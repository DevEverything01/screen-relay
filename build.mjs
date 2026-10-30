import { build } from 'esbuild';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const entries = [
  { entry: 'src/cli/main.ts', outfile: 'dist/cli/relay.mjs' },
  { entry: 'src/sdk/index.ts', outfile: 'dist/sdk/index.js' },
  { entry: 'src/protocol/index.ts', outfile: 'dist/protocol/index.js' },
];

await Promise.all(entries.map(async ({ entry, outfile }) => {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    packages: 'bundle',
  });
  await chmod(outfile, 0o755);
}));
await build({
  entryPoints: ['viewer/main.ts'],
  outfile: 'dist/viewer/viewer.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'relayViewer',
  target: 'es2020',
});
await mkdir('dist/viewer', { recursive: true });
await copyFile('viewer/index.html', 'dist/viewer/index.html');
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
