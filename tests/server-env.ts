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
	BODY_SIZE_LIMIT: '25M'
};
