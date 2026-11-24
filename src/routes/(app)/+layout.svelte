<script lang="ts">
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import CircleUserIcon from '@lucide/svelte/icons/circle-user';
	import LeafIcon from '@lucide/svelte/icons/leaf';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Brand from '#lib/components/brand.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { LayoutProps } from './$types';

	// The signed-in app, with a header on every page.
	let { children }: LayoutProps = $props();

	/** Marks the header link for the section of the app being shown. */
	const current = (section: string) =>
		page.url.pathname === section || page.url.pathname.startsWith(`${section}/`)
			? 'page'
			: undefined;

	// On the narrowest phones, the links drop their icons so all three fit beside the name.
	const navLink = 'aria-[current=page]:bg-muted max-[25rem]:[&_svg]:hidden';
</script>

<div class="min-h-dvh">
	<header class="border-b">
		<div class="mx-auto flex h-14 max-w-2xl items-center justify-between gap-2 px-4">
			<Brand />
			<nav aria-label="Main" class="flex items-center gap-1">
				<Button
					href={resolve('')}
					variant="ghost"
					size="sm"
					class={navLink}
					aria-current={page.url.pathname === '/' ? 'page' : undefined}
				>
					<CalendarCheckIcon />
					Today
				</Button>
				<Button
					href={resolve('plants')}
					variant="ghost"
					size="sm"
					class={navLink}
					aria-current={current('/plants') ?? current('/rooms')}
				>
					<LeafIcon />
					Plants
				</Button>
				<Button
					href={resolve('account')}
					variant="ghost"
					size="sm"
					class={navLink}
					aria-current={current('/account')}
				>
					<CircleUserIcon />
					Account
				</Button>
			</nav>
		</div>
	</header>
	<main class="mx-auto max-w-2xl px-4 py-6">
		{@render children()}
	</main>
</div>
