/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
      // @educore/shared se consume desde su código fuente (sin compilar) en la web.
      conditions: ['educore-source', ...defaultClientConditions],
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      // En desarrollo la web y la API comparten origen a través del proxy, igual
      // que en producción detrás del proxy inverso (cookies SameSite=Strict).
      proxy: {
        '/api': { target: env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000', changeOrigin: false },
      },
    },
    build: {
      sourcemap: false,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
