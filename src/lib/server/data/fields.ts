import { z } from 'zod';

/** Optional free text: surrounding spaces are trimmed, and an empty value means not given. */
export const optionalText = (max: number, message: string) =>
	z
		.string()
		.trim()
		.max(max, message)
		.optional()
		.transform((value) => value || null);
