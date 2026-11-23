<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import FieldError from '#lib/components/field-error.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let creating = $state(false);
	// The server's time zone is the first guess; the browser's own is a better one, once known.
	let browserTimeZone = $state<string | null>(null);
	let timeZone = $derived(form?.timeZone ?? browserTimeZone ?? data.timeZone);

	onMount(() => {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (data.timeZones.includes(zone)) browserTimeZone = zone;
	});

	const selectClasses =
		'h-11 w-full rounded-md border border-input bg-transparent px-2.5 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30';
</script>

<svelte:head>
	<title>Set up your home · Chloris</title>
</svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Set up your home</h1>
<p class="mt-2 text-muted-foreground">
	A home holds your rooms and plants. You can invite the rest of your household later.
</p>

<form
	method="POST"
	class="mt-8 flex flex-col gap-6"
	use:enhance={() => {
		creating = true;
		return async ({ update }) => {
			await update({ reset: false });
			creating = false;
		};
	}}
>
	<div class="flex flex-col gap-2">
		<label for="name" class="text-sm font-medium">Name</label>
		<Input
			id="name"
			name="name"
			required
			maxlength={60}
			autocomplete="off"
			placeholder="Our flat"
			class="h-11"
			value={form?.name ?? ''}
			aria-invalid={form?.errors?.name ? true : undefined}
			aria-describedby={form?.errors?.name ? 'name-error' : undefined}
		/>
		<FieldError id="name-error" message={form?.errors?.name} />
	</div>

	<div class="flex flex-col gap-2">
		<label for="timeZone" class="text-sm font-medium">Time zone</label>
		<select
			id="timeZone"
			name="timeZone"
			class={selectClasses}
			bind:value={timeZone}
			aria-invalid={form?.errors?.timeZone ? true : undefined}
			aria-describedby={form?.errors?.timeZone ? 'timeZone-error' : 'timeZone-hint'}
		>
			{#each data.timeZones as zone (zone)}
				<option value={zone}>{zone.replaceAll('_', ' ')}</option>
			{/each}
		</select>
		<p id="timeZone-hint" class="text-sm text-muted-foreground">
			Decides when each day starts, for what's due.
		</p>
		<FieldError id="timeZone-error" message={form?.errors?.timeZone} />
	</div>

	<Button type="submit" class="h-11 w-full" disabled={creating}>Create home</Button>
</form>
