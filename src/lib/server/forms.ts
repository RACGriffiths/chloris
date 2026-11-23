/** A text field from a submitted form: `''` if it is missing, or a file rather than text. */
export function textField(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}
