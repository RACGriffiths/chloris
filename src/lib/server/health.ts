import { getConnection } from './db';

/** True when the database is open and answering queries. */
export function isHealthy(): boolean {
	try {
		getConnection().sqlite.prepare('SELECT 1').get();
		return true;
	} catch {
		return false;
	}
}
