/**
 * Kinds of care and how they're named on screen (docs/spec.md, Care log and schedules). Shared by
 * the server, which validates against these lists, and the pages, which show them.
 */

/** Care that can be put on a schedule, in the order a plant's schedules are listed. */
export const TASKS = ['water', 'feed', 'mist', 'prune', 'repot', 'pest-treatment'] as const;

export type Task = (typeof TASKS)[number];

export function isTask(value: string): value is Task {
	return (TASKS as readonly string[]).includes(value);
}

/**
 * Every kind of care event. `move` is logged but never scheduled. `checked` records that a task
 * was looked at and wasn't needed, and names the task it was for (D13).
 */
export const CARE_TYPES = [...TASKS, 'move', 'checked'] as const;

export type CareType = (typeof CARE_TYPES)[number];

/** What the Log care form offers: everything but a check, which a schedule's button records. */
export const LOGGABLE_TYPES = [...TASKS, 'move'] as const satisfies readonly CareType[];

/**
 * What decides when a task is next due: the interval since it was last done, the recheck delay
 * after a check, or a snooze (D31).
 */
export type DueReason = 'interval' | 'checked' | 'snoozed';

const NAMES: Record<Exclude<CareType, 'checked'>, { name: string; done: string; noun: string }> = {
	water: { name: 'Water', done: 'Watered', noun: 'watering' },
	feed: { name: 'Feed', done: 'Fed', noun: 'feeding' },
	mist: { name: 'Mist', done: 'Misted', noun: 'misting' },
	prune: { name: 'Prune', done: 'Pruned', noun: 'pruning' },
	repot: { name: 'Repot', done: 'Repotted', noun: 'repotting' },
	'pest-treatment': { name: 'Treat pests', done: 'Treated for pests', noun: 'pest treatment' },
	move: { name: 'Move', done: 'Moved', noun: 'move' }
};

const named = (type: string) => (Object.hasOwn(NAMES, type) ? NAMES[type as Task] : null);

/** The task as an instruction: "Water", "Treat pests". */
export function taskName(type: string): string {
	return named(type)?.name ?? type;
}

/** The task as a noun, for sentences: "watering", "pest treatment". */
export function taskNoun(type: string): string {
	return named(type)?.noun ?? type;
}

/** A care event as the history lists it: "Watered", "Checked, watering not needed". */
export function careEventName(type: string, checkedTask: string | null): string {
	if (type === 'checked') {
		return checkedTask ? `Checked, ${taskNoun(checkedTask)} not needed` : 'Checked';
	}
	return named(type)?.done ?? type;
}

/** A button that logs a task on several plants at once: "Water all 3", "Treat all 3 for pests". */
export function allText(task: Task, count: number): string {
	return task === 'pest-treatment'
		? `Treat all ${count} for pests`
		: `${taskName(task)} all ${count}`;
}

/** How often a schedule comes round: "Every day", "Every 7 days". */
export function everyText(days: number): string {
	return days === 1 ? 'Every day' : `Every ${days} days`;
}

const inDays = (days: number) => (days === 1 ? 'tomorrow' : `in ${days} days`);

/**
 * When a task is next due, for its schedule on the plant's page. `daysAway` is how many days
 * from today it's due: negative when overdue. `date` is the due date as people read it.
 */
export function dueText(daysAway: number, reason: DueReason, date: string): string {
	if (daysAway < 0) return `Overdue by ${-daysAway} ${-daysAway === 1 ? 'day' : 'days'}`;
	if (daysAway === 0) return 'Due today';
	if (reason === 'snoozed') return `Snoozed until ${date}`;
	if (reason === 'checked') return `Check again ${inDays(daysAway)}`;
	return `Due ${inDays(daysAway)}`;
}
