<script lang="ts">
	import TreesIcon from '@lucide/svelte/icons/trees';
	import LightIcon from '#lib/components/light-icon.svelte';
	import { lightName, type LightLevel, type RoomSetting } from '#lib/rooms.js';

	/**
	 * A room's light level and, if it's outdoors, that it is. Indoors is the usual case, so it
	 * isn't mentioned.
	 */
	let { setting, light }: { setting: RoomSetting; light: LightLevel | null } = $props();
</script>

{#if light || setting === 'outdoor'}
	<span class="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
		{#if light}
			<span class="inline-flex items-center gap-1">
				<LightIcon {light} />
				{lightName(light)}
			</span>
		{/if}
		{#if setting === 'outdoor'}
			<span class="inline-flex items-center gap-1">
				<TreesIcon class="size-4" aria-hidden="true" />
				Outdoors
			</span>
		{/if}
	</span>
{/if}
