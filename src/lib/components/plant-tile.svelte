<script lang="ts">
	import { resolve } from '$app/paths';
	import { cn } from '#lib/utils.js';

	/**
	 * A plant's tile: its cover photo (D42), or for a plant with no photos, a square in one of a
	 * few leaf tones holding the first letter of its name. The tone comes from the plant's id, so a
	 * plant keeps its colour when it's renamed, and shows behind the photo while it loads. The tile
	 * sits beside the plant's name, so it's hidden from screen readers.
	 */
	let {
		id,
		name,
		photoId = null,
		class: className = ''
	}: { id: string; name: string; photoId?: string | null; class?: string } = $props();

	// Written out in full so Tailwind finds the class names when it scans this file.
	const TONES = [
		'bg-lime-100 text-lime-900',
		'bg-emerald-100 text-emerald-900',
		'bg-green-100 text-green-900',
		'bg-teal-100 text-teal-900',
		'bg-amber-100 text-amber-900'
	];

	function hash(value: string): number {
		let total = 0;
		for (const char of value) total = (total * 31 + char.charCodeAt(0)) >>> 0;
		return total;
	}

	let tone = $derived(TONES[hash(id) % TONES.length]);
	let initial = $derived(Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '');
</script>

<!-- `overflow-hidden` clips the photo to the tile's rounded corners. -->
<span
	aria-hidden="true"
	class={cn(
		'grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl text-lg font-semibold select-none',
		tone,
		className
	)}
>
	{#if photoId}
		<!-- The square thumbnail, filling the tile. `alt=""` because the name is beside it. -->
		<img
			src={resolve(`photos/${photoId}/thumb`)}
			alt=""
			width="400"
			height="400"
			loading="lazy"
			class="size-full object-cover"
		/>
	{:else}
		{initial}
	{/if}
</span>
