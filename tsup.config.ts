import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: false,
    target: 'node18',
    treeshake: true,
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node18',
    clean: false,
    sourcemap: false,
    minify: true,
    noExternal: ['cac', 'picocolors'],
    banner: { js: '#!/usr/bin/env node' },
  },
]);
