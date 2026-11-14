import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

// Stamped at build time, so the sidebar proves which build is actually live
const BUILT = new Date().toISOString()
const VERSION = (readFileSync(new URL('./src/version.js', import.meta.url), 'utf8').match(/VERSION = '([^']+)'/) || [])[1] || ''

export default defineConfig({
  plugins: [
    react(),
    // /version.json: how a portal left open on a phone finds out there's a newer release (src/lib/updates.js)
    { name: 'version-file', apply: 'build', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION, built: BUILT }) }) } },
  ],
  define: { __BUILD_TIME__: JSON.stringify(BUILT) },
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
