import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL("../", import.meta.url));
  const env = loadEnv(mode, envDir, "");
  return {
    envDir,
    plugins: [react()],
    resolve: {
      alias: {
        circomlibjs: fileURLToPath(
          new URL("./src/poseidon-browser.ts", import.meta.url),
        ),
      },
    },
    server: {
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
      proxy: { "/api": env.API_ORIGIN || "http://127.0.0.1:3001" },
    },
    build: { outDir: "dist" },
  };
});
