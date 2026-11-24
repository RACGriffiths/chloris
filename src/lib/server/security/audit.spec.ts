import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAuditEvents } from '../data/audit';
import { createHome } from '../data/homes';
import { listServerEvents } from '../data/server-log';
import { addMember, insertUser, useTestDatabase } from '../testing';
import { audit, auditAccount, logLimitsReached, requestSource, signInFailed } from './audit';
import { limits } from './rate-limit';

useTestDatabase();

let alice: string;
let aliceHome: string;
let bobHome: string;

beforeEach(() => {
	alice = insertUser('alice@example.com', { canCreateHome: true });
	const bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
});

const signIn = { action: 'sign-in', detail: { method: 'passkey' } } as const;

function requestFrom(address: string | Error, userAgent = 'Mozilla/5.0 (Android)') {
	return {
		getClientAddress: () => {
			if (address instanceof Error) throw address;
			return address;
		},
		request: new Request('http://localhost/', { headers: { 'user-agent': userAgent } })
	};
}

describe('requestSource', () => {
	it("takes the visitor's address and browser from the request", () => {
		expect(requestSource(requestFrom('203.0.113.7'))).toEqual({
			ipAddress: '203.0.113.7',
			userAgent: 'Mozilla/5.0 (Android)'
		});
		expect(requestSource(requestFrom(new Error('No address header')))).toMatchObject({
			ipAddress: null
		});
	});
});

describe('audit', () => {
	it("records in the home it's given, and no other", () => {
		audit(requestFrom('203.0.113.7'), aliceHome, alice, {
			action: 'room-deleted',
			detail: { name: 'Kitchen' }
		});

		expect(listAuditEvents(aliceHome)).toMatchObject([
			{ action: 'room-deleted', ipAddress: '203.0.113.7' }
		]);
		expect(listAuditEvents(bobHome)).toEqual([]);
	});
});

describe('auditAccount', () => {
	it("records where it came from in the server's log, and not in the homes' logs", () => {
		const carol = insertUser('carol@example.com');
		addMember(aliceHome, carol, 'carer');

		auditAccount({ userId: carol, ipAddress: '203.0.113.7', userAgent: 'Firefox' }, signIn);

		expect(listServerEvents(10)).toMatchObject([
			{ action: 'sign-in', userEmail: 'carol@example.com', ipAddress: '203.0.113.7' }
		]);
		expect(listAuditEvents(aliceHome)).toMatchObject([
			{ action: 'sign-in', ipAddress: null, userAgent: null }
		]);
	});

	it('records in each home the person belongs to, and in no other', () => {
		const carol = insertUser('carol@example.com');
		addMember(aliceHome, carol, 'carer');

		auditAccount({ userId: carol }, signIn);

		expect(listAuditEvents(aliceHome)).toMatchObject([{ action: 'sign-in', userName: 'carol' }]);
		expect(listAuditEvents(bobHome)).toEqual([]);

		addMember(bobHome, carol, 'viewer');
		auditAccount({ userId: carol }, signIn);

		expect(listAuditEvents(aliceHome)).toHaveLength(2);
		expect(listAuditEvents(bobHome)).toHaveLength(1);
	});

	it("leaves out a home whose membership has expired; no home's log for someone with none", () => {
		const sitter = insertUser('sitter@example.com');
		addMember(aliceHome, sitter, 'sitter', { expiresAt: new Date(Date.now() - 1000) });
		const newcomer = insertUser('new@example.com', { canCreateHome: true });

		auditAccount({ userId: sitter }, signIn);
		auditAccount({ userId: newcomer }, signIn);

		expect(listAuditEvents(aliceHome)).toEqual([]);
		expect(listAuditEvents(bobHome)).toEqual([]);
		expect(listServerEvents(10)).toHaveLength(2);
	});
});

describe('signInFailed', () => {
	it("counts towards the visitor's limit, and goes in the server's log", () => {
		const request = requestFrom('192.0.2.200');

		signInFailed(request, 'invite');

		expect(listServerEvents(10)).toMatchObject([
			{ action: 'sign-in-failed', detail: { method: 'invite' }, ipAddress: '192.0.2.200' }
		]);
		for (let i = 1; i < limits.failedSignIn.max; i++) signInFailed(request, 'link');
		expect(limits.failedSignIn.check('192.0.2.200').ok).toBe(false);
	});
});

describe('logLimitsReached', () => {
	afterEach(() => {
		for (const limiter of Object.values(limits)) limiter.onLimit = undefined;
	});

	it("records in the server's log when a limit is used up, once a window", () => {
		logLimitsReached();
		const uploader = insertUser('uploader@example.com');

		for (let i = 0; i < limits.upload.max + 5; i++) limits.upload.consume(uploader);
		for (let i = 0; i < limits.passkey.max; i++) limits.passkey.consume('192.0.2.201');

		expect(listServerEvents(10)).toMatchObject([
			{
				action: 'limit-reached',
				detail: { limit: 'passkey', key: '192.0.2.201' },
				userEmail: null
			},
			{
				action: 'limit-reached',
				detail: { limit: 'upload', key: uploader },
				userEmail: 'uploader@example.com'
			}
		]);
	});
});
