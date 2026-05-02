import { defineConfig } from 'vite';

function routeToViteIndex() {
  const rewrite = (req, _res, next) => {
    const raw = String(req.url || '');
    const qIdx = raw.indexOf('?');
    const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
    const query = qIdx === -1 ? '' : raw.slice(qIdx);
    // Preserve the query string when rewriting — the splash page reads
    // `?bg=1` to switch into iframe-background mode, and stripping it
    // (which split('?')[0] used to do) breaks the live scene that the
    // home / leaderboard / about pages embed behind their glass cards.
    if (path === '/' || path === '/home' || path === '/home/' || path === '/home.html') {
      req.url = '/home.html' + query;
    } else if (path === '/index.html') {
      req.url = '/home.html' + query;
    } else if (path === '/play' || path === '/play/') {
      req.url = '/vite-index.html' + query;
    } else if (path === '/leaderboard' || path === '/leaderboard/') {
      req.url = '/leaderboard.html' + query;
    } else if (path === '/about' || path === '/about/') {
      req.url = '/about.html' + query;
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
        home: 'home.html',
        admin: 'admin.html',
        leaderboard: 'leaderboard.html',
        about: 'about.html',
        settings: 'settings.html',
        old: 'index.html'
      },
      output: {
        // Use rolldown's advancedChunks (declarative groups). manualChunks
        // existed but rolldown's auto-splitter was overriding our hints,
        // dragging three-core into the largest consumer. Groups + priority
        // gives us a reliable vendor split.
        advancedChunks: {
          groups: [
            { name: 'vendor-three',   test: /[\\/]node_modules[\\/]three[\\/]/, priority: 10 },
            { name: 'vendor-fonts',   test: /[\\/]node_modules[\\/]@fontsource/, priority: 10 },
            { name: 'leaderboard',    test: /[\\/]src[\\/]modules[\\/]leaderboard\.js$/, priority: 5 },
            { name: 'room',           test: /[\\/]src[\\/]modules[\\/]room\.js$/, priority: 5 },
            { name: 'purifier',       test: /[\\/]src[\\/]modules[\\/]purifier\.js$/, priority: 5 },
            { name: 'game-fp',        test: /[\\/]src[\\/]modules[\\/]game-fp\.js$/, priority: 5 },
            { name: 'cat-animation',  test: /[\\/]src[\\/]modules[\\/]cat-animation\.js$/, priority: 5 },
            { name: 'inspector-mode', test: /[\\/]src[\\/]modules[\\/](inspector-mode|particles|wall-fade)\.js$/, priority: 5 }
          ]
        }
      }
    }
  },
  server: {
    port: 3000,
    open: '/',
    proxy: {
      '/api': {
        target: 'https://diy-air-purifier-leaderboard.essays-loges0y.workers.dev',
        changeOrigin: true
      }
    }
  }
});
