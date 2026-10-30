import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';

const entries = [{ entry: 'src/cli/main.ts', outfile: 'dist/cli/relay.mjs' }];

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
