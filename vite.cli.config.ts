import { defineConfig } from 'vite';

/**
 * Builds the command-line tool (src/cli.ts) into build/cli, next to the server that
 * `vite build` puts in build/. It runs after the server build, which empties build/ first.
 * Dependencies stay external and load from node_modules, as the server's do.
 */
export default defineConfig({
	build: {
		ssr: 'src/cli.ts',
		outDir: 'build/cli',
		emptyOutDir: true,
		copyPublicDir: false,
		rolldownOptions: { output: { entryFileNames: 'index.js' } }
	}
});
