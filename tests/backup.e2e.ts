import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { addPlant, addRoom, newOwner } from './helpers';
import { serverEnv } from './server-env';

/**
 * The backup command and the integrity check (D52, D53), run as someone hosting Chloris would:
 * the built command-line tool, beside the running server, on the same database and photos.
 */

/** Runs the built command-line tool with the server's settings and `env` on top. */
function cli(args: string[], env: Record<string, string> = {}) {
	return spawnSync(process.execPath, ['build/cli', ...args], {
		env: { ...process.env, ...serverEnv, ...env },
		encoding: 'utf8'
	});
}

test('backs up the database and photos while the server runs, and the backup checks out', async ({
	page
}, testInfo) => {
	await newOwner(page, 'Backed-up flat');
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	await addPlant(page, 'Fern', 'Kitchen');
	await page.getByText('Add a photo').click();
	await page.getByLabel('Photo', { exact: true }).setInputFiles({
		name: 'fern.jpg',
		mimeType: 'image/jpeg',
		buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3a7d44' } })
			.jpeg()
			.toBuffer()
	});
	await page.getByRole('button', { name: 'Add photo' }).click();
	const photos = page.getByRole('region', { name: 'Photos', exact: true });
	await expect(photos.getByRole('img')).toHaveCount(1);

	const destination = testInfo.outputPath('backups');
	fs.mkdirSync(destination, { recursive: true });
	const backup = cli(['backup', destination, '--keep', '2']);
	expect(backup.stderr).toBe('');
	expect(backup.status).toBe(0);
	expect(backup.stdout).toMatch(/^Backed up to .*chloris-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ$/m);
	const [folder] = fs.readdirSync(destination);

	// A backup is laid out as DATA_DIR is, so the check can run on it, as on a restored copy.
	const onBackup = cli(['check'], { DATA_DIR: path.join(destination, folder), PHOTOS_DIR: '' });
	expect(onBackup.status, onBackup.stderr).toBe(0);
	expect(onBackup.stdout).toMatch(/^Photos: \d+ photos? in the database/m);
	expect(onBackup.stdout).toMatch(/^All is well\.$/m);

	// And on the server's own folders, while it runs.
	const onServer = cli(['check']);
	expect(onServer.status, onServer.stderr).toBe(0);
	expect(onServer.stdout).toContain('Database: no problems found.');
});
