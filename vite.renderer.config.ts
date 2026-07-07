import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'

const isStandalone = process.env.STANDALONE_BUILD === '1'
const fileEnv = loadEnv(process.env.NODE_ENV || 'development', __dirname, '')
const env = (name: string): string => process.env[name] || fileEnv[name] || ''
// The Intercom App ID is public — it ships in the widget URL for every Intercom
// customer — so a checked-in default is safe. Secrets never enter this config.
const intercomAppId = JSON.stringify(env('INTERCOM_APP_ID') || 'y4l8ype0')

export default defineConfig({
  // index.html lives in src/renderer/, not the project root
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [tailwindcss()],
  define: {
    __INTERCOM_APP_ID__: intercomAppId,
  },
  resolve: {
    alias: {
      // Use path.resolve so this works regardless of cwd at build time
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@daylens/remote-contract': path.resolve(__dirname, 'packages/remote-contract/index.ts'),
    },
  },
  build: {
    ...(isStandalone && {
      outDir: path.resolve(__dirname, 'dist/renderer/main_window'),
      emptyOutDir: true,
    }),
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':  ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
