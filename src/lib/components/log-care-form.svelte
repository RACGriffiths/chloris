<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { enhance, type SubmitFunction } from '$app/forms';
	import FieldError from '#lib/components/field-error.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { LOGGABLE_TYPES, careEventName } from '#lib/care.js';
	import { chosenPhoto, preparePhotoField } from '#lib/photo-field.js';
	import { PHOTO_ACCEPT } from '#lib/photos.js';

	/**
	 * The form for logging any kind of care, with a note, at an earlier time, or with a photo
	 * (D41). It sits closed under the schedules, which log their own tasks in one tap, and opens by
	 * itself when the server sends it back with a problem. A photo is resized in the browser first,
	 * as in "Add a photo", once JavaScript has loaded.
	 */
	let {
		values,
		errors = {},
		latest,
		noteLimit,
		canAddPhoto = false
	}: {
		/** What was sent, when the server sent the form back. A file can't be put back. */
		values?: { type: string; doneAt: string; note: string };
		errors?: Partial<Record<string, string>>;
		/** The latest time the picker offers: the end of today in the home's time zone. */
		latest: string;
		noteLimit: number;
		/** Whether to offer a photo: only for those who may add photos. */
		canAddPhoto?: boolean;
	} = $props();

	let stage = $state<'idle' | 'preparing' | 'sending'>('idle');

	const prepare: SubmitFunction = async ({ formData }) => {
		if (chosenPhoto(formData)) {
			stage = 'preparing';
			await preparePhotoField(formData);
		}
		stage = 'sending';
		return async ({ update }) => {
			// Empties the form once the care is logged; keeps what was typed if it was refused.
			await update();
			stage = 'idle';
		};
	};

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
		<span class="pl-5 text-sm text-muted-foreground">
			Anything else, earlier care, a note{canAddPhoto ? ' or a photo' : ''}
		</span>
	</summary>

	<!-- multipart/form-data, so it can carry a photo. -->
	<form
		method="POST"
		action="?/log"
		enctype="multipart/form-data"
		class="flex flex-col gap-6 border-t p-3 pt-5"
		use:enhance={prepare}
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

		{#if canAddPhoto}
			<div class="flex flex-col gap-2">
				<label for="log-photo" class="text-sm font-medium">
					Photo <span class="font-normal text-muted-foreground">(optional)</span>
				</label>
				<Input
					id="log-photo"
					name="photo"
					type="file"
					accept={PHOTO_ACCEPT}
					class="h-11 py-2"
					{...invalid('photo')}
				/>
				<FieldError id="log-photo-error" message={errors.photo} />
			</div>
		{/if}

		<Button type="submit" class="h-11 w-full" disabled={stage !== 'idle'}>
			{stage === 'preparing' ? 'Getting the photo ready…' : 'Log care'}
		</Button>
	</form>
</details>
