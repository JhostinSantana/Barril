import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/Barril/",
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:4000',
      '/health': 'http://localhost:4000'
    }
  }
})
