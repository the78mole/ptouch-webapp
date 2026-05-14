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

  // Inject app version and build date at compile time.
  // Values come from env vars set by CI; local dev falls back to sensible defaults.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION ?? "vX.DEV"),
    __APP_BUILD_DATE__: JSON.stringify(
      process.env.VITE_APP_BUILD_DATE ??
        new Date().toISOString().slice(0, 16).replace("T", " "),
    ),
  },
});
