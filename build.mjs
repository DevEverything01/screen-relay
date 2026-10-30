import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

const entries = ['src/sdk/index.ts', 'src/protocol/index.ts'];

await build({ entryPoints: entries, outbase: 'src', outdir: 'dist', bundle: true, format: 'esm', platform: 'node' });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
