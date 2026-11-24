import { sql } from 'drizzle-orm';
import {
	foreignKey,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';
import { CARE_TYPES, TASKS } from '../../care';
import { DIGEST_CHANNELS } from '../../notifications';
import { PLANT_STATUSES } from '../../plants';
import { LIGHT_LEVELS, ROOM_SETTINGS } from '../../rooms';

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

// Rooms and plants (docs/spec.md, Data model; D29, D30).

/** A room or outdoor space in a home. Its name is unique within the home, ignoring case. */
export const room = sqliteTable(
	'room',
	{
		id: text('id').primaryKey(),
		homeId: text('home_id')
			.notNull()
			.references(() => home.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Indoors or outdoors. The `enum` lists only type the column; SQLite doesn't enforce them. */
		setting: text('setting', { enum: ROOM_SETTINGS }).notNull().default('indoor'),
		/** How much light the room gets, or `null` if not given. */
		light: text('light', { enum: LIGHT_LEVELS }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [index('room_home_id_idx').on(table.homeId)]
);

/**
 * A plant in a home, always in one of its rooms. A room with plants can't be deleted (D30): the
 * foreign key has no `on delete` action, so SQLite refuses at the end of the statement, which
 * still lets a home's deletion cascade to both.
 */
export const plant = sqliteTable(
	'plant',
	{
		id: text('id').primaryKey(),
		homeId: text('home_id')
			.notNull()
			.references(() => home.id, { onDelete: 'cascade' }),
		roomId: text('room_id')
			.notNull()
			.references(() => room.id),
		nickname: text('nickname').notNull(),
		/** Free text: there is no species database (docs/spec.md, Out of scope). */
		species: text('species'),
		/** A calendar date, `YYYY-MM-DD`, with no time or time zone. */
		acquiredOn: text('acquired_on'),
		/** Where it came from: a shop, a friend, a cutting. */
		source: text('source'),
		pot: text('pot'),
		soil: text('soil'),
		/** Lower-case labels, in the order given, each at most once. */
		tags: text('tags', { mode: 'json' })
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'`),
		notes: text('notes'),
		/** Only active plants are listed and cared for; the others are in the Memorial (D43 to D45). */
		status: text('status', { enum: PLANT_STATUSES }).notNull().default('active'),
		/** The day the status last changed, `YYYY-MM-DD`; cleared with the note on restoring (D43). */
		statusOn: text('status_on'),
		statusNote: text('status_note'),
		/** The plant this one was grown from, in the same home. Screens come later (Later: family tree). */
		parentId: text('parent_id').references((): AnySQLiteColumn => plant.id, {
			onDelete: 'set null'
		}),
		/** One of its own photos, shown on its tile. Stored with the photo table (D38); chosen on the timeline. */
		coverPhotoId: text('cover_photo_id').references((): AnySQLiteColumn => photo.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('plant_home_id_idx').on(table.homeId),
		index('plant_room_id_idx').on(table.roomId),
		index('plant_parent_id_idx').on(table.parentId)
	]
);

// The care log and schedules (docs/spec.md, Data model; D31 to D33).

/**
 * One piece of care given to a plant: a watering, a feed, a check that found a task wasn't
 * needed. When each task is next due is worked out from these (CLAUDE.md rule 4), so undoing one
 * deletes it and the due date follows.
 */
export const careEvent = sqliteTable(
	'care_event',
	{
		id: text('id').primaryKey(),
		homeId: text('home_id')
			.notNull()
			.references(() => home.id, { onDelete: 'cascade' }),
		plantId: text('plant_id')
			.notNull()
			.references(() => plant.id, { onDelete: 'cascade' }),
		/** Who logged it; `null` once their account is deleted, so the home keeps its history. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		type: text('type', { enum: CARE_TYPES }).notNull(),
		/** For a check, the task that wasn't needed; `null` for every other type. */
		checkedTask: text('checked_task', { enum: TASKS }),
		/** When the care was given, which may be earlier than when it was logged (backdating). */
		doneAt: timestamp('done_at').notNull(),
		note: text('note'),
		/** A photo taken with the care, of the same plant. Stored with the photo table (D38). */
		photoId: text('photo_id').references((): AnySQLiteColumn => photo.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt()
	},
	(table) => [
		index('care_event_home_id_idx').on(table.homeId, table.doneAt),
		index('care_event_plant_id_idx').on(table.plantId, table.doneAt),
		index('care_event_plant_type_idx').on(table.plantId, table.type, table.doneAt)
	]
);

/**
 * How often a plant needs one task, such as watering every 7 days. A plant has at most one
 * schedule per task. When it's next due is never stored: it comes from the care log (D20, D31).
 */
export const careSchedule = sqliteTable(
	'care_schedule',
	{
		id: text('id').primaryKey(),
		homeId: text('home_id')
			.notNull()
			.references(() => home.id, { onDelete: 'cascade' }),
		plantId: text('plant_id')
			.notNull()
			.references(() => plant.id, { onDelete: 'cascade' }),
		task: text('task', { enum: TASKS }).notNull(),
		intervalDays: integer('interval_days').notNull(),
		/** The interval in the home's winter months. Stored from version 1; screens come later (D33). */
		winterIntervalDays: integer('winter_interval_days'),
		/** How long "checked, not needed" puts the task off (D13). */
		recheckDays: integer('recheck_days').notNull().default(2),
		/** `YYYY-MM-DD`. Doing or checking the task ends a snooze (D31). */
		snoozedUntil: text('snoozed_until'),
		/** Stands in for the last time the task was done until it's first logged (D20). */
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('care_schedule_home_id_idx').on(table.homeId),
		uniqueIndex('care_schedule_plant_task_idx').on(table.plantId, table.task)
	]
);

// Photos (docs/spec.md, Photos and backups; D35 to D38).

/**
 * A photo of a plant. Its files, one per size, are in `PHOTOS_DIR` under the home's id, named by
 * `fileKey` (`#lib/server/photos/storage`). Files are written once and never overwritten
 * (CLAUDE.md rule 5). Deleting a photo sets `deletedAt`, and its files stay through
 * `PHOTO_DELETE_GRACE_DAYS`, so a photo backup taken after a database backup still has them.
 */
export const photo = sqliteTable(
	'photo',
	{
		id: text('id').primaryKey(),
		homeId: text('home_id')
			.notNull()
			.references(() => home.id, { onDelete: 'cascade' }),
		plantId: text('plant_id')
			.notNull()
			.references(() => plant.id, { onDelete: 'cascade' }),
		/** Who added it; `null` once their account is deleted, so the home keeps its photos. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		/** Names its files. Random and separate from `id`, so a photo's address says nothing of them. */
		fileKey: text('file_key').notNull().unique(),
		/** When it was taken, from the photo's own date, or when it was added if it had none (D36). */
		takenAt: timestamp('taken_at').notNull(),
		/** The size of its largest file, in pixels, the right way up. */
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		caption: text('caption'),
		/** When it was deleted. Left out of every read; its files go after the grace period. */
		deletedAt: timestamp('deleted_at'),
		createdAt: createdAt()
	},
	(table) => [
		index('photo_home_id_idx').on(table.homeId),
		index('photo_plant_id_idx').on(table.plantId, table.takenAt)
	]
);

// Notifications (docs/spec.md, Reminders and notifications; D46 to D50).

/**
 * One person's digest settings for one home. Without a row, the defaults apply
 * (`defaultNotificationSettings` in `#lib/notifications`). The foreign key to the membership
 * removes the row with the membership, so settings never outlive it.
 */
export const notificationSettings = sqliteTable(
	'notification_settings',
	{
		id: text('id').primaryKey(),
		homeId: text('home_id')
			.notNull()
			.references(() => home.id, { onDelete: 'cascade' }),
		userId: text('user_id').notNull(),
		/** How the digest comes, or `null` when it's off. Push comes in version 2. */
		channel: text('channel', { enum: DIGEST_CHANNELS }),
		/** When the digest goes, `HH:MM` in the home's time zone. */
		digestTime: text('digest_time').notNull(),
		/** Quiet hours, `HH:MM` in the home's time zone; both `null` for none. */
		quietStart: text('quiet_start'),
		quietEnd: text('quiet_end'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('notification_settings_home_user_idx').on(table.homeId, table.userId),
		foreignKey({
			name: 'notification_settings_membership_fk',
			columns: [table.homeId, table.userId],
			foreignColumns: [membership.homeId, membership.userId]
		}).onDelete('cascade')
	]
);

/**
 * Each day's digest for one person in one home, written before it's sent, so a restart or a
 * second process never sends it twice (D48). A day when nothing was due has a row too, with no
 * tasks and no `sentAt`, so that day's digest is decided once.
 */
export const digestLog = sqliteTable(
	'digest_log',
	{
		id: text('id').primaryKey(),
		homeId: text('home_id')
			.notNull()
			.references(() => home.id, { onDelete: 'cascade' }),
		userId: text('user_id').notNull(),
		/** The day it's for, `YYYY-MM-DD` in the home's time zone. */
		date: text('date').notNull(),
		channel: text('channel', { enum: DIGEST_CHANNELS }).notNull(),
		/** How many tasks it listed: 0 when nothing was due, and nothing was sent. */
		taskCount: integer('task_count').notNull(),
		/** When the mail server accepted it; `null` while sending, or when nothing was due. */
		sentAt: timestamp('sent_at'),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('digest_log_home_user_date_idx').on(table.homeId, table.userId, table.date),
		foreignKey({
			name: 'digest_log_membership_fk',
			columns: [table.homeId, table.userId],
			foreignColumns: [membership.homeId, membership.userId]
		}).onDelete('cascade')
	]
);
