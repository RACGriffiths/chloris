import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Declares the environment variables the app reads, so SvelteKit makes them available through
 * `$app/env/private` (server-only). Every variable is optional here: `parseConfig()` in
 * `#lib/server/config` validates them together when the server starts, which lets it check
 * settings that depend on each other, such as the SMTP group. See docs/spec.md (Configuration).
 */
const optional = (value: string | undefined) => value;

export const variables = defineEnvVars({
	ORIGIN: {
		description: 'Public HTTPS address, e.g. https://plants.example.com. Required.',
		schema: optional
	},
	PORT: { description: 'Port the Node server listens on. Default 3000.', schema: optional },
	HOST: { description: 'Address the Node server listens on. Default 0.0.0.0.', schema: optional },
	BETTER_AUTH_SECRET: {
		description: 'Secret for signing sessions and tokens, at least 32 characters. Required.',
		schema: optional
	},
	DATA_DIR: {
		description: 'Folder holding the SQLite database. Default ./data.',
		schema: optional
	},
	PHOTOS_DIR: {
		description: 'Folder holding photo files. Default $DATA_DIR/photos.',
		schema: optional
	},
	BODY_SIZE_LIMIT: {
		description: 'Maximum request size, e.g. 25M. Read by the Node adapter.',
		schema: optional
	},
	ADDRESS_HEADER: {
		description: "Header carrying the visitor's IP behind a proxy, e.g. X-Forwarded-For.",
		schema: optional
	},
	XFF_DEPTH: {
		description: 'Number of trusted proxies in front of the app, with X-Forwarded-For.',
		schema: optional
	},
	SMTP_HOST: { description: 'SMTP server. Leave unset to switch email off.', schema: optional },
	SMTP_PORT: { description: 'SMTP port. Default 587.', schema: optional },
	SMTP_USER: { description: 'SMTP user name.', schema: optional },
	SMTP_PASSWORD: { description: 'SMTP password.', schema: optional },
	SMTP_FROM: { description: 'Sender address for emails.', schema: optional },
	VAPID_PUBLIC_KEY: {
		description: 'Web push public key. Push is off without it.',
		schema: optional
	},
	VAPID_PRIVATE_KEY: { description: 'Web push private key.', schema: optional },
	VAPID_SUBJECT: {
		description: 'Web push contact, a mailto: or https:// URL.',
		schema: optional
	},
	PHOTO_DELETE_GRACE_DAYS: {
		description: "Days a deleted photo's files stay on disk. Default 30.",
		schema: optional
	}
});
