import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// The Content Security Policy sent with every page (docs/spec.md, Security and privacy).
			// SvelteKit adds a new nonce to `script-src` and `style-src` for each page, for the
			// inline script and styles it writes itself, so nothing else inline runs. The other
			// security headers are set in `src/hooks.server.ts`.
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					// Scripts load only from the app itself.
					'script-src': ['self'],
					'style-src': ['self'],
					// `style` attributes can't carry a nonce. app.html has one, and components may
					// render others; they can't run code.
					'style-src-attr': ['unsafe-inline'],
					// `blob:` for the preview of a photo being resized before upload; `data:` for
					// small images Vite inlines, such as the favicon.
					'img-src': ['self', 'data:', 'blob:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'manifest-src': ['self'],
					'worker-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['none'],
					'form-action': ['self'],
					// No other site may show Chloris in a frame (clickjacking).
					'frame-ancestors': ['none']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
