import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Permite que o ngrok acesse o servidor local
    allowedHosts: [
      "foam-sensitive-goldmine.ngrok-free.dev",
      ".ngrok-free.app",
      ".ngrok-free.dev",
    ],
    // Garante que o servidor aceite conexões externas
    host: true,
    strictPort: true,
  },
});
