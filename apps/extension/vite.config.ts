import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

/** Chrome loads `dist/`, so the manifest and icons have to land there. Copying them
 *  in the build (rather than keeping second copies under dist/) keeps one source of
 *  truth — a hand-maintained duplicate manifest is the classic way these drift. */
function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    writeBundle() {
      const root = import.meta.dirname;
      copyFileSync(resolve(root, 'manifest.json'), resolve(root, 'dist/manifest.json'));
      const iconsOut = resolve(root, 'dist/icons');
      mkdirSync(iconsOut, { recursive: true });
      for (const file of readdirSync(resolve(root, 'icons'))) {
        copyFileSync(resolve(root, 'icons', file), resolve(iconsOut, file));
      }
    },
  } as const;
}

// Build 1 of 2: the popup (an HTML entry) and the background service worker
// (an ES module, which MV3 requires when manifest declares type: "module").
// Content scripts cannot be ES modules, so they get their own IIFE build in
// vite.scripts.config.ts.
export default defineConfig({
  plugins: [react(), tailwindcss(), copyStaticAssets()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    // A service worker cannot use <link rel="modulepreload">, and vite's preload helper
    // references `window`. Including it is how a dynamic import in the worker turned
    // into "ReferenceError: window is not defined" at boot.
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'src/surfaces/popup/index.html'),
        options: resolve(import.meta.dirname, 'src/surfaces/options/index.html'),
        gate: resolve(import.meta.dirname, 'src/surfaces/gate/index.html'),
        background: resolve(import.meta.dirname, 'src/engine/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        format: 'es',
      },
    },
  },
});
