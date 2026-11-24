import { describe, expect, it } from 'vitest';
import { formatCalendarDate } from './dates';

describe('formatCalendarDate', () => {
	it('writes the date out the same, whatever time zone the server is in', () => {
		expect(formatCalendarDate('2025-03-14')).toBe('14 Mar 2025');
		expect(formatCalendarDate('2024-12-31')).toBe('31 Dec 2024');
	});
});
