/**
 * Dates and times. Calendar dates are stored as `YYYY-MM-DD` with no time zone. Moments are
 * `Date`s, and are turned into calendar dates and wall-clock times in the home's time zone, which
 * decides when a day starts (docs/spec.md, Data model).
 */

const DAY_MS = 86_400_000;

/** Midnight UTC on a calendar date: a fixed point to do calendar arithmetic on. */
const utcMidnight = (date: string) => Date.parse(`${date}T00:00:00Z`);

/**
 * A calendar date stored as `YYYY-MM-DD`, such as when a plant was acquired, written out for
 * people: `14 Mar 2025`. It has no time of day, so no time zone applies.
 */
export function formatCalendarDate(value: string): string {
	return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
		utcMidnight(value)
	);
}

/** A calendar date in the near future or past, written short: `Thu 27 Nov`, or with its year. */
export function formatNearDate(value: string, today: string): string {
	const sameYear = value.slice(0, 4) === today.slice(0, 4);
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: 'UTC',
		day: 'numeric',
		month: 'short',
		...(sameYear ? { weekday: 'short' } : { year: 'numeric' })
	})
		.format(utcMidnight(value))
		.replace(',', '');
}

/** A calendar date written out in full, without its year: `Tuesday 24 November`. */
export function formatLongDate(value: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: 'UTC',
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	})
		.format(utcMidnight(value))
		.replace(',', '');
}

/** The month a calendar date falls in, with its year: `November 2026`. */
export function formatMonth(value: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: 'UTC',
		month: 'long',
		year: 'numeric'
	}).format(utcMidnight(value));
}

/** The calendar date `days` after `date` (before it, if negative). */
export function addDays(date: string, days: number): string {
	return new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** How many days from `from` to `to`: negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
	return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

/** The year, month, day, hour, minute and second that `instant` shows on a clock in `timeZone`. */
function wallClock(instant: Date | number, timeZone: string) {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(instant);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? '00';
	return {
		date: `${part('year')}-${part('month')}-${part('day')}`,
		time: `${part('hour')}:${part('minute')}`,
		second: part('second')
	};
}

/** The calendar date `instant` falls on in `timeZone`. */
export function calendarDate(instant: Date, timeZone: string): string {
	return wallClock(instant, timeZone).date;
}

/** `instant` as a `datetime-local` field's value, `YYYY-MM-DDTHH:mm`, in `timeZone`. */
export function localDateTime(instant: Date, timeZone: string): string {
	const { date, time } = wallClock(instant, timeZone);
	return `${date}T${time}`;
}

/** How far `timeZone`'s clocks are ahead of UTC at `instant`, in milliseconds. */
function offset(instant: number, timeZone: string): number {
	const { date, time, second } = wallClock(instant, timeZone);
	const shown = Date.parse(`${date}T${time}:${second}Z`);
	return shown - Math.floor(instant / 1000) * 1000;
}

/**
 * The moment a clock in `timeZone` shows `local`, a `datetime-local` value such as
 * `2025-03-14T09:30`. When clocks go back and the time happens twice, it's the first. When they
 * go forward and it never happens, it's read with the offset from before the change, which lands
 * just after it.
 */
export function zonedTime(local: string, timeZone: string): Date {
	const asUtc = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
	const before = offset(asUtc - DAY_MS, timeZone);
	const after = offset(asUtc + DAY_MS, timeZone);
	// Try the earlier offset first, so a repeated hour reads as its first occurrence.
	for (const candidate of [Math.max(before, after), Math.min(before, after)]) {
		const instant = asUtc - candidate;
		if (localDateTime(new Date(instant), timeZone) === local.slice(0, 16)) {
			return new Date(instant);
		}
	}
	return new Date(asUtc - before);
}

/** A calendar date near `today`: `today`, `yesterday`, or as `formatNearDate` writes it. */
export function relativeDay(date: string, today: string): string {
	if (date === today) return 'today';
	if (date === addDays(today, -1)) return 'yesterday';
	return formatNearDate(date, today);
}

/**
 * When something happened, in the home's time zone. For a list, such as a plant's care history:
 * `Today, 09:14`, `Yesterday, 18:02`, `Mon 17 Nov, 08:30`, or with the year once it's not this
 * year. In a sentence: `today at 09:14`, `Mon 17 Nov at 08:30`.
 */
export function formatMoment(
	instant: Date,
	timeZone: string,
	now = new Date(),
	style: 'list' | 'sentence' = 'list'
): string {
	const { date, time } = wallClock(instant, timeZone);
	const day = relativeDay(date, calendarDate(now, timeZone));
	if (style === 'sentence') return `${day} at ${time}`;
	return `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${time}`;
}
