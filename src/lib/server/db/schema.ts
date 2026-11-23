import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Drizzle table definitions. After changing this file, run `npm run db:generate` to create a
 * migration, and commit both together. Never edit a migration that has been committed.
 *
 * Every domain table needs a `home_id` column (see docs/spec.md, Data model). Only the
 * data-access layer in `#lib/server/data` may query these tables.
 *
 * The account tables (user, session, account, verification, passkey) and the home tables (home,
 * membership, invitation) have the columns BetterAuth expects: a home is a BetterAuth
 * organisation, renamed in `#lib/server/auth`. BetterAuth checks this schema against its own when
 * it first touches the database, so a missing column fails loudly rather than at random. Invite
 * links are Chloris's own `invite` table (D28).
 */

/** Milliseconds since the epoch, read and written as a `Date`. */
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

const createdAt = () => timestamp('created_at').notNull().default(now);
const updatedAt = () =>
	timestamp('updated_at')
		.notNull()
		.default(now)
		.$onUpdate(() => new Date());

// Accounts: managed by BetterAuth.

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	/** Stored in lower case by BetterAuth. */
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	image: text('image'),
	/** Set by the command-line tool. Only these accounts may create a home (D26). */
	canCreateHome: integer('can_create_home', { mode: 'boolean' }).notNull().default(false),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		token: text('token').notNull().unique(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at').notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		/** BetterAuth's active organisation. Unused until people can switch between homes. */
		activeHomeId: text('active_home_id').references(() => home.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [index('session_user_id_idx').on(table.userId)]
);

/** Sign-in methods linked to a user. Chloris has no passwords or social logins, so it stays empty. */
export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at'),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
		scope: text('scope'),
		password: text('password'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [index('account_user_id_idx').on(table.userId)]
);

/** Short-lived tokens: magic links and passkey challenges. */
export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)]
);

export const passkey = sqliteTable(
	'passkey',
	{
		id: text('id').primaryKey(),
		name: text('name'),
		publicKey: text('public_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		credentialID: text('credential_id').notNull(),
		counter: integer('counter').notNull(),
		deviceType: text('device_type').notNull(),
		backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
		transports: text('transports'),
		aaguid: text('aaguid'),
		createdAt: timestamp('created_at').default(now)
	},
	(table) => [
		index('passkey_user_id_idx').on(table.userId),
		uniqueIndex('passkey_credential_id_idx').on(table.credentialID)
	]
);

// Homes: a home is a BetterAuth organisation, and a membership is an organisation member.

export const home = sqliteTable('home', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	/** Required and unique for BetterAuth. Chloris sets it to the home's id and never shows it. */
	slug: text('slug').notNull().unique(),
	/** IANA time zone, e.g. `Europe/London`: decides when a day starts for due dates and digests. */
	timeZone: text('time_zone').notNull(),
	/** Months (1 to 12) when winter intervals apply. Empty until winter intervals arrive. */
	winterMonths: text('winter_months', { mode: 'json' })
		.$type<number[]>()
		.notNull()
		.default(sql`'[]'`),
	/** Part of BetterAuth's organisation; unused. */
	logo: text('logo'),
	/** Part of BetterAuth's organisation; unused. */
	metadata: text('metadata'),
	createdAt: createdAt()
});

export const membership = sqliteTable(
	'membership',
	{
		id: text('id').primaryKey(),
		homeId: text('home_id')
			.notNull()
			.references(() => home.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** One of the fixed roles in `#lib/server/permissions`. */
		role: text('role').notNull(),
		/** When this membership stops granting access, e.g. at the end of a sitter's stay. */
		expiresAt: timestamp('expires_at'),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('membership_home_user_idx').on(table.homeId, table.userId),
		index('membership_user_id_idx').on(table.userId)
	]
);

/**
 * BetterAuth's invitations. Unused: Chloris has its own invite links (`invite`, D28). The table
 * stays because BetterAuth's organisation plugin refuses to start without it.
 */
export const invitation = sqliteTable(
	'invitation',
	{
		id: text('id').primaryKey(),
		homeId: text('home_id')
			.notNull()
			.references(() => home.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		role: text('role'),
		status: text('status').notNull().default('pending'),
		expiresAt: timestamp('expires_at').notNull(),
		inviterId: text('inviter_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: createdAt()
	},
	(table) => [
		index('invitation_home_id_idx').on(table.homeId),
		index('invitation_email_idx').on(table.email)
	]
);

/**
 * Invite links to join a home (D19, D28). Chloris's own, rather than BetterAuth's invitations,
 * which are tied to one email address. Only a hash of each link's token is stored, so the link
 * is shown once, when it is made, and a copy of the database can't be used to join.
 */
export const invite = sqliteTable(
	'invite',
	{
		id: text('id').primaryKey(),
		homeId: text('home_id')
			.notNull()
			.references(() => home.id, { onDelete: 'cascade' }),
		/** SHA-256 of the token in the link. */
		tokenHash: text('token_hash').notNull().unique(),
		/** The role the new member gets: one of `INVITE_ROLES` in `#lib/server/data/invites`. */
		role: text('role').notNull(),
		createdBy: text('created_by')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at').notNull(),
		/** When the link was used. A used invite never works again. */
		usedAt: timestamp('used_at'),
		usedBy: text('used_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(table) => [index('invite_home_id_idx').on(table.homeId)]
);
