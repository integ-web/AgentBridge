import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Set base path for GitHub Pages
  base: '/agentbridge/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});
