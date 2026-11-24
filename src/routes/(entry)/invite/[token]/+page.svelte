<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import FieldError from '#lib/components/field-error.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { roleDescription, roleName } from '#lib/roles.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let joining = $state(false);

	const joiningForm: SubmitFunction = () => {
		joining = true;
		return async ({ update }) => {
			await update({ reset: false });
			joining = false;
		};
	};

	const article = (role: string) => (role === 'owner' ? 'an' : 'a');
</script>

<svelte:head>
	<title>{data.invite ? `Join ${data.invite.homeName} · Chloris` : 'Invite · Chloris'}</title>
	<meta name="referrer" content="strict-origin" />
</svelte:head>

{#if form?.tooMany}
	<p role="alert" class="mb-6 text-sm text-destructive">{form.tooMany}</p>
{/if}

{#if form?.joined}
	<h1 class="text-2xl font-semibold tracking-tight">You've joined {form.joined.homeName}</h1>
	<p class="mt-2 text-muted-foreground">
		Chloris shows one home at a time for now, so you'll still see {form.joined.shownName} when you open
		it. Switching between homes is on its way.
	</p>
	<Button href={resolve('')} class="mt-8 h-11 w-full">Continue</Button>
{:else if !data.invite || form?.refused === 'invalid'}
	<h1 class="text-2xl font-semibold tracking-tight">This invite doesn't work</h1>
	<p class="mt-2 text-muted-foreground">
		It may have expired, been used already or been cancelled. Each invite link works only once. Ask
		whoever sent it for a new one.
	</p>
	<Button href={resolve('')} class="mt-8 h-11 w-full">Go to Chloris</Button>
{:else if data.signedIn?.alreadyMember || form?.refused === 'already-member'}
	<h1 class="text-2xl font-semibold tracking-tight">
		You're already in {data.invite.homeName}
	</h1>
	<p class="mt-2 text-muted-foreground">
		The invite hasn't been used, so whoever sent it can give it to someone else.
	</p>
	<Button href={resolve('')} class="mt-8 h-11 w-full">Continue</Button>
{:else}
	<h1 class="text-2xl font-semibold tracking-tight">Join {data.invite.homeName}</h1>
	<p class="mt-2 text-muted-foreground">
		{data.invite.invitedBy} has invited you to {data.invite.homeName} on Chloris, as {article(
			data.invite.role
		)}
		{roleName(data.invite.role).toLowerCase()}.
	</p>
	<div class="mt-4 rounded-lg border bg-muted/50 p-3 text-sm">
		<p class="font-medium">{roleName(data.invite.role)}</p>
		<p class="text-muted-foreground">{roleDescription(data.invite.role)}</p>
	</div>
	<p class="mt-4 text-sm text-muted-foreground">
		The invite works once, until {data.invite.expires}.
	</p>

	{#if data.signedIn}
		<p class="mt-8">
			You're signed in as {data.signedIn.name} ({data.signedIn.email}).
		</p>
		<form method="POST" action="?/join" use:enhance={joiningForm}>
			<Button type="submit" class="mt-4 h-11 w-full" disabled={joining}>
				Join {data.invite.homeName}
			</Button>
		</form>
	{:else}
		<form
			method="POST"
			action="?/create"
			class="mt-8 flex flex-col gap-6"
			use:enhance={joiningForm}
		>
			<div class="flex flex-col gap-2">
				<label for="name" class="text-sm font-medium">Your name</label>
				<Input
					id="name"
					name="name"
					required
					maxlength={60}
					autocomplete="name"
					class="h-11"
					value={form?.name ?? ''}
					aria-invalid={form?.errors?.name ? true : undefined}
					aria-describedby={form?.errors?.name ? 'name-error' : undefined}
				/>
				<FieldError id="name-error" message={form?.errors?.name} />
			</div>

			<div class="flex flex-col gap-2">
				<label for="email" class="text-sm font-medium">Email</label>
				<Input
					id="email"
					name="email"
					type="email"
					required
					autocomplete="email"
					class="h-11"
					value={form?.email ?? ''}
					aria-invalid={form?.errors?.email ? true : undefined}
					aria-describedby={form?.errors?.email ? 'email-error' : 'email-hint'}
				/>
				<p id="email-hint" class="text-sm text-muted-foreground">
					For signing in on another device, or if you lose this one.
				</p>
				<FieldError id="email-error" message={form?.errors?.email} />
			</div>

			<Button type="submit" class="h-11 w-full" disabled={joining}>
				Join {data.invite.homeName}
			</Button>
		</form>
		<p class="mt-6 text-sm text-muted-foreground">
			Already have an account? <a href={resolve('sign-in')} class="underline underline-offset-4">
				Sign in
			</a>, then open this link again.
		</p>
	{/if}
{/if}
