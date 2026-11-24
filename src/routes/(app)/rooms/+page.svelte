<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import RoomDetails from '#lib/components/room-details.svelte';
	import RoomFields from '#lib/components/room-fields.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let adding = $state(false);

	const plantCount = (count: number) =>
		count === 0 ? 'No plants' : count === 1 ? '1 plant' : `${count} plants`;
	const byRoom = (roomId: string) => resolve(`plants?room=${roomId}`);
</script>

<svelte:head>
	<title>Rooms · Chloris</title>
</svelte:head>

<p class="truncate text-sm text-muted-foreground">{data.home.name}</p>
<h1 class="text-2xl font-semibold tracking-tight">Rooms</h1>

{#if data.rooms.length > 0}
	<ul class="mt-6 divide-y rounded-lg border">
		{#each data.rooms as room (room.id)}
			<li class="flex items-center gap-3 p-3">
				<div class="min-w-0 flex-1">
					<a href={byRoom(room.id)} class="block truncate font-medium hover:underline">
						{room.name}
					</a>
					<div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
						<span class="text-sm text-muted-foreground">{plantCount(room.plantCount)}</span>
						<RoomDetails setting={room.setting} light={room.light} />
					</div>
				</div>
				{#if data.canConfigure}
					<Button
						href={resolve(`rooms/${room.id}/edit`)}
						variant="ghost"
						size="sm"
						class="shrink-0"
						aria-label="Edit {room.name}"
					>
						Edit
					</Button>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p class="mt-2 text-muted-foreground">
		No rooms yet. Each plant lives in a room, so start with the one your plants are in.
	</p>
{/if}

{#if data.canConfigure}
	<section class="mt-10" aria-labelledby="add-room">
		<h2 id="add-room" class="text-lg font-semibold">Add a room</h2>
		{#if form?.added}
			<p role="status" class="mt-2 text-sm text-muted-foreground">Added {form.added}.</p>
		{/if}
		<form
			method="POST"
			action="?/create"
			class="mt-4 flex flex-col gap-6"
			use:enhance={() => {
				adding = true;
				return async ({ result, update }) => {
					// Empties the form after a room is added, ready for the next one.
					await update({ reset: result.type === 'success' });
					adding = false;
				};
			}}
		>
			<RoomFields values={form?.values} errors={form?.errors} />
			<Button type="submit" class="h-11 w-full" disabled={adding}>
				<PlusIcon />
				Add room
			</Button>
		</form>
	</section>
{/if}
