import { describe, expect, it } from 'vitest';
import {
	defaultNotificationSettings,
	digestSummary,
	inQuietHours,
	parseTimeOfDay
} from './notifications';

describe('parseTimeOfDay', () => {
	it('reads times as people type them and time fields send them', () => {
		expect(parseTimeOfDay('08:00')).toBe('08:00');
		expect(parseTimeOfDay('8:05')).toBe('08:05');
		expect(parseTimeOfDay(' 23:59 ')).toBe('23:59');
		expect(parseTimeOfDay('07:30:00')).toBe('07:30');
		expect(parseTimeOfDay('07:30:00.000')).toBe('07:30');
	});

	it("refuses what isn't a time of day", () => {
		for (const value of ['', '8', '24:00', '12:60', '8am', '08:0', '-1:00']) {
			expect(parseTimeOfDay(value)).toBeNull();
		}
	});
});

describe('inQuietHours', () => {
	it('runs from the start up to the end', () => {
		expect(inQuietHours('12:59', '13:00', '15:00')).toBe(false);
		expect(inQuietHours('13:00', '13:00', '15:00')).toBe(true);
		expect(inQuietHours('14:59', '13:00', '15:00')).toBe(true);
		expect(inQuietHours('15:00', '13:00', '15:00')).toBe(false);
	});

	it('runs past midnight when it ends earlier than it starts', () => {
		expect(inQuietHours('21:59', '22:00', '07:00')).toBe(false);
		expect(inQuietHours('22:00', '22:00', '07:00')).toBe(true);
		expect(inQuietHours('00:00', '22:00', '07:00')).toBe(true);
		expect(inQuietHours('06:59', '22:00', '07:00')).toBe(true);
		expect(inQuietHours('07:00', '22:00', '07:00')).toBe(false);
	});

	it('covers nothing without quiet hours', () => {
		expect(inQuietHours('03:00', null, null)).toBe(false);
		expect(inQuietHours('03:00', '03:00', '03:00')).toBe(false);
	});
});

describe('defaultNotificationSettings', () => {
	it('emails those who can log care at 08:00, and is off for the others', () => {
		expect(defaultNotificationSettings(true)).toEqual({
			channel: 'email',
			digestTime: '08:00',
			quietStart: '22:00',
			quietEnd: '07:00'
		});
		expect(defaultNotificationSettings(false).channel).toBeNull();
	});
});

describe('digestSummary', () => {
	it('says how and when, or that it is off', () => {
		expect(digestSummary(defaultNotificationSettings(true))).toBe('By email at 08:00');
		expect(digestSummary(defaultNotificationSettings(false))).toBe('Off');
	});
});
