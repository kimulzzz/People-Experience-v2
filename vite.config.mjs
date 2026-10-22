import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// v2.59.0: Node's http server cuts off a request that takes longer than 5 minutes to arrive (requestTimeout). A large
// event video (up to the Admin's upload limit, 1 GB by default) uploaded through this proxy can take longer, so the dev
// and preview servers get the same 120-minute limit as the backend (REQUEST_TIMEOUT_MS). The proxy itself has no size cap.
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || String(120 * 60 * 1000), 10);
const longUploads = {
  name: 'px-long-uploads',
  configureServer(server) { if (server.httpServer) server.httpServer.requestTimeout = REQUEST_TIMEOUT_MS; },
  configurePreviewServer(server) { if (server.httpServer) server.httpServer.requestTimeout = REQUEST_TIMEOUT_MS; }
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    longUploads
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
