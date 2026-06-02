import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Desktop-local app. Dev server proxies the JSON API and the static data
// route to the FastAPI backend so the SPA and the backend share an origin.
// The production build emits to `dist/`, which the backend serves at `/`.
const BACKEND = 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/data': { target: BACKEND, changeOrigin: true },
    },
  },
});
