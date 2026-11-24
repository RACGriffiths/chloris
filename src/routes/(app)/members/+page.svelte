<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import LinkIcon from '@lucide/svelte/icons/link';
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
	import Share2Icon from '@lucide/svelte/icons/share-2';
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { roleDescription, roleName } from '#lib/roles.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type CreatedLink = { url: string; role: string; expires: string };

	let creating = $state(false);
	// The link just made stays on screen after other forms on the page are sent, such as cancelling
	// an older invite. Only a hash of it is stored, so once it's gone it can't be shown again.
	let kept = $state<CreatedLink | null>(null);
	let created = $derived<CreatedLink | null>(form?.created ?? kept);

	// Copying and sharing need JavaScript. Without it the link can still be selected and copied.
	let canCopy = $state(false);
	let canShare = $state(false);
	let copied = $state(false);

	onMount(() => {
		canCopy = 'clipboard' in navigator;
		canShare = 'share' in navigator;
	});

	async function copy(url: string) {
		await navigator.clipboard.writeText(url);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	async function share(url: string) {
		try {
			await navigator.share({ title: `Join ${data.home.name} on Chloris`, url });
		} catch {
			// Cancelled, or the browser refused. The link is still on screen to copy.
		}
	}

	/** Selects the whole link when the field is focused, so it's easy to copy by hand. */
	function selectAll(event: FocusEvent) {
		(event.currentTarget as HTMLInputElement).select();
	}

	const article = (role: string) => (role === 'owner' ? 'an' : 'a');
</script>

<svelte:head>
	<title>Members · Chloris</title>
</svelte:head>

<p class="text-sm text-muted-foreground">{data.home.name}</p>
<h1 class="text-2xl font-semibold tracking-tight">Members</h1>

{#if form?.error}
	<p role="alert" class="mt-4 text-sm text-destructive">{form.error}</p>
{/if}

<ul class="mt-6 divide-y rounded-lg border">
	{#each data.members as member (member.id)}
		<li class="flex items-center gap-3 p-3">
			<div class="min-w-0 flex-1">
				<p class="truncate font-medium">{member.name}{member.you ? ' (you)' : ''}</p>
				<p class="truncate text-sm text-muted-foreground">{member.email}</p>
			</div>
			<span class="shrink-0 text-sm text-muted-foreground">{roleName(member.role)}</span>
		</li>
	{/each}
</ul>

<section class="mt-10" aria-labelledby="invite">
	<h2 id="invite" class="text-lg font-semibold">Invite someone</h2>
	<p class="mt-1 text-sm text-muted-foreground">
		You'll get a link to send them however you like. It works once, for {data.inviteDays} days.
	</p>

	{#if created}
		<Card.Root class="mt-4 border-primary/40">
			<Card.Header>
				<Card.Title>
					Invite link for {article(created.role)}
					{roleName(created.role).toLowerCase()}
				</Card.Title>
				<Card.Description>
					Send it only to the person you're inviting: anyone with the link can join. It works once,
					until {created.expires}. Copy it now, because it won't be shown again.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				<label for="invite-link" class="sr-only">Invite link</label>
				<Input
					id="invite-link"
					readonly
					value={created.url}
					class="h-11 font-mono text-sm"
					onfocus={selectAll}
				/>
				{#if canCopy || canShare}
					<div class="flex gap-2">
						{#if canCopy}
							<Button class="h-11 flex-1" onclick={() => copy(created.url)}>
								{#if copied}
									<CheckIcon />
									Copied
								{:else}
									<CopyIcon />
									Copy link
								{/if}
							</Button>
						{/if}
						{#if canShare}
							<Button variant="outline" class="h-11 flex-1" onclick={() => share(created.url)}>
								<Share2Icon />
								Share
							</Button>
						{/if}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	<form
		method="POST"
		action="?/create"
		class="mt-6 flex flex-col gap-4"
		use:enhance={() => {
			creating = true;
			return async ({ result, update }) => {
				// Keeps the chosen role selected, ready for another invite.
				await update({ reset: false });
				if (result.type === 'success' && result.data?.created) {
					kept = result.data.created as CreatedLink;
					copied = false;
				}
				creating = false;
			};
		}}
	>
		<fieldset class="flex flex-col gap-2">
			<legend class="mb-2 text-sm font-medium">Their role</legend>
			{#each data.roles as role (role)}
				<label
					class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-accent"
				>
					<input
						type="radio"
						name="role"
						value={role}
						checked={role === 'carer'}
						class="mt-1 size-4 shrink-0 accent-primary"
					/>
					<span>
						<span class="block font-medium">{roleName(role)}</span>
						<span class="block text-sm text-muted-foreground">{roleDescription(role)}</span>
					</span>
				</label>
			{/each}
		</fieldset>
		<Button type="submit" class="h-11 w-full" disabled={creating}>
			<LinkIcon />
			Create invite link
		</Button>
	</form>
</section>

{#if data.invites.length > 0}
	<section class="mt-10" aria-labelledby="pending">
		<h2 id="pending" class="text-lg font-semibold">Invites not used yet</h2>
		<ul class="mt-4 divide-y rounded-lg border">
			{#each data.invites as invite (invite.id)}
				<li class="flex items-center gap-3 p-3">
					<div class="min-w-0 flex-1">
						<p class="font-medium">{roleName(invite.role)}</p>
						<p class="text-sm text-muted-foreground">
							Made by {invite.createdBy} · expires {invite.expires}
						</p>
					</div>
					<form method="POST" action="?/cancel" use:enhance>
						<input type="hidden" name="id" value={invite.id} />
						<Button
							type="submit"
							variant="ghost"
							size="sm"
							aria-label="Cancel this {roleName(invite.role).toLowerCase()} invite"
						>
							Cancel
						</Button>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="mt-10" aria-labelledby="audit">
	<h2 id="audit" class="text-lg font-semibold">Audit log</h2>
	<p class="mt-1 text-sm text-muted-foreground">
		Who signed in, and when, and the invites, passkeys and deletions in this home.
	</p>
	<Button href={resolve('members/audit')} variant="outline" class="mt-4 h-11 w-full">
		<ScrollTextIcon />
		See the audit log
	</Button>
</section>
