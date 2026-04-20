import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'vite-index.html',
        admin: 'admin.html',
        leaderboard: 'leaderboard/index.html'
      }
    }
  },
  server: {
    port: 3000,
    open: '/vite-index.html',
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
});
