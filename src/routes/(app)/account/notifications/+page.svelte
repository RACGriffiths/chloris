<script lang="ts">
	import MailCheckIcon from '@lucide/svelte/icons/mail-check';
	import MailWarningIcon from '@lucide/svelte/icons/mail-warning';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import FieldError from '#lib/components/field-error.svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// After a refused save, the form shows what was sent; otherwise what's saved.
	let values = $derived(form?.values ?? data.values);
	let errors: Partial<Record<string, string>> = $derived(form?.errors ?? {});

	let saving = $state(false);
	let sending = $state(false);

	function invalid(field: string, hint?: string) {
		const error = errors[field] ? `${field}-error` : undefined;
		return {
			'aria-invalid': error ? true : undefined,
			'aria-describedby': [error, hint].filter(Boolean).join(' ') || undefined
		};
	}

	const choiceClasses =
		'flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50';
</script>

<svelte:head>
	<title>Notifications · Chloris</title>
</svelte:head>

<p class="text-sm text-muted-foreground">
	<a href={resolve('account')} class="underline-offset-4 hover:underline">Account</a>
</p>
<h1 class="text-2xl font-semibold tracking-tight">Notifications</h1>
<p class="mt-1 text-muted-foreground">Your daily digest for {data.home.name}.</p>

{#if form?.error}
	<p role="alert" class="mt-4 text-sm text-destructive">{form.error}</p>
{/if}

{#if !data.emailEnabled}
	<p class="mt-6 rounded-lg border p-4 text-sm">
		Email is switched off on this server, so there's no daily digest. Whoever runs Chloris can
		switch it on with the SMTP settings.
	</p>
{:else}
	{#if !data.emailConfirmed}
		<Alert.Root class="mt-6">
			{#if form?.linkSent}
				<MailCheckIcon />
				<Alert.Title>Check your email</Alert.Title>
				<Alert.Description>
					A sign-in link is on its way to {data.email}. Open it within {data.linkMinutes} minutes and
					sign in to confirm the address.
				</Alert.Description>
			{:else}
				<MailWarningIcon />
				<Alert.Title>Confirm your email address</Alert.Title>
				<Alert.Description>
					<p>
						Digests go only to a confirmed address. We'll email {data.email} a sign-in link: using it
						confirms the address, signs you out on your other devices and removes your passkeys, so that
						only the owner of the address can sign in. You can add a passkey again straight away.
					</p>
					<form
						method="POST"
						action="?/confirm"
						class="mt-2"
						use:enhance={() => {
							sending = true;
							return async ({ update }) => {
								await update();
								sending = false;
							};
						}}
					>
						<Button type="submit" variant="outline" class="h-11" disabled={sending}>
							Email me a sign-in link
						</Button>
					</form>
				</Alert.Description>
			{/if}
		</Alert.Root>
	{/if}

	<!--
		`group` on the form lets a field inside it be styled by the state of another, with
		`group-has-[...]:hidden`: the time is hidden while "Off" is chosen, and the quiet hours while
		their box is unticked. It's plain CSS, so it works before JavaScript loads, and hidden fields
		are still sent, so nothing typed is lost.
	-->
	<form
		method="POST"
		action="?/save"
		class="group mt-6 flex flex-col gap-8"
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				// Keeps the choices on screen if the server sends the form back with a problem.
				await update({ reset: false });
				saving = false;
			};
		}}
	>
		<fieldset class="flex flex-col gap-3">
			<legend class="text-lg font-semibold">Daily digest</legend>
			<p class="-mt-1 text-sm text-muted-foreground">
				What's due and overdue, room by room. Nothing is sent on a day when nothing is due.
			</p>
			<div class="flex flex-col gap-2">
				<label class={choiceClasses}>
					<input
						type="radio"
						name="channel"
						value="email"
						defaultChecked={values.channel === 'email'}
						class="mt-1 size-4 shrink-0 accent-primary"
					/>
					<span class="min-w-0">
						<span class="block font-medium">By email</span>
						<span class="block truncate text-sm text-muted-foreground">To {data.email}</span>
					</span>
				</label>
				<label class={choiceClasses}>
					<input
						id="channel-off"
						type="radio"
						name="channel"
						value="off"
						defaultChecked={values.channel === 'off'}
						class="mt-1 size-4 shrink-0 accent-primary"
					/>
					<span class="font-medium">Off</span>
				</label>
			</div>
			<FieldError id="channel-error" message={errors.channel} />

			<div class="flex flex-col gap-2 group-has-[#channel-off:checked]:hidden">
				<label for="digestTime" class="text-sm font-medium">Time</label>
				<Input
					id="digestTime"
					name="digestTime"
					type="time"
					class="h-11 w-36"
					value={values.digestTime}
					{...invalid('digestTime', 'digestTime-hint')}
				/>
				<p id="digestTime-hint" class="text-sm text-muted-foreground">
					In the home's time zone, {data.home.timeZone}. If the server misses it, the digest comes
					later that day.
				</p>
				<FieldError id="digestTime-error" message={errors.digestTime} />
			</div>
		</fieldset>

		<fieldset class="flex flex-col gap-3">
			<legend class="text-lg font-semibold">Quiet hours</legend>
			<label class="flex cursor-pointer items-center gap-3">
				<input
					id="quietHours"
					type="checkbox"
					name="quietHours"
					value="on"
					defaultChecked={values.quietHours === 'on'}
					class="size-4 shrink-0 accent-primary"
				/>
				<span>Send nothing between these times</span>
			</label>
			<div class="grid grid-cols-2 gap-3 group-has-[#quietHours:not(:checked)]:hidden sm:max-w-xs">
				<div class="flex flex-col gap-2">
					<label for="quietStart" class="text-sm font-medium">From</label>
					<Input
						id="quietStart"
						name="quietStart"
						type="time"
						class="h-11"
						value={values.quietStart}
						{...invalid('quietStart')}
					/>
					<FieldError id="quietStart-error" message={errors.quietStart} />
				</div>
				<div class="flex flex-col gap-2">
					<label for="quietEnd" class="text-sm font-medium">Until</label>
					<Input
						id="quietEnd"
						name="quietEnd"
						type="time"
						class="h-11"
						value={values.quietEnd}
						{...invalid('quietEnd')}
					/>
					<FieldError id="quietEnd-error" message={errors.quietEnd} />
				</div>
			</div>
		</fieldset>

		<div class="flex flex-col gap-3">
			<Button type="submit" class="h-11 w-full" disabled={saving}>Save</Button>
			{#if form?.saved}
				<p role="status" class="text-center text-sm">Saved.</p>
			{/if}
			{#if data.lastSent}
				<p class="text-center text-sm text-muted-foreground">Last digest sent {data.lastSent}.</p>
			{/if}
		</div>
	</form>
{/if}
