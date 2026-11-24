<script lang="ts">
	import CareIcon from '#lib/components/care-icon.svelte';
	import FieldError from '#lib/components/field-error.svelte';
	import { Input } from '#lib/components/ui/input/index.js';
	import { taskNoun, type Task } from '#lib/care.js';

	/**
	 * A care schedule's fields, for a form that adds or changes one. The page supplies the form.
	 * `tasks` lists the tasks to choose from when adding; a schedule's task can't be changed, so the
	 * edit page leaves it out.
	 *
	 * The radio buttons use `defaultChecked` rather than `checked`, as in `room-fields.svelte`, so a
	 * form reset returns to the right choice.
	 */
	type Values = { task: string; intervalDays: string; recheckDays: string };
	let {
		tasks = [],
		values,
		errors = {},
		maxInterval,
		maxRecheck
	}: {
		tasks?: readonly Task[];
		values: Values;
		errors?: Partial<Record<string, string>>;
		maxInterval: number;
		maxRecheck: number;
	} = $props();

	const capitalised = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

	function invalid(field: keyof Values, hint: string) {
		const error = errors[field] ? `${field}-error` : undefined;
		return {
			'aria-invalid': error ? true : undefined,
			'aria-describedby': [error, hint].filter(Boolean).join(' ')
		};
	}
</script>

{#if tasks.length > 0}
	<fieldset class="flex flex-col gap-2">
		<legend class="mb-2 text-sm font-medium">Task</legend>
		<div class="grid grid-cols-2 gap-2">
			{#each tasks as task (task)}
				<label
					class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
				>
					<input
						type="radio"
						name="task"
						value={task}
						defaultChecked={values.task === task}
						class="sr-only"
					/>
					<CareIcon type={task} class="size-8" />
					<span class="font-medium">{capitalised(taskNoun(task))}</span>
				</label>
			{/each}
		</div>
		<FieldError id="task-error" message={errors.task} />
	</fieldset>
{/if}

<div class="flex flex-col gap-2">
	<label for="intervalDays" class="text-sm font-medium">How often</label>
	<div class="flex items-center gap-2">
		<span class="text-sm">Every</span>
		<Input
			id="intervalDays"
			name="intervalDays"
			type="number"
			inputmode="numeric"
			required
			min={1}
			max={maxInterval}
			class="h-11 w-24"
			value={values.intervalDays}
			{...invalid('intervalDays', 'intervalDays-hint')}
		/>
		<span class="text-sm">days</span>
	</div>
	<p id="intervalDays-hint" class="text-sm text-muted-foreground">
		Counted from the day it was last done.
	</p>
	<FieldError id="intervalDays-error" message={errors.intervalDays} />
</div>

<div class="flex flex-col gap-2">
	<label for="recheckDays" class="text-sm font-medium">Check again after</label>
	<div class="flex items-center gap-2">
		<Input
			id="recheckDays"
			name="recheckDays"
			type="number"
			inputmode="numeric"
			required
			min={1}
			max={maxRecheck}
			class="h-11 w-20"
			value={values.recheckDays}
			{...invalid('recheckDays', 'recheckDays-hint')}
		/>
		<span class="text-sm">days</span>
	</div>
	<p id="recheckDays-hint" class="text-sm text-muted-foreground">
		When you check and it can wait, such as soil that's still damp, “Not needed” puts it off this
		long.
	</p>
	<FieldError id="recheckDays-error" message={errors.recheckDays} />
</div>
