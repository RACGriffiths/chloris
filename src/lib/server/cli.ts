import path from 'node:path';
import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { SIGN_IN_LINK_MINUTES } from './auth/index';
import { createCommandLineSignInLink } from './auth/sign-in-link';
import { BackupError, makeBackup } from './backup/backup';
import { checkIntegrity, type MissingPhoto } from './backup/check';
import { describeServerEntry } from '../audit';
import { describeUserAgent } from '../devices';
import { ConfigError, parseConfig, type Config, type Env } from './config';
import { listServerEvents, recordServerEvent } from './data/server-log';
import { closeDatabase, getConnection, initDatabase, openExistingDatabase } from './db';

/** How many entries `log` prints unless told otherwise. */
const DEFAULT_LOG_LIMIT = 50;

/**
 * Chloris's command-line tool, built to `build/cli` by `npm run build`. It reads the same
 * environment variables as the server, so run it where the server runs.
 */

export const USAGE = `Usage: node build/cli <command> [options]

sign-in-link <email> [--name <name>] [--can-create-home]
  Prints a one-time link that signs in the account with that email address. Use it to set
  up the first account, or when email is switched off and someone can't sign in.
  If there is no account with that address, one is created, and it may create a home.
    --name <name>        Display name for a new account (default: the start of the address)
    --can-create-home    Also let an existing account create a home

backup <folder> [--keep <n>]
  Backs up the database, then the photos, into a new folder inside <folder> named for the
  time, such as chloris-2026-11-24T03-00-00Z. Photos already in the previous backup there
  are linked to it rather than copied again. <folder> must exist: put it on another drive.
    --keep <n>           Afterwards, remove the oldest backups in <folder>, leaving <n>

check
  Checks the database for damage, and that every photo it lists has its files in the
  photo folder. Lists files that belong to no photo. Changes nothing.

log [--limit <n>]
  Prints the server's own log, the latest first: sign-ins and passkey changes with where
  they came from, sign-ins that failed, rate limits used up, and sign-in links printed
  here. What happens in each home is in its audit log, which its owners see in the app.
    --limit <n>          How many entries to print (default ${DEFAULT_LOG_LIMIT})

All four can run while the server is running. Exit status: 0 if all went well, 1 if
it failed or found a problem, 2 if the command was wrong.`;

export interface Output {
	log(message: string): void;
	error(message: string): void;
}

/** The options each command takes. */
const COMMAND_OPTIONS: Record<string, string[]> = {
	'sign-in-link': ['name', 'can-create-home'],
	backup: ['keep'],
	check: [],
	log: ['limit']
};

/** How many arguments each command takes, after its name. */
const COMMAND_ARGUMENTS: Record<string, number> = {
	'sign-in-link': 1,
	backup: 1,
	check: 0,
	log: 0
};

/** Runs one command and returns the exit code. */
export async function main(args: string[], env: Env, out: Output = console): Promise<number> {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			allowPositionals: true,
			options: {
				name: { type: 'string' },
				'can-create-home': { type: 'boolean' },
				keep: { type: 'string' },
				limit: { type: 'string' },
				help: { type: 'boolean', short: 'h' }
			}
		});
	} catch (error) {
		out.error(`${(error as Error).message}\n\n${USAGE}`);
		return 2;
	}
	const { values, positionals } = parsed;
	if (values.help) {
		out.log(USAGE);
		return 0;
	}
	const [command = '', ...rest] = positionals;
	const given = Object.keys(values).filter((name) => name !== 'help');
	if (
		!Object.hasOwn(COMMAND_OPTIONS, command) ||
		rest.length !== COMMAND_ARGUMENTS[command] ||
		!given.every((name) => COMMAND_OPTIONS[command].includes(name))
	) {
		out.error(USAGE);
		return 2;
	}
	const keep = wholeNumber(values.keep);
	const limit = wholeNumber(values.limit) ?? DEFAULT_LOG_LIMIT;
	for (const [name, value] of [
		['keep', keep],
		['limit', limit]
	] as const) {
		if (value !== undefined && value < 1) {
			out.error(`--${name} must be a whole number of at least 1.\n\n${USAGE}`);
			return 2;
		}
	}

	try {
		const config = parseConfig(env);
		if (command === 'sign-in-link') {
			return await signInLink(config, rest[0], values, out);
		}
		openExistingDatabase(config.dataDir);
		if (command === 'backup') return await backup(config, rest[0], keep, out);
		if (command === 'log') return printLog(limit, out);
		return await check(config, out);
	} catch (error) {
		if (error instanceof ConfigError || error instanceof BackupError) out.error(error.message);
		else if (error instanceof ZodError) out.error(`${rest[0]}: ${error.issues[0].message}`);
		else throw error;
		return 1;
	} finally {
		closeDatabase();
	}
}

async function signInLink(
	config: Config,
	email: string,
	options: { name?: string; 'can-create-home'?: boolean },
	out: Output
): Promise<number> {
	const { applied } = await initDatabase(config.dataDir);
	if (applied > 0) out.log(`Applied ${applied} database migration(s).`);

	const link = await createCommandLineSignInLink(
		{ origin: config.origin, secret: config.authSecret, db: getConnection().db },
		{ email, name: options.name, allowHomeCreation: options['can-create-home'] ?? false }
	);

	recordServerEvent(
		{},
		{
			action: 'sign-in-link-printed',
			detail: { email: link.email, created: link.created, canCreateHome: link.canCreateHome }
		}
	);

	const account = link.created
		? 'a new account, which may create a home'
		: link.canCreateHome
			? 'an existing account, which may create a home'
			: 'an existing account';
	out.log(
		[
			`Sign-in link for ${link.email} (${account}):`,
			'',
			`  ${link.url}`,
			'',
			`It works once, within ${SIGN_IN_LINK_MINUTES} minutes. Open it on the device that`,
			'should be signed in, and keep it private: anyone with it can sign in as this account.'
		].join('\n')
	);
	return 0;
}

