<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Brand from '#lib/components/brand.svelte';
	import type { LayoutProps } from './$types';

	// The pages before you're in a home: signing in, adding a passkey, creating a home. Also the
	// About page, which anyone can open, so each of them links to it (D59).
	let { children }: LayoutProps = $props();
</script>

<div class="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-5 py-10">
	<header class="mb-12">
		<Brand />
	</header>
	<main class="flex-1">
		{@render children()}
	</main>
	{#if page.url.pathname !== '/about'}
		<footer class="mt-12 text-sm text-muted-foreground">
			<a href={resolve('about')} class="underline-offset-4 hover:text-foreground hover:underline">
				About Chloris
			</a>
		</footer>
	{/if}
</div>
