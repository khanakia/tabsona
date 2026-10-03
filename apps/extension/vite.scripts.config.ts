import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Build 2 of 2: ONE content script, as a self-contained IIFE.
//
// WHY ONE AT A TIME: the IIFE format has no module scope to share, so rollup refuses
// multiple inputs in a single IIFE build. The package script therefore runs this
// config once per entry, selected by CONTENT_ENTRY.
//
// WHY IIFE AT ALL: a content script is injected as a classic script and cannot be an
// ES module. The storage shim in particular runs in the page's MAIN world at
// document_start, before any app code, so it must be one file with no imports left
// to resolve at runtime.
const ENTRY = process.env.CONTENT_ENTRY;
if (!ENTRY) throw new Error('CONTENT_ENTRY must name a content script entry (shim | badge)');

export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: false, // build 1 and the sibling entry already wrote here
    target: 'chrome120',
    rollupOptions: {
      input: resolve(import.meta.dirname, `src/content/${ENTRY}.ts`),
      output: { entryFileNames: `${ENTRY}.js`, format: 'iife' },
      preserveEntrySignatures: false,
    },
  },
});
