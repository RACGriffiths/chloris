import { describe, expect, it } from 'vitest';
import { digestEmail, escapeHtml, type DigestContent, type DigestTask } from './digest';

const task = (fields: Partial<DigestTask> & Pick<DigestTask, 'plantName' | 'roomName'>) => ({
	plantId: `${fields.plantName.toLowerCase()}-id`,
	roomId: `${fields.roomName.toLowerCase()}-id`,
	task: 'water' as const,
	due: '2026-06-15',
	daysAway: 0,
	...fields
});

const content: DigestContent = {
	to: 'alice@example.com',
	name: 'Alice',
	homeName: "Alice's flat",
	today: '2026-06-15',
	digestTime: '08:00',
	origin: 'https://plants.example.com',
	tasks: [
		task({ plantName: 'ivy', roomName: 'Kitchen' }),
		task({ plantName: 'Fern', roomName: 'Kitchen', task: 'feed' }),
		task({ plantName: 'Fern', roomName: 'Kitchen', due: '2026-06-12', daysAway: -3 }),
		task({
			plantName: 'Monstera',
			roomName: 'Bedroom',
			task: 'mist',
			due: '2026-06-14',
			daysAway: -1
		})
	]
};

describe('digestEmail', () => {
	it('lists the tasks by room and then plant, in name order, with links', () => {
		const email = digestEmail(content);

		expect(email.to).toBe('alice@example.com');
		expect(email.subject).toBe("Alice's flat: 4 plant tasks for today");
		expect(email.text).toBe(
			[
				'Hello Alice,',
				'',
				"Here's what needs doing in Alice's flat today, Monday 15 June.",
				'',
				'BEDROOM',
				'',
				'Monstera',
				'  Mist, overdue by 1 day',
				'  https://plants.example.com/plants/monstera-id',
				'',
				'KITCHEN',
				'',
				'Fern',
				'  Water, overdue by 3 days',
				'  Feed, due today',
				'  https://plants.example.com/plants/fern-id',
				'',
				'ivy',
				'  Water, due today',
				'  https://plants.example.com/plants/ivy-id',
				'',
				'Log care on the Today page: https://plants.example.com/',
				'',
				'--',
				'You get this email at 08:00 on days when something is due.',
				'To change the time or turn it off: https://plants.example.com/account/notifications',
				''
			].join('\n')
		);
	});

	it('says "task" for one', () => {
		expect(digestEmail({ ...content, tasks: content.tasks.slice(0, 1) }).subject).toBe(
			"Alice's flat: 1 plant task for today"
		);
	});

	it('has an HTML version with the same links, escaping what the household typed', () => {
		const html =
			digestEmail({
				...content,
				name: 'Al <b>',
				homeName: 'Flat & "garden"',
				tasks: [task({ plantName: '<script>alert(1)</script>', roomName: "Mum's room" })]
			}).html ?? '';

		expect(html).toContain('Hello Al &lt;b&gt;,');
		expect(html).toContain('Flat &amp; &quot;garden&quot;');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).not.toContain('<script>');
		expect(html).toContain('Mum&#39;s room');
		expect(html).toContain(
			'href="https://plants.example.com/plants/%3Cscript%3Ealert(1)%3C%2Fscript%3E-id"'
		);
		expect(html).toContain('href="https://plants.example.com/"');
		expect(html).toContain('href="https://plants.example.com/account/notifications"');
	});

	it('keeps a home name with line breaks on one line in the subject', () => {
		expect(digestEmail({ ...content, homeName: 'Our\r\nBcc: x@example.com' }).subject).toBe(
			'Our Bcc: x@example.com: 4 plant tasks for today'
		);
	});
});

describe('escapeHtml', () => {
	it('escapes the characters that matter in text and attributes', () => {
		expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
			'&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;'
		);
	});
});
