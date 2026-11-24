<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import FieldError from '#lib/components/field-error.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { MEMORIAL_STATUSES, statusName } from '#lib/plants.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let plant = $derived(data.plant);
	let values = $derived(form?.values ?? data.values);
	let errors: Partial<Record<string, string>> = $derived(form?.errors ?? {});

	let saving = $state(false);

	function invalid(field: string, hint?: string) {
		const error = errors[field] ? `${field}-error` : undefined;
		return {
			'aria-invalid': error ? true : undefined,
			'aria-describedby': [error, hint].filter(Boolean).join(' ') || undefined
		};
	}
</script>

<svelte:head>
	<title
		>{plant.inMemorial ? 'Memorial entry' : 'Move to the Memorial'} · {plant.nickname} · Chloris</title
	>
</svelte:head>

<p class="truncate text-sm text-muted-foreground">{plant.nickname}</p>
<h1 class="text-2xl font-semibold tracking-tight">
	{plant.inMemorial ? 'Memorial entry' : 'Move to the Memorial'}
</h1>
{#if !plant.inMemorial}
	<p class="mt-2 text-muted-foreground">
		{plant.nickname} will leave Today and the Plants list, and nothing will fall due. Its care history
		and photos are kept, and it can be restored from its page.
	</p>
{/if}

<form
	method="POST"
	class="mt-6 flex flex-col gap-6"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			// Keeps the choices if the server sends the form back with a problem.
			await update({ reset: false });
			saving = false;
		};
	}}
>
	<!-- `has-checked:` styles a tile while the radio button inside it is chosen. -->
	<fieldset class="flex flex-col gap-2">
		<legend class="mb-2 text-sm font-medium">What happened</legend>
		<div class="flex flex-col gap-2">
			{#each MEMORIAL_STATUSES as status (status)}
				<label
					class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
				>
					<input
						type="radio"
						name="status"
						value={status}
						defaultChecked={values.status === status}
						class="size-4 shrink-0 accent-primary"
					/>
					<span class="font-medium">{statusName(status)}</span>
				</label>
			{/each}
		</div>
		<FieldError id="status-error" message={errors.status} />
	</fieldset>

	<div class="flex flex-col gap-2">
		<label for="statusOn" class="text-sm font-medium">When</label>
		<Input
			id="statusOn"
			name="statusOn"
			type="date"
			required
			min={data.earliest}
			max={data.today}
			class="h-11"
			value={values.statusOn}
			{...invalid('statusOn')}
		/>
		<FieldError id="statusOn-error" message={errors.statusOn} />
	</div>

	<div class="flex flex-col gap-2">
		<label for="statusNote" class="text-sm font-medium">
			Note <span class="font-normal text-muted-foreground">(optional)</span>
		</label>
		<Textarea
			id="statusNote"
			name="statusNote"
			maxlength={data.noteLimit}
			rows={3}
			value={values.statusNote}
			{...invalid('statusNote', 'statusNote-hint')}
		/>
		<p id="statusNote-hint" class="text-sm text-muted-foreground">
			What went wrong, who has it now, or anything worth remembering.
		</p>
		<FieldError id="statusNote-error" message={errors.statusNote} />
	</div>

	<div class="flex flex-col gap-2">
		<Button type="submit" class="h-11 w-full" disabled={saving}>
			{plant.inMemorial ? 'Save changes' : 'Move to the Memorial'}
		</Button>
		<Button href={resolve(`plants/${plant.id}`)} variant="ghost" class="h-11 w-full">Cancel</Button>
	</div>
</form>
