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
        leaderboard: 'leaderboard.html'
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
