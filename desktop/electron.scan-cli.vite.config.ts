import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
])

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'out/cli',
    lib: {
      entry: resolve('electron/cli/scan.ts'),
      formats: ['es'],
      fileName: () => 'agents-manager.js',
    },
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id),
      output: {
        banner: '#!/usr/bin/env node',
        entryFileNames: 'agents-manager.js',
      },
    },
    target: 'node22',
  },
})
