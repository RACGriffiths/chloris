import { describe, expect, it } from 'vitest';
import { describeAuditEntry, describeServerEntry } from './audit';

describe('describeAuditEntry', () => {
	it('says what happened, to follow the person’s name', () => {
		const said = [
			describeAuditEntry({ action: 'sign-in', detail: { method: 'passkey' } }),
			describeAuditEntry({ action: 'sign-in', detail: { method: 'link' } }),
			describeAuditEntry({ action: 'sign-in', detail: { method: 'invite' } }),
			describeAuditEntry({ action: 'passkey-added', detail: { name: 'Chrome on Android' } }),
			describeAuditEntry({ action: 'passkey-removed', detail: { name: 'Safari on iPhone' } }),
			describeAuditEntry({ action: 'home-created', detail: { name: 'The flat' } }),
			describeAuditEntry({ action: 'invite-created', detail: { role: 'owner' } }),
			describeAuditEntry({ action: 'invite-cancelled', detail: { role: 'viewer' } }),
			describeAuditEntry({ action: 'invite-accepted', detail: { role: 'carer' } }),
			describeAuditEntry({ action: 'room-deleted', detail: { name: 'Kitchen' } }),
			describeAuditEntry({
				action: 'schedule-deleted',
				detail: { plant: 'Monty', task: 'pest-treatment' }
			}),
			describeAuditEntry({ action: 'photo-deleted', detail: { plant: 'Monty' } })
		];

		expect(said).toEqual([
			'signed in with a passkey',
			'signed in with a sign-in link',
			'signed in for the first time, from an invite link',
			'added a passkey (Chrome on Android)',
			'removed a passkey (Safari on iPhone)',
			'created the home The flat',
			'made an invite link for an owner',
			'cancelled an invite link for a viewer',
			'joined as a carer, from an invite link',
			'deleted the room Kitchen',
			'removed the pest treatment schedule of Monty',
			'deleted a photo of Monty'
		]);
	});
});

describe('describeServerEntry', () => {
	it('says what happened, naming the person by email address', () => {
		const who = 'pat@example.com';
		const said = [
			describeServerEntry({ action: 'sign-in', detail: { method: 'link' } }, who),
			describeServerEntry({ action: 'passkey-removed', detail: { name: 'Pixel' } }, null),
			describeServerEntry({ action: 'sign-in-failed', detail: { method: 'passkey' } }, null),
			describeServerEntry({ action: 'sign-in-failed', detail: { method: 'link' } }, null),
			describeServerEntry({ action: 'sign-in-failed', detail: { method: 'invite' } }, null),
			describeServerEntry(
				{ action: 'limit-reached', detail: { limit: 'failedSignIn', key: '192.0.2.1' } },
				null
			),
			describeServerEntry(
				{ action: 'limit-reached', detail: { limit: 'signInLinkAddress', key: who } },
				null
			),
			describeServerEntry({ action: 'limit-reached', detail: { limit: 'upload', key: 'id' } }, who),
			describeServerEntry(
				{
					action: 'sign-in-link-printed',
					detail: { email: who, created: true, canCreateHome: true }
				},
				null
			),
			describeServerEntry(
				{
					action: 'sign-in-link-printed',
					detail: { email: who, created: false, canCreateHome: false }
				},
				null
			)
		];

		expect(said).toEqual([
			'pat@example.com signed in with a sign-in link',
			'Someone whose account was deleted removed a passkey (Pixel)',
			'A passkey sign-in was refused',
			"A sign-in link that doesn't work was used",
			"An invite link that doesn't work was tried",
			'Limit used up on failed sign-ins from 192.0.2.1; sign-ins from there are refused for now',
			'Limit used up on sign-in links for pat@example.com',
			'pat@example.com used up the limit on photo uploads',
			'The command-line tool printed a sign-in link for pat@example.com (a new account, which may create a home)',
			'The command-line tool printed a sign-in link for pat@example.com (an existing account)'
		]);
	});
});
