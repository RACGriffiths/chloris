<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Audit log · Chloris</title>
</svelte:head>

<Button href={resolve('members')} variant="ghost" size="sm" class="-ml-2.5">
	<ChevronLeftIcon />
	Members
</Button>

<div class="mt-3 min-w-0">
	<p class="truncate text-sm text-muted-foreground">{data.home.name}</p>
	<h1 class="text-2xl font-semibold tracking-tight">Audit log</h1>
</div>

<p class="mt-2 text-muted-foreground">
	Sign-ins, passkeys, invites and deletions in this home, the latest first. Changes made to the home
	show the device and internet address they came from.
</p>

{#if data.events.length > 0}
	<ol class="mt-6 divide-y rounded-lg border" aria-label="Audit log">
		{#each data.events as event (event.id)}
			<li class="p-3">
				<p><span class="font-medium">{event.who}</span> {event.what}</p>
				<p class="mt-0.5 text-sm text-muted-foreground">
					<time datetime={event.at}>{event.when}</time><span class="break-words">
						{event.from ? ` · ${event.from}` : ''}
					</span>
				</p>
			</li>
		{/each}
	</ol>
	{#if data.events.length === data.pageSize}
		<p class="mt-4 text-sm text-muted-foreground">Showing the latest {data.pageSize}.</p>
	{/if}
{:else}
	<p class="mt-6 rounded-lg border p-4 text-muted-foreground">Nothing has been recorded yet.</p>
{/if}
