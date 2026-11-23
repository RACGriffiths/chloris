import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig, type Env } from './config';

const minimal: Env = {
	ORIGIN: 'https://plants.example.com',
	BETTER_AUTH_SECRET: 'a'.repeat(32)
};

function problemsFor(env: Env): string[] {
	try {
		parseConfig(env);
	} catch (error) {
		if (error instanceof ConfigError) return error.problems;
		throw error;
	}
	throw new Error('expected parseConfig to throw');
}

describe('parseConfig', () => {
	it('applies the defaults from the spec', () => {
		const config = parseConfig(minimal);

		expect(config).toMatchObject({
			origin: 'https://plants.example.com',
			port: 3000,
			host: '0.0.0.0',
			dataDir: path.resolve('data'),
			photosDir: path.resolve('data', 'photos'),
			smtp: null,
			push: null,
			photoDeleteGraceDays: 30
		});
	});

	it('reports every missing required variable at once', () => {
		expect(problemsFor({})).toEqual(['ORIGIN: is required', 'BETTER_AUTH_SECRET: is required']);
	});

	it('treats empty and blank values as unset', () => {
		const config = parseConfig({ ...minimal, PORT: '', SMTP_HOST: '  ', DATA_DIR: '' });

		expect(config.port).toBe(3000);
		expect(config.smtp).toBeNull();
		expect(config.dataDir).toBe(path.resolve('data'));
	});

	describe('ORIGIN', () => {
		it('requires https', () => {
			expect(problemsFor({ ...minimal, ORIGIN: 'http://plants.example.com' })).toEqual([
				'ORIGIN: must use https:// (plain http:// is only allowed for localhost)'
			]);
		});

		it.each(['http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:3000'])(
			'allows plain http for %s',
			(value) => {
				expect(parseConfig({ ...minimal, ORIGIN: value }).origin).toBe(value);
			}
		);

		it('rejects a path or trailing slash', () => {
			expect(problemsFor({ ...minimal, ORIGIN: 'https://plants.example.com/' })).toEqual([
				'ORIGIN: must be just the origin, with no path or trailing slash (did you mean https://plants.example.com?)'
			]);
			expect(problemsFor({ ...minimal, ORIGIN: 'https://example.com/plants' })).toHaveLength(1);
		});

		it('rejects something that is not a URL', () => {
			expect(problemsFor({ ...minimal, ORIGIN: 'plants.example.com' })).toEqual([
				'ORIGIN: must be a URL such as https://plants.example.com'
			]);
		});
	});

	it('requires a secret of at least 32 characters', () => {
		expect(problemsFor({ ...minimal, BETTER_AUTH_SECRET: 'short' })).toEqual([
			'BETTER_AUTH_SECRET: must be at least 32 characters; generate one with: openssl rand -base64 32'
		]);
	});

	it('parses numbers and rejects ones out of range', () => {
		expect(parseConfig({ ...minimal, PORT: '8080', PHOTO_DELETE_GRACE_DAYS: '0' })).toMatchObject({
			port: 8080,
			photoDeleteGraceDays: 0
		});
		expect(problemsFor({ ...minimal, PORT: '70000' })).toEqual(['PORT: must be at most 65535']);
		expect(problemsFor({ ...minimal, PORT: '3000abc' })).toEqual(['PORT: must be a whole number']);
		expect(problemsFor({ ...minimal, PHOTO_DELETE_GRACE_DAYS: '-1' })).toEqual([
			'PHOTO_DELETE_GRACE_DAYS: must be a whole number'
		]);
	});

	it('resolves folders, defaulting photos to a subfolder of DATA_DIR', () => {
		expect(parseConfig({ ...minimal, DATA_DIR: '/srv/chloris' })).toMatchObject({
			dataDir: '/srv/chloris',
			photosDir: '/srv/chloris/photos'
		});
		expect(
			parseConfig({ ...minimal, DATA_DIR: '/srv/chloris', PHOTOS_DIR: '/mnt/photos' }).photosDir
		).toBe('/mnt/photos');
	});

	it('accepts the Node adapter body size formats', () => {
		for (const value of ['25M', '512K', '1048576', 'Infinity']) {
			expect(parseConfig({ ...minimal, BODY_SIZE_LIMIT: value }).bodySizeLimit).toBe(value);
		}
		expect(problemsFor({ ...minimal, BODY_SIZE_LIMIT: '512kb' })).toEqual([
			'BODY_SIZE_LIMIT: must be a number of bytes, optionally ending in K, M or G'
		]);
	});

	it('only allows XFF_DEPTH with X-Forwarded-For', () => {
		expect(
			parseConfig({ ...minimal, ADDRESS_HEADER: 'X-Forwarded-For', XFF_DEPTH: '1' })
		).toMatchObject({ addressHeader: 'X-Forwarded-For', xffDepth: 1 });
		expect(problemsFor({ ...minimal, XFF_DEPTH: '1' })).toEqual([
			'XFF_DEPTH: only applies when ADDRESS_HEADER is X-Forwarded-For'
		]);
	});

	describe('email', () => {
		it('is switched on by a host and sender', () => {
			expect(
				parseConfig({
					...minimal,
					SMTP_HOST: 'smtp.example.com',
					SMTP_FROM: 'Chloris <c@example.com>'
				}).smtp
			).toEqual({
				host: 'smtp.example.com',
				port: 587,
				user: undefined,
				password: undefined,
				from: 'Chloris <c@example.com>'
			});
		});

		it('rejects a partial setup', () => {
			expect(problemsFor({ ...minimal, SMTP_HOST: 'smtp.example.com' })).toEqual([
				'SMTP_FROM: is required when any of SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM is set (email)'
			]);
			expect(
				problemsFor({
					...minimal,
					SMTP_HOST: 'smtp.example.com',
					SMTP_FROM: 'c@example.com',
					SMTP_USER: 'chloris'
				})
			).toEqual(['SMTP_PASSWORD: is required when any of SMTP_USER, SMTP_PASSWORD is set (email)']);
		});
	});

	describe('web push', () => {
		const vapid = {
			VAPID_PUBLIC_KEY: 'public',
			VAPID_PRIVATE_KEY: 'private',
			VAPID_SUBJECT: 'mailto:admin@example.com'
		};

		it('is switched on by all three keys', () => {
			expect(parseConfig({ ...minimal, ...vapid }).push).toEqual({
				publicKey: 'public',
				privateKey: 'private',
				subject: 'mailto:admin@example.com'
			});
		});

		it('rejects a partial setup and a bad subject', () => {
			expect(problemsFor({ ...minimal, VAPID_PUBLIC_KEY: 'public' })).toHaveLength(2);
			expect(problemsFor({ ...minimal, ...vapid, VAPID_SUBJECT: 'admin@example.com' })).toEqual([
				'VAPID_SUBJECT: must start with mailto: or https://'
			]);
		});
	});

	it('lists the problems in the error message', () => {
		expect(() => parseConfig({})).toThrow(
			'Invalid configuration:\n  - ORIGIN: is required\n  - BETTER_AUTH_SECRET: is required'
		);
	});
});
