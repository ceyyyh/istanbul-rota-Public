import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` → dist/ (çok dosyalı, GitHub Pages vb. için)
// `npm run build:single` → dist-single/index.html (tek dosya, her şey gömülü)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
  server: { host: '127.0.0.1' },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
}));
