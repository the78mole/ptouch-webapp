import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Restrict Vite's file watching to src/ only — avoids inotify exhaustion
  // from watching node_modules/ and other large directories at the project root.
  root: "src",

  // Use '/ptouch-webapp/' as the base path when deployed to GitHub Pages
  // (https://the78mole.github.io/ptouch-webapp/).
  // In development (npm run dev) Vite serves from '/' automatically.
  base: "/ptouch-webapp/",
  plugins: [tailwindcss()],
  build: {
    target: "es2022",
    // Output relative to project root, not src/
    outDir: "../dist",
    emptyOutDir: true,
  },
});
