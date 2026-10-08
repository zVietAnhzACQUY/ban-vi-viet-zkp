import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../generated/client/index.js";
dotenv.config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});
export const db = new PrismaClient();
