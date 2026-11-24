/**
 * The order names are listed in: alphabetical, ignoring case and accents, with numbers in
 * number order ("Shelf 2" before "Shelf 10"). Sorting happens here rather than in SQL, because
 * SQLite's own case folding only knows the letters A to Z.
 */
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Compares two rows by `name`, then by `id` so that rows with the same name keep a fixed order. */
export function byName<T extends { id: string }>(name: (row: T) => string) {
	return (a: T, b: T) => collator.compare(name(a), name(b)) || (a.id < b.id ? -1 : 1);
}

/** Whether two names would look the same in a list: equal, ignoring case. */
export function sameName(a: string, b: string): boolean {
	return a.toLocaleLowerCase('en') === b.toLocaleLowerCase('en');
}
