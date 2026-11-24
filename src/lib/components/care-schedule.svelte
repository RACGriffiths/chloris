<script lang="ts">
	import AlarmClockIcon from '@lucide/svelte/icons/alarm-clock';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import CareIcon from '#lib/components/care-icon.svelte';
	import FieldError from '#lib/components/field-error.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { taskNoun, type Task } from '#lib/care.js';
	import { cn } from '#lib/utils.js';

	/**
	 * One of a plant's care schedules, as a list item: the task, when it's due, and the buttons that
	 * log it, record "checked, not needed" or snooze it. Every button is its own small form posting
	 * to the plant page's actions, so they work before JavaScript loads.
	 */
	let {
		plantId,
		schedule,
		canLog,
		canConfigure,
		snoozeError,
		snoozeFrom,
		snoozeTo
	}: {
		plantId: string;
		schedule: {
			id: string;
			task: Task;
			every: string;
			due: string;
			daysAway: number;
			snoozed: boolean;
			lastDone: string;
		};
		canLog: boolean;
		canConfigure: boolean;
		/** Why a snooze of this task was refused, if it was. */
		snoozeError?: string | null;
		/** The first and last dates a snooze can run until. */
		snoozeFrom: string;
		snoozeTo: string;
	} = $props();

	let noun = $derived(taskNoun(schedule.task));
	let title = $derived(`${noun.charAt(0).toUpperCase()}${noun.slice(1)}`);
	let due = $derived(schedule.daysAway <= 0);

	let busy = $state(false);

	/** Disables the buttons while a form is being sent, so a second tap doesn't log twice. */
	const sending: SubmitFunction = () => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	};

	const chip = $derived(
		schedule.daysAway < 0
			? 'bg-amber-100 text-amber-900'
			: schedule.daysAway === 0
				? 'bg-emerald-100 text-emerald-900'
				: 'text-muted-foreground'
	);
</script>

<!-- `relative` places the snooze panel, which opens over the rows below this one. -->
<li class="relative flex flex-col gap-3 p-3" aria-labelledby="schedule-{schedule.task}">
	<div class="flex items-start gap-3">
		<CareIcon type={schedule.task} />
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<h3 id="schedule-{schedule.task}" class="font-medium">{title}</h3>
				<span class={cn('rounded-full text-sm font-medium', due && 'px-2.5 py-0.5', chip)}>
					{schedule.due}
				</span>
			</div>
			<p class="mt-0.5 text-sm text-muted-foreground">
				{#if canConfigure}
					<a
						href={resolve(`plants/${plantId}/schedules/${schedule.id}`)}
						class="inline-flex items-center gap-1 underline-offset-4 hover:underline"
						aria-label="Change the {noun} schedule: {schedule.every.toLowerCase()}"
					>
						{schedule.every}
						<PencilIcon class="size-3" aria-hidden="true" />
					</a>,
				{:else}
					{schedule.every},
				{/if}
				{schedule.lastDone}
			</p>
		</div>
	</div>

	{#if canLog}
		<div class="flex flex-wrap gap-2">
			<form method="POST" action="?/log" use:enhance={sending}>
				<input type="hidden" name="type" value={schedule.task} />
				<Button type="submit" class="h-10" disabled={busy}>
					<CheckIcon />
					Done<span class="sr-only">&nbsp;{noun}</span>
				</Button>
			</form>

			{#if due}
				<form method="POST" action="?/log" use:enhance={sending}>
					<input type="hidden" name="type" value="checked" />
					<input type="hidden" name="checkedTask" value={schedule.task} />
					<Button
						type="submit"
						variant="outline"
						class="h-10"
						disabled={busy}
						aria-label="Checked, {noun} not needed"
					>
						Not needed
					</Button>
				</form>

				<!--
					A <details> element opens and closes without JavaScript. Its panel is positioned
					against the list item, so it spans the row whichever line the button wraps onto.
				-->
				<details class="group" open={!!snoozeError}>
					<!-- Styled like an outline button. The marker rule hides Safari's own triangle. -->
					<summary
						class="inline-flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-md border bg-background px-2.5 text-sm font-medium shadow-xs outline-none select-none group-open:bg-muted hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
						aria-label="Snooze {noun}"
					>
						<AlarmClockIcon class="size-4" aria-hidden="true" />
						Snooze
						<ChevronDownIcon
							class="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
							aria-hidden="true"
						/>
					</summary>
					<div
						class="absolute inset-x-3 top-full z-10 -mt-1 flex flex-col gap-4 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
					>
						<form
							method="POST"
							action="?/snooze"
							class="grid grid-cols-2 gap-2"
							use:enhance={sending}
						>
							<input type="hidden" name="task" value={schedule.task} />
							<Button
								type="submit"
								name="days"
								value="1"
								variant="outline"
								class="h-10"
								disabled={busy}
							>
								For a day
							</Button>
							<Button
								type="submit"
								name="days"
								value="3"
								variant="outline"
								class="h-10"
								disabled={busy}
							>
								For 3 days
							</Button>
						</form>
						<form method="POST" action="?/snooze" class="flex flex-col gap-2" use:enhance={sending}>
							<input type="hidden" name="task" value={schedule.task} />
							<label for="snooze-{schedule.task}" class="text-sm font-medium">Until a date</label>
							<div class="flex gap-2">
								<Input
									id="snooze-{schedule.task}"
									name="until"
									type="date"
									required
									min={snoozeFrom}
									max={snoozeTo}
									class="h-10 flex-1"
									aria-invalid={snoozeError ? true : undefined}
									aria-describedby={snoozeError ? `snooze-${schedule.task}-error` : undefined}
								/>
								<Button type="submit" class="h-10" disabled={busy}>Snooze</Button>
							</div>
							<FieldError id="snooze-{schedule.task}-error" message={snoozeError} />
						</form>
					</div>
				</details>
			{:else if schedule.snoozed}
				<form method="POST" action="?/unsnooze" use:enhance={sending}>
					<input type="hidden" name="task" value={schedule.task} />
					<Button type="submit" variant="ghost" class="h-10" disabled={busy}>
						Cancel snooze<span class="sr-only">&nbsp;on {noun}</span>
					</Button>
				</form>
			{/if}
		</div>
	{/if}
</li>
