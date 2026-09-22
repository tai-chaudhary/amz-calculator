import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Stamped at build time, so the sidebar proves which build is actually live
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
})
