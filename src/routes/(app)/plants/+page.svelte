<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import DoorOpenIcon from '@lucide/svelte/icons/door-open';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SproutIcon from '@lucide/svelte/icons/sprout';
	import XIcon from '@lucide/svelte/icons/x';
	import { resolve } from '$app/paths';
	import PlantTile from '#lib/components/plant-tile.svelte';
	import RoomDetails from '#lib/components/room-details.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** The rooms to show, each with its plants. Filtering by tag hides rooms with no matches. */
	let groups = $derived(
		data.rooms
			.filter((room) => !data.filter.roomId || room.id === data.filter.roomId)
			.map((room) => ({ room, plants: data.plants.filter((plant) => plant.roomId === room.id) }))
			.filter((group) => !data.filter.tag || group.plants.length > 0)
	);

	/** A link to this page with other filters. */
	function filtered(roomId: string | null, tag: string | null) {
		const filters = { room: roomId, tag };
		const search = new URLSearchParams(
			Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))
		).toString();
		return resolve(search ? `plants?${search}` : 'plants');
	}

	const addPlant = (roomId?: string) =>
		resolve(roomId ? `plants/new?room=${roomId}` : 'plants/new');

	const chip =
		'inline-flex h-9 items-center rounded-full border px-3.5 text-sm whitespace-nowrap hover:bg-muted aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground';
</script>

<svelte:head>
	<title>Plants · Chloris</title>
</svelte:head>

<div class="flex items-end justify-between gap-3">
	<div class="min-w-0">
		<p class="truncate text-sm text-muted-foreground">{data.home.name}</p>
		<h1 class="text-2xl font-semibold tracking-tight">Plants</h1>
	</div>
	<div class="flex shrink-0 gap-1">
		{#if data.rooms.length > 0}
			<Button href={resolve('rooms')} variant="ghost" class="h-10">
				<DoorOpenIcon />
				Rooms
			</Button>
		{/if}
		{#if data.canEditPlants}
			<Button href={addPlant(data.filter.roomId ?? undefined)} class="h-10">
				<PlusIcon />
				Add plant
			</Button>
		{/if}
	</div>
</div>

{#if data.rooms.length === 0}
	<Card.Root class="mt-6">
		<Card.Header>
			<SproutIcon class="mb-2 size-8 text-primary" aria-hidden="true" />
			<Card.Title>No plants yet</Card.Title>
			<Card.Description>
				{#if data.canEditPlants}
					Plants are kept room by room. Add your first plant, and you'll name its room on the way.
				{:else}
					Nobody has added any plants to {data.home.name} yet.
				{/if}
			</Card.Description>
		</Card.Header>
	</Card.Root>
{:else}
	{#if data.rooms.length > 1}
		<!-- Scrolls sideways on a narrow screen rather than wrapping onto several lines. -->
		<nav aria-label="Show one room" class="-mx-4 mt-5 overflow-x-auto px-4 pb-1">
			<ul class="flex w-max gap-2">
				<li>
					<a
						href={filtered(null, data.filter.tag)}
						class={chip}
						aria-current={data.filter.roomId ? undefined : 'page'}
					>
						All rooms
					</a>
				</li>
				{#each data.rooms as room (room.id)}
					<li>
						<a
							href={filtered(room.id, data.filter.tag)}
							class={chip}
							aria-current={data.filter.roomId === room.id ? 'page' : undefined}
						>
							{room.name}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	{#if data.filter.tag}
		<div class="mt-4 flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
			<p class="min-w-0">
				Plants tagged <strong class="font-semibold">{data.filter.tag}</strong>
			</p>
			<Button
				href={filtered(data.filter.roomId, null)}
				variant="ghost"
				size="sm"
				class="shrink-0"
				aria-label="Show plants with any tag"
			>
				<XIcon />
				Clear
			</Button>
		</div>
	{/if}

	{#each groups as { room, plants } (room.id)}
		<section class="mt-8" aria-labelledby="room-{room.id}">
			<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h2 id="room-{room.id}" class="text-lg font-semibold">{room.name}</h2>
				<RoomDetails setting={room.setting} light={room.light} />
			</div>
			{#if plants.length > 0}
				<ul class="mt-3 divide-y rounded-lg border">
					{#each plants as plant (plant.id)}
						<li>
							<a
								href={resolve(`plants/${plant.id}`)}
								class="flex items-center gap-3 p-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
							>
								<PlantTile id={plant.id} name={plant.nickname} photoId={plant.coverPhotoId} />
								<span class="min-w-0 flex-1">
									<span class="block truncate font-medium">{plant.nickname}</span>
									{#if plant.species}
										<span class="block truncate text-sm text-muted-foreground">
											{plant.species}
										</span>
									{/if}
								</span>
								<ChevronRightIcon
									class="size-4 shrink-0 text-muted-foreground"
									aria-hidden="true"
								/>
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
					No plants in {room.name} yet.
					{#if data.canEditPlants}
						<a
							href={addPlant(room.id)}
							class="font-medium text-foreground underline underline-offset-4"
						>
							Add one
						</a>
					{/if}
				</p>
			{/if}
		</section>
	{:else}
		<!-- Only a tag filter can leave nothing to show: every room is listed, even when empty. -->
		<p class="mt-8 text-muted-foreground">
			No plants {data.filter.roomId ? 'in this room ' : ''}are tagged
			<strong class="font-semibold text-foreground">{data.filter.tag}</strong>.
		</p>
	{/each}
{/if}
