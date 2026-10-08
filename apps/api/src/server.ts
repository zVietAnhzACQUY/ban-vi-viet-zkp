import { db } from "./db.js";
import { createApp } from "./app.js";
const app = await createApp(db);
await app.listen({
  port: Number(process.env.API_PORT || 3001),
  host: "127.0.0.1",
});
console.log(
  "Bản Vị Việt API: http://127.0.0.1:" + (process.env.API_PORT || 3001),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
