<script lang="ts">
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LeafIcon from '@lucide/svelte/icons/leaf';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SproutIcon from '@lucide/svelte/icons/sprout';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import CareIcon from '#lib/components/care-icon.svelte';
	import DueTask from '#lib/components/due-task.svelte';
	import PlantTile from '#lib/components/plant-tile.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { allText } from '#lib/care.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let busy = $state(false);

	/** Disables every button while a form is being sent, so a second tap doesn't log twice. */
	const submit: SubmitFunction = () => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	};

	const plantLink = (id: string) => resolve(`plants/${id}`);
</script>

<svelte:head>
	<title>{data.home ? `Today · ${data.home.name} · Chloris` : 'Chloris'}</title>
</svelte:head>

{#if data.home}
	<p class="truncate text-sm text-muted-foreground">{data.home.name}</p>
	<div class="flex flex-wrap items-baseline justify-between gap-x-3">
		<h1 class="text-2xl font-semibold tracking-tight">Today</h1>
		<p class="text-sm text-muted-foreground">{data.date}</p>
	</div>

	{#if data.plantCount === 0}
		<Card.Root class="mt-6">
			<Card.Header>
				<SproutIcon class="mb-2 size-8 text-primary" aria-hidden="true" />
				<Card.Title>Nothing to look after yet</Card.Title>
				<Card.Description>
					{#if data.canEditPlants}
						Add your plants, room by room, then give each a schedule, such as watering every week.
					{:else}
						Nobody has added any plants yet.
					{/if}
				</Card.Description>
			</Card.Header>
			{#if data.canEditPlants}
				<Card.Footer>
					<Button href={resolve('plants/new')} class="h-11 w-full">
						<PlusIcon />
						Add a plant
					</Button>
				</Card.Footer>
			{/if}
		</Card.Root>
	{:else if data.taskCount === 0}
		<Card.Root class="mt-6">
			<Card.Header>
				<LeafIcon class="mb-2 size-8 text-primary" aria-hidden="true" />
				<Card.Title>No regular care yet</Card.Title>
				<Card.Description>
					Give a plant a schedule on its page, such as watering every week, and what needs doing
					each day will gather here.
				</Card.Description>
			</Card.Header>
			<Card.Footer>
				<Button href={resolve('plants')} variant="outline" class="h-11 w-full">
					See your plants
				</Button>
			</Card.Footer>
		</Card.Root>
	{:else if data.rooms.length === 0}
		<Card.Root class="mt-6">
			<Card.Header>
				<CheckCheckIcon class="mb-2 size-8 text-primary" aria-hidden="true" />
				<Card.Title>Nothing needs doing today</Card.Title>
				{#if data.next}
					<Card.Description>
						Next up is {data.next.noun} for
						<a
							href={plantLink(data.next.plantId)}
							class="font-medium text-foreground underline underline-offset-4"
						>
							{data.next.plantName}
						</a>, {data.next.when}.
					</Card.Description>
				{/if}
			</Card.Header>
		</Card.Root>
	{/if}

	{#each data.rooms as room (room.id)}
		<section class="mt-8" aria-labelledby="room-{room.id}">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 id="room-{room.id}" class="text-lg font-semibold">{room.name}</h2>
				{#if data.canLog}
					{#each room.together as group (group.task)}
						<!-- Logs the task on every plant listed for it here, and only those. -->
						<form method="POST" action="?/log" use:enhance={submit}>
							<input type="hidden" name="task" value={group.task} />
							{#each group.plantIds as plantId (plantId)}
								<input type="hidden" name="plantId" value={plantId} />
							{/each}
							<Button
								type="submit"
								name="outcome"
								value="done"
								variant="outline"
								class="h-9"
								disabled={busy}
							>
								<CareIcon type={group.task} class="-ml-1 size-6" />
								{allText(group.task, group.plantIds.length)}<span class="sr-only">
									&nbsp;in {room.name}
								</span>
							</Button>
						</form>
					{/each}
				{/if}
			</div>

			<ul class="mt-3 divide-y rounded-lg border">
				{#each room.plants as plant (plant.id)}
					<li class="flex flex-col gap-3 p-3" aria-label={plant.name}>
						<a
							href={plantLink(plant.id)}
							class="-m-1 flex items-center gap-3 rounded-lg p-1 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							<PlantTile id={plant.id} name={plant.name} />
							<span class="min-w-0 flex-1 truncate font-medium">{plant.name}</span>
							<ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						</a>
						<!-- Lined up under the plant's name, past its tile. -->
						<ul class="flex flex-col gap-4 pl-14" aria-label="Due for {plant.name}">
							{#each plant.tasks as task (task.task)}
								<DueTask
									plantId={plant.id}
									plantName={plant.name}
									{task}
									canLog={data.canLog}
									{busy}
									{submit}
								/>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	{#if data.done.length > 0}
		<section class="mt-8" aria-labelledby="done-today">
			<h2 id="done-today" class="text-lg font-semibold">Done today</h2>
			<ul class="mt-3 divide-y rounded-lg border">
				{#each data.done as item (item.id)}
					<!-- `relative` places the confirmation, which opens under the entry. -->
					<li class="relative flex items-start gap-3 p-3">
						<CareIcon type={item.type} checkedTask={item.checkedTask} />
						<div class="min-w-0 flex-1">
							<a
								href={plantLink(item.plantId)}
								class="block truncate font-medium underline-offset-4 hover:underline"
							>
								{item.plantName}
							</a>
							<p class="text-sm text-muted-foreground">{item.name}, {item.time}, by {item.by}</p>
						</div>
						{#if item.yours && data.canLog}
							<!-- Two taps to remove, so a stray one can't. -->
							<details class="shrink-0">
								<!-- Styled like a small ghost button. -->
								<summary
									class="inline-flex h-8 cursor-pointer list-none items-center rounded-md px-2.5 text-sm font-medium text-muted-foreground outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
									aria-label="Remove {item.name.toLowerCase()} for {item.plantName}, {item.time}"
								>
									Remove
								</summary>
								<form
									method="POST"
									action="?/undo"
									class="absolute top-full right-3 z-10 -mt-2 rounded-lg border bg-popover p-2 shadow-md"
									use:enhance={submit}
								>
									<input type="hidden" name="eventId" value={item.id} />
									<Button type="submit" variant="destructive" class="h-10" disabled={busy}>
										Remove from today
									</Button>
								</form>
							</details>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.canManageMembers}
		<p class="mt-10 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
			Sharing the plants with someone?
			<Button href={resolve('members')} variant="link" class="h-auto p-0">
				<UserPlusIcon />
				Invite someone
			</Button>
		</p>
	{/if}

	<!--
		What the last button did, with a way to undo care just logged. `sticky` with `bottom-4`
		keeps it in view at the bottom of the screen while the list scrolls under it; at the end of
		the page it settles into its own place, so it never hides the last entry.
	-->
	{#if form?.logged || form?.message || form?.error}
		<div class="sticky bottom-4 mt-6 rounded-lg border bg-popover p-2 pl-3 text-sm shadow-lg">
			{#if form.logged}
				<div role="status" class="flex items-center justify-between gap-3">
					<div>
						<p>{form.logged.message}</p>
						{#if form.logged.notDue}
							<p class="text-muted-foreground">{form.logged.notDue}</p>
						{/if}
					</div>
					<form method="POST" action="?/undo" use:enhance={submit}>
						{#each form.logged.ids as id (id)}
							<input type="hidden" name="eventId" value={id} />
						{/each}
						<Button type="submit" variant="outline" size="sm" class="shrink-0" disabled={busy}>
							<Undo2Icon />
							Undo
						</Button>
					</form>
				</div>
			{:else if form.message}
				<p role="status" class="py-1">{form.message}</p>
			{:else}
				<p role="alert" class="py-1 text-destructive">{form.error}</p>
			{/if}
		</div>
	{/if}
{:else}
	<h1 class="text-2xl font-semibold tracking-tight">You don't have access to a home</h1>
	<p class="mt-2 text-muted-foreground">
		You're signed in as {data.name}, but you're not a member of any home. To join one, ask someone
		in that household for an invite link. If you were looking after someone's plants, your access
		ended when your stay did.
	</p>
{/if}
