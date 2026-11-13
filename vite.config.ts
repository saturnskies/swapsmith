/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

/** Lists every built file in dist/precache.json, which public/sw.js saves at install so the app opens offline (ADR-002). */
const precacheList = (): Plugin => ({
  name: 'swapsmith-precache-list',
  apply: 'build',
  generateBundle(_, bundle) {
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(Object.keys(bundle).filter((f) => f.startsWith('assets/'))) });
  },
});

export default defineConfig({
  // Served from https://saturnskies.github.io/swapsmith/ (see ADR-001).
  base: '/swapsmith/',
  plugins: [precacheList()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
