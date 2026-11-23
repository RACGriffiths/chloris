import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const origin = `http://localhost:${port}`;

export default defineConfig({
	testDir: 'tests',
	testMatch: '**/*.e2e.ts',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: { baseURL: origin, trace: 'retain-on-failure' },
	// Phone first: test on a phone-sized screen.
	projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
	webServer: {
		// Runs the production build as `node build` would in a real install. CI builds once beforehand.
		command: process.env.CI ? 'node build' : 'npm run build && node build',
		url: `${origin}/api/health`,
		timeout: 120_000,
		env: {
			HOST: '127.0.0.1',
			PORT: String(port),
			ORIGIN: origin,
			BETTER_AUTH_SECRET: 'end-to-end-tests-only-not-a-real-secret',
			// Playwright empties test-results before each run, so every run starts with a new database.
			DATA_DIR: 'test-results/e2e-data'
		}
	}
});
