import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    port: 3000,
    strictPort: true,
    hmr: false,
    // No changeOrigin on purpose: the backend compares the browser's Origin with the Host header (CSRF
    // defence), so the proxy must pass the original Host (localhost:3000) through unchanged.
    proxy: {
      '/api': {
        target: 'http://localhost:5000'
      },
      '/uploads': {
        target: 'http://localhost:5000'
      },
      '/exports': {
        target: 'http://localhost:5000'
      }
    }
  }
});
