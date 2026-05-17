import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
])

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: 'out/cli',
    lib: {
      entry: resolve('electron/cli/scan.ts'),
      formats: ['es'],
      fileName: () => 'scan.js',
    },
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id),
      output: {
        entryFileNames: 'scan.js',
      },
    },
    target: 'node22',
  },
})
