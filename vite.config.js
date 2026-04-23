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
    // Target modern browsers so esbuild's CSS minifier keeps the standard
    // `backdrop-filter` property. With the default target (which includes
    // Safari 14), esbuild collapses `backdrop-filter` + `-webkit-backdrop-filter`
    // pairs down to only the `-webkit-` prefixed version, which Firefox
    // doesn't recognize — breaking the frosted-glass look on FF and Edge.
    cssTarget: ['chrome100', 'firefox100', 'edge100', 'safari18'],
    // Rolldown's CSS minifier aggressively collapses duplicate properties even
    // with a modern cssTarget, dropping the unprefixed `backdrop-filter` and
    // leaving only `-webkit-backdrop-filter` (which Firefox ignores). Disable
    // CSS minification to preserve both declarations; the CSS bundle is tiny
    // (~36KB uncompressed, <6KB gzipped) so the size cost is negligible.
    cssMinify: false,
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
