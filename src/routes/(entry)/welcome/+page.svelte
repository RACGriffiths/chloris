<script lang="ts">
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Passkeys need JavaScript, so the button stays disabled until the page is interactive.
	let interactive = $state(false);
	let adding = $state(false);
	let error = $state<string | null>(null);

	onMount(() => {
		interactive = true;
	});

	async function add() {
		error = null;
		adding = true;
		try {
			const passkeys = await import('#lib/passkeys.js');
			if (!passkeys.passkeysSupported()) {
				error = "This browser can't create passkeys. You can still sign in with a link.";
				return;
			}
			const outcome = await passkeys.addPasskey();
			if (outcome.ok) await goto(resolve(''), { refreshAll: true });
			else if (!outcome.cancelled) error = outcome.message;
		} finally {
			adding = false;
		}
	}
</script>

<svelte:head>
	<title>Add a passkey · Chloris</title>
</svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Welcome, {data.name}</h1>
<p class="mt-2 text-muted-foreground">
	Add a passkey to sign in next time with this device's fingerprint, face or screen lock, without
	waiting for a link.
</p>

<Button class="mt-8 h-11 w-full" onclick={add} disabled={!interactive || adding}>
	<KeyRoundIcon />
	Add a passkey
</Button>
{#if error}
	<p role="alert" class="mt-3 text-sm text-destructive">{error}</p>
{/if}
<Button href={resolve('')} variant="ghost" class="mt-3 h-11 w-full">Not now</Button>
