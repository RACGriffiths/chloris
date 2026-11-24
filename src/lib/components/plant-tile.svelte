<script lang="ts">
	import { cn } from '#lib/utils.js';

	/**
	 * A plant's tile: a square in one of a few leaf tones, holding the first letter of its name.
	 * It stands in for the cover photo until photos arrive. The tone comes from the plant's id, so
	 * a plant keeps its colour when it's renamed.
	 */
	let { id, name, class: className = '' }: { id: string; name: string; class?: string } = $props();

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

<span
	aria-hidden="true"
	class={cn(
		'grid size-11 shrink-0 place-items-center rounded-xl text-lg font-semibold select-none',
		tone,
		className
	)}
>
	{initial}
</span>
