/**
 * How the end-to-end tests run the app. The server (playwright.config.ts) and the command-line
 * tool (in the tests) need the same settings, so they share the same database.
 */
export const port = 4173;
export const origin = `http://localhost:${port}`;

export const serverEnv = {
	HOST: '127.0.0.1',
	PORT: String(port),
	ORIGIN: origin,
	BETTER_AUTH_SECRET: 'end-to-end-tests-only-not-a-real-secret',
	// Playwright empties test-results before each run, so every run starts with a new database.
	DATA_DIR: 'test-results/e2e-data',
	// As the Docker image sets it, so originals sent without JavaScript fit.
	BODY_SIZE_LIMIT: '25M',
	// As behind one proxy, so a test can send `X-Forwarded-For` to be a visitor of its own, with
	// rate limits of its own (tests/security.e2e.ts). Requests without it all share one set.
	ADDRESS_HEADER: 'X-Forwarded-For',
	XFF_DEPTH: '1'
};

/**
 * A second copy of the app with email on, for the tests that need it, such as the daily digest's
 * settings. Its mail goes to the pretend mail server in `tests/mailbox.ts`, which the tests read
 * with `readMail()` in `tests/helpers.ts`. It has a database of its own.
 */
export const emailPort = 4174;
export const emailOrigin = `http://localhost:${emailPort}`;
export const mailboxSmtpPort = 4175;
export const mailboxUrl = 'http://127.0.0.1:4176';

export const emailServerEnv = {
	...serverEnv,
	PORT: String(emailPort),
	ORIGIN: emailOrigin,
	DATA_DIR: 'test-results/e2e-email-data',
	SMTP_HOST: '127.0.0.1',
	SMTP_PORT: String(mailboxSmtpPort),
	SMTP_FROM: 'Chloris <chloris@example.com>'
};

export const mailboxEnv = {
	MAILBOX_SMTP_PORT: String(mailboxSmtpPort),
	MAILBOX_HTTP_PORT: new URL(mailboxUrl).port
};
