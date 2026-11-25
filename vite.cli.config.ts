import { defineConfig } from 'vite';
import { readBuildInfo } from './src/lib/server/build-info.ts';

/**
 * Builds the command-line tool (src/cli.ts) into build/cli, next to the server that
 * `vite build` puts in build/. It runs after the server build, which empties build/ first.
 * Dependencies stay external and load from node_modules, as the server's do.
 */
export default defineConfig({
	// As in vite.config.ts, so `#lib/server/about.js` works here too.
	define: {
		__CHLORIS_BUILD__: JSON.stringify(readBuildInfo(import.meta.dirname))
	},
	build: {
		ssr: 'src/cli.ts',
		outDir: 'build/cli',
		emptyOutDir: true,
		copyPublicDir: false,
		rolldownOptions: { output: { entryFileNames: 'index.js' } }
	}
});
