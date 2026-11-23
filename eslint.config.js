import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommendedTypeChecked,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: {
			parserOptions: { projectService: true },
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// CLAUDE.md rule 1: routes reach domain data only through the data-access layer.
		files: ['src/routes/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['#lib/server/db', '#lib/server/db/*', '**/server/db/*'],
							message: 'Routes must use the data-access layer (#lib/server/data), not the database.'
						},
						{
							group: ['drizzle-orm', 'drizzle-orm/*', 'better-sqlite3'],
							message: 'Routes must use the data-access layer (#lib/server/data), not the database.'
						}
					]
				}
			]
		}
	},
	{
		// shadcn-svelte components take `href` from the caller, which is where resolve() belongs.
		files: ['src/lib/components/ui/**'],
		rules: { 'svelte/no-navigation-without-resolve': 'off' }
	}
);
