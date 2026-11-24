import { describe, expect, it } from 'vitest';
import { careEventName, dueText, everyText, isTask, taskName, taskNoun } from './care';

describe('names', () => {
	it('names each task as an instruction, a noun and a past event', () => {
		expect(taskName('pest-treatment')).toBe('Treat pests');
		expect(taskNoun('water')).toBe('watering');
		expect(careEventName('feed', null)).toBe('Fed');
		expect(careEventName('move', null)).toBe('Moved');
		expect(careEventName('checked', 'water')).toBe('Checked, watering not needed');
	});

	it('knows which types can be scheduled', () => {
		expect(isTask('repot')).toBe(true);
		expect(isTask('move')).toBe(false);
		expect(isTask('checked')).toBe(false);
	});
});

describe('everyText', () => {
	it('says how often', () => {
		expect(everyText(1)).toBe('Every day');
		expect(everyText(14)).toBe('Every 14 days');
	});
});

describe('dueText', () => {
	it('says when the task is due, and why when it was put off', () => {
		expect(dueText(-1, 'interval', 'Sun 23 Nov')).toBe('Overdue by 1 day');
		expect(dueText(-4, 'snoozed', 'Thu 20 Nov')).toBe('Overdue by 4 days');
		expect(dueText(0, 'checked', 'Mon 24 Nov')).toBe('Due today');
		expect(dueText(1, 'interval', 'Tue 25 Nov')).toBe('Due tomorrow');
		expect(dueText(6, 'interval', 'Sun 30 Nov')).toBe('Due in 6 days');
		expect(dueText(2, 'checked', 'Wed 26 Nov')).toBe('Check again in 2 days');
		expect(dueText(3, 'snoozed', 'Thu 27 Nov')).toBe('Snoozed until Thu 27 Nov');
	});
});
