<script lang="ts">
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import MailCheckIcon from '@lucide/svelte/icons/mail-check';
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import FieldError from '#lib/components/field-error.svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Passkeys need JavaScript, so the button stays disabled until the page is interactive.
	let interactive = $state(false);
	let signingIn = $state(false);
	let sending = $state(false);
	let passkeyError = $state<string | null>(null);

	const home = () => goto(resolve(''), { refreshAll: true });

	onMount(() => {
		interactive = true;
		// Where the browser supports it, saved passkeys show up in the email field's suggestions.
		void (async () => {
			const passkeys = await import('#lib/passkeys.js');
			if (!(await passkeys.autofillSupported())) return;
			const outcome = await passkeys.signInWithPasskey({ autoFill: true });
			if (outcome.ok) await home();
		})();
	});

	async function signInWithPasskey() {
		passkeyError = null;
		signingIn = true;
		try {
			const passkeys = await import('#lib/passkeys.js');
			if (!passkeys.passkeysSupported()) {
				passkeyError = "This browser can't use passkeys. Get a sign-in link instead.";
				return;
			}
			const outcome = await passkeys.signInWithPasskey();
			if (outcome.ok) await home();
			else if (!outcome.cancelled) passkeyError = outcome.message;
		} finally {
			signingIn = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in · Chloris</title>
</svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Sign in</h1>
<p class="mt-2 text-muted-foreground">
	Use a passkey saved on this device, or get a one-time sign-in link.
</p>

<Button class="mt-8 h-11 w-full" onclick={signInWithPasskey} disabled={!interactive || signingIn}>
	<KeyRoundIcon />
	Sign in with a passkey
</Button>
{#if passkeyError}
	<p role="alert" class="mt-3 text-sm text-destructive">{passkeyError}</p>
{/if}

<div class="my-8 flex items-center gap-3 text-sm text-muted-foreground">
	<span class="h-px flex-1 bg-border"></span>
	or
	<span class="h-px flex-1 bg-border"></span>
</div>

{#if form?.sent}
	<Alert.Root>
		<MailCheckIcon />
		<Alert.Title>Check your email</Alert.Title>
		<Alert.Description>
			If {form.email} has an account here, a sign-in link is on its way. It works once, within {data.linkMinutes}
			minutes.
		</Alert.Description>
	</Alert.Root>
{:else}
	<form
		method="POST"
		class="flex flex-col gap-3"
		use:enhance={() => {
			sending = true;
			return async ({ update }) => {
				await update();
				sending = false;
			};
		}}
	>
		<label for="email" class="text-sm font-medium">Email</label>
		<Input
			id="email"
			name="email"
			type="email"
			autocomplete="username webauthn"
			required
			class="h-11"
			value={form?.email ?? ''}
			aria-invalid={form?.error ? true : undefined}
			aria-describedby={form?.error ? 'email-error' : undefined}
		/>
		<FieldError id="email-error" message={form?.error} />
		{#if data.emailEnabled}
			<Button type="submit" variant="outline" class="h-11 w-full" disabled={sending}>
				Email me a sign-in link
			</Button>
		{:else}
			<p class="text-sm text-muted-foreground">
				Sign-in links by email are switched off on this server. If you can't use a passkey, ask
				whoever runs Chloris for a sign-in link.
			</p>
		{/if}
	</form>
{/if}
