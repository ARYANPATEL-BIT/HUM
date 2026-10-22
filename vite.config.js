import { defineConfig } from 'vite';

// Relative base works on GitHub Pages under any repo path (user.github.io/<repo>/).
// Override with VITE_BASE=/hum/ if absolute URLs are ever needed.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  build: {
    // three.js alone is ~520 kB minified (~130 kB gzipped) and the game is one bundle (~810 kB); expected.
    chunkSizeWarningLimit: 900,
  },
});
