<script lang="ts">
	import CircleUserIcon from '@lucide/svelte/icons/circle-user';
	import { resolve } from '$app/paths';
	import Brand from '#lib/components/brand.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { LayoutProps } from './$types';

	// The signed-in app, with a header on every page.
	let { children }: LayoutProps = $props();
</script>

<div class="min-h-dvh">
	<header class="border-b">
		<div class="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
			<Brand />
			<Button href={resolve('account')} variant="ghost" size="sm">
				<CircleUserIcon />
				Account
			</Button>
		</div>
	</header>
	<main class="mx-auto max-w-2xl px-4 py-6">
		{@render children()}
	</main>
</div>
