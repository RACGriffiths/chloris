import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../config';
import {
	discardUnrecordedPhoto,
	initPhotoStorage,
	photoPath,
	readPhotoFile,
	writePhotoFiles
} from './storage';

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'chloris-photos-'));
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

const files = (text: string) => ({
	thumb: Buffer.from(`${text} thumb`),
	medium: Buffer.from(`${text} medium`),
	full: Buffer.from(`${text} full`)
});

describe('initPhotoStorage', () => {
	it('makes the default folder if it is missing', () => {
		const dir = path.join(root, 'data', 'photos');

		initPhotoStorage(dir, { create: true });

		expect(fs.statSync(dir).isDirectory()).toBe(true);
	});

	it("refuses to start if a PHOTOS_DIR that was set doesn't exist, rather than making it", () => {
		const dir = path.join(root, 'mnt', 'photos');

		expect(() => initPhotoStorage(dir, { create: false })).toThrow(ConfigError);
		expect(() => initPhotoStorage(dir, { create: false })).toThrow(/doesn't exist/);
		expect(fs.existsSync(dir)).toBe(false);
	});

	it("refuses a file in place of a folder, and a folder it can't write to", () => {
		const file = path.join(root, 'not-a-folder');
		fs.writeFileSync(file, '');
		const readOnly = path.join(root, 'read-only');
		fs.mkdirSync(readOnly, { mode: 0o555 });

		expect(() => initPhotoStorage(file, { create: false })).toThrow(/isn't a folder/);
		// Root can write anywhere, so the check only means something for other users.
		if (process.getuid?.() !== 0) {
			expect(() => initPhotoStorage(readOnly, { create: false })).toThrow(/isn't writable/);
		}
	});
});

describe('photo files', () => {
	beforeEach(() => initPhotoStorage(root, { create: false }));

	it("keeps each home's photos in its own folder, one file per size", async () => {
		await writePhotoFiles('home-1', 'key-1', files('first'));

		expect(fs.readdirSync(path.join(root, 'home-1')).sort()).toEqual([
			'key-1-full.jpg',
			'key-1-medium.jpg',
			'key-1-thumb.jpg'
		]);
		expect((await readPhotoFile('home-1', 'key-1', 'medium'))?.toString()).toBe('first medium');
	});

	it('never overwrites a file that exists', async () => {
		await writePhotoFiles('home-1', 'key-1', files('first'));

		await expect(writePhotoFiles('home-1', 'key-1', files('second'))).rejects.toThrow(/EEXIST/);

		for (const size of ['thumb', 'medium', 'full'] as const) {
			expect((await readPhotoFile('home-1', 'key-1', size))?.toString()).toBe(`first ${size}`);
		}
	});

	it('removes the files already written if a later one fails', async () => {
		// The full size is written last; a folder in its place makes it fail.
		fs.mkdirSync(path.join(root, 'home-1', 'key-1-full.jpg'), { recursive: true });

		await expect(writePhotoFiles('home-1', 'key-1', files('first'))).rejects.toThrow();

		expect(fs.existsSync(photoPath('home-1', 'key-1', 'thumb'))).toBe(false);
		expect(fs.existsSync(photoPath('home-1', 'key-1', 'medium'))).toBe(false);
	});

	it('discards the files of a photo that was never recorded', async () => {
		await writePhotoFiles('home-1', 'key-1', files('first'));

		await discardUnrecordedPhoto('home-1', 'key-1');

		expect(fs.readdirSync(path.join(root, 'home-1'))).toEqual([]);
	});

	it('gives null for a file that is missing', async () => {
		expect(await readPhotoFile('home-1', 'no-such-key', 'thumb')).toBeNull();
	});

	it('refuses names that could reach outside the folder', () => {
		expect(() => photoPath('../etc', 'key-1', 'full')).toThrow();
		expect(() => photoPath('home-1', 'key/../../x', 'full')).toThrow();
	});
});
