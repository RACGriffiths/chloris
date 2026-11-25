<script lang="ts">
	import CodeXmlIcon from '@lucide/svelte/icons/code-xml';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>About · Chloris</title>
</svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">About Chloris</h1>
<p class="mt-2 text-muted-foreground">A self-hosted plant care tracker for households.</p>

<dl class="mt-8 divide-y rounded-lg border">
	<div class="flex items-baseline justify-between gap-4 p-3">
		<dt class="text-muted-foreground">Version</dt>
		<dd class="font-medium">{data.version}</dd>
	</div>
	{#if data.commit}
		<div class="flex items-baseline justify-between gap-4 p-3">
			<dt class="text-muted-foreground">Built from commit</dt>
			<dd class="font-mono text-sm">{data.commit}</dd>
		</div>
	{/if}
</dl>

<section class="mt-10" aria-labelledby="source">
	<h2 id="source" class="text-lg font-semibold">Source code</h2>
	<p class="mt-1 text-sm text-muted-foreground">
		Anyone using Chloris can have the source code of the version running here, to read, change and
		share.
	</p>
	<Button href={data.sourceUrl} variant="outline" class="mt-4 h-11">
		<CodeXmlIcon />
		Source code of this version
	</Button>
	{#if !data.commit}
		<p class="mt-3 text-sm text-muted-foreground">
			This copy doesn't record which commit it was built from, so the link goes to the whole
			repository.
		</p>
	{:else if data.modified}
		<p class="mt-3 text-sm text-muted-foreground">
			This copy was built with changes that weren't committed, so its code differs from the
			commit's.
		</p>
	{/if}
</section>

<section class="mt-10" aria-labelledby="licence">
	<h2 id="licence" class="text-lg font-semibold">Licence</h2>
	<p class="mt-1 text-sm">Copyright © 2026 RACGriffiths.</p>
	<p class="mt-2 text-sm">
		Chloris is free software: you can share it and change it under the terms of the GNU Affero
		General Public License, version 3 or any later version. It comes with no warranty, to the extent
		the law allows.
	</p>
	<p class="mt-2 text-sm">
		<a
			href="https://www.gnu.org/licenses/agpl-3.0.html"
			class="font-medium underline underline-offset-4"
		>
			Read the licence
		</a>
	</p>
</section>
