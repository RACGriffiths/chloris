import path from 'node:path';
import { z } from 'zod';

/**
 * Chloris's configuration, read from environment variables and checked once at start-up.
 * The variables are listed in docs/spec.md (Configuration). This module has no SvelteKit
 * imports, so command-line tools can use it with `process.env` as well.
 */

export type Env = Readonly<Record<string, string | undefined>>;

export interface SmtpConfig {
	host: string;
	port: number;
	user?: string;
	password?: string;
	from: string;
}

export interface PushConfig {
	publicKey: string;
	privateKey: string;
	subject: string;
}

export interface Config {
	/** Public origin, e.g. `https://plants.example.com`, with no trailing slash. */
	origin: string;
	port: number;
	host: string;
	authSecret: string;
	/** Absolute path of the folder holding the database. */
	dataDir: string;
	/** Absolute path of the folder holding photo files. */
	photosDir: string;
	/** Raw `BODY_SIZE_LIMIT`, as read by the Node adapter. */
	bodySizeLimit?: string;
	addressHeader?: string;
	xffDepth?: number;
	/** `null` when email is switched off. */
	smtp: SmtpConfig | null;
	/** `null` when web push is switched off. */
	push: PushConfig | null;
	photoDeleteGraceDays: number;
}

export class ConfigError extends Error {
	constructor(readonly problems: string[]) {
		super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
		this.name = 'ConfigError';
	}
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

const required = (message = 'is required') =>
	z.string({ error: (issue) => (issue.input === undefined ? message : 'must be text') });

const integer = (min: number, max = Number.MAX_SAFE_INTEGER) =>
	z
		.string()
		.regex(/^\d+$/, 'must be a whole number')
		.transform(Number)
		.pipe(z.number().min(min, `must be at least ${min}`).max(max, `must be at most ${max}`));

const origin = required().transform((value, ctx) => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		ctx.addIssue({ code: 'custom', message: 'must be a URL such as https://plants.example.com' });
		return z.NEVER;
	}
	if (
		url.protocol !== 'https:' &&
		!(url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname))
	) {
		ctx.addIssue({
			code: 'custom',
			message: 'must use https:// (plain http:// is only allowed for localhost)'
		});
	}
	if (value !== url.origin) {
		ctx.addIssue({
			code: 'custom',
			message: `must be just the origin, with no path or trailing slash (did you mean ${url.origin}?)`
		});
	}
	return url.origin;
});

const envSchema = z.object({
	ORIGIN: origin,
	PORT: integer(1, 65535).default(3000),
	HOST: z.string().default('0.0.0.0'),
	BETTER_AUTH_SECRET: required().min(
		32,
		'must be at least 32 characters; generate one with: openssl rand -base64 32'
	),
	DATA_DIR: z.string().default('./data'),
	PHOTOS_DIR: z.string().optional(),
	BODY_SIZE_LIMIT: z
		.string()
		.regex(/^(\d+[KMG]?|Infinity)$/i, 'must be a number of bytes, optionally ending in K, M or G')
		.optional(),
	ADDRESS_HEADER: z.string().optional(),
	XFF_DEPTH: integer(1).optional(),
	SMTP_HOST: z.string().optional(),
	SMTP_PORT: integer(1, 65535).default(587),
	SMTP_USER: z.string().optional(),
	SMTP_PASSWORD: z.string().optional(),
	SMTP_FROM: z.string().includes('@', { error: 'must contain an email address' }).optional(),
	VAPID_PUBLIC_KEY: z.string().optional(),
	VAPID_PRIVATE_KEY: z.string().optional(),
	VAPID_SUBJECT: z
		.string()
		.regex(/^(mailto:|https:\/\/)/, 'must start with mailto: or https://')
		.optional(),
	PHOTO_DELETE_GRACE_DAYS: integer(0).default(30)
});

/** Settings that only work as a set: either all of `required` are set, or none of `all`. */
function checkGroup(
	values: Record<string, unknown>,
	all: string[],
	required: string[],
	feature: string
): string[] {
	const anySet = all.some((name) => values[name] !== undefined);
	if (!anySet) return [];
	return required
		.filter((name) => values[name] === undefined)
		.map((name) => `${name}: is required when any of ${all.join(', ')} is set (${feature})`);
}

/**
 * Validates the environment and returns a typed configuration.
 * Empty values count as unset. Throws a `ConfigError` listing every problem at once.
 */
export function parseConfig(env: Env): Config {
	const cleaned = Object.fromEntries(
		Object.keys(envSchema.shape).map((name) => {
			const value = env[name]?.trim();
			return [name, value === '' ? undefined : value];
		})
	);

	const result = envSchema.safeParse(cleaned);
	if (!result.success) {
		throw new ConfigError(
			result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
		);
	}
	const values = result.data;

	const problems = [
		...checkGroup(
			cleaned,
			['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'],
			['SMTP_HOST', 'SMTP_FROM'],
			'email'
		),
		...checkGroup(cleaned, ['SMTP_USER', 'SMTP_PASSWORD'], ['SMTP_USER', 'SMTP_PASSWORD'], 'email'),
		...checkGroup(
			cleaned,
			['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
			['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
			'web push'
		)
	];
	if (
		values.XFF_DEPTH !== undefined &&
		values.ADDRESS_HEADER?.toLowerCase() !== 'x-forwarded-for'
	) {
		problems.push('XFF_DEPTH: only applies when ADDRESS_HEADER is X-Forwarded-For');
	}
	if (problems.length > 0) throw new ConfigError(problems);

	const dataDir = path.resolve(values.DATA_DIR);

	return {
		origin: values.ORIGIN,
		port: values.PORT,
		host: values.HOST,
		authSecret: values.BETTER_AUTH_SECRET,
		dataDir,
		photosDir: values.PHOTOS_DIR ? path.resolve(values.PHOTOS_DIR) : path.join(dataDir, 'photos'),
		bodySizeLimit: values.BODY_SIZE_LIMIT,
		addressHeader: values.ADDRESS_HEADER,
		xffDepth: values.XFF_DEPTH,
		smtp:
			values.SMTP_HOST && values.SMTP_FROM
				? {
						host: values.SMTP_HOST,
						port: values.SMTP_PORT,
						user: values.SMTP_USER,
						password: values.SMTP_PASSWORD,
						from: values.SMTP_FROM
					}
				: null,
		push:
			values.VAPID_PUBLIC_KEY && values.VAPID_PRIVATE_KEY && values.VAPID_SUBJECT
				? {
						publicKey: values.VAPID_PUBLIC_KEY,
						privateKey: values.VAPID_PRIVATE_KEY,
						subject: values.VAPID_SUBJECT
					}
				: null,
		photoDeleteGraceDays: values.PHOTO_DELETE_GRACE_DAYS
	};
}

let current: Config | undefined;

/** Validates the environment once at start-up and keeps the result for `getConfig()`. */
export function initConfig(env: Env): Config {
	current = parseConfig(env);
	return current;
}

export function getConfig(): Config {
	if (!current) throw new Error('Configuration has not been loaded; call initConfig() at start-up');
	return current;
}
