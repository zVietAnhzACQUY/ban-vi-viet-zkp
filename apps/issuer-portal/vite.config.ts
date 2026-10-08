import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { configuredWebsiteOrigin } from "./src/navigation";

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL("../", import.meta.url));
  const env = loadEnv(mode, envDir, "");
  const websiteOrigin = configuredWebsiteOrigin(process.env.WEBSITE_ORIGIN || env.WEBSITE_ORIGIN, mode === "production");
  return {
    envDir,
    plugins: [react()],
    define: { "import.meta.env.VITE_WEBSITE_ORIGIN": JSON.stringify(websiteOrigin) },
    server: { port: Number(env.ISSUER_PORTAL_PORT || 5175), strictPort: true },
    build: { outDir: "dist" },
  };
});