async function backup(
	config: Config,
	destination: string,
	keep: number | undefined,
	out: Output
): Promise<number> {
	const result = await makeBackup({
		photosDir: config.photosDir,
		destination: path.resolve(destination),
		keep
	});
	const lines = [
		`Backed up to ${result.folder}`,
		`  Database: copied and checked (${formatBytes(result.databaseBytes)}).`,
		`  Photos: copied ${count(result.copied, 'file')} (${formatBytes(result.copiedBytes)})` +
			(result.linkedFrom
				? `, and linked ${count(result.linked, 'unchanged file')} to ${path.basename(result.linkedFrom)}.`
				: '.')
	];
	if (result.removed.length > 0) {
		lines.push(
			`  Removed ${count(result.removed.length, 'older backup')}, leaving ${keep}:`,
			...result.removed.map((folder) => `    ${path.basename(folder)}`)
		);
	}
	out.log(lines.join('\n'));

	if (result.unfinished.length > 0) {
		out.error(
			[
				'',
				`${count(result.unfinished.length, 'backup')} in the backup folder didn't finish. Unless a`,
				'backup is running now, remove them:',
				...result.unfinished.map((folder) => `  ${folder}`)
			].join('\n')
		);
	}
	if (result.missing.length > 0) {
		out.error(
			[
				'',
				`${count(result.missing.length, 'photo')} in the database had files missing from the photo folder,`,
				`so the backup doesn't have them either. Is the photo folder (${config.photosDir}) the`,
				'right one, and its drive mounted? If so, restore these files from an earlier backup:',
				...missingFiles(config.photosDir, result.missing)
			].join('\n')
		);
		return 1;
	}
	return 0;
}

async function check(config: Config, out: Output): Promise<number> {
	const report = await checkIntegrity(config.photosDir);
	const { photos } = report;
	const lines: string[] = [];

	if (report.database.length === 0) {
		lines.push('Database: no problems found.');
	} else {
		lines.push(
			`Database: SQLite found ${count(report.database.length, 'problem')}. Stop the server and`,
			'restore the database from a backup:',
			...report.database.map((problem) => `  ${problem}`)
		);
	}

	lines.push(
		`Photos: ${count(photos.photos, 'photo')} in the database` +
			(photos.deleted > 0 ? ` (${photos.deleted} deleted, kept until the grace period ends)` : '') +
			`, and ${count(photos.files, 'file')} in ${config.photosDir}.`
	);
	if (!report.photoFolderFound) {
		lines.push(
			`  The photo folder ${config.photosDir} doesn't exist. Is its drive mounted, and is`,
			'  PHOTOS_DIR the folder the server uses?'
		);
	}
	if (photos.missing.length > 0) {
		lines.push(
			'',
			`Photos with files missing: ${photos.missing.length}. Pages show a placeholder instead.`,
			'Restore these files from a backup:',
			...missingFiles(config.photosDir, photos.missing)
		);
	}
	if (photos.deletedWithoutFiles > 0) {
		lines.push(
			'',
			`Deleted photos whose files have gone already: ${photos.deletedWithoutFiles}. Nothing shows`,
			'deleted photos, so nothing needs doing: the server removes them after the grace period.'
		);
	}
	if (photos.unreferenced.length > 0) {
		lines.push(
			'',
			`Files that belong to no photo: ${photos.unreferenced.length}. An upload that stopped part way`,
			"leaves them. They do no harm; once they're in a backup, they can be deleted to free",
			'the space:',
			...photos.unreferenced.map((file) => `  ${path.join(config.photosDir, file)}`)
		);
	}
	lines.push('', report.ok ? 'All is well.' : 'Found problems: see above.');

	if (report.ok) out.log(lines.join('\n'));
	else out.error(lines.join('\n'));
	return report.ok ? 0 : 1;
}

/** The server's log, one entry a line, the latest first (D58). */
function printLog(limit: number, out: Output): number {
	const events = listServerEvents(limit);
	if (events.length === 0) {
		out.log('Nothing has been recorded yet.');
		return 0;
	}
	const lines = events.map((event) => {
		const when = event.createdAt
			.toISOString()
			.replace('T', ' ')
			.replace(/\.\d+Z$/, 'Z');
		const from = [event.ipAddress, event.userAgent && describeUserAgent(event.userAgent)]
			.filter(Boolean)
			.join(', ');
		return `${when}  ${describeServerEntry(event, event.userEmail)}${from ? ` (${from})` : ''}`;
	});
	if (events.length === limit) lines.push('', `The latest ${limit}; use --limit to see more.`);
	out.log(lines.join('\n'));
	return 0;
}

/** A number option's value, or `undefined` if it wasn't given; `0` if it isn't a whole number. */
function wholeNumber(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	return /^\d+$/.test(value) ? Number(value) : 0;
}

/** Each missing file's path, with the photo and plant it's for. */
function missingFiles(photosDir: string, missing: MissingPhoto[]): string[] {
	return missing.flatMap((photo) =>
		photo.files.map(
			(file) => `  ${path.join(photosDir, file)} (photo ${photo.photoId} of plant ${photo.plantId})`
		)
	);
}

/** "1 file", "3 files". */
function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} bytes`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
