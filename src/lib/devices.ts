/** Checked in order: iPhones also claim "Mac OS X", Android claims "Linux", Edge claims "Chrome". */
const SYSTEMS: [RegExp, string][] = [
	[/iPhone/, 'iPhone'],
	[/iPad/, 'iPad'],
	[/Android/, 'Android'],
	[/CrOS/, 'ChromeOS'],
	[/Macintosh|Mac OS X/, 'Mac'],
	[/Windows/, 'Windows'],
	[/Linux/, 'Linux']
];

const BROWSERS: [RegExp, string][] = [
	[/Edg(A|iOS)?\//, 'Edge'],
	[/Firefox\/|FxiOS\//, 'Firefox'],
	[/SamsungBrowser\//, 'Samsung Internet'],
	[/Chrome\/|CriOS\//, 'Chrome'],
	[/Safari\//, 'Safari']
];

const find = (list: [RegExp, string][], text: string) =>
	list.find(([pattern]) => pattern.test(text))?.[1];

/** A short name for the device behind a user agent, such as "Chrome on Android". */
export function describeUserAgent(userAgent: string | null | undefined): string {
	if (!userAgent) return 'Unknown device';
	const system = find(SYSTEMS, userAgent);
	const browser = find(BROWSERS, userAgent);
	if (browser && system) return `${browser} on ${system}`;
	return browser ?? system ?? 'Unknown device';
}
