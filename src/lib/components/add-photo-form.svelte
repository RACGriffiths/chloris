<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { enhance, type SubmitFunction } from '$app/forms';
	import FieldError from '#lib/components/field-error.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { chosenPhoto, preparePhotoField } from '#lib/photo-field.js';
	import { MAX_CAPTION_LENGTH, PHOTO_ACCEPT } from '#lib/photos.js';

	/**
	 * The form for adding a photo of a plant. It sits closed under the photos and opens by itself
	 * when the server sends it back with a problem. Before JavaScript loads, it sends the original
	 * photo; once it has, the browser resizes the photo first and leaves its metadata behind
	 * (`#lib/photo-field`), sending the date it was taken separately.
	 */
	let {
		values,
		errors = {}
	}: {
		/** What was sent, when the server sent the form back. A file can't be put back. */
		values?: { caption: string };
		errors?: Partial<Record<string, string>>;
	} = $props();

	let stage = $state<'idle' | 'preparing' | 'sending'>('idle');

	/**
	 * Runs when the form is submitted, before anything is sent. `use:enhance` waits for it, so it
	 * can swap the chosen file in `formData` for the resized copy.
	 */
	const prepare: SubmitFunction = async ({ formData }) => {
		if (chosenPhoto(formData)) {
			stage = 'preparing';
			await preparePhotoField(formData);
		}
		stage = 'sending';
		return async ({ update }) => {
			// Empties the form once the photo is added; keeps the caption if it was refused.
			await update();
			stage = 'idle';
		};
	};

	function invalid(field: string) {
		const error = errors[field] ? `photo-${field}-error` : undefined;
		return { 'aria-invalid': error ? true : undefined, 'aria-describedby': error };
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
			Add a photo
		</span>
		<span class="pl-5 text-sm text-muted-foreground">Take one, or choose one you have</span>
	</summary>

	<!-- A file can only be sent in a form encoded as multipart/form-data. -->
	<form
		method="POST"
		action="?/addPhoto"
		enctype="multipart/form-data"
		class="flex flex-col gap-6 border-t p-3 pt-5"
		use:enhance={prepare}
	>
		<div class="flex flex-col gap-2">
			<label for="photo-file" class="text-sm font-medium">Photo</label>
			<Input
				id="photo-file"
				name="photo"
				type="file"
				accept={PHOTO_ACCEPT}
				required
				class="h-11 py-2"
				{...invalid('photo')}
			/>
			<FieldError id="photo-photo-error" message={errors.photo} />
		</div>

		<div class="flex flex-col gap-2">
			<label for="photo-caption" class="text-sm font-medium">Caption</label>
			<Input
				id="photo-caption"
				name="caption"
				maxlength={MAX_CAPTION_LENGTH}
				placeholder="Optional"
				class="h-11"
				value={values?.caption}
				{...invalid('caption')}
			/>
			<FieldError id="photo-caption-error" message={errors.caption} />
		</div>

		<Button type="submit" class="h-11 w-full" disabled={stage !== 'idle'}>
			{#if stage === 'preparing'}
				Getting the photo ready…
			{:else if stage === 'sending'}
				Sending…
			{:else}
				Add photo
			{/if}
		</Button>
	</form>
</details>
