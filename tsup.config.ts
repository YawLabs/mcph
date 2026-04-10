import { readFileSync } from 'fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  define: { '__VERSION__': JSON.stringify(version) },
});
