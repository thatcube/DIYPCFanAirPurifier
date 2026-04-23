import { defineConfig } from 'vite';

function routeToViteIndex() {
  const rewrite = (req, _res, next) => {
    const url = String(req.url || '').split('?')[0];
    if (url === '/' || url === '/index.html' || url === '/play' || url === '/play/') {
      req.url = '/vite-index.html';
    }
    next();
  };

  return {
    name: 'route-to-vite-index',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    }
  };
}

export default defineConfig({
  root: '.',
  plugins: [routeToViteIndex()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'vite-index.html',
        admin: 'admin.html',
        leaderboard: 'leaderboard.html',
        old: 'index.html'
      }
    }
  },
  server: {
    port: 3000,
    open: '/vite-index.html',
    proxy: {
      '/api': {
        target: 'https://diy-air-purifier-leaderboard.essays-loges0y.workers.dev',
        changeOrigin: true
      }
    }
  }
});
