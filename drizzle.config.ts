import fs from 'node:fs';
import { defineConfig } from 'drizzle-kit';
import { MIGRATIONS_DIR, databaseFile } from './src/lib/server/db/paths';

// drizzle-kit runs outside SvelteKit, so it reads .env itself.
if (fs.existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/lib/server/db/schema.ts',
	out: MIGRATIONS_DIR,
	// Only `npm run db:studio` connects to the database. The app applies migrations itself at
	// start-up, after a backup, so there is deliberately no `drizzle-kit migrate` or `push` script.
	dbCredentials: { url: databaseFile(process.env.DATA_DIR || './data') },
	strict: true,
	verbose: true
});
