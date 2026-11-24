<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import { enhance, type SubmitFunction } from '$app/forms';
	import CareIcon from '#lib/components/care-icon.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { taskName, taskNoun, type Task } from '#lib/care.js';
	import { cn } from '#lib/utils.js';

	/**
	 * A task due on one plant, as the Today view lists it: what it is, how late it is, and the
	 * buttons that log it as done or as checked and not needed. Both buttons are in one form posting
	 * to the Today view's `log` action, and each sends its own `outcome`, so they work before
	 * JavaScript loads.
	 */
	let {
		plantId,
		plantName,
		task,
		canLog,
		busy,
		submit
	}: {
		plantId: string;
		plantName: string;
		task: { task: Task; due: string; overdue: boolean };
		canLog: boolean;
		/** Whether a form on the page is being sent, so a second tap doesn't log twice. */
		busy: boolean;
		submit: SubmitFunction;
	} = $props();

	let noun = $derived(taskNoun(task.task));
</script>

<li class="flex flex-col gap-2">
	<div class="flex items-center justify-between gap-3">
		<span class="flex min-w-0 items-center gap-2 font-medium">
			<CareIcon type={task.task} class="size-7" />
			{taskName(task.task)}
		</span>
		<span
			class={cn(
				'shrink-0 rounded-full px-2.5 py-0.5 text-sm font-medium',
				task.overdue ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
			)}
		>
			{task.due}
		</span>
	</div>

	{#if canLog}
		<form method="POST" action="?/log" class="grid grid-cols-2 gap-2" use:enhance={submit}>
			<input type="hidden" name="task" value={task.task} />
			<input type="hidden" name="plantId" value={plantId} />
			<!-- The button pressed is sent with the form, as `outcome`. -->
			<Button type="submit" name="outcome" value="done" class="h-10" disabled={busy}>
				<CheckIcon />
				Done<span class="sr-only">&nbsp;{noun} {plantName}</span>
			</Button>
			<Button
				type="submit"
				name="outcome"
				value="not-needed"
				variant="outline"
				class="h-10"
				disabled={busy}
				aria-label="Checked {plantName}, {noun} not needed"
			>
				Not needed
			</Button>
		</form>
	{/if}
</li>
