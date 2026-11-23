import { describe, expect, it } from 'vitest';
import { authHeaders, authRequest, isAuthPath, isBrowserAuthEndpoint } from './http';
import { CLIENT_ADDRESS_HEADER } from './index';

describe('isBrowserAuthEndpoint', () => {
	it('allows only the passkey ceremonies', () => {
		for (const path of [
			'/api/auth/passkey/generate-register-options',
			'/api/auth/passkey/verify-registration',
			'/api/auth/passkey/generate-authenticate-options',
			'/api/auth/passkey/verify-authentication'
		]) {
			expect(isBrowserAuthEndpoint(path), path).toBe(true);
		}
	});

	it('blocks the rest of BetterAuth, which the server calls itself', () => {
		for (const path of [
			'/api/auth',
			'/api/auth/',
			'/api/auth/get-session',
			'/api/auth/sign-in/magic-link',
			'/api/auth/magic-link/verify',
			'/api/auth/sign-out',
			'/api/auth/update-user',
			'/api/auth/list-sessions',
			'/api/auth/revoke-session',
			'/api/auth/passkey/list-user-passkeys',
			'/api/auth/passkey/delete-passkey',
			'/api/auth/organization/create',
			'/api/auth/organization/update-member-role',
			'/api/auth/passkey/verify-registration/',
			'/api/auth/passkey/verify-registration/extra'
		]) {
			expect(isAuthPath(path), path).toBe(true);
			expect(isBrowserAuthEndpoint(path), path).toBe(false);
		}
	});

	it('leaves other paths alone', () => {
		expect(isAuthPath('/api/health')).toBe(false);
		expect(isAuthPath('/api/authentic')).toBe(false);
		expect(isBrowserAuthEndpoint('/passkey/verify-registration')).toBe(false);
	});
});

describe('authHeaders', () => {
	const event = (headers: Record<string, string>, address: () => string) => ({
		request: new Request('http://localhost/', { headers }),
		getClientAddress: address
	});

	it("replaces any address the visitor sent with SvelteKit's", () => {
		const headers = authHeaders(
			event({ [CLIENT_ADDRESS_HEADER]: '6.6.6.6', cookie: 'a=b' }, () => '203.0.113.7')
		);

		expect(headers.get(CLIENT_ADDRESS_HEADER)).toBe('203.0.113.7');
		expect(headers.get('cookie')).toBe('a=b');
	});

	it('sends no address when SvelteKit cannot tell it', () => {
		const headers = authHeaders(
			event({ [CLIENT_ADDRESS_HEADER]: '6.6.6.6' }, () => {
				throw new Error('Address header was requested but not present');
			})
		);

		expect(headers.has(CLIENT_ADDRESS_HEADER)).toBe(false);
	});

	it("keeps the request's method and body for BetterAuth's handler", async () => {
		const request = authRequest({
			request: new Request('http://localhost/api/auth/passkey/verify-registration', {
				method: 'POST',
				body: '{"a":1}',
				headers: { 'content-type': 'application/json' }
			}),
			getClientAddress: () => '203.0.113.7'
		});

		expect(request.method).toBe('POST');
		expect(await request.text()).toBe('{"a":1}');
		expect(request.headers.get(CLIENT_ADDRESS_HEADER)).toBe('203.0.113.7');
	});
});
