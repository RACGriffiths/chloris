<script lang="ts">
	/** A form field's error message, linked to the field with `aria-describedby={id}`. */
	let { id, message }: { id: string; message: string | null | undefined } = $props();
</script>

{#if message}
	<p {id} class="text-sm text-destructive">{message}</p>
{/if}
