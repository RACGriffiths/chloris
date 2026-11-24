import type { RequestEvent } from '@sveltejs/kit';

/**
 * Rate limits on asking for sign-in links, signing in and uploading photos (docs/spec.md,
 * Security and privacy; D56). Counts are kept in memory: Chloris is one process (D04), so there's
 * nothing to share them with, and a restart forgetting them only lets someone try again sooner.
 *
 * This module has no SvelteKit runtime imports, so unit tests can use it directly.
 */

const MINUTE = 60_000;

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

interface Window {
	count: number;
	/** When the count starts again from nothing, in milliseconds since the epoch. */
	resetAt: number;
}

/**
 * At most `max` attempts per key in `windowMs`, counted from the key's first attempt. A key is a
 * visitor's address (`clientKey()`), a person, or an email address.
 */
export class RateLimiter {
	readonly #windows = new Map<string, Window>();

	/** Called when a key uses its last attempt in a window: once a window, however many follow. */
	onLimit?: (key: string) => void;

	constructor(
		readonly max: number,
		readonly windowMs: number,
		/** How many keys to remember at most, so a flood of addresses can't use up memory. */
		readonly maxKeys = 10_000
	) {}

	/** Whether `key` is still under the limit, without counting an attempt. */
	check(key: string, now = Date.now()): LimitResult {
		const window = this.#window(key, now);
		if (!window || window.count < this.max) return { ok: true };
		return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) };
	}

	/** Counts an attempt for `key`, unless the limit is already reached: then it's refused. */
	consume(key: string, now = Date.now()): LimitResult {
		const checked = this.check(key, now);
		if (checked.ok) this.count(key, now);
		return checked;
	}

	/** Counts an attempt for `key` after the fact, such as a sign-in that failed. */
	count(key: string, now = Date.now()): void {
		let window = this.#window(key, now);
		if (window) {
			window.count += 1;
		} else {
			this.#makeRoom(now);
			window = { count: 1, resetAt: now + this.windowMs };
			this.#windows.set(key, window);
		}
		if (window.count === this.max) this.onLimit?.(key);
	}

	/** The key's current window, or `undefined` if it has none or it has ended. */
	#window(key: string, now: number): Window | undefined {
		const window = this.#windows.get(key);
		if (window && window.resetAt <= now) {
			this.#windows.delete(key);
			return undefined;
		}
		return window;
	}

	/** Forgets ended windows once the map is full, then the oldest keys if it still is. */
	#makeRoom(now: number): void {
		if (this.#windows.size < this.maxKeys) return;
		for (const [key, window] of this.#windows) {
			if (window.resetAt <= now) this.#windows.delete(key);
		}
		// A Map keeps keys in the order they were added, so the first are the oldest.
		for (const key of this.#windows.keys()) {
			if (this.#windows.size < this.maxKeys) break;
			this.#windows.delete(key);
		}
	}
}

export type LimitName = keyof typeof limits;

/** The limits Chloris applies. Each counts per visitor's address unless it says otherwise. */
export const limits = {
	/** Asking for a sign-in link by email. */
	signInLinkVisitor: new RateLimiter(10, 60 * MINUTE),
	/** Asking for a sign-in link for one email address, from anywhere, so nobody can flood a
	 * mailbox. Counted whether or not the address has an account, so it reveals nothing. */
	signInLinkAddress: new RateLimiter(3, 15 * MINUTE),
	/** Sign-ins that failed: a sign-in link or invite that didn't work, or a passkey that wasn't
	 * accepted. Once reached, every sign-in from that address is refused until the window ends. */
	failedSignIn: new RateLimiter(20, 15 * MINUTE),
	/** Requests to BetterAuth's passkey endpoints, each of which stores a challenge. */
	passkey: new RateLimiter(60, MINUTE),
	/** Photos uploaded, counted per person: uploading needs an account, and a household may
	 * share one address. */
	upload: new RateLimiter(60, 10 * MINUTE)
};

/**
 * Who a request comes from, for rate limits: its address as SvelteKit's Node adapter determines
 * it, from `ADDRESS_HEADER` and `XFF_DEPTH` behind a proxy. An IPv6 address counts by its /64
 * network, which a household or phone usually has to itself and can pick any address in.
 */
export function clientKey(event: Pick<RequestEvent, 'getClientAddress'>): string {
	try {
		return addressKey(event.getClientAddress());
	} catch {
		// ADDRESS_HEADER is set, but this request doesn't have it.
		return 'unknown';
	}
}

/** An IPv4 address as it is; an IPv6 address as its /64 network. */
export function addressKey(address: string): string {
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
	if (mapped) return mapped[1];
	if (!address.includes(':')) return address;

	const bare = address.split('%')[0].toLowerCase();
	const halves = bare.split('::');
	if (halves.length > 2) return bare;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	// A dotted IPv4 ending, as in `64:ff9b::192.0.2.1`, stands for two groups.
	const size = (groups: string[]) => groups.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
	const missing = 8 - size(head) - size(tail);
	if (missing < 0 || (halves.length === 1 && missing !== 0)) return bare;

	const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
	const network = groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16));
	if (network.some((group) => group === 'NaN')) return bare;
	return `${network.join(':')}::/64`;
}

/**
 * Counts a request for a sign-in link to `email`, from the visitor and for the address. Call it
 * before looking for the account, so the answer is the same whether or not there is one.
 */
export function consumeSignInLink(
	event: Pick<RequestEvent, 'getClientAddress'>,
	email: string
): LimitResult {
	const visitor = limits.signInLinkVisitor.consume(clientKey(event));
	return visitor.ok ? limits.signInLinkAddress.consume(email.trim().toLowerCase()) : visitor;
}

/** The message for a sign-in link refused by `consumeSignInLink()`. */
export const tooManyLinks = ({ retryAfterSeconds }: { retryAfterSeconds: number }) =>
	`Too many sign-in links have been asked for. ${tryAgainIn(retryAfterSeconds)}`;

/** The message for a sign-in refused after too many that failed. */
export const tooManySignIns = ({ retryAfterSeconds }: { retryAfterSeconds: number }) =>
	`Too many sign-ins from here didn't work. ${tryAgainIn(retryAfterSeconds)}`;

/** "Try again in 5 minutes.", for a refusal's message. */
export function tryAgainIn(retryAfterSeconds: number): string {
	const minutes = Math.ceil(retryAfterSeconds / 60);
	return minutes <= 1 ? 'Try again in a minute.' : `Try again in ${minutes} minutes.`;
}

/**
 * Whether a request looks as if it came through a proxy while `ADDRESS_HEADER` isn't set. Then
 * every visitor seems to come from the proxy's address, and they all share one set of limits.
 */
export function looksProxied(headers: Headers, addressHeader: string | undefined): boolean {
	if (addressHeader) return false;
	return ['x-forwarded-for', 'forwarded', 'x-real-ip'].some((name) => headers.has(name));
}
