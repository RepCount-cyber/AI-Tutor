import { build } from 'esbuild';

await build({
  entryPoints: ['client/neon-auth.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  outfile: 'public/neon-auth.js',
  legalComments: 'none'
});
