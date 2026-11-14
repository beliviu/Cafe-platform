import { fileURLToPath } from 'node:url'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Design system bersama ada di ../shared/ui (dipakai juga oleh platform-admin).
const shared = fileURLToPath(new URL('../shared/ui', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      { find: '@dailybrew/ui/styles.css', replacement: `${shared}/styles.css` },
      { find: '@dailybrew/ui', replacement: `${shared}/index.js` },
    ],
    // File di shared/ui berada di luar folder aplikasi: paket ini harus diambil dari node_modules aplikasi.
    dedupe: ['react', 'react-dom', 'react-router-dom', 'lucide-react'],
  },
  server: { fs: { allow: ['..'] } },
})
