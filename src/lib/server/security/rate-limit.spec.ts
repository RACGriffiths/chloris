import { describe, expect, it } from 'vitest';
import {
	RateLimiter,
	addressKey,
	clientKey,
	consumeSignInLink,
	limits,
	looksProxied,
	tryAgainIn
} from './rate-limit';

const MINUTE = 60_000;
const start = Date.parse('2026-11-24T09:00:00Z');

describe('RateLimiter', () => {
	it('allows `max` attempts in the window, then refuses until it ends', () => {
		const limiter = new RateLimiter(3, 10 * MINUTE);

		for (let i = 0; i < 3; i++)
			expect(limiter.consume('a', start + i * MINUTE)).toEqual({ ok: true });

		expect(limiter.consume('a', start + 4 * MINUTE)).toEqual({ ok: false, retryAfterSeconds: 360 });
		expect(limiter.check('a', start + 10 * MINUTE - 1)).toEqual({
			ok: false,
			retryAfterSeconds: 1
		});
		expect(limiter.consume('a', start + 10 * MINUTE)).toEqual({ ok: true });
	});

	it("doesn't count refused attempts, so waiting is enough", () => {
		const limiter = new RateLimiter(1, MINUTE);
		limiter.consume('a', start);

		for (let i = 1; i < 50; i++) limiter.consume('a', start + i * 1000);

		expect(limiter.consume('a', start + MINUTE)).toEqual({ ok: true });
	});

	it('says when a key uses its last attempt, once a window', () => {
		const limiter = new RateLimiter(2, MINUTE);
		const reached: string[] = [];
		limiter.onLimit = (key) => reached.push(key);

		for (let i = 0; i < 5; i++) limiter.consume('a', start + i);
		limiter.count('b', start);
		expect(reached).toEqual(['a']);

		limiter.consume('a', start + MINUTE);
		limiter.consume('a', start + MINUTE + 1);
		expect(reached).toEqual(['a', 'a']);
	});

	it('keeps each key apart', () => {
		const limiter = new RateLimiter(1, MINUTE);

		expect(limiter.consume('a', start).ok).toBe(true);
		expect(limiter.consume('b', start).ok).toBe(true);
		expect(limiter.consume('a', start).ok).toBe(false);
	});

	it('checks without counting, and counts failures after the fact', () => {
		const limiter = new RateLimiter(2, MINUTE);

		expect(limiter.check('a', start)).toEqual({ ok: true });
		expect(limiter.check('a', start)).toEqual({ ok: true });
		limiter.count('a', start);
		limiter.count('a', start + 1000);

		expect(limiter.check('a', start + 2000)).toEqual({ ok: false, retryAfterSeconds: 58 });
	});

	it('remembers at most `maxKeys` keys, forgetting ended windows and then the oldest', () => {
		const limiter = new RateLimiter(1, MINUTE, 2);
		limiter.consume('old', start);
		limiter.consume('a', start + 30_000);

		// `old`'s window has ended, so it makes room.
		limiter.consume('b', start + MINUTE);
		expect(limiter.check('a', start + MINUTE).ok).toBe(false);
		expect(limiter.check('b', start + MINUTE).ok).toBe(false);

		// Nothing has ended, so the oldest key goes.
		limiter.consume('c', start + MINUTE + 1);
		expect(limiter.check('a', start + MINUTE + 2).ok).toBe(true);
		expect(limiter.check('c', start + MINUTE + 2).ok).toBe(false);
	});
});

describe('addressKey', () => {
	it('keeps an IPv4 address as it is, also when written as IPv6', () => {
		expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
		expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
	});

	it('counts an IPv6 address by its /64 network', () => {
		expect(addressKey('2001:db8:85a3:12:8a2e:370:7334:1')).toBe('2001:db8:85a3:12::/64');
		expect(addressKey('2001:0DB8:85A3:0012:ffff::2')).toBe('2001:db8:85a3:12::/64');
		expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
		expect(addressKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
		expect(addressKey('::1')).toBe('0:0:0:0::/64');
		expect(addressKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
	});

	it("leaves something it can't read as it is", () => {
		expect(addressKey('1::2::3')).toBe('1::2::3');
		expect(addressKey('1:2:3')).toBe('1:2:3');
	});
});

describe('clientKey', () => {
	it("uses the visitor's address, and one key for requests missing ADDRESS_HEADER", () => {
		expect(clientKey({ getClientAddress: () => '2001:db8::5' })).toBe('2001:db8:0:0::/64');
		expect(
			clientKey({
				getClientAddress: () => {
					throw new Error('Address header was specified with ADDRESS_HEADER but is absent');
				}
			})
		).toBe('unknown');
	});
});

describe('consumeSignInLink', () => {
	const from = (address: string) => ({ getClientAddress: () => address });

	it('limits links for one address, from anywhere, whatever its case', () => {
		const max = limits.signInLinkAddress.max;
		for (let i = 0; i < max; i++) {
			expect(consumeSignInLink(from(`198.51.100.${i}`), 'Pat@example.com').ok).toBe(true);
		}

		expect(consumeSignInLink(from('198.51.100.99'), ' pat@example.com').ok).toBe(false);
		expect(consumeSignInLink(from('198.51.100.99'), 'sam@example.com').ok).toBe(true);
	});

	it('limits links asked for from one visitor, for any addresses', () => {
		const max = limits.signInLinkVisitor.max;
		for (let i = 0; i < max; i++) {
			expect(consumeSignInLink(from('192.0.2.1'), `person-${i}@example.com`).ok).toBe(true);
		}

		expect(consumeSignInLink(from('192.0.2.1'), 'another@example.com').ok).toBe(false);
		// Refused before the address was counted.
		expect(limits.signInLinkAddress.check('another@example.com').ok).toBe(true);
	});
});

describe('tryAgainIn', () => {
	it('rounds up to whole minutes', () => {
		expect(tryAgainIn(1)).toBe('Try again in a minute.');
		expect(tryAgainIn(60)).toBe('Try again in a minute.');
		expect(tryAgainIn(61)).toBe('Try again in 2 minutes.');
		expect(tryAgainIn(900)).toBe('Try again in 15 minutes.');
	});
});

describe('looksProxied', () => {
	it('is true for forwarding headers only while ADDRESS_HEADER is unset', () => {
		const proxied = new Headers({ 'x-forwarded-for': '203.0.113.7' });

		expect(looksProxied(proxied, undefined)).toBe(true);
		expect(looksProxied(new Headers({ forwarded: 'for=203.0.113.7' }), undefined)).toBe(true);
		expect(looksProxied(proxied, 'X-Forwarded-For')).toBe(false);
		expect(looksProxied(new Headers(), undefined)).toBe(false);
	});
});
