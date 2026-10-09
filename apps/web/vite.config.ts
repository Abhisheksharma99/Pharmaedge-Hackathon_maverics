import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Not the default "assets/": that path is the app's Asset Search route.
    assetsDir: 'static',
  },
  server: {
    // Same-origin in dev too, so the httpOnly SameSite=Strict cookies just work.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
