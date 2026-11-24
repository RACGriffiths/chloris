/**
 * What a plant's status can be (docs/spec.md, Data model). Shared by the server and the pages.
 * Only active plants are listed; the others are in the Memorial view (D43 to D45).
 */
export const PLANT_STATUSES = ['active', 'died', 'given-away', 'sold'] as const;

export type PlantStatus = (typeof PLANT_STATUSES)[number];

/** The statuses that put a plant in the Memorial: every one but active. */
export const MEMORIAL_STATUSES = ['died', 'given-away', 'sold'] as const;

export type MemorialStatus = (typeof MEMORIAL_STATUSES)[number];

const STATUS_NAMES: Record<MemorialStatus, string> = {
	died: 'Died',
	'given-away': 'Given away',
	sold: 'Sold'
};

/** What happened to a plant in the Memorial, as a heading or the start of a sentence: `Given away`. */
export function statusName(status: string): string {
	return Object.hasOwn(STATUS_NAMES, status) ? STATUS_NAMES[status as MemorialStatus] : status;
}

/** What the add and edit forms' fields hold, as text. */
export type PlantValues = {
	nickname: string;
	roomId: string;
	species: string;
	acquiredOn: string;
	source: string;
	pot: string;
	soil: string;
	tags: string;
	notes: string;
};
