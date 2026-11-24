<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import StarIcon from '@lucide/svelte/icons/star';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import FieldError from '#lib/components/field-error.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let plant = $derived(data.plant);
	let photo = $derived(data.photo);

	/** What the edit form shows: what was sent if the server refused it, or else the photo's. */
	let values = $derived(
		form?.edit?.values ?? { caption: photo.caption ?? '', takenAt: photo.takenAt }
	);
	let errors: Partial<Record<string, string>> = $derived(form?.edit?.errors ?? {});

	const photoPage = (id: string) => resolve(`plants/${plant.id}/photos/${id}`);

	let busy = $state(false);

	/**
	 * For every form here. `reset: false` keeps the fields as they are once the page updates, so
	 * a saved caption stays shown rather than the form emptying.
	 */
	const submit: SubmitFunction = () => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	};

	function invalid(field: string) {
		const error = errors[field] ? `edit-${field}-error` : undefined;
		return { 'aria-invalid': error ? true : undefined, 'aria-describedby': error };
	}
</script>

<svelte:head>
	<title>Photo of {plant.nickname} · Chloris</title>
</svelte:head>

<Button href={resolve(`plants/${plant.id}#photos`)} variant="ghost" size="sm" class="-ml-2.5">
	<ChevronLeftIcon />
	{plant.nickname}
</Button>

<h1 class="mt-3 text-2xl font-semibold tracking-tight">Photo of {plant.nickname}</h1>

<figure class="mt-4">
	<!-- The full size is a plain image, not a page, so the browser loads it itself. -->
	<a
		href={resolve(`photos/${photo.id}/full`)}
		data-sveltekit-reload
		class="block rounded-lg bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
	>
		<!--
			`width` and `height` give the photo's shape, so the page keeps room for it while it loads.
			The photo fills the width, but never more than 70% of the screen's height, keeping its shape.
		-->
		<img
			src={resolve(`photos/${photo.id}/medium`)}
			alt={photo.caption ?? `${plant.nickname}, taken ${photo.taken}`}
			width={photo.width}
			height={photo.height}
			class="mx-auto h-auto max-h-[70svh] w-auto max-w-full rounded-lg"
		/>
	</a>
	{#if photo.caption}
		<figcaption class="mt-3 break-words">{photo.caption}</figcaption>
	{/if}
</figure>

<!-- Three columns, so the count stays in the middle when there's no newer or older photo. -->
<nav class="mt-3 grid grid-cols-3 items-center gap-2" aria-label="Photos of {plant.nickname}">
	{#if data.newerId}
		<Button href={photoPage(data.newerId)} variant="outline" class="h-11 justify-self-start">
			<ChevronLeftIcon />
			Newer
		</Button>
	{:else}
		<span></span>
	{/if}
	<p class="text-center text-sm text-muted-foreground">{data.position} of {data.count}</p>
	{#if data.olderId}
		<Button href={photoPage(data.olderId)} variant="outline" class="h-11 justify-self-end">
			Older
			<ChevronRightIcon />
		</Button>
	{/if}
</nav>

{#if form?.message}
	<p role="status" class="mt-4 rounded-lg bg-secondary px-3 py-2 text-sm">{form.message}</p>
{/if}

<dl class="mt-4 divide-y rounded-lg border text-sm">
	<div class="flex justify-between gap-4 p-3">
		<dt class="shrink-0 text-muted-foreground">Taken</dt>
		<dd class="min-w-0 text-right">{photo.taken}</dd>
	</div>
	<div class="flex justify-between gap-4 p-3">
		<dt class="shrink-0 text-muted-foreground">Added by</dt>
		<dd class="min-w-0 text-right break-words">{photo.by}</dd>
	</div>
	{#if photo.care}
		<div class="flex justify-between gap-4 p-3">
			<dt class="shrink-0 text-muted-foreground">Added with</dt>
			<dd class="min-w-0 text-right">{photo.care.name}, {photo.care.when}</dd>
		</div>
	{/if}
</dl>

{#if data.isCover}
	<div
		class="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-secondary p-3 text-sm"
	>
		<p class="flex items-center gap-2">
			<StarIcon class="size-4 shrink-0" aria-hidden="true" />
			{plant.nickname}'s cover photo
		</p>
		{#if data.canChooseCover}
			<form method="POST" action="?/cover" use:enhance={submit}>
				<input type="hidden" name="use" value="latest" />
				<Button type="submit" variant="outline" size="sm" disabled={busy}>
					Use the latest photo instead
				</Button>
			</form>
		{/if}
	</div>
{:else if data.canChooseCover}
	<form method="POST" action="?/cover" class="mt-4" use:enhance={submit}>
		<input type="hidden" name="use" value="this" />
		<Button type="submit" variant="outline" class="h-11 w-full" disabled={busy}>
			<StarIcon />
			Use as cover photo
		</Button>
		<p class="mt-2 text-sm text-muted-foreground">
			Until you choose one, {plant.nickname} shows its latest photo.
		</p>
	</form>
{/if}

{#if data.canChange}
	<!-- Opens without JavaScript, and by itself when the server sends the form back. -->
	<details class="group mt-4 rounded-lg border" open={!!form?.edit}>
		<summary class="flex cursor-pointer list-none p-3 [&::-webkit-details-marker]:hidden">
			<span class="flex items-center gap-1 font-medium">
				<ChevronRightIcon
					class="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
					aria-hidden="true"
				/>
				Edit caption and date
			</span>
		</summary>

		<form
			method="POST"
			action="?/save"
			class="flex flex-col gap-6 border-t p-3 pt-5"
			use:enhance={submit}
		>
			<div class="flex flex-col gap-2">
				<label for="edit-caption" class="text-sm font-medium">Caption</label>
				<Input
					id="edit-caption"
					name="caption"
					maxlength={data.captionLimit}
					placeholder="Optional"
					class="h-11"
					value={values.caption}
					{...invalid('caption')}
				/>
				<FieldError id="edit-caption-error" message={errors.caption} />
			</div>

			<div class="flex flex-col gap-2">
				<label for="edit-takenAt" class="text-sm font-medium">Taken</label>
				<Input
					id="edit-takenAt"
					name="takenAt"
					type="datetime-local"
					required
					max={data.latest}
					class="h-11"
					value={values.takenAt}
					{...invalid('takenAt')}
				/>
				<FieldError id="edit-takenAt-error" message={errors.takenAt} />
			</div>

			<Button type="submit" class="h-11 w-full" disabled={busy}>Save</Button>
		</form>
	</details>

	<!-- Two taps to delete, so a stray one can't. -->
	<details class="mt-4">
		<!-- Styled like a ghost button in the destructive colour. -->
		<summary
			class="inline-flex h-11 cursor-pointer list-none items-center rounded-md px-3 text-sm font-medium text-destructive outline-none select-none hover:bg-destructive/10 focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
		>
			Delete photo
		</summary>
		<form
			method="POST"
			action="?/delete"
			class="mt-2 flex flex-col gap-3 rounded-lg border p-3"
			use:enhance={submit}
		>
			<p class="text-sm">
				It goes from {plant.nickname}'s timeline at once{photo.care
					? ', though the care it was added with stays in the history'
					: ''}.
			</p>
			<Button type="submit" variant="destructive" class="h-11" disabled={busy}>
				Delete this photo
			</Button>
		</form>
	</details>
{/if}
