<script lang="ts">
	import Flower2Icon from '@lucide/svelte/icons/flower-2';
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

<!-- The way to the Memorial, at the foot of the page as deleting a room is (D43). -->
{#if !data.plant.inMemorial}
	<section class="mt-12 border-t pt-6" aria-labelledby="memorialise">
		<h2 id="memorialise" class="text-lg font-semibold">Died, given away or sold?</h2>
		<p class="mt-2 text-sm text-muted-foreground">
			Move {data.plant.nickname} to the Memorial. It leaves Today and the Plants list, keeping its care
			history and photos, and it can be restored.
		</p>
		<Button
			href={resolve(`plants/${data.plant.id}/memorialise`)}
			variant="outline"
			class="mt-4 h-11 w-full"
		>
			<Flower2Icon />
			Move to the Memorial
		</Button>
	</section>
{/if}
