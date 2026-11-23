import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getConnection, type Db } from '../db';
import { home, invite, membership, user } from '../db/schema';
import { isActive } from './memberships';

/**
 * Invite links (D19, D28). An owner makes a link that carries a role; whoever opens it can join
 * the home once, within `INVITE_DAYS`. The link holds a random token, and only its hash is
 * stored.
 *
 * Making, listing and cancelling invites take a `homeId`, and the caller checks
 * `can(user, homeId, 'member:manage')` first. Using an invite takes the token instead: the link
 * is what gives the right to join, so there is no `can()` check, and the token decides the home.
 */

/** How long an invite link works for. */
export const INVITE_DAYS = 7;

/** The roles an invite may carry in version 1. Sitters need an expiry, which comes in version 2. */
export const INVITE_ROLES = ['owner', 'carer', 'viewer'] as const;

export type InviteRole = (typeof INVITE_ROLES)[number];

const isInviteRole = (role: string): role is InviteRole =>
	(INVITE_ROLES as readonly string[]).includes(role);

/** What an owner chooses when making an invite. */
export const inviteInput = z.object({ role: z.enum(INVITE_ROLES, 'Choose a role.') });

/** What someone without an account fills in to join by invite. */
export const newAccountInput = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Enter your name.')
		.max(60, 'Keep your name to 60 characters or fewer.'),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.pipe(z.email('Enter an email address, like name@example.com.'))
});

export type NewAccountInput = z.input<typeof newAccountInput>;

/** An invite that hasn't been used and hasn't expired, as its home's owners see it. */
export interface PendingInvite {
	id: string;
	role: InviteRole;
	createdByName: string;
	createdAt: Date;
	expiresAt: Date;
}

/** What the person opening an invite link is told about it. */
export interface InviteDetails {
	homeId: string;
	homeName: string;
	role: InviteRole;
	invitedBy: string;
	expiresAt: Date;
}

/** The outcome of using an invite. A refused invite is left as it was. */
export type JoinResult =
	| { ok: true; homeId: string; userId: string }
	| { ok: false; reason: 'invalid' | 'already-member' | 'email-taken' };

const DAY = 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

/**
 * Makes an invite to `homeId` and returns it with the token for its link. The token is not
 * stored, so this is the only time it is available. Throws a `ZodError` if the input is invalid.
 */
export function createInvite(
	homeId: string,
	createdBy: string,
	input: z.input<typeof inviteInput>,
	now = new Date()
): { invite: PendingInvite; token: string } {
	const { role } = inviteInput.parse(input);
	const token = randomBytes(32).toString('base64url');
	const { db } = getConnection();
	const row = db
		.insert(invite)
		.values({
			id: randomUUID(),
			homeId,
			tokenHash: hashToken(token),
			role,
			createdBy,
			expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY),
			createdAt: now
		})
		.returning({ id: invite.id, createdAt: invite.createdAt, expiresAt: invite.expiresAt })
		.get();
	const creator = db.select({ name: user.name }).from(user).where(eq(user.id, createdBy)).get();
	return { invite: { ...row, role, createdByName: creator?.name ?? '' }, token };
}

/** The invites to `homeId` that can still be used, oldest first. */
export function listPendingInvites(homeId: string, now = new Date()): PendingInvite[] {
	const rows = getConnection()
		.db.select({
			id: invite.id,
			role: invite.role,
			createdByName: user.name,
			createdAt: invite.createdAt,
			expiresAt: invite.expiresAt
		})
		.from(invite)
		.innerJoin(user, eq(user.id, invite.createdBy))
		.where(and(eq(invite.homeId, homeId), isNull(invite.usedAt), gt(invite.expiresAt, now)))
		.orderBy(asc(invite.createdAt), asc(invite.id))
		.all();
	return rows.flatMap(({ role, ...rest }) => (isInviteRole(role) ? [{ ...rest, role }] : []));
}

/**
 * Cancels an unused invite to `homeId`, so its link stops working. Returns whether there was one
 * to cancel.
 */
export function cancelInvite(homeId: string, inviteId: string): boolean {
	const { changes } = getConnection()
		.db.delete(invite)
		.where(and(eq(invite.id, inviteId), eq(invite.homeId, homeId), isNull(invite.usedAt)))
		.run();
	return changes > 0;
}

