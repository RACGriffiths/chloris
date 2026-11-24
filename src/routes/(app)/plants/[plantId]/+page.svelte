<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ImageIcon from '@lucide/svelte/icons/image';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import CareIcon from '#lib/components/care-icon.svelte';
	import CareSchedule from '#lib/components/care-schedule.svelte';
	import LogCareForm from '#lib/components/log-care-form.svelte';
	import PlantTile from '#lib/components/plant-tile.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

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

	let undoing = $state(false);
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

<section class="mt-8" aria-labelledby="care">
	<h2 id="care" class="text-lg font-semibold">Care</h2>

	<!-- What the last button did, with a way to undo care just logged. -->
	{#if form?.logged}
		<div
			role="status"
			class="mt-3 flex items-center justify-between gap-3 rounded-lg bg-secondary py-2 pr-2 pl-3 text-sm"
		>
			<p>{form.logged.message}</p>
			<form
				method="POST"
				action="?/undo"
				use:enhance={() => {
					undoing = true;
					return async ({ update }) => {
						await update({ reset: false });
						undoing = false;
					};
				}}
			>
				<input type="hidden" name="eventId" value={form.logged.id} />
				<Button type="submit" variant="outline" size="sm" class="shrink-0" disabled={undoing}>
					<Undo2Icon />
					Undo
				</Button>
			</form>
		</div>
	{:else if form?.message}
		<p role="status" class="mt-3 rounded-lg bg-secondary px-3 py-2 text-sm">{form.message}</p>
	{:else if form?.error}
		<p role="alert" class="mt-3 text-sm text-destructive">{form.error}</p>
	{/if}

	{#if data.schedules.length > 0}
		<ul class="mt-3 divide-y rounded-lg border" aria-label="Schedules">
			{#each data.schedules as schedule (schedule.id)}
				<CareSchedule
					plantId={plant.id}
					{schedule}
					canLog={data.canLog}
					canConfigure={data.canConfigure}
					snoozeError={form?.snooze?.task === schedule.task ? form.snooze.error : null}
					snoozeFrom={data.snoozeFrom}
					snoozeTo={data.snoozeTo}
				/>
			{/each}
		</ul>
	{:else}
		<p class="mt-2 text-sm text-muted-foreground">
			{#if data.canConfigure}
				No regular care yet. Add a schedule, such as watering every week, and this page will say
				when it's due.
			{:else}
				No regular care has been set up for {plant.nickname} yet.
			{/if}
		</p>
	{/if}

	{#if data.canConfigure && data.unscheduled.length > 0}
		<Button
			href={resolve(`plants/${plant.id}/schedules/new`)}
			variant="outline"
			class="mt-3 h-11 w-full"
		>
			<PlusIcon />
			Add a schedule
		</Button>
	{/if}

	{#if data.canLog}
		<div class="mt-3">
			<LogCareForm
				values={form?.log?.values}
				errors={form?.log?.errors}
				latest={data.latest}
				noteLimit={data.noteLimit}
			/>
		</div>
	{/if}
</section>

{#if plant.notes}
	<section class="mt-8" aria-labelledby="notes">
		<h2 id="notes" class="text-lg font-semibold">Notes</h2>
		<!-- Keeps the line breaks typed into the notes. -->
		<p class="mt-2 whitespace-pre-line">{plant.notes}</p>
	</section>
{/if}

<section class="mt-8" aria-labelledby="history">
	<h2 id="history" class="text-lg font-semibold">Care history</h2>
	{#if data.history.length > 0}
		<ul class="mt-3 divide-y rounded-lg border">
			{#each data.history as item (item.id)}
				<!-- `relative` places the confirmation, which opens under the entry. -->
				<li class="relative flex items-start gap-3 p-3">
					<CareIcon type={item.type} checkedTask={item.checkedTask} />
					<div class="min-w-0 flex-1">
						<p class="font-medium">{item.name}</p>
						<p class="text-sm text-muted-foreground">{item.when}, by {item.by}</p>
						{#if item.note}
							<p class="mt-1 text-sm break-words whitespace-pre-line">{item.note}</p>
						{/if}
					</div>
					{#if item.yours && data.canLog}
						<!-- Two taps to remove, so a stray one can't. -->
						<details class="shrink-0">
							<!-- Styled like a small ghost button. -->
							<summary
								class="inline-flex h-8 cursor-pointer list-none items-center rounded-md px-2.5 text-sm font-medium text-muted-foreground outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
								aria-label="Remove {item.name.toLowerCase()}, {item.when}"
							>
								Remove
							</summary>
							<form
								method="POST"
								action="?/undo"
								class="absolute top-full right-3 z-10 -mt-2 rounded-lg border bg-popover p-2 shadow-md"
								use:enhance={() => {
									undoing = true;
									return async ({ update }) => {
										await update({ reset: false });
										undoing = false;
									};
								}}
							>
								<input type="hidden" name="eventId" value={item.id} />
								<Button type="submit" variant="destructive" class="h-10" disabled={undoing}>
									Remove from history
								</Button>
							</form>
						</details>
					{/if}
				</li>
			{/each}
		</ul>
		{#if data.moreHistory}
			<Button
				href={resolve(`plants/${plant.id}?history=all#history`)}
				variant="ghost"
				class="mt-2 h-11 w-full"
			>
				Show all care history
			</Button>
		{/if}
	{:else}
		<p class="mt-2 text-sm text-muted-foreground">
			Nothing logged yet. Each watering, feed, repot and check will be listed here, latest first.
		</p>
	{/if}
</section>

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
