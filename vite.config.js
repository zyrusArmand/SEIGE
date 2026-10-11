import { defineConfig } from 'vite';

// The Blender script writes models to assets/models; serve that folder as static files.
export default defineConfig({
  base: './',
  publicDir: 'assets/models',
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
});
