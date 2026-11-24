/**
 * The daily digest's settings: how it comes, at what time, and quiet hours (docs/spec.md,
 * Reminders and notifications; D46, D47). Shared by the server, which checks and acts on them, and
 * the pages, which show them. Times of day are `HH:MM` in the home's time zone.
 */

/** How a digest can come. Push arrives in version 2; until then only email is offered. */
export const DIGEST_CHANNELS = ['email', 'push'] as const;

export type DigestChannel = (typeof DIGEST_CHANNELS)[number];

/** A person's digest settings for one home. */
export interface NotificationSettings {
	/** How the digest comes, or `null` when it's off. */
	channel: DigestChannel | null;
	/** When it goes, `HH:MM`. */
	digestTime: string;
	/** When quiet hours start and end, `HH:MM`, or both `null` for none. */
	quietStart: string | null;
	quietEnd: string | null;
}

export const DEFAULT_DIGEST_TIME = '08:00';
export const DEFAULT_QUIET_START = '22:00';
export const DEFAULT_QUIET_END = '07:00';

/**
 * The settings of someone who hasn't chosen any (D47): by email at 08:00 for those who can log
 * care, and off for those who can't, who couldn't act on it. Quiet hours from 22:00 to 07:00.
 */
export function defaultNotificationSettings(canLogCare: boolean): NotificationSettings {
	return {
		channel: canLogCare ? 'email' : null,
		digestTime: DEFAULT_DIGEST_TIME,
		quietStart: DEFAULT_QUIET_START,
		quietEnd: DEFAULT_QUIET_END
	};
}

/**
 * A time of day as people type it or a time field sends it (`8:00`, `08:00`, `08:00:00`), as
 * `HH:MM`; `null` if it isn't one.
 */
export function parseTimeOfDay(value: string): string | null {
	const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
	if (!match) return null;
	const [hours, minutes] = [Number(match[1]), Number(match[2])];
	if (hours > 23 || minutes > 59) return null;
	return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

/**
 * Whether `time` falls inside quiet hours from `start` to `end`, each `HH:MM`. They run from
 * `start` up to, but not including, `end`, past midnight when `end` is earlier: 22:00 to 07:00
 * covers 23:30 and 06:59 but not 07:00. Without quiet hours, nothing is inside them.
 */
export function inQuietHours(time: string, start: string | null, end: string | null): boolean {
	if (start === null || end === null || start === end) return false;
	return start < end ? time >= start && time < end : time >= start || time < end;
}

/** A digest's settings in a few words, for the Account page: "By email at 08:00", "Off". */
export function digestSummary(settings: NotificationSettings): string {
	if (settings.channel === null) return 'Off';
	return `${settings.channel === 'email' ? 'By email' : 'By push'} at ${settings.digestTime}`;
}
