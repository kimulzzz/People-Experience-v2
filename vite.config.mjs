import { defineConfig, loadEnv } from 'vite';
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

// v2.60.2: default ports in one place. The browser (and a tunnel such as ngrok) only ever talks to the frontend
// port; the backend port stays internal and is reached through the proxy below. FRONTEND_PORT / PORT can be set in
// .env; PORT is the same variable the backend reads (server/server.js), so the proxy always follows the backend.
const DEFAULT_FRONTEND_PORT = 3000;
const DEFAULT_BACKEND_PORT = 5000;
// Host names a tunnel gives out (ngrok free and paid domains); extra ones (e.g. a fixed custom domain) via
// ALLOWED_HOSTS=host1,.domain2 in .env. Vite refuses any other host name ("Blocked request").
const TUNNEL_HOSTS = ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'];

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const frontendPort = parseInt(env.FRONTEND_PORT || String(DEFAULT_FRONTEND_PORT), 10);
  const backendPort = parseInt(env.PORT || String(DEFAULT_BACKEND_PORT), 10);
  if (frontendPort === backendPort) {
    throw new Error(`Frontend and backend cannot share port ${frontendPort}: set PORT (backend) and FRONTEND_PORT to different values.`);
  }
  const backend = `http://localhost:${backendPort}`;
  const allowedHosts = [...TUNNEL_HOSTS, ...String(env.ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean)];
  // No changeOrigin on purpose: the backend compares the browser's Origin with the Host header (CSRF
  // defence), so the proxy must pass the original Host (localhost:3000, or the ngrok host name) through unchanged.
  const proxy = {
    '/api': { target: backend },
    '/uploads': { target: backend },
    '/exports': { target: backend }
  };
  return {
    plugins: [
      react(),
      tailwindcss(),
      longUploads
    ],
    server: {
      host: '0.0.0.0',
      port: frontendPort,
      strictPort: true,
      hmr: false,
      allowedHosts,
      proxy
    },
    preview: {
      host: '0.0.0.0',
      port: frontendPort,
      strictPort: true,
      allowedHosts,
      proxy
    }
  };
});
