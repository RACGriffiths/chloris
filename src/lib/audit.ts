import { taskNoun } from './care';
import { roleName } from './roles';

/**
 * The audit log's entries, and how they read on screen (docs/spec.md, Security and privacy;
 * D57). Each records what it was done to as it was at the time, such as a deleted room's name,
 * so the entry still makes sense once the room has gone.
 */

export const AUDIT_ACTIONS = [
	'sign-in',
	'passkey-added',
	'passkey-removed',
	'home-created',
	'invite-created',
	'invite-cancelled',
	'invite-accepted',
	'room-deleted',
	'schedule-deleted',
	'photo-deleted'
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** How someone signed in: with a passkey, a sign-in link, or by joining from an invite link. */
export type SignInMethod = 'passkey' | 'link' | 'invite';

/** What each action records about what it was done to. */
export interface AuditDetails {
	'sign-in': { method: SignInMethod };
	'passkey-added': { name: string };
	/** `unproven`: removed because it was added before the account's email address was proven
	 * (D50), rather than by the person. */
	'passkey-removed': { name: string; unproven?: boolean };
	'home-created': { name: string };
	'invite-created': { role: string };
	'invite-cancelled': { role: string };
	'invite-accepted': { role: string };
	'room-deleted': { name: string };
	'schedule-deleted': { plant: string; task: string };
	'photo-deleted': { plant: string };
}

/** An action with its details, typed together. */
export type AuditEntry = {
	[A in AuditAction]: { action: A; detail: AuditDetails[A] };
}[AuditAction];

const withArticle = (word: string) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
const role = (value: string) => withArticle(roleName(value).toLowerCase());

const SIGN_IN: Record<SignInMethod, string> = {
	passkey: 'signed in with a passkey',
	link: 'signed in with a sign-in link',
	invite: 'signed in for the first time, from an invite link'
};

/** What happened, to follow the person's name: "signed in with a passkey". */
export function describeAuditEntry(entry: AuditEntry): string {
	switch (entry.action) {
		case 'sign-in':
			return SIGN_IN[entry.detail.method];
		case 'passkey-added':
			return `added a passkey (${entry.detail.name})`;
		case 'passkey-removed':
			return entry.detail.unproven
				? `lost a passkey (${entry.detail.name}) added before their email address was confirmed`
				: `removed a passkey (${entry.detail.name})`;
		case 'home-created':
			return `created the home ${entry.detail.name}`;
		case 'invite-created':
			return `made an invite link for ${role(entry.detail.role)}`;
		case 'invite-cancelled':
			return `cancelled an invite link for ${role(entry.detail.role)}`;
		case 'invite-accepted':
			return `joined as ${role(entry.detail.role)}, from an invite link`;
		case 'room-deleted':
			return `deleted the room ${entry.detail.name}`;
		case 'schedule-deleted':
			return `removed the ${taskNoun(entry.detail.task)} schedule of ${entry.detail.plant}`;
		case 'photo-deleted':
			return `deleted a photo of ${entry.detail.plant}`;
	}
}

/**
 * The server's own log (D58): what belongs to no home, or to every home a person is in. Read
 * with `node build/cli log` by whoever hosts Chloris, and later by server admins.
 */
export const SERVER_ACTIONS = [
	'sign-in',
	'sign-in-failed',
	'passkey-added',
	'passkey-removed',
	'limit-reached',
	'sign-in-link-printed'
] as const;

export type ServerAction = (typeof SERVER_ACTIONS)[number];

export interface ServerDetails {
	'sign-in': { method: SignInMethod };
	'sign-in-failed': { method: SignInMethod };
	'passkey-added': { name: string };
	'passkey-removed': { name: string; unproven?: boolean };
	/** `limit` names one of the rate limits (D56); `key` is what it counted: an address, a
	 * person's id or an email address. */
	'limit-reached': { limit: string; key: string };
	/** `created`: the account was made for it; `canCreateHome`: the account may create a home. */
	'sign-in-link-printed': { email: string; created: boolean; canCreateHome: boolean };
}

export type ServerEntry = {
	[A in ServerAction]: { action: A; detail: ServerDetails[A] };
}[ServerAction];

/** The account-wide entries, which go in the server's log and in each of the person's homes. */
export type AccountEntry = Extract<
	AuditEntry,
	{ action: 'sign-in' | 'passkey-added' | 'passkey-removed' }
>;

const FAILED: Record<SignInMethod, string> = {
	passkey: 'A passkey sign-in was refused',
	link: "A sign-in link that doesn't work was used",
	invite: "An invite link that doesn't work was tried"
};

const LIMITS: Record<string, (key: string) => string> = {
	signInLinkVisitor: (key) => `sign-in links asked for from ${key}`,
	signInLinkAddress: (key) => `sign-in links for ${key}`,
	failedSignIn: (key) => `failed sign-ins from ${key}; sign-ins from there are refused for now`,
	passkey: (key) => `passkey requests from ${key}`,
	upload: () => 'photo uploads'
};

/**
 * A server log entry as a sentence. `who` is the person's email address, or `null` if there's no
 * person, such as for a sign-in that failed.
 */
export function describeServerEntry(entry: ServerEntry, who: string | null): string {
	const person = who ?? 'Someone whose account was deleted';
	switch (entry.action) {
		case 'sign-in':
		case 'passkey-added':
		case 'passkey-removed':
			return `${person} ${describeAuditEntry(entry)}`;
		case 'sign-in-failed':
			return FAILED[entry.detail.method];
		case 'limit-reached': {
			const { limit, key } = entry.detail;
			const what = Object.hasOwn(LIMITS, limit) ? LIMITS[limit](key) : `${limit} for ${key}`;
			return `${who ? `${who} used up the limit on ` : 'Limit used up on '}${what}`;
		}
		case 'sign-in-link-printed': {
			const { email, created, canCreateHome } = entry.detail;
			const account = created ? 'a new account' : 'an existing account';
			return `The command-line tool printed a sign-in link for ${email} (${account}${canCreateHome ? ', which may create a home' : ''})`;
		}
	}
}
