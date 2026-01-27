import { defineConfig } from 'vite'

export default defineConfig({
  base: '/copilot-coding-agent-activity-dashboard/',
  root: '.',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    minify: 'esbuild',
    cssMinify: true,
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  },
  server: {
    port: 8080,
    open: true
  },
  preview: {
    port: 8080
  }
})
