import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Stamped at build time, so the sidebar proves which build is actually live
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than the portal does. Keeping them in
        // their own files means a new release only re-downloads our own code.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          if (id.includes('node_modules/@supabase/')) return 'supabase'
        },
      },
    },
  },
})
