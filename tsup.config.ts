import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // 3 Farklı Format: cjs (Node/Older React), esm (Modern Web), iife (Vanilla HTML/CDN)
  format: ['cjs', 'esm', 'iife'], 
  globalName: 'UniHub', // HTML Script etiketinde 'window.UniHub' olabilmesi için
  dts: true,
  clean: true,
  minify: true, // CDN ve Prod ortamı için kod sıkıştırma
  sourcemap: true,
  outExtension({ format }) {
    if (format === 'iife') return { js: '.global.js' }
    if (format === 'cjs') return { js: '.js' }
    return { js: '.mjs' }
  }
});
