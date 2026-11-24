/**
 * A calendar date stored as `YYYY-MM-DD`, such as when a plant was acquired, written out for
 * people: `14 Mar 2025`. It has no time of day, so no time zone applies.
 */
export function formatCalendarDate(value: string): string {
	return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
		new Date(`${value}T00:00:00Z`)
	);
}
