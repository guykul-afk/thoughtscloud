import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standard Vite config for Firebase-only operations
export default defineConfig({
  plugins: [react()],
})
