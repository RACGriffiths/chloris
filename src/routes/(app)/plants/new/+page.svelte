<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import PlantForm from '#lib/components/plant-form.svelte';
	import RoomFields from '#lib/components/room-fields.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PlantValues } from '#lib/plants.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let addingRoom = $state(false);

	let values = $derived<PlantValues>(
		form?.plant?.values ?? {
			nickname: '',
			roomId: data.roomId,
			species: '',
			acquiredOn: '',
			source: '',
			pot: '',
			soil: '',
			tags: '',
			notes: ''
		}
	);
</script>

<svelte:head>
	<title>Add a plant · Chloris</title>
</svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Add a plant</h1>

{#if data.rooms.length > 0}
	<div class="mt-6">
		<PlantForm
			action="?/create"
			rooms={data.rooms}
			{values}
			errors={form?.plant?.errors}
			submitLabel="Add plant"
		>
			{#snippet cancel()}
				<Button href={resolve('plants')} variant="ghost" class="h-11 w-full">Cancel</Button>
			{/snippet}
		</PlantForm>
	</div>
{:else if data.canAddRoom}
	<p class="mt-2 text-muted-foreground">
		Plants are kept room by room. Start with the room this one lives in; you can add more rooms
		later.
	</p>
	<form
		method="POST"
		action="?/room"
		class="mt-8 flex flex-col gap-6"
		use:enhance={() => {
			addingRoom = true;
			return async ({ update }) => {
				await update({ reset: false });
				addingRoom = false;
			};
		}}
	>
		<RoomFields values={form?.room?.values} errors={form?.room?.errors} />
		<Button type="submit" class="h-11 w-full" disabled={addingRoom}>Add room</Button>
	</form>
{:else}
	<p class="mt-2 text-muted-foreground">
		Plants are kept room by room, and this home has no rooms yet. Ask whoever set up the home to add
		one.
	</p>
{/if}
