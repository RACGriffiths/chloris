<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import FieldError from '#lib/components/field-error.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import type { PlantValues } from '#lib/plants.js';

	/**
	 * The form for adding or changing a plant. It posts to `action`, or the page's default action
	 * if that isn't given. The name,
	 * room and species are always shown; the rest sit under "More details", which opens by itself
	 * when any of them is filled in or has a problem.
	 */
	let {
		action,
		rooms,
		values,
		errors = {},
		submitLabel,
		cancel
	}: {
		action?: string;
		rooms: { id: string; name: string }[];
		values: PlantValues;
		errors?: Partial<Record<string, string>>;
		submitLabel: string;
		/** A link or button shown beside the submit button. */
		cancel?: Snippet;
	} = $props();

	const DETAILS = ['acquiredOn', 'source', 'pot', 'soil', 'tags', 'notes'] as const;

	let saving = $state(false);
	let detailsOpen = $derived(DETAILS.some((field) => values[field] || errors[field]));

	/** The attributes that tie a field to its error message, when it has one. */
	function invalid(field: keyof PlantValues, hint?: string) {
		const error = errors[field] ? `${field}-error` : undefined;
		return {
			'aria-invalid': error ? true : undefined,
			'aria-describedby': [error, hint].filter(Boolean).join(' ') || undefined
		};
	}
</script>

<form
	method="POST"
	{action}
	class="flex flex-col gap-6"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			// Keeps what was typed if the server sends the form back with a problem.
			await update({ reset: false });
			saving = false;
		};
	}}
>
	<div class="flex flex-col gap-2">
		<label for="nickname" class="text-sm font-medium">Name</label>
		<Input
			id="nickname"
			name="nickname"
			required
			maxlength={60}
			autocomplete="off"
			placeholder="Big fern"
			class="h-11"
			value={values.nickname}
			{...invalid('nickname')}
		/>
		<FieldError id="nickname-error" message={errors.nickname} />
	</div>

	<div class="flex flex-col gap-2">
		<label for="roomId" class="text-sm font-medium">Room</label>
		<NativeSelect.Root
			id="roomId"
			name="roomId"
			required
			size="lg"
			class="w-full"
			value={values.roomId}
			{...invalid('roomId')}
		>
			<NativeSelect.Option value="" disabled>Choose a room</NativeSelect.Option>
			{#each rooms as room (room.id)}
				<NativeSelect.Option value={room.id}>{room.name}</NativeSelect.Option>
			{/each}
		</NativeSelect.Root>
		<FieldError id="roomId-error" message={errors.roomId} />
	</div>

	<div class="flex flex-col gap-2">
		<label for="species" class="text-sm font-medium">Species</label>
		<Input
			id="species"
			name="species"
			maxlength={100}
			autocomplete="off"
			placeholder="Boston fern"
			class="h-11"
			value={values.species}
			{...invalid('species', 'species-hint')}
		/>
		<p id="species-hint" class="text-sm text-muted-foreground">
			Optional. Its common or Latin name, whichever you know.
		</p>
		<FieldError id="species-error" message={errors.species} />
	</div>

	<details class="group rounded-lg border" open={detailsOpen}>
		<summary
			class="flex cursor-pointer list-none flex-col gap-0.5 p-3 [&::-webkit-details-marker]:hidden"
		>
			<span class="flex items-center gap-1 font-medium">
				<ChevronRightIcon
					class="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
					aria-hidden="true"
				/>
				More details
			</span>
			<span class="pl-5 text-sm text-muted-foreground">
				When you got it, its pot and soil, tags and notes
			</span>
		</summary>

		<div class="flex flex-col gap-6 border-t p-3 pt-5">
			<div class="flex flex-col gap-2">
				<label for="acquiredOn" class="text-sm font-medium">Date you got it</label>
				<Input
					id="acquiredOn"
					name="acquiredOn"
					type="date"
					class="h-11"
					value={values.acquiredOn}
					{...invalid('acquiredOn')}
				/>
				<FieldError id="acquiredOn-error" message={errors.acquiredOn} />
			</div>

			<div class="flex flex-col gap-2">
				<label for="source" class="text-sm font-medium">Where it came from</label>
				<Input
					id="source"
					name="source"
					maxlength={100}
					placeholder="A garden centre"
					class="h-11"
					value={values.source}
					{...invalid('source')}
				/>
				<FieldError id="source-error" message={errors.source} />
			</div>

			<div class="grid gap-6 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<label for="pot" class="text-sm font-medium">Pot</label>
					<Input
						id="pot"
						name="pot"
						maxlength={100}
						placeholder="15 cm terracotta"
						class="h-11"
						value={values.pot}
						{...invalid('pot')}
					/>
					<FieldError id="pot-error" message={errors.pot} />
				</div>

				<div class="flex flex-col gap-2">
					<label for="soil" class="text-sm font-medium">Soil</label>
					<Input
						id="soil"
						name="soil"
						maxlength={100}
						placeholder="Peat-free compost"
						class="h-11"
						value={values.soil}
						{...invalid('soil')}
					/>
					<FieldError id="soil-error" message={errors.soil} />
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<label for="tags" class="text-sm font-medium">Tags</label>
				<Input
					id="tags"
					name="tags"
					autocomplete="off"
					placeholder="pet safe, trailing"
					class="h-11"
					value={values.tags}
					{...invalid('tags', 'tags-hint')}
				/>
				<p id="tags-hint" class="text-sm text-muted-foreground">
					Separate tags with commas. Use them to find plants on the Plants page.
				</p>
				<FieldError id="tags-error" message={errors.tags} />
			</div>

			<div class="flex flex-col gap-2">
				<label for="notes" class="text-sm font-medium">Notes</label>
				<Textarea
					id="notes"
					name="notes"
					maxlength={2000}
					rows={4}
					value={values.notes}
					{...invalid('notes')}
				/>
				<FieldError id="notes-error" message={errors.notes} />
			</div>
		</div>
	</details>

	<div class="flex flex-col gap-2">
		<Button type="submit" class="h-11 w-full" disabled={saving}>{submitLabel}</Button>
		{@render cancel?.()}
	</div>
</form>
