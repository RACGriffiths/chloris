import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { PlantStatus } from '../plants';
import { closeDatabase, getConnection, initDatabase } from './db';
import { eq } from 'drizzle-orm';
import { membership, plant, user } from './db/schema';

/**
 * Helpers for unit tests only. Fixtures write to the database directly, so tests can set up
 * states that no data-access function creates yet (other roles, expired memberships).
 */

/** Gives each test in the file a new database, migrated like the app's. */
export function useTestDatabase(): { readonly dataDir: string } {
	const state = { dataDir: '' };
	beforeEach(async () => {
		state.dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chloris-test-')), 'data');
		await initDatabase(state.dataDir);
	});
	afterEach(() => {
		closeDatabase();
		fs.rmSync(path.dirname(state.dataDir), { recursive: true, force: true });
	});
	return state;
}

export function insertUser(email: string, fields: { canCreateHome?: boolean } = {}): string {
	const id = randomUUID();
	getConnection()
		.db.insert(user)
		.values({ id, email, name: email.split('@')[0], emailVerified: true, ...fields })
		.run();
	return id;
}

export function addMember(
	homeId: string,
	userId: string,
	role: string,
	{ expiresAt, createdAt }: { expiresAt?: Date; createdAt?: Date } = {}
): void {
	getConnection()
		.db.insert(membership)
		.values({ id: randomUUID(), homeId, userId, role, expiresAt, createdAt })
		.run();
}

/** Gives a plant a status other than active, which the Memorial view will set (D30). */
export function setPlantStatus(plantId: string, status: Exclude<PlantStatus, 'active'>): void {
	getConnection().db.update(plant).set({ status }).where(eq(plant.id, plantId)).run();
}

export const TEST_ORIGIN = 'http://localhost:5173';
export const TEST_SECRET = 'unit-tests-only-not-a-real-secret-0123456789';
