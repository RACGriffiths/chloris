import { describe, expect, it } from 'vitest';
import {
	addDays,
	calendarDate,
	daysBetween,
	formatCalendarDate,
	formatMoment,
	formatLongDate,
	formatMonth,
	formatNearDate,
	localDateTime,
	zonedTime
} from './dates';

describe('formatCalendarDate', () => {
	it('writes the date out the same, whatever time zone the server is in', () => {
		expect(formatCalendarDate('2025-03-14')).toBe('14 Mar 2025');
		expect(formatCalendarDate('2024-12-31')).toBe('31 Dec 2024');
	});
});

describe('formatNearDate', () => {
	it('gives the weekday in the same year, and the year otherwise', () => {
		expect(formatNearDate('2026-11-27', '2026-11-24')).toBe('Fri 27 Nov');
		expect(formatNearDate('2027-01-02', '2026-12-30')).toBe('2 Jan 2027');
	});
});

describe('formatLongDate', () => {
	it('gives the weekday, day and month', () => {
		expect(formatLongDate('2026-11-24')).toBe('Tuesday 24 November');
	});
});

describe('formatMonth', () => {
	it('gives the month and year, whatever the day', () => {
		expect(formatMonth('2026-11-01')).toBe('November 2026');
		expect(formatMonth('2025-05-31')).toBe('May 2025');
	});
});

describe('calendar arithmetic', () => {
	it('adds days across months, years and leap days', () => {
		expect(addDays('2026-11-24', 7)).toBe('2026-12-01');
		expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
	});

	it('counts days between dates, negative when going back', () => {
		expect(daysBetween('2026-11-24', '2026-12-01')).toBe(7);
		expect(daysBetween('2026-12-01', '2026-11-24')).toBe(-7);
		// The clocks change in between, which mustn't make a day go missing.
		expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
	});
});

describe('calendarDate', () => {
	it('is the date in the home’s time zone, not the server’s', () => {
		const lateEvening = new Date('2026-11-24T23:30:00Z');
		expect(calendarDate(lateEvening, 'Europe/London')).toBe('2026-11-24');
		expect(calendarDate(lateEvening, 'Europe/Paris')).toBe('2026-11-25');
		expect(calendarDate(lateEvening, 'America/New_York')).toBe('2026-11-24');
	});
});

describe('zonedTime and localDateTime', () => {
	it('read a wall-clock time in the home’s time zone, and back', () => {
		const instant = zonedTime('2026-06-15T09:30', 'Europe/London');
		expect(instant.toISOString()).toBe('2026-06-15T08:30:00.000Z');
		expect(localDateTime(instant, 'Europe/London')).toBe('2026-06-15T09:30');
		expect(zonedTime('2026-01-15T09:30', 'America/New_York').toISOString()).toBe(
			'2026-01-15T14:30:00.000Z'
		);
		expect(zonedTime('2026-01-15T09:30:45', 'Europe/Paris').toISOString()).toBe(
			'2026-01-15T08:30:45.000Z'
		);
	});

	it('takes the first of a time that happens twice when the clocks go back', () => {
		// London goes from 02:00 BST back to 01:00 GMT on 25 October 2026.
		expect(zonedTime('2026-10-25T01:30', 'Europe/London').toISOString()).toBe(
			'2026-10-25T00:30:00.000Z'
		);
		expect(zonedTime('2026-11-01T01:30', 'America/New_York').toISOString()).toBe(
			'2026-11-01T05:30:00.000Z'
		);
	});

	it('moves a time that never happens, when the clocks go forward, to just after the change', () => {
		// London goes from 01:00 GMT to 02:00 BST on 29 March 2026.
		const instant = zonedTime('2026-03-29T01:30', 'Europe/London');
		expect(localDateTime(instant, 'Europe/London')).toBe('2026-03-29T02:30');
	});

	it('is right on the days either side of a change', () => {
		expect(zonedTime('2026-10-25T12:00', 'Europe/London').toISOString()).toBe(
			'2026-10-25T12:00:00.000Z'
		);
		expect(zonedTime('2026-10-24T12:00', 'Europe/London').toISOString()).toBe(
			'2026-10-24T11:00:00.000Z'
		);
	});
});

describe('formatMoment', () => {
	const now = new Date('2026-11-24T12:00:00Z');

	it('says today and yesterday, then the date, in the home’s time zone', () => {
		const zone = 'Europe/London';
		expect(formatMoment(new Date('2026-11-24T09:14:00Z'), zone, now)).toBe('Today, 09:14');
		expect(formatMoment(new Date('2026-11-23T18:02:00Z'), zone, now)).toBe('Yesterday, 18:02');
		expect(formatMoment(new Date('2026-11-17T08:30:00Z'), zone, now)).toBe('Tue 17 Nov, 08:30');
		expect(formatMoment(new Date('2025-11-17T08:30:00Z'), zone, now)).toBe('17 Nov 2025, 08:30');
		expect(formatMoment(new Date('2026-11-24T09:14:00Z'), zone, now, 'sentence')).toBe(
			'today at 09:14'
		);
		expect(formatMoment(new Date('2026-11-17T08:30:00Z'), zone, now, 'sentence')).toBe(
			'Tue 17 Nov at 08:30'
		);
		// Late on the 23rd in London is already the 24th in Paris.
		expect(formatMoment(new Date('2026-11-23T23:30:00Z'), 'Europe/Paris', now)).toBe(
			'Today, 00:30'
		);
	});
});
