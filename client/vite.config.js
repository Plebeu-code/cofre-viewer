import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// App 100% estatica (sem backend). base relativo para funcionar em qualquer
// host/subpasta (GitHub Pages, Netlify, S3, abertura via file:// servida).
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: { port: 5173 },
})
