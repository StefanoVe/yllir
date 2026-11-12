// Bundles the server into ../dist/server.mjs. Dependencies are bundled too, so the
// output runs with Node alone. Exits 1 when the bundle cannot be built.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  const result = await build({
    entryPoints: [path.join(here, 'src/index.ts')],
    outfile: path.resolve(here, '../dist/server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'warning',
    banner: {
      js: 'import { createRequire as __yllirCreateRequire } from "node:module"; const require = __yllirCreateRequire(import.meta.url);',
    },
  });
  if (result.errors.length > 0) {
    throw new Error(`${result.errors.length} build error(s)`);
  }
  console.log('Built master-screen/dist/server.mjs');
} catch (err) {
  console.error(`Server build failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
