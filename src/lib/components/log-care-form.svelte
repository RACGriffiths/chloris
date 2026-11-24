<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { enhance } from '$app/forms';
	import FieldError from '#lib/components/field-error.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { LOGGABLE_TYPES, careEventName } from '#lib/care.js';

	/**
	 * The form for logging any kind of care, with a note, or at an earlier time. It sits closed
	 * under the schedules, which log their own tasks in one tap, and opens by itself when the
	 * server sends it back with a problem.
	 */
	let {
		values,
		errors = {},
		latest,
		noteLimit
	}: {
		/** What was sent, when the server sent the form back. */
		values?: { type: string; doneAt: string; note: string };
		errors?: Partial<Record<string, string>>;
		/** The latest time the picker offers: the end of today in the home's time zone. */
		latest: string;
		noteLimit: number;
	} = $props();

	let saving = $state(false);

	function invalid(field: string, hint?: string) {
		const error = errors[field] ? `log-${field}-error` : undefined;
		return {
			'aria-invalid': error ? true : undefined,
			'aria-describedby': [error, hint].filter(Boolean).join(' ') || undefined
		};
	}
</script>

<details class="group rounded-lg border" open={!!values}>
	<summary
		class="flex cursor-pointer list-none flex-col gap-0.5 p-3 [&::-webkit-details-marker]:hidden"
	>
		<span class="flex items-center gap-1 font-medium">
			<ChevronRightIcon
				class="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
				aria-hidden="true"
			/>
			Log other care
		</span>
		<span class="pl-5 text-sm text-muted-foreground">Anything else, earlier care, or a note</span>
	</summary>

	<form
		method="POST"
		action="?/log"
		class="flex flex-col gap-6 border-t p-3 pt-5"
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				// Empties the form once the care is logged; keeps what was typed if it was refused.
				await update();
				saving = false;
			};
		}}
	>
		<div class="flex flex-col gap-2">
			<label for="log-type" class="text-sm font-medium">What you did</label>
			<NativeSelect.Root
				id="log-type"
				name="type"
				size="lg"
				class="w-full"
				value={values?.type}
				{...invalid('type')}
			>
				{#each LOGGABLE_TYPES as type (type)}
					<NativeSelect.Option value={type}>{careEventName(type, null)}</NativeSelect.Option>
				{/each}
			</NativeSelect.Root>
			<FieldError id="log-type-error" message={errors.type} />
		</div>

		<div class="flex flex-col gap-2">
			<label for="log-doneAt" class="text-sm font-medium">When</label>
			<Input
				id="log-doneAt"
				name="doneAt"
				type="datetime-local"
				max={latest}
				class="h-11"
				value={values?.doneAt}
				{...invalid('doneAt', 'log-doneAt-hint')}
			/>
			<p id="log-doneAt-hint" class="text-sm text-muted-foreground">
				Leave it empty for now, or pick when you did it.
			</p>
			<FieldError id="log-doneAt-error" message={errors.doneAt} />
		</div>

		<div class="flex flex-col gap-2">
			<label for="log-note" class="text-sm font-medium">Note</label>
			<Textarea
				id="log-note"
				name="note"
				maxlength={noteLimit}
				rows={3}
				placeholder="Optional"
				value={values?.note}
				{...invalid('note')}
			/>
			<FieldError id="log-note-error" message={errors.note} />
		</div>

		<Button type="submit" class="h-11 w-full" disabled={saving}>Log care</Button>
	</form>
</details>
