// Entry point of the command-line tool; see `#lib/server/cli` and vite.cli.config.ts.
import { main } from './lib/server/cli';

process.exitCode = await main(process.argv.slice(2), process.env);
