import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves the app from /<repo>/ — the deploy workflow sets BASE_PATH=/screenshotframe/.
// Local dev and Vercel/Netlify leave it unset and serve from /.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
