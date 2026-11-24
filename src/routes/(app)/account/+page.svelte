<script lang="ts">
	import BellIcon from '@lucide/svelte/icons/bell';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MonitorSmartphoneIcon from '@lucide/svelte/icons/monitor-smartphone';
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Adding a passkey needs JavaScript, so the button stays disabled until the page is interactive.
	let interactive = $state(false);
	let adding = $state(false);
	let passkeyError = $state<string | null>(null);

	onMount(() => {
		interactive = true;
	});

	async function addPasskey() {
		passkeyError = null;
		adding = true;
		try {
			const passkeys = await import('#lib/passkeys.js');
			if (!passkeys.passkeysSupported()) {
				passkeyError = "This browser can't create passkeys.";
				return;
			}
			const outcome = await passkeys.addPasskey();
			if (outcome.ok) await refreshAll();
			else if (!outcome.cancelled) passkeyError = outcome.message;
		} finally {
			adding = false;
		}
	}
</script>

<svelte:head>
	<title>Account · Chloris</title>
</svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Account</h1>
<p class="mt-1 text-muted-foreground">{data.name} · {data.email}</p>

{#if form?.error}
	<p role="alert" class="mt-4 text-sm text-destructive">{form.error}</p>
{/if}

{#if data.digest}
	<section class="mt-8" aria-labelledby="notifications">
		<h2 id="notifications" class="text-lg font-semibold">Notifications</h2>
		<a
			href={resolve('account/notifications')}
			class="mt-4 flex items-center gap-3 rounded-lg border p-3 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
		>
			<BellIcon class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
			<span class="min-w-0 flex-1">
				<span class="block font-medium">Daily digest</span>
				<span class="block text-sm text-muted-foreground">{data.digest}</span>
			</span>
			<ChevronRightIcon class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
		</a>
	</section>
{/if}

<section class="mt-10" aria-labelledby="passkeys">
	<h2 id="passkeys" class="text-lg font-semibold">Passkeys</h2>
	<p class="mt-1 text-sm text-muted-foreground">
		Sign in with a fingerprint, face or screen lock instead of waiting for a link.
	</p>
	{#if data.passkeys.length > 0}
		<ul class="mt-4 divide-y rounded-lg border">
			{#each data.passkeys as passkey (passkey.id)}
				<li class="flex items-center gap-3 p-3">
					<KeyRoundIcon class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<div class="min-w-0 flex-1">
						<p class="truncate font-medium">{passkey.name}</p>
						{#if passkey.added}
							<p class="text-sm text-muted-foreground">Added {passkey.added}</p>
						{/if}
					</div>
					<form method="POST" action="?/deletePasskey" use:enhance>
						<input type="hidden" name="id" value={passkey.id} />
						<Button type="submit" variant="ghost" size="sm" aria-label="Remove {passkey.name}">
							Remove
						</Button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-sm">You haven't added a passkey yet.</p>
	{/if}
	<Button
		class="mt-4 h-11"
		variant="outline"
		onclick={addPasskey}
		disabled={!interactive || adding}
	>
		<KeyRoundIcon />
		Add a passkey
	</Button>
	{#if passkeyError}
		<p role="alert" class="mt-3 text-sm text-destructive">{passkeyError}</p>
	{/if}
</section>

<section class="mt-10" aria-labelledby="sessions">
	<h2 id="sessions" class="text-lg font-semibold">Where you're signed in</h2>
	<ul class="mt-4 divide-y rounded-lg border">
		{#each data.sessions as session (session.id)}
			<li class="flex items-center gap-3 p-3">
				<MonitorSmartphoneIcon class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">{session.device}</p>
					<p class="text-sm text-muted-foreground">
						{session.current ? 'This device' : `Last active ${session.lastActive}`}
					</p>
				</div>
				<form method="POST" action="?/revokeSession" use:enhance>
					<input type="hidden" name="id" value={session.id} />
					<Button
						type="submit"
						variant="ghost"
						size="sm"
						aria-label={session.current
							? 'Sign out of this device'
							: `Sign out of ${session.device}`}
					>
						Sign out
					</Button>
				</form>
			</li>
		{/each}
	</ul>
</section>

<form method="POST" action="?/signOut" class="mt-10" use:enhance>
	<Button type="submit" variant="outline" class="h-11">
		<LogOutIcon />
		Sign out
	</Button>
</form>
