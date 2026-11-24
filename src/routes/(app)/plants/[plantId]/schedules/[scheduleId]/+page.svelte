<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ScheduleFields from '#lib/components/schedule-fields.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { taskNoun } from '#lib/care.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let noun = $derived(taskNoun(data.task));
	let saving = $state(false);
</script>

<svelte:head>
	<title>{data.plant.nickname}'s {noun} · Chloris</title>
</svelte:head>

<p class="truncate text-sm text-muted-foreground">{data.plant.nickname}</p>
<h1 class="text-2xl font-semibold tracking-tight">
	{noun.charAt(0).toUpperCase()}{noun.slice(1)} schedule
</h1>

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
	<ScheduleFields
		values={form?.values ? { ...form.values, task: data.task } : data.values}
		errors={form?.errors}
		maxInterval={data.maxInterval}
		maxRecheck={data.maxRecheck}
	/>
	<div class="flex flex-col gap-2">
		<Button type="submit" class="h-11 w-full" disabled={saving}>Save changes</Button>
		<Button href={resolve(`plants/${data.plant.id}`)} variant="ghost" class="h-11 w-full">
			Cancel
		</Button>
	</div>
</form>

<section class="mt-10" aria-labelledby="remove">
	<h2 id="remove" class="text-lg font-semibold">Remove this schedule</h2>
	<p class="mt-1 text-sm text-muted-foreground">
		{data.plant.nickname} will no longer show when {noun} is due. The care already logged stays in its
		history.
	</p>
	<form method="POST" action="?/delete" class="mt-4" use:enhance>
		<Button type="submit" variant="destructive" class="h-11 w-full">Remove {noun} schedule</Button>
	</form>
</section>
