import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' keeps every asset path relative, so the same build works on
// GitHub Pages (https://<user>.github.io/<repo>/), Netlify, Vercel or a local folder.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory')) return 'charts'
          if (id.includes('node_modules/react')) return 'react'
        },
      },
    },
  },
  test: { environment: 'node' },
} as never)
