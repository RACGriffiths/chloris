<script lang="ts">
	import SproutIcon from '@lucide/svelte/icons/sprout';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
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
		<Card.Header>
			<SproutIcon class="mb-2 size-8 text-primary" aria-hidden="true" />
			<Card.Title>Nothing to look after yet</Card.Title>
			<Card.Description>
				Rooms and plants are coming next. Then this page will show what needs watering today.
			</Card.Description>
		</Card.Header>
	</Card.Root>
{:else}
	<h1 class="text-2xl font-semibold tracking-tight">You don't have access to a home</h1>
	<p class="mt-2 text-muted-foreground">
		You're signed in as {data.name}, but you're not a member of any home. To join one, ask someone
		in that household for an invite link. If you were looking after someone's plants, your access
		ended when your stay did.
	</p>
{/if}
