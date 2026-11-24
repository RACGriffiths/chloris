/**
 * The choices a room offers, and how they're named on screen. Shared by the server, which
 * validates against these lists, and the pages, which show them.
 */

/** Whether a room is inside the house or out (docs/spec.md, Data model). */
export const ROOM_SETTINGS = ['indoor', 'outdoor'] as const;

export type RoomSetting = (typeof ROOM_SETTINGS)[number];

/** How much light a room gets, dimmest first. A room may leave it unset. */
export const LIGHT_LEVELS = ['low', 'medium', 'bright', 'direct-sun'] as const;

export type LightLevel = (typeof LIGHT_LEVELS)[number];

const SETTING_NAMES: Record<RoomSetting, string> = { indoor: 'Indoors', outdoor: 'Outdoors' };

const LIGHT_NAMES: Record<LightLevel, { name: string; description: string }> = {
	low: { name: 'Low light', description: 'In shade most of the day, or far from a window.' },
	medium: { name: 'Medium light', description: 'Some daylight, but no sun on the plants.' },
	bright: {
		name: 'Bright light',
		description: 'Plenty of light, with sun that is filtered or brief.'
	},
	'direct-sun': { name: 'Direct sun', description: 'Sun on the plants for hours a day.' }
};

export function settingName(setting: string): string {
	return Object.hasOwn(SETTING_NAMES, setting) ? SETTING_NAMES[setting as RoomSetting] : setting;
}

export function lightName(light: string): string {
	return Object.hasOwn(LIGHT_NAMES, light) ? LIGHT_NAMES[light as LightLevel].name : light;
}

export function lightDescription(light: string): string {
	return Object.hasOwn(LIGHT_NAMES, light) ? LIGHT_NAMES[light as LightLevel].description : '';
}
