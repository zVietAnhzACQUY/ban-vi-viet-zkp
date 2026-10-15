import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { PrismaClient } from "../generated/client/index.js";
import { createApp } from "../src/app.js";

// No db.ts, dotenv or PostgreSQL: only generated fictional users and memory sessions.
test("pilot login IP limits and generic authentication failures", async t => {
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const users = ["CUSTOMER", "ADMIN", "ISSUER_OPERATOR"].map(role => ({
    id: randomUUID(), email: `${role.toLowerCase()}@fixture.invalid`, name: "Fictional auth fixture", role, passwordHash,
  }));
  const sessions = new Map<string, unknown>();
  const db = {
    user: { findUnique: async ({ where }: any) => users.find(user => user.email === where.email) ?? null },
    session: {
      create: async ({ data }: any) => { sessions.set(data.id, data); return data; },
      deleteMany: async ({ where }: any) => { sessions.delete(where.id); return { count: 1 }; },
      findUnique: async () => null,
    },
  } as unknown as PrismaClient;
  const app = await createApp(db);
  t.after(() => app.close());
  const web = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "http://127.0.0.1:5173";
  const portal = process.env.ISSUER_PORTAL_ORIGIN || "http://127.0.0.1:5175";
  async function login(issuer: boolean, email: string, secret: string, ip: string, forwarded?: string) {
    const prefix = issuer ? "/api/issuer/auth" : "/api/auth";
    const origin = issuer ? portal : web;
    const csrf = await app.inject({ url: issuer ? prefix + "/csrf" : "/api/csrf", remoteAddress: ip, headers: { origin } });
    const cookie = csrf.cookies.map(item => `${item.name}=${item.value}`).join("; ");
    return app.inject({ method: "POST", url: prefix + "/login", remoteAddress: ip,
      headers: { origin, cookie, "x-csrf-token": csrf.json().token, ...(forwarded ? { "x-forwarded-for": forwarded } : {}) },
      payload: { email, password: secret },
    });
  }
  await t.test("CUSTOMER Website and operator Issuer succeed without hash disclosure", async () => {
    for (const [index, issuer, ip] of [[0, false, "192.0.2.1"], [2, true, "192.0.2.2"]] as const) {
      const response = await login(issuer, users[index].email, password, ip);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(Object.keys(response.json().user).sort(), ["email", "id", "name", "role"]);
      assert.equal(response.body.includes(password), false);
      assert.equal(response.body.includes(passwordHash), false);
    }
  });
  await t.test("missing email, wrong password and disallowed roles have generic responses", async () => {
    for (const issuer of [false, true]) {
      const ip = issuer ? "192.0.2.4" : "192.0.2.3";
      const missing = await login(issuer, "missing@fixture.invalid", password, ip);
      const wrong = await login(issuer, users[issuer ? 2 : 0].email, "wrong-fixture-password", ip);
      assert.equal(missing.statusCode, 401);
      assert.equal(wrong.statusCode, 401);
      assert.deepEqual(missing.json(), wrong.json());
      assert.equal(wrong.json().code, "INVALID_LOGIN");
      for (const index of issuer ? [0, 1] : [2]) {
        const denied = await login(issuer, users[index].email, password, ip);
        assert.equal(denied.statusCode, 401);
        assert.deepEqual(denied.json(), missing.json());
      }
    }
  });
  await t.test("both login routes allow 15 attempts, reject 16 with Retry-After; spoofed XFF cannot bypass", async () => {
    for (const issuer of [false, true]) {
      const ip = issuer ? "192.0.2.6" : "192.0.2.5";
      for (let attempt = 1; attempt <= 15; attempt++) {
        const response = await login(issuer, "missing@fixture.invalid", password, ip, `198.51.100.${attempt}`);
        assert.equal(response.statusCode, 401);
      }
      const blocked = await login(issuer, users[issuer ? 2 : 0].email, password, ip, "203.0.113.100");
      assert.equal(blocked.statusCode, 429);
      assert.ok(Number(blocked.headers["retry-after"]) > 0);
      const unknown = await login(issuer, "missing@fixture.invalid", password, ip, "203.0.113.101");
      assert.equal(unknown.statusCode, 429);
      assert.deepEqual(blocked.json(), unknown.json());
      const differentIp = await login(issuer, users[issuer ? 2 : 0].email, password, issuer ? "192.0.2.8" : "192.0.2.7");
      assert.equal(differentIp.statusCode, 200);
    }
  });
});
