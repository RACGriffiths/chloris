<script lang="ts">
	import CircleQuestionMarkIcon from '@lucide/svelte/icons/circle-question-mark';
	import FieldError from '#lib/components/field-error.svelte';
	import LightIcon from '#lib/components/light-icon.svelte';
	import { Input } from '#lib/components/ui/input/index.js';
	import {
		LIGHT_LEVELS,
		ROOM_SETTINGS,
		lightDescription,
		lightName,
		settingName
	} from '#lib/rooms.js';

	/**
	 * A room's fields, for a form that adds or changes one. The page supplies the form.
	 *
	 * The radio buttons use `defaultChecked`, not `checked`: Svelte removes the `checked` attribute
	 * the server rendered once the page hydrates, so resetting the form after a room is added would
	 * leave nothing chosen. `defaultChecked` is what a reset returns to, and the server still
	 * renders it as `checked` for browsers without JavaScript.
	 */
	type Values = { name: string; setting: string; light: string };
	let {
		values = { name: '', setting: 'indoor', light: '' },
		errors = {}
	}: { values?: Values; errors?: Partial<Record<string, string>> } = $props();

	const choiceClasses =
		'flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50';
</script>

<div class="flex flex-col gap-2">
	<label for="room-name" class="text-sm font-medium">Room name</label>
	<Input
		id="room-name"
		name="name"
		required
		maxlength={60}
		autocomplete="off"
		placeholder="Kitchen"
		class="h-11"
		value={values.name}
		aria-invalid={errors.name ? true : undefined}
		aria-describedby={errors.name ? 'room-name-error' : undefined}
	/>
	<FieldError id="room-name-error" message={errors.name} />
</div>

<fieldset class="flex flex-col gap-2">
	<legend class="mb-2 text-sm font-medium">Indoors or outdoors</legend>
	<div class="grid grid-cols-2 gap-2">
		{#each ROOM_SETTINGS as setting (setting)}
			<label class={choiceClasses}>
				<input
					type="radio"
					name="setting"
					value={setting}
					defaultChecked={values.setting === setting}
					class="size-4 shrink-0 accent-primary"
				/>
				{settingName(setting)}
			</label>
		{/each}
	</div>
	<FieldError id="room-setting-error" message={errors.setting} />
</fieldset>

<fieldset class="flex flex-col gap-2" aria-describedby="room-light-hint">
	<legend class="text-sm font-medium">Light</legend>
	<p id="room-light-hint" class="mb-2 text-sm text-muted-foreground">
		How much light reaches the plants. You can leave it for now.
	</p>
	{#each LIGHT_LEVELS as light (light)}
		<label class={choiceClasses}>
			<input
				type="radio"
				name="light"
				value={light}
				defaultChecked={values.light === light}
				class="size-4 shrink-0 accent-primary"
			/>
			<LightIcon {light} class="size-5 shrink-0 text-muted-foreground" />
			<span>
				<span class="block font-medium">{lightName(light)}</span>
				<span class="block text-sm text-muted-foreground">{lightDescription(light)}</span>
			</span>
		</label>
	{/each}
	<label class={choiceClasses}>
		<input
			type="radio"
			name="light"
			value=""
			defaultChecked={!values.light}
			class="size-4 shrink-0 accent-primary"
		/>
		<CircleQuestionMarkIcon class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="font-medium">Not sure yet</span>
	</label>
	<FieldError id="room-light-error" message={errors.light} />
</fieldset>
