<script lang="ts">
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import CloudSunIcon from '@lucide/svelte/icons/cloud-sun';
	import SunIcon from '@lucide/svelte/icons/sun';
	import SunDimIcon from '@lucide/svelte/icons/sun-dim';
	import type { LightLevel } from '#lib/rooms.js';

	/** An icon for a room's light level, from cloud to full sun. Decorative: show its name too. */
	let { light, class: className = 'size-4' }: { light: LightLevel; class?: string } = $props();

	const ICONS = { low: CloudIcon, medium: CloudSunIcon, bright: SunDimIcon, 'direct-sun': SunIcon };

	let Icon = $derived(ICONS[light]);
</script>

<Icon class={className} aria-hidden="true" />
