import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  clearScreen: false,
  // Excluir src-tauri del watch: cargo escribe ahí (target/*.dll) y el watcher
  // de Vite choca con EBUSY en Windows al observar los artefactos de compilación.
  server: { port: 5173, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], globals: true },
});
