<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import RoomFields from '#lib/components/room-fields.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let saving = $state(false);

	let values = $derived(
		form?.values ?? {
			name: data.room.name,
			setting: data.room.setting,
			light: data.room.light ?? ''
		}
	);
</script>

<svelte:head>
	<title>Edit {data.room.name} · Chloris</title>
</svelte:head>

<h1 class="text-2xl font-semibold tracking-tight break-words">Edit {data.room.name}</h1>

<form
	method="POST"
	action="?/save"
	class="mt-6 flex flex-col gap-6"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update({ reset: false });
			saving = false;
		};
	}}
>
	<RoomFields {values} errors={form?.errors} />
	<div class="flex flex-col gap-2">
		<Button type="submit" class="h-11 w-full" disabled={saving}>Save changes</Button>
		<Button href={resolve('rooms')} variant="ghost" class="h-11 w-full">Cancel</Button>
	</div>
</form>

<section class="mt-12 border-t pt-6" aria-labelledby="delete-room">
	<h2 id="delete-room" class="text-lg font-semibold">Delete this room</h2>
	{#if data.plants.length > 0}
		<p class="mt-2 text-sm text-muted-foreground">
			A room can be deleted only when it's empty. Move these plants to another room first, from each
			plant's Edit page:
		</p>
		<ul class="mt-3 flex flex-wrap gap-2">
			{#each data.plants as plant (plant.id)}
				<li>
					<a
						href={resolve(`plants/${plant.id}/edit`)}
						class="inline-flex h-8 items-center rounded-full border px-3 text-sm hover:bg-muted"
					>
						{plant.nickname}
						{#if plant.inMemorial}
							<span class="ml-1 text-muted-foreground">(in the Memorial)</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-2 text-sm text-muted-foreground">
			{data.room.name} has no plants, so it can be deleted.
		</p>
		{#if form?.deleteError}
			<p role="alert" class="mt-2 text-sm text-destructive">{form.deleteError}</p>
		{/if}
		<form method="POST" action="?/delete" class="mt-4" use:enhance>
			<Button type="submit" variant="destructive" class="h-11 w-full">
				Delete {data.room.name}
			</Button>
		</form>
	{/if}
</section>
