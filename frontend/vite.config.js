import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendPort = process.env.BACKEND_PORT || '8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    allowedHosts: ['calendar.bhenning.com', 'calendar.brianhenning.com'],
    proxy: {
      '/api': `http://localhost:${backendPort}`
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
