import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.BACKEND_PORT || '8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['calendar.bhenning.com', 'calendar.brianhenning.com'],
    proxy: {
      '/api': `http://localhost:${backendPort}`
    }
  }
})
