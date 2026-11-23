#!/usr/bin/env node
// Claude Code PreToolUse hook (CLAUDE.md rule 7): blocks file edits to database migrations that
// are already committed. New, uncommitted migrations can still be changed. Exit code 2 blocks
// the tool call and shows the message on stderr to Claude.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const MIGRATIONS_DIR = 'src/lib/server/db/migrations/';

let raw = '';
for await (const chunk of process.stdin) raw += String(chunk);

/** Reads `key` from `value` if it is an object. */
const field = (/** @type {unknown} */ value, /** @type {string} */ key) =>
	value && typeof value === 'object'
		? /** @type {Record<string, unknown>} */ (value)[key]
		: undefined;

/** @type {unknown} */
const input = JSON.parse(raw);
const inputCwd = field(input, 'cwd');
const cwd = typeof inputCwd === 'string' ? inputCwd : process.cwd();
const toolInput = field(input, 'tool_input');
const target = field(toolInput, 'file_path') ?? field(toolInput, 'notebook_path');
if (typeof target !== 'string') process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? cwd;
const relative = path.relative(projectDir, path.resolve(cwd, target)).split(path.sep).join('/');
if (!relative.startsWith(MIGRATIONS_DIR)) process.exit(0);

try {
	execFileSync('git', ['cat-file', '-e', `HEAD:${relative}`], { cwd: projectDir, stdio: 'ignore' });
} catch {
	process.exit(0); // Not in the last commit: a new migration that may still be edited.
}

console.error(
	`Blocked: ${relative} is a committed migration, and committed migrations must never be edited ` +
		'(CLAUDE.md rule 7). Change src/lib/server/db/schema.ts instead and run `npm run db:generate` ' +
		'to create a new migration.'
);
process.exit(2);
