import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Use '/ptouch-webapp/' as the base path when deployed to GitHub Pages
  // (https://the78mole.github.io/ptouch-webapp/).
  // In development (npm run dev) Vite serves from '/' automatically.
  base: '/ptouch-webapp/',
  plugins: [tailwindcss()],
  build: {
    target: 'es2022',
  },
});
