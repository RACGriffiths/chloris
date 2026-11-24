/**
 * Security headers sent with every response, besides the Content Security Policy, which
 * SvelteKit writes for each page from the `csp` option in `vite.config.ts` (docs/spec.md,
 * Security and privacy). A header a route set itself, such as the stricter `Referrer-Policy` of
 * pages with a token in the address, is left as it is.
 */
export function securityHeaders(origin: string): Record<string, string> {
	return {
		// Browsers remember to use HTTPS for two years. Not `includeSubDomains`: other services on
		// the same domain may not have HTTPS. Over plain http (localhost only) it means nothing.
		...(origin.startsWith('https:') ? { 'strict-transport-security': 'max-age=63072000' } : {}),
		'x-content-type-options': 'nosniff',
		// Other sites never see the app's addresses, which hold plant and photo ids.
		'referrer-policy': 'same-origin',
		// A page another site opens can't reach back into Chloris's window.
		'cross-origin-opener-policy': 'same-origin',
		// Nothing in Chloris uses these. Location in particular stays off: photos are stripped of
		// it too (D36).
		'permissions-policy': 'geolocation=(), microphone=(), payment=(), usb=()'
	};
}

/** Adds `headers` to `response`, keeping any it already has. */
export function withHeaders(response: Response, headers: Record<string, string>): Response {
	const add = (target: Response) => {
		for (const [name, value] of Object.entries(headers)) {
			if (!target.headers.has(name)) target.headers.set(name, value);
		}
		return target;
	};
	try {
		return add(response);
	} catch {
		// A response whose headers can't change, such as one passed on from `fetch()`: copy it.
		return add(new Response(response.body, response));
	}
}
