// Bundle the Worker. The shared source clients (src/) import Node-only and
// Postgres modules; when the importer is under src/ those four imports are
// swapped for their Worker versions in cloudflare/src/.
import { build } from 'esbuild';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SWAPS = {
  'lib/env.ts': 'cloudflare/src/env.ts',
  'lib/rpc-post.ts': 'cloudflare/src/rpc-post.ts',
  'db/client.ts': 'cloudflare/src/client-shim.ts',
  'collector/store.ts': 'cloudflare/src/store.ts',
};

const swap = {
  name: 'worker-swaps',
  setup(b) {
    b.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (!args.importer.startsWith(join(root, 'src') + '/')) return;
      const target = resolve(args.resolveDir, args.path);
      for (const [from, to] of Object.entries(SWAPS)) if (target === join(root, 'src', from)) return { path: join(root, to) };
    });
  },
};

await build({
  entryPoints: [join(root, 'cloudflare/src/worker.ts')],
  outfile: join(root, 'cloudflare/dist/worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:workers', 'node:*'],
  plugins: [swap],
  logLevel: 'info',
});
