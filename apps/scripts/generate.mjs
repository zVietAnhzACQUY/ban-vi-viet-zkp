import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The schema lives outside the npm workspace. Disable Prisma's auto-install
// heuristic so it cannot modify the frozen G1 root manifest or lockfile.
const cwd = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    "node_modules/prisma/build/index.js",
    "generate",
    "--schema",
    "../prisma/schema.prisma",
  ],
  {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, PRISMA_GENERATE_SKIP_AUTOINSTALL: "1" },
  },
);
process.exit(result.status ?? 1);
