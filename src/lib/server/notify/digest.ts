import { TASKS, dueText, taskName, type Task } from '../../care';
import { formatLongDate, formatNearDate } from '../../dates';
import { compareNames } from '../data/order';
import type { Email } from './mailer';

/**
 * The daily digest email (docs/spec.md, Reminders and notifications; D49): the tasks due today
 * and overdue, under each room and then each plant in name order, as the Today view lists them,
 * with a link to each plant. Plain text, with an HTML version for mail apps that show one.
 */

/** A task the digest lists: one plant's due or overdue task, as `listTasks()` gives it. */
export interface DigestTask {
	plantId: string;
	plantName: string;
	roomId: string;
	roomName: string;
	task: Task;
	/** The day it's due, `YYYY-MM-DD`. */
	due: string;
	/** Days from today: 0 for today, negative when overdue. */
	daysAway: number;
}

export interface DigestContent {
	/** Who it's for: their address and name. */
	to: string;
	name: string;
	homeName: string;
	/** The day it's for, `YYYY-MM-DD` in the home's time zone. */
	today: string;
	/** When it's sent each day, `HH:MM`, for its footer. */
	digestTime: string;
	tasks: DigestTask[];
	/** `ORIGIN`, which every link starts with. */
	origin: string;
}

interface Group {
	id: string;
	name: string;
}

interface RoomGroup extends Group {
	plants: (Group & { url: string; tasks: { name: string; when: string; overdue: boolean }[] })[];
}

/** Collapses runs of spaces and line breaks, which have no place in a subject or a greeting. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The tasks grouped by room and then by plant, both in name order, as on the Today view. */
function byRoom(tasks: DigestTask[], today: string, origin: string): RoomGroup[] {
	type Plant = Group & { tasks: DigestTask[] };
	type Room = Group & { plants: Map<string, Plant> };
	const byName = (a: Group, b: Group) => compareNames(a.name, b.name) || a.id.localeCompare(b.id);
	const rooms = new Map<string, Room>();
	for (const task of tasks) {
		const room: Room = rooms.get(task.roomId) ?? {
			id: task.roomId,
			name: task.roomName,
			plants: new Map()
		};
		rooms.set(task.roomId, room);
		const plant: Plant = room.plants.get(task.plantId) ?? {
			id: task.plantId,
			name: task.plantName,
			tasks: []
		};
		room.plants.set(task.plantId, plant);
		plant.tasks.push(task);
	}
	return [...rooms.values()].sort(byName).map((room) => ({
		id: room.id,
		name: room.name,
		plants: [...room.plants.values()].sort(byName).map((plant) => ({
			id: plant.id,
			name: plant.name,
			url: new URL(`/plants/${encodeURIComponent(plant.id)}`, origin).href,
			tasks: plant.tasks
				.sort((a, b) => TASKS.indexOf(a.task) - TASKS.indexOf(b.task))
				.map((task) => {
					// "Due today", "Overdue by 2 days", in the middle of a line.
					const when = dueText(task.daysAway, 'interval', formatNearDate(task.due, today));
					return {
						name: taskName(task.task),
						when: `${when.charAt(0).toLowerCase()}${when.slice(1)}`,
						overdue: task.daysAway < 0
					};
				})
		}))
	}));
}

/** Text the household typed, made safe to put in HTML. */
export function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** The colours of the app's light theme, as hex for mail apps that don't know `oklch()`. */
const colour = {
	text: '#1b1c17',
	muted: '#66695a',
	border: '#e6e6df',
	page: '#f6f6f3',
	card: '#ffffff',
	overdue: '#c4161c',
	button: '#2a2b24',
	buttonText: '#fbfbf9'
};

/** The digest email for one person, ready to send. */
export function digestEmail(content: DigestContent): Email {
	const { origin, today } = content;
	const homeName = oneLine(content.homeName);
	const name = oneLine(content.name);
	const count = content.tasks.length;
	const rooms = byRoom(content.tasks, today, origin);
	const todayUrl = new URL('/', origin).href;
	const settingsUrl = new URL('/account/notifications', origin).href;
	const date = formatLongDate(today);
	const intro = `Here's what needs doing in ${homeName} today, ${date}.`;
	const footer = `You get this email at ${content.digestTime} on days when something is due.`;

	const text = [
		`Hello ${name},`,
		'',
		intro,
		...rooms.flatMap((room) => [
			'',
			room.name.toUpperCase(),
			...room.plants.flatMap((plant) => [
				'',
				plant.name,
				...plant.tasks.map((task) => `  ${task.name}, ${task.when}`),
				`  ${plant.url}`
			])
		]),
		'',
		`Log care on the Today page: ${todayUrl}`,
		'',
		'--',
		footer,
		`To change the time or turn it off: ${settingsUrl}`,
		''
	].join('\n');

	const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(homeName)}</title></head>
<body style="margin:0;padding:24px 16px;background:${colour.page};color:${colour.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:560px;margin:0 auto">
<p style="margin:0 0 8px">Hello ${escapeHtml(name)},</p>
<p style="margin:0 0 8px">${escapeHtml(intro)}</p>
${rooms
	.map(
		(
			room
		) => `<h2 style="margin:24px 0 8px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:${colour.muted}">${escapeHtml(room.name)}</h2>
<div style="background:${colour.card};border:1px solid ${colour.border};border-radius:10px">
${room.plants
	.map(
		(
			plant,
			index
		) => `<div style="padding:12px 16px${index > 0 ? `;border-top:1px solid ${colour.border}` : ''}">
<a href="${escapeHtml(plant.url)}" style="color:${colour.text};font-weight:600;text-decoration:underline">${escapeHtml(plant.name)}</a>
${plant.tasks
	.map(
		(task) =>
			`<div>${escapeHtml(task.name)}, <span style="color:${task.overdue ? colour.overdue : colour.muted}">${escapeHtml(task.when)}</span></div>`
	)
	.join('\n')}
</div>`
	)
	.join('\n')}
</div>`
	)
	.join('\n')}
<p style="margin:24px 0"><a href="${escapeHtml(todayUrl)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:${colour.button};color:${colour.buttonText};font-weight:600;text-decoration:none">Open Today in Chloris</a></p>
<p style="margin:0;font-size:13px;color:${colour.muted}">${escapeHtml(footer)} <a href="${escapeHtml(settingsUrl)}" style="color:${colour.muted}">Change the time or turn it off</a>.</p>
</div>
</body>
</html>
`;

	return {
		to: content.to,
		subject: `${homeName}: ${count} plant ${count === 1 ? 'task' : 'tasks'} for today`,
		text,
		html
	};
}
