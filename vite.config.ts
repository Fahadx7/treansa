import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
    // GEMINI_API_KEY is NOT exposed to the frontend (stays server-side only)
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        // Local dev: /api/* → Express on port 3000
        '/api': 'http://localhost:3000',
      },
    },
  };
});
