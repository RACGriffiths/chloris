<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ScheduleFields from '#lib/components/schedule-fields.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let saving = $state(false);
</script>

<svelte:head>
	<title>Add a schedule · {data.plant.nickname} · Chloris</title>
</svelte:head>

<p class="truncate text-sm text-muted-foreground">{data.plant.nickname}</p>
<h1 class="text-2xl font-semibold tracking-tight">Add a schedule</h1>

{#if data.tasks.length > 0}
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
		<ScheduleFields
			tasks={data.tasks}
			values={form?.values ?? data.values}
			errors={form?.errors}
			maxInterval={data.maxInterval}
			maxRecheck={data.maxRecheck}
		/>
		<div class="flex flex-col gap-2">
			<Button type="submit" class="h-11 w-full" disabled={saving}>
				<PlusIcon />
				Add schedule
			</Button>
			<Button href={resolve(`plants/${data.plant.id}`)} variant="ghost" class="h-11 w-full">
				Cancel
			</Button>
		</div>
	</form>
{:else}
	<p class="mt-2 text-muted-foreground">
		{data.plant.nickname} already has a schedule for every task. Change one from the plant's page.
	</p>
	<Button href={resolve(`plants/${data.plant.id}`)} variant="outline" class="mt-6 h-11 w-full">
		Back to {data.plant.nickname}
	</Button>
{/if}
