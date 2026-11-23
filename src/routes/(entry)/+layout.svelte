<script lang="ts">
	import Brand from '#lib/components/brand.svelte';
	import type { LayoutProps } from './$types';

	// The pages before you're in a home: signing in, adding a passkey, creating a home.
	let { children }: LayoutProps = $props();
</script>

<main class="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-5 py-10">
	<header class="mb-12">
		<Brand />
	</header>
	{@render children()}
</main>
