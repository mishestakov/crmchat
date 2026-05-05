import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  envDir: "../../",
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:3000",
      "/openapi.json": "http://localhost:3000",
    },
  },
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@tanstack/react-router") || id.includes("@tanstack/react-query")) {
            return "tanstack";
          }
          if (id.includes("/motion/")) {
            return "motion";
          }
        },
      },
    },
  },
});
