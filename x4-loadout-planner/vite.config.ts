import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built app works on GitHub Pages subpaths and file hosting alike
export default defineConfig({
  plugins: [react()],
  base: './',
});
