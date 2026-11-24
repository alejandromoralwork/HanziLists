import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/hanzi/',
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/hanzi/api': 'http://127.0.0.1:4620' } },
  preview: { proxy: { '/hanzi/api': 'http://127.0.0.1:4620' } },
  test: { environment: 'node' },
} as any)
