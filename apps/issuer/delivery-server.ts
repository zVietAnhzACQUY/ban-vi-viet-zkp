import { db } from "../api/src/db.js";
import { createDeliveryApp } from "./delivery-service.js";
import { deliveryKey } from "./delivery-crypto.js";
import { evidenceStorage } from "./evidence-storage.js";

if (process.env.NODE_ENV === "production" && !process.env.ISSUER_PORTAL_ORIGIN)
  throw new Error("ISSUER_PORTAL_ORIGIN is required in production.");
if (process.env.NODE_ENV === "production" && !process.env.WEBSITE_ORIGIN)
  throw new Error("WEBSITE_ORIGIN is required in production.");

const app = await createDeliveryApp(db, {
  encryptionKey: deliveryKey(),
  portalOrigin: process.env.ISSUER_PORTAL_ORIGIN,
  walletOrigin: process.env.WALLET_ORIGIN,
  websiteOrigin: process.env.WEBSITE_ORIGIN,
  evidenceStorage: evidenceStorage(),
});
const port = Number(process.env.ISSUER_DELIVERY_PORT || 3002);
await app.listen({ port, host: "127.0.0.1" });
console.log(`Issuer Delivery: http://127.0.0.1:${port}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
