import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The built app is served by the FastAPI backend (backend/app/main.py), which also answers /api and /tiles.
// In development `npm run dev` proxies those paths to the backend on port 4173.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4173", "/tiles": "http://127.0.0.1:4173" },
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 6000,
    rolldownOptions: { output: { inlineDynamicImports: true } },
  },
});
