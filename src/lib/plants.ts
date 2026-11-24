/**
 * What a plant's status can be (docs/spec.md, Data model). Shared by the server and the pages.
 * Only active plants are listed; the others belong to the Memorial view, which comes later.
 */
export const PLANT_STATUSES = ['active', 'died', 'given-away', 'sold'] as const;

export type PlantStatus = (typeof PLANT_STATUSES)[number];

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
