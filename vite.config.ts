import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // GEMINI_API_KEY is NOT exposed to the frontend (stays server-side only)
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        // In local dev, forward /.netlify/functions/api/* to Express on port 3000
        '/.netlify/functions/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace('/.netlify/functions/api', '/api'),
        },
      },
    },
  };
});
