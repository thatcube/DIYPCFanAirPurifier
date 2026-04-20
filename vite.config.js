import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    // Keep asset filenames predictable for Netlify
    rollupOptions: {
      input: {
        main: 'index.html',
        admin: 'admin.html',
        leaderboard: 'leaderboard/index.html'
      }
    }
  },
  server: {
    port: 3000,
    // Proxy API calls to the express server during dev
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
});
