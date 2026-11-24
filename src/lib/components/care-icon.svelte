<script lang="ts">
	import BugIcon from '@lucide/svelte/icons/bug';
	import DropletIcon from '@lucide/svelte/icons/droplet';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import MoveIcon from '@lucide/svelte/icons/move';
	import ScissorsIcon from '@lucide/svelte/icons/scissors';
	import SearchCheckIcon from '@lucide/svelte/icons/search-check';
	import ShovelIcon from '@lucide/svelte/icons/shovel';
	import SprayCanIcon from '@lucide/svelte/icons/spray-can';
	import type { CareType } from '#lib/care.js';
	import { cn } from '#lib/utils.js';

	/**
	 * A kind of care as a small round icon, tinted so each task is easy to spot in a list. A check
	 * takes the colour of the task it was for. Decorative: show the care's name too.
	 */
	let {
		type,
		checkedTask = null,
		class: className = ''
	}: { type: CareType; checkedTask?: CareType | null; class?: string } = $props();

	const ICONS = {
		water: DropletIcon,
		feed: FlaskConicalIcon,
		mist: SprayCanIcon,
		prune: ScissorsIcon,
		repot: ShovelIcon,
		'pest-treatment': BugIcon,
		move: MoveIcon,
		checked: SearchCheckIcon
	};

	// Written out in full so Tailwind finds the class names when it scans this file.
	const TONES: Record<CareType, string> = {
		water: 'bg-sky-100 text-sky-800',
		feed: 'bg-amber-100 text-amber-800',
		mist: 'bg-teal-100 text-teal-800',
		prune: 'bg-lime-100 text-lime-800',
		repot: 'bg-orange-100 text-orange-800',
		'pest-treatment': 'bg-rose-100 text-rose-800',
		move: 'bg-secondary text-muted-foreground',
		checked: 'bg-secondary text-muted-foreground'
	};

	let Icon = $derived(ICONS[type]);
	let tone = $derived(TONES[type === 'checked' && checkedTask ? checkedTask : type]);
</script>

<span
	aria-hidden="true"
	class={cn('grid size-9 shrink-0 place-items-center rounded-full', tone, className)}
>
	<Icon class="size-4" />
</span>
