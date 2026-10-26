import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relativa: funciona igual en localhost y en GitHub Pages (https://usuario.github.io/repo/)
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true, port: 5180 },
  preview: { host: true, port: 5180 },
})
