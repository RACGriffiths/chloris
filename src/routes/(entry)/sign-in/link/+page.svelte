<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let signingIn = $state(false);
</script>

<svelte:head>
	<title>Sign in · Chloris</title>
	<meta name="referrer" content="strict-origin" />
</svelte:head>

{#if form?.invalid || !data.token}
	<h1 class="text-2xl font-semibold tracking-tight">This link doesn't work</h1>
	<p class="mt-2 text-muted-foreground">
		It may have expired, or been used already. Each sign-in link works only once, and only for a
		short time.
	</p>
	<Button href={resolve('sign-in')} class="mt-8 h-11 w-full">Back to sign-in</Button>
{:else}
	<h1 class="text-2xl font-semibold tracking-tight">Sign in to Chloris</h1>
	<p class="mt-2 text-muted-foreground">You opened a sign-in link. Continue to sign in here.</p>
	<form
		method="POST"
		use:enhance={() => {
			signingIn = true;
			return async ({ update }) => {
				await update();
				signingIn = false;
			};
		}}
	>
		<input type="hidden" name="token" value={data.token} />
		<Button type="submit" class="mt-8 h-11 w-full" disabled={signingIn}>Sign in</Button>
	</form>
{/if}
