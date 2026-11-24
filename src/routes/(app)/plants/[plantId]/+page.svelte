<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import DropletsIcon from '@lucide/svelte/icons/droplets';
	import ImageIcon from '@lucide/svelte/icons/image';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import { resolve } from '$app/paths';
	import PlantTile from '#lib/components/plant-tile.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let plant = $derived(data.plant);

	/** The details that are filled in, in the order they're shown. */
	let details = $derived(
		[
			{ label: 'Date you got it', value: plant.acquired },
			{ label: 'Where it came from', value: plant.source },
			{ label: 'Pot', value: plant.pot },
			{ label: 'Soil', value: plant.soil }
		].filter((detail) => detail.value)
	);

	/** What later versions will add to this page. */
	const comingSoon = [
		{
			id: 'care',
			title: 'Care history',
			icon: DropletsIcon,
			text: 'Each watering, feed, repot and check will be listed here, newest first.'
		},
		{
			id: 'photos',
			title: 'Photos',
			icon: ImageIcon,
			text: 'Photos will line up here in the order they were taken, so you can see it grow.'
		},
		{
			id: 'measurements',
			title: 'Measurements',
			icon: RulerIcon,
			text: 'Height, leaf count and anything else you measure will be charted here.'
		}
	];

	const byRoom = (roomId: string) => resolve(`plants?room=${roomId}`);
	const byTag = (tag: string) => resolve(`plants?${new URLSearchParams({ tag }).toString()}`);
</script>

<svelte:head>
	<title>{plant.nickname} · Chloris</title>
</svelte:head>

<Button href={resolve('plants')} variant="ghost" size="sm" class="-ml-2.5">
	<ChevronLeftIcon />
	Plants
</Button>

<div class="mt-3 flex items-start gap-4">
	<PlantTile id={plant.id} name={plant.nickname} class="size-16 rounded-2xl text-2xl" />
	<div class="min-w-0 flex-1">
		<h1 class="text-2xl font-semibold tracking-tight break-words">{plant.nickname}</h1>
		{#if plant.species}
			<p class="mt-0.5 text-muted-foreground">{plant.species}</p>
		{/if}
	</div>
	{#if data.canEdit}
		<Button
			href={resolve(`plants/${plant.id}/edit`)}
			variant="outline"
			class="h-10 shrink-0"
			aria-label="Edit {plant.nickname}"
		>
			<PencilIcon />
			Edit
		</Button>
	{/if}
</div>

<dl class="mt-6 divide-y rounded-lg border text-sm">
	<div class="flex justify-between gap-4 p-3">
		<dt class="text-muted-foreground">Room</dt>
		<dd class="min-w-0 text-right">
			<a href={byRoom(plant.roomId)} class="font-medium underline underline-offset-4">
				{plant.roomName}
			</a>
		</dd>
	</div>
	{#each details as detail (detail.label)}
		<div class="flex justify-between gap-4 p-3">
			<dt class="shrink-0 text-muted-foreground">{detail.label}</dt>
			<dd class="min-w-0 text-right break-words">{detail.value}</dd>
		</div>
	{/each}
</dl>

{#if plant.tags.length > 0}
	<ul class="mt-4 flex flex-wrap gap-2" aria-label="Tags">
		{#each plant.tags as tag (tag)}
			<li>
				<a
					href={byTag(tag)}
					class="inline-flex h-8 items-center rounded-full bg-secondary px-3 text-sm hover:bg-muted"
				>
					{tag}
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if plant.notes}
	<section class="mt-8" aria-labelledby="notes">
		<h2 id="notes" class="text-lg font-semibold">Notes</h2>
		<!-- Keeps the line breaks typed into the notes. -->
		<p class="mt-2 whitespace-pre-line">{plant.notes}</p>
	</section>
{/if}

{#each comingSoon as section (section.id)}
	<section class="mt-8" aria-labelledby={section.id}>
		<h2 id={section.id} class="text-lg font-semibold">{section.title}</h2>
		<div
			class="mt-2 flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
		>
			<section.icon class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
			<p><span class="font-medium text-foreground">Coming soon.</span> {section.text}</p>
		</div>
	</section>
{/each}
