<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import Flower2Icon from '@lucide/svelte/icons/flower-2';
	import { resolve } from '$app/paths';
	import PlantTile from '#lib/components/plant-tile.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Memorial · Chloris</title>
</svelte:head>

<Button href={resolve('plants')} variant="ghost" size="sm" class="-ml-2.5">
	<ChevronLeftIcon />
	Plants
</Button>

<div class="mt-3 min-w-0">
	<p class="truncate text-sm text-muted-foreground">{data.home.name}</p>
	<h1 class="text-2xl font-semibold tracking-tight">Memorial</h1>
</div>

{#if data.plants.length > 0}
	<p class="mt-2 text-muted-foreground">
		Plants that died, were given away or were sold, the most recent first. Each keeps its care
		history and photos.
	</p>

	<ul class="mt-6 divide-y rounded-lg border" aria-label="Plants in the Memorial">
		{#each data.plants as plant (plant.id)}
			<li>
				<a
					href={resolve(`plants/${plant.id}`)}
					class="flex items-start gap-4 p-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					<PlantTile
						id={plant.id}
						name={plant.nickname}
						photoId={plant.coverPhotoId}
						class="size-16 rounded-2xl text-2xl"
					/>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{plant.nickname}</span>
						{#if plant.species}
							<span class="block truncate text-sm text-muted-foreground">{plant.species}</span>
						{/if}
						<span class="mt-1 block text-sm">{plant.ended}</span>
						{#if plant.got}
							<span class="block text-sm text-muted-foreground">Had from {plant.got}</span>
						{/if}
						{#if plant.note}
							<!-- `line-clamp-3` cuts a long note off after three lines; the plant's page has it all. -->
							<span class="mt-1 line-clamp-3 text-sm break-words whitespace-pre-line">
								{plant.note}
							</span>
						{/if}
					</span>
				</a>
			</li>
		{/each}
	</ul>
{:else}
	<Card.Root class="mt-6">
		<Card.Header>
			<Flower2Icon class="mb-2 size-8 text-primary" aria-hidden="true" />
			<Card.Title>No plants here</Card.Title>
			<Card.Description>
				A plant that dies, is given away or is sold comes here from its Edit page, keeping its care
				history and photos.
			</Card.Description>
		</Card.Header>
	</Card.Root>
{/if}
