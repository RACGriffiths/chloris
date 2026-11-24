<script lang="ts">
	import LeafIcon from '@lucide/svelte/icons/leaf';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SproutIcon from '@lucide/svelte/icons/sprout';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<svelte:head>
	<title>{data.home ? `${data.home.name} · Chloris` : 'Chloris'}</title>
</svelte:head>

{#if data.home}
	<p class="text-sm text-muted-foreground">Your home</p>
	<h1 class="text-2xl font-semibold tracking-tight">{data.home.name}</h1>
	{#if data.canManageMembers}
		<Button href={resolve('members')} variant="outline" class="mt-4 h-11">
			<UserPlusIcon />
			Invite someone
		</Button>
	{/if}

	<Card.Root class="mt-6">
		{#if data.home.plantCount === 0}
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
		{:else}
			<Card.Header>
				<LeafIcon class="mb-2 size-8 text-primary" aria-hidden="true" />
				<Card.Title>
					{count(data.home.plantCount, 'plant', 'plants')} in
					{count(data.home.roomCount, 'room', 'rooms')}
				</Card.Title>
				<Card.Description>
					Each plant's page shows when its care is due. Soon this page will gather what needs doing
					today.
				</Card.Description>
			</Card.Header>
			<Card.Footer>
				<Button href={resolve('plants')} variant="outline" class="h-11 w-full">
					See your plants
				</Button>
			</Card.Footer>
		{/if}
	</Card.Root>
{:else}
	<h1 class="text-2xl font-semibold tracking-tight">You don't have access to a home</h1>
	<p class="mt-2 text-muted-foreground">
		You're signed in as {data.name}, but you're not a member of any home. To join one, ask someone
		in that household for an invite link. If you were looking after someone's plants, your access
		ended when your stay did.
	</p>
{/if}