type Tx = Pick<Db, 'select' | 'insert' | 'update'>;

/** The invite a token belongs to, if it can still be used. */
function findUsable(tx: Tx, token: string, now: Date) {
	const row = tx
		.select({ id: invite.id, homeId: invite.homeId, role: invite.role })
		.from(invite)
		.where(
			and(eq(invite.tokenHash, hashToken(token)), isNull(invite.usedAt), gt(invite.expiresAt, now))
		)
		.get();
	return row && isInviteRole(row.role) ? { ...row, role: row.role } : null;
}

/** Marks an invite used. Inside an immediate transaction, after `findUsable`, it can't fail. */
function claim(tx: Tx, inviteId: string, userId: string, now: Date): void {
	const { changes } = tx
		.update(invite)
		.set({ usedAt: now, usedBy: userId })
		.where(and(eq(invite.id, inviteId), isNull(invite.usedAt)))
		.run();
	if (changes !== 1) throw new Error('The invite was used by someone else at the same moment');
}

/** What an invite link offers, or `null` if the token is unknown, used, cancelled or expired. */
export function findInvite(token: string, now = new Date()): InviteDetails | null {
	const { db } = getConnection();
	const found = findUsable(db, token, now);
	if (!found) return null;
	const row = db
		.select({ homeName: home.name, invitedBy: user.name, expiresAt: invite.expiresAt })
		.from(invite)
		.innerJoin(home, eq(home.id, invite.homeId))
		.innerJoin(user, eq(user.id, invite.createdBy))
		.where(eq(invite.id, found.id))
		.get();
	return row ? { homeId: found.homeId, role: found.role, ...row } : null;
}

/**
 * Uses an invite to add an existing account to the invite's home. Someone who is already a
 * member is refused and the invite stays unused. A membership that has expired is replaced.
 */
export function acceptInvite(token: string, userId: string, now = new Date()): JoinResult {
	return getConnection().db.transaction(
		(tx) => {
			const found = findUsable(tx, token, now);
			if (!found) return { ok: false, reason: 'invalid' } as const;
			const existing = tx
				.select({ id: membership.id, expiresAt: membership.expiresAt })
				.from(membership)
				.where(and(eq(membership.homeId, found.homeId), eq(membership.userId, userId)))
				.get();
			if (existing && isActive(existing, now))
				return { ok: false, reason: 'already-member' } as const;

			claim(tx, found.id, userId, now);
			if (existing) {
				tx.update(membership)
					.set({ role: found.role, expiresAt: null })
					.where(eq(membership.id, existing.id))
					.run();
			} else {
				tx.insert(membership)
					.values({ id: randomUUID(), homeId: found.homeId, userId, role: found.role })
					.run();
			}
			return { ok: true, homeId: found.homeId, userId } as const;
		},
		// Takes the write lock at once, so two people can't both use the same link.
		{ behavior: 'immediate' }
	);
}

/**
 * Uses an invite to create an account and add it to the invite's home, together. The link is
 * the only proof the person has, so the email address isn't marked verified until they use a
 * sign-in link sent to it. An account made this way can never create a home (D26). An address
 * that already has an account is refused: that person signs in first. Throws a `ZodError` if the
 * input is invalid.
 *
 * BetterAuth creates every other account; this one is created here so that the account, the
 * membership and using up the invite happen in one transaction.
 */
export function joinWithNewAccount(
	token: string,
	input: NewAccountInput,
	now = new Date()
): JoinResult {
	const { name, email } = newAccountInput.parse(input);
	return getConnection().db.transaction(
		(tx) => {
			const found = findUsable(tx, token, now);
			if (!found) return { ok: false, reason: 'invalid' } as const;
			if (tx.select({ id: user.id }).from(user).where(eq(user.email, email)).get()) {
				return { ok: false, reason: 'email-taken' } as const;
			}

			const userId = randomUUID();
			tx.insert(user)
				.values({ id: userId, name, email, emailVerified: false, canCreateHome: false })
				.run();
			claim(tx, found.id, userId, now);
			tx.insert(membership)
				.values({ id: randomUUID(), homeId: found.homeId, userId, role: found.role })
				.run();
			return { ok: true, homeId: found.homeId, userId } as const;
		},
		{ behavior: 'immediate' }
	);
}
