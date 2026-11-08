// Bundles the API (and the workspace `@brickledger/shared` source) into dist/index.js.
// Third-party packages stay external and are resolved from node_modules at runtime.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const sharedEntry = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

await build({
  entryPoints: ['src/index.ts', 'src/vercel.ts', 'src/scripts/migrate.ts', 'src/scripts/seed-demo.ts'],
  outdir: 'dist',
  entryNames: '[name]',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [
    {
      name: 'workspace-and-externals',
      setup(b) {
        b.onResolve({ filter: /^@brickledger\/shared$/ }, () => ({ path: sharedEntry }));
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.kind === 'entry-point' || /^[A-Za-z]:[\\/]/.test(args.path)) return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
