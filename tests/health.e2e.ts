import { expect, test } from '@playwright/test';

test('the home page renders', async ({ page }) => {
	await page.goto('/');

	await expect(page).toHaveTitle('Chloris');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chloris');
});

test('the health check reports the database is up', async ({ request }) => {
	const response = await request.get('/api/health');

	expect(response.status()).toBe(200);
	expect(response.headers()['cache-control']).toBe('no-store');
	expect(await response.json()).toEqual({ status: 'ok' });
});
