<script lang="ts">
	import { resolve } from '$app/paths';
	import PlantForm from '#lib/components/plant-form.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Edit {data.plant.nickname} · Chloris</title>
</svelte:head>

<h1 class="text-2xl font-semibold tracking-tight break-words">Edit {data.plant.nickname}</h1>

<div class="mt-6">
	<PlantForm
		rooms={data.rooms}
		values={form?.values ?? data.plant.values}
		errors={form?.errors}
		submitLabel="Save changes"
	>
		{#snippet cancel()}
			<Button href={resolve(`plants/${data.plant.id}`)} variant="ghost" class="h-11 w-full">
				Cancel
			</Button>
		{/snippet}
	</PlantForm>
</div>
