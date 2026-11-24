/** A text field from a submitted form: `''` if it is missing, or a file rather than text. */
export function textField(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

/**
 * Every value a form sent under one name, such as the plants a "Water all" button logs: each
 * `<input type="hidden">` with that name adds one. Files are left out.
 */
export function textList(form: FormData, name: string): string[] {
	return form.getAll(name).filter((value) => typeof value === 'string');
}

/**
 * A form's validation messages by field name, from a Zod schema's `safeParse()`, ready to show
 * beside each field. Where a field has several problems, the first is shown.
 */
export function fieldErrors(error: {
	issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const issue of error.issues) {
		const field = String(issue.path[0] ?? '');
		errors[field] ??= issue.message;
	}
	return errors;
}

/** Several text fields from a submitted form, by name, each `''` if missing. */
export function textFields<const Name extends string>(
	form: FormData,
	names: readonly Name[]
): Record<Name, string> {
	return Object.fromEntries(names.map((name) => [name, textField(form, name)])) as Record<
		Name,
		string
	>;
}
