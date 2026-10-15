import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { db } from "../src/db.js";
import { createApp } from "../src/app.js";
import { cartView, checkout, hash } from "../src/commerce.js";
import {
  claimAgeCredentialIssuance,
  finalizeAgeCredentialIssuance,
} from "../../issuer/issue-age.js";
if (process.env.G2_TEST !== "1" || !/^g2_test(?:_[a-z0-9_]+)?$/.test(
  new URL(process.env.DATABASE_URL!).searchParams.get("schema") || "",
))
  throw new Error("Refuse tests against non-test database");
const app = await createApp(db),
  run = randomUUID().slice(0, 8);
const category = await db.category.create({
  data: { name: "Test " + run, slug: "test-" + run },
});
const passwordHash = await argon2.hash("Integration@2026", {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});
async function client(admin = false, issuer = false) {
  const token = randomBytes(32).toString("hex");
  const u = await db.user.create({
    data: {
      email: randomUUID() + "@test.invalid",
      name: "Test",
      passwordHash,
      role: issuer ? "ISSUER_OPERATOR" : admin ? "ADMIN" : "CUSTOMER",
      cart: { create: {} },
      addresses: {
        create: {
          name: "Test",
          phone: "0900000000",
          line: "12 Test street",
          city: "Test city",
        },
      },
      sessions: {
        create: { id: hash((issuer?"issuer:":"")+token), expiresAt: new Date(Date.now() + 3600000) },
      },
    },
    include: { addresses: true },
  });
  const csrf = await app.inject({ url: issuer?"/api/issuer/auth/csrf":"/api/csrf",headers:{origin:"http://127.0.0.1:5175"} });
  const jar = (issuer?"issuer_session=":"bvv_session=") + token + (issuer?"; issuer_csrf=":"; bvv_csrf=") + csrf.json().token;
  return {
    user: u,
    address: u.addresses[0],
    jar,
    csrf: csrf.json().token,
    request: (method: any, url: string, payload?: any) =>
      app.inject({
        method,
        url: "/api" + url,
        payload,
        headers: {
          cookie: jar,
          origin: issuer?"http://127.0.0.1:5175":"http://127.0.0.1:5173",
          "x-csrf-token": csrf.json().token,
        },
      }),
  };
}
async function product(stock = 5, age = false) {
  return db.product.create({
    data: {
      slug: randomUUID(),
      name: "Test product",
      subtitle: "Test",
      description: "Test",
      price: 125000n,
      stock,
      weight: "250 g",
      origin: "Demo",
      art: "coffee",
      tone: "#345634",
      categoryId: category.id,
      requiresAgeProof: age,
      minimumAge: age ? 18 : 0,
    },
  });
}
async function add(
  c: Awaited<ReturnType<typeof client>>,
  p: { id: string },
  quantity = 1,
) {
  const r = await c.request("POST", "/cart/items", {
    productId: p.id,
    quantity,
  });
  assert.equal(r.statusCode, 200, r.body);
}
async function orderInput(c: Awaited<ReturnType<typeof client>>) {
  return {
    addressId: c.address.id,
    idempotencyKey: randomUUID(),
    quote: (await c.request("GET", "/cart")).json().quote,
  };
}
try {
  await test("G2 PostgreSQL integration", async (t) => {
    await t.test(
      "COD uses server price, snapshots address, clears cart and records stock movement",
      async () => {
        const c = await client(),
          p = await product();
        await add(c, p, 2);
        const challengeCount = await db.ageChallenge.count({
          where: { userId: c.user.id },
        });
        const challenge = await c.request("POST", "/age/challenges", {});
        assert.equal(challenge.json().code, "AGE_NOT_REQUIRED");
        assert.equal(
          await db.ageChallenge.count({ where: { userId: c.user.id } }),
          challengeCount,
        );
        const input = await orderInput(c),
          r = await c.request("POST", "/orders", input);
        assert.equal(r.statusCode, 200, r.body);
        const o = r.json();
        assert.equal(o.total, "250000");
        assert.equal(o.items[0].unitPrice, "125000");
        assert.equal(o.status, "PENDING");
        assert.equal(
          (await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock,
          3,
        );
        assert.equal((await c.request("GET", "/cart")).json().items.length, 0);
        await c.request("PATCH", "/me/addresses/" + c.address.id, {
          name: "Changed",
          phone: "0900000000",
          line: "99 Other street",
          city: "Test",
        });
        assert.equal(
          (await c.request("GET", "/me/orders/" + o.id)).json().address.name,
          "Test",
        );
        assert.equal(
          await db.inventoryMovement.count({
            where: { orderId: o.id, reason: "ORDER" },
          }),
          1,
        );
      },
    );
    await t.test(
      "eight buyers for final unit: one order, seven conflicts, never negative",
      async () => {
        const p = await product(1),
          clients = await Promise.all(
            Array.from({ length: 8 }, () => client()),
          );
        for (const c of clients) await add(c, p);
        const inputs = await Promise.all(clients.map(orderInput));
        const results = await Promise.all(
          clients.map((c, i) => c.request("POST", "/orders", inputs[i])),
        );
        assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
        assert.equal(results.filter((r) => r.statusCode === 409).length, 7);
        assert.equal(
          (await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock,
          0,
        );
        assert.equal(
          await db.orderItem.count({ where: { productId: p.id } }),
          1,
        );
      },
    );
    await t.test(
      "concurrent idempotent retries return same order; modified reuse rejected",
      async () => {
        const c = await client(),
          p = await product(5);
        await add(c, p);
        const input = await orderInput(c);
        const results = await Promise.all(
          Array.from({ length: 6 }, () => c.request("POST", "/orders", input)),
        );
        assert(results.every((r) => r.statusCode === 200));
        assert.equal(new Set(results.map((r) => r.json().id)).size, 1);
        assert.equal(
          (await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock,
          4,
        );
        assert.equal(
          (
            await c.request("POST", "/orders", {
              ...input,
              quote: "a".repeat(64),
            })
          ).statusCode,
          409,
        );
      },
    );
    await t.test(
      "fault after stock update rolls back stock, order and cart",
      async () => {
        const c = await client(),
          p = await product();
        await add(c, p);
        const input = await orderInput(c);
        await assert.rejects(
          () =>
            checkout(db, c.user.id, input, () => {
              throw new Error("TEST_FAULT");
            }),
          /TEST_FAULT/,
        );
        assert.equal(
          (await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock,
          5,
        );
        assert.equal(await db.order.count({ where: { userId: c.user.id } }), 0);
        assert.equal((await cartView(db, c.user.id)).items.length, 1);
      },
    );
    await t.test(
      "changed server price rejects stale quote; fresh quote uses updated price",
      async () => {
        const c = await client(),
          p = await product();
        await add(c, p);
        const old = await orderInput(c);
        await db.product.update({
          where: { id: p.id },
          data: { price: 150000n },
        });
        assert.equal(
          (await c.request("POST", "/orders", old)).json().code,
          "CART_CHANGED",
        );
        const r = await c.request("POST", "/orders", await orderInput(c));
        assert.equal(r.json().total, "150000");
      },
    );
    await t.test(
      "client cannot inject price, total, proof or claims to bypass age",
      async () => {
        const c = await client(),
          p = await product(5, true);
        await add(c, p);
        const input = await orderInput(c);
        assert.equal(
          (
            await c.request("POST", "/orders", {
              ...input,
              total: "1",
              ageVerified: true,
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (await c.request("POST", "/orders", input)).json().code,
          "AGE_PROOF_REQUIRED",
        );
        assert.equal(
          (await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock,
          5,
        );
      },
    );
    await t.test("double cancellation restores stock only once", async () => {
      const c = await client(),
        p = await product();
      await add(c, p, 2);
      const o = (
        await c.request("POST", "/orders", await orderInput(c))
      ).json();
      const results = await Promise.all([
        c.request("POST", "/me/orders/" + o.id + "/cancel", {}),
        c.request("POST", "/me/orders/" + o.id + "/cancel", {}),
      ]);
      assert(results.every((r) => r.statusCode === 200));
      assert.equal(
        (await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock,
        5,
      );
      assert.equal(
        await db.inventoryMovement.count({
          where: { orderId: o.id, reason: "CANCEL" },
        }),
        1,
      );
    });
    await t.test("ownership and admin permissions enforced", async () => {
      const a = await client(),
        b = await client(),
        p = await product();
      await add(a, p);
      assert.equal(
        (
          await b.request("PATCH", "/me/addresses/" + a.address.id, {
            name: "Bad",
            phone: "0900000000",
            line: "Fake street",
            city: "City",
          })
        ).statusCode,
        404,
      );
      const input = await orderInput(a);
      assert.equal(
        (
          await a.request("POST", "/orders", {
            ...input,
            addressId: b.address.id,
          })
        ).statusCode,
        404,
      );
      const o = (await a.request("POST", "/orders", input)).json();
      assert.equal(
        (await b.request("GET", "/me/orders/" + o.id)).statusCode,
        404,
      );
      assert.equal(
        (await b.request("POST", "/me/orders/" + o.id + "/cancel", {}))
          .statusCode,
        404,
      );
      assert.equal((await a.request("GET", "/admin/products")).statusCode, 403);
      const admin = await client(true);
      const users = await admin.request("GET", "/admin/users");
      assert.equal(users.statusCode, 200, users.body);
      assert(users.json().some((row: any) => row.id === a.user.id));
      assert(!users.body.includes("passwordHash"));
    });
    await t.test(
      "admin transitions enforce order and collect COD only on completion",
      async () => {
        const c = await client(),
          admin = await client(true),
          p = await product();
        await add(c, p);
        const o = (
          await c.request("POST", "/orders", await orderInput(c))
        ).json();
        assert.equal(
          (
            await admin.request("PATCH", "/admin/orders/" + o.id + "/status", {
              status: "COMPLETED",
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await admin.request("PATCH", "/admin/orders/" + o.id + "/status", {
              status: "CONFIRMED",
            })
          ).statusCode,
          200,
        );
        const done = await admin.request(
          "PATCH",
          "/admin/orders/" + o.id + "/status",
          { status: "COMPLETED" },
        );
        assert(done.json().codCollectedAt);
        assert.equal(
          (
            await admin.request("PATCH", "/admin/orders/" + o.id + "/status", {
              status: "CANCELLED",
            })
          ).statusCode,
          409,
        );
      },
    );
    await t.test(
      "admin manages categories, products and lots with audit-safe defaults",
      async () => {
        const admin = await client(true);
        const suffix = randomUUID().slice(0, 8);
        const categoryResult = await admin.request(
          "POST",
          "/admin/categories",
          {
            name: "Admin category " + suffix,
            slug: "admin-" + suffix,
          },
        );
        assert.equal(categoryResult.statusCode, 200, categoryResult.body);
        const managedCategory = categoryResult.json();
        const productPayload = {
          name: "Admin product " + suffix,
          slug: "admin-product-" + suffix,
          subtitle: "Managed in integration test",
          description:
            "A fictional product used only in the isolated test schema.",
          price: "99000",
          stock: 4,
          weight: "100 g",
          origin: "Demo",
          categoryId: managedCategory.id,
          art: "tea",
          tone: "#45664c",
          requiresAgeProof: false,
          minimumAge: 0,
          published: true,
        };
        const productResult = await admin.request(
          "POST",
          "/admin/products",
          productPayload,
        );
        assert.equal(productResult.statusCode, 200, productResult.body);
        const managedProduct = productResult.json();
        assert.equal(
          await db.inventoryMovement.count({
            where: { productId: managedProduct.id, reason: "ADMIN_INITIAL" },
          }),
          1,
        );
        const updated = await admin.request(
          "PATCH",
          "/admin/products/" + managedProduct.id,
          { ...productPayload, stock: 7 },
        );
        assert.equal(updated.statusCode, 200, updated.body);
        assert.equal(updated.json().stock, 7);
        const lotResult = await admin.request("POST", "/admin/lots", {
          productId: managedProduct.id,
          lotCode: "TEST-" + suffix.toUpperCase(),
          status: "DRAFT",
          stock: 4,
        });
        assert.equal(lotResult.statusCode, 200, lotResult.body);
        assert.equal(lotResult.json().certificateStatus, "NONE");
        const activatedLot = await admin.request(
          "PATCH",
          "/admin/lots/" + lotResult.json().id,
          {
            productId: managedProduct.id,
            lotCode: lotResult.json().lotCode,
            status: "ACTIVE",
            stock: 4,
          },
        );
        assert.equal(activatedLot.statusCode, 200, activatedLot.body);
        assert.equal(activatedLot.json().status, "ACTIVE");
        const archived = await admin.request(
          "DELETE",
          "/admin/lots/" + lotResult.json().id,
        );
        assert.equal(archived.statusCode, 200, archived.body);
        assert.equal(archived.json().status, "ARCHIVED");
        const hidden = await admin.request(
          "DELETE",
          "/admin/products/" + managedProduct.id,
        );
        assert.equal(hidden.statusCode, 200, hidden.body);
        assert.equal(hidden.json().published, false);
        assert.equal(
          (
            await admin.request(
              "DELETE",
              "/admin/categories/" + managedCategory.id,
            )
          ).statusCode,
          409,
        );
      },
    );
    await t.test(
      "CSRF, invalid quantities, unpublished product and empty cart rejected",
      async () => {
        const c = await client(),
          p = await product();
        const r = await app.inject({
          method: "POST",
          url: "/api/cart/items",
          payload: { productId: p.id, quantity: 1 },
          headers: { cookie: c.jar, origin: "http://127.0.0.1:5173" },
        });
        assert.equal(r.statusCode, 403);
        const cross = await app.inject({
          method: "POST",
          url: "/api/cart/items",
          payload: { productId: p.id, quantity: 1 },
          headers: {
            cookie: c.jar,
            origin: "https://evil.invalid",
            "x-csrf-token": c.csrf,
          },
        });
        assert.equal(cross.statusCode, 403);
        assert.equal(
          (
            await c.request("POST", "/cart/items", {
              productId: p.id,
              quantity: -1,
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (await c.request("POST", "/orders", await orderInput(c))).json().code,
          "CART_EMPTY",
        );
        await db.product.update({
          where: { id: p.id },
          data: { published: false },
        });
        assert.equal(
          (
            await c.request("POST", "/cart/items", {
              productId: p.id,
              quantity: 1,
            })
          ).statusCode,
          404,
        );
      },
    );
    await t.test(
      "DB constraints prohibit negative stock and zero cart quantity",
      async () => {
        const c = await client(),
          p = await product();
        await add(c, p);
        await assert.rejects(() =>
          db.product.update({ where: { id: p.id }, data: { stock: -1 } }),
        );
        await assert.rejects(() =>
          db.cartItem.updateMany({
            where: { productId: p.id, cart: { userId: c.user.id } },
            data: { quantity: 0 },
          }),
        );
      },
    );
    await t.test(
      "registration/login create HttpOnly session; logout invalidates it",
      async () => {
        const csrf = await app.inject({ url: "/api/csrf" }),
          token = csrf.json().token,
          headers = {
            cookie: "bvv_csrf=" + token,
            origin: "http://127.0.0.1:5173",
            "x-csrf-token": token,
          };
        const email = randomUUID() + "@test.invalid";
        const registered = await app.inject({
          method: "POST",
          url: "/api/auth/register",
          headers,
          payload: { email, password: "Integration@2026", name: "New user" },
        });
        assert.equal(registered.statusCode, 200, registered.body);
        const cookies = registered.headers["set-cookie"];
        assert(String(cookies).includes("HttpOnly"));
        assert(!registered.body.includes("passwordHash"));
        const login = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers,
          payload: { email, password: "Integration@2026" },
        });
        assert.equal(login.statusCode, 200);
        const sid = login.cookies.find((c) => c.name === "bvv_session")!.value;
        assert.equal(
          (
            await app.inject({
              url: "/api/me",
              headers: { cookie: "bvv_session=" + sid },
            })
          ).json().user.email,
          email,
        );
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: {
            ...headers,
            cookie: headers.cookie + "; bvv_session=" + sid,
          },
          payload: {},
        });
        assert.equal(
          (
            await app.inject({
              url: "/api/me",
              headers: { cookie: "bvv_session=" + sid },
            })
          ).json().user,
          null,
        );
      },
    );
    await t.test(
      "password change verifies the current password and keeps secrets out of responses",
      async () => {
        const c = await client();
        const wrong = await c.request("PATCH", "/me/password", {
          currentPassword: "WrongPassword@2026",
          newPassword: "ChangedPassword@2026",
        });
        assert.equal(wrong.statusCode, 400);
        assert.equal(wrong.json().code, "PASSWORD_INVALID");
        const changed = await c.request("PATCH", "/me/password", {
          currentPassword: "Integration@2026",
          newPassword: "ChangedPassword@2026",
        });
        assert.equal(changed.statusCode, 200, changed.body);
        assert.deepEqual(changed.json(), { ok: true });
        const stored = await db.user.findUniqueOrThrow({
          where: { id: c.user.id },
        });
        assert(await argon2.verify(stored.passwordHash, "ChangedPassword@2026"));
        assert(!changed.body.includes("password"));
      },
    );
    await t.test("only an operator can review an AGE credential request", async () => {
      const customer = await client();
      const other = await client();
      const admin = await client(false,true);
      const merchant = await client(true);
      assert.equal((await merchant.request("GET","/admin/age-credential-requests")).statusCode,403);
      assert.equal((await admin.request("GET","/admin/products")).statusCode,401);
      const created = await customer.request("POST", "/me/age-credential-requests", {});
      assert.equal(created.statusCode, 200, created.body);
      const requestId = created.json().id;
      const minimalStatus = await customer.request("GET", "/me/age-credential-status");
      assert.equal(minimalStatus.statusCode, 200, minimalStatus.body);
      assert.deepEqual(Object.keys(minimalStatus.json()).sort(), ["createdAt", "id", "recordSubmitted", "status", "walletReceived", "walletReceivedAt"]);
      assert.equal(minimalStatus.json().walletReceived, false);
      assert.equal(minimalStatus.json().id, requestId);
      const owned = await customer.request("GET", "/me/age-credential-requests/" + requestId);
      assert.equal(owned.statusCode, 200, owned.body);
      assert.equal(owned.json().id, requestId);
      assert.deepEqual(Object.keys(owned.json()).sort(), ["createdAt", "id", "recordSubmitted", "status", "walletReceived", "walletReceivedAt"]);
      const ownedList = await customer.request("GET", "/me/age-credential-requests");
      assert.equal(ownedList.statusCode, 200, ownedList.body);
      assert.deepEqual(Object.keys(ownedList.json()[0]).sort(), ["createdAt", "id", "recordSubmitted", "status", "walletReceived", "walletReceivedAt"]);
      for (const forbiddenField of ["dob", "privateInputs", "salt", "holderSecret", "witness", "token", "privateKey"])
        assert.equal(owned.body.includes(forbiddenField), false);
      const hiddenFromOther = await other.request("GET", "/me/age-credential-requests/" + requestId);
      assert.equal(hiddenFromOther.statusCode, 404);
      assert.equal(hiddenFromOther.body.includes(customer.user.email), false);
      const forbiddenList = await other.request("GET", "/admin/age-credential-requests");
      assert.equal(forbiddenList.statusCode, 403);
      const forbidden = await other.request(
        "PATCH",
        "/admin/age-credential-requests/" + requestId,
        { action: "APPROVE", recordChecked: true },
      );
      assert.equal(forbidden.statusCode, 403);
      const missingConfirmation = await admin.request(
        "PATCH",
        "/admin/age-credential-requests/" + requestId,
        { action: "APPROVE" },
      );
      assert.equal(missingConfirmation.statusCode, 400);
      const wrongOrigin = await app.inject({
        method: "PATCH",
        url: "/api/admin/age-credential-requests/" + requestId,
        payload: { action: "APPROVE", recordChecked: true },
        headers: {
          cookie: admin.jar,
          origin: "https://evil.invalid",
          "x-csrf-token": admin.csrf,
        },
      });
      assert.equal(wrongOrigin.statusCode, 403);
      await db.ageCredentialRequest.update({where:{id:requestId},data:{verificationMethod:"IN_PERSON",recordSubmittedAt:new Date(),consentAt:new Date(),evidenceRevision:1}});
      const approved = await app.inject({
        method: "PATCH",
        url: "/api/admin/age-credential-requests/" + requestId,
        payload: { action: "APPROVE", recordChecked: true, evidenceRevision:1 },
        headers: {
          cookie: admin.jar,
          origin: "http://127.0.0.1:5175",
          "x-csrf-token": admin.csrf,
        },
      });
      assert.equal(approved.statusCode, 200, approved.body);
      assert.equal(approved.json().status, "APPROVED");
      assert.equal(
        await db.auditLog.count({
          where: { actorId: admin.user.id, action: "AGE_REQUEST_APPROVE", objectId: requestId },
        }),
        1,
      );
      const portalLogin=await app.inject({method:"POST",url:"/api/issuer/auth/login",payload:{email:admin.user.email,password:"Integration@2026"},headers:{cookie:admin.jar,origin:"http://127.0.0.1:5175","x-csrf-token":admin.csrf}});
      assert.equal(portalLogin.statusCode,200);
      assert.equal(portalLogin.json().user.role,"ISSUER_OPERATOR");
      const credentialId = randomUUID();
      const receivedAt = new Date();
      await db.ageCredentialRequest.update({ where: { id: requestId }, data: {
        status: "ISSUED", credentialId, issuedAt: receivedAt,
        expiresAt: new Date(receivedAt.getTime() + 86_400_000), issuerKeyId: "issuer:v1",
      }});
      const delivery = await db.ageCredentialDelivery.create({ data: {
        requestId, userId: customer.user.id, credentialId,
        ciphertext: "fixture", iv: "fixture", authTag: "fixture",
      }});
      await db.ageCredentialClaim.create({ data: {
        deliveryId: delivery.id, requestId, userId: customer.user.id, credentialId,
        credentialType: "AGE", tokenHash: randomBytes(32).toString("hex"),
        status: "CLAIMED", expiresAt: new Date(receivedAt.getTime() + 300_000), claimedAt: receivedAt,
      }});
      const afterAck = await customer.request("GET", "/me/age-credential-status");
      assert.equal(afterAck.json().status, "ISSUED");
      assert.equal(afterAck.json().walletReceived, true);
      assert.equal(new Date(afterAck.json().walletReceivedAt).getTime(), receivedAt.getTime());
      const otherCannotReadReceived = await other.request("GET", "/me/age-credential-requests/" + requestId);
      assert.equal(otherCannotReadReceived.statusCode, 404);
      for (const secret of ["tokenHash", "ciphertext", "authTag", "credential", "holderSecret", "salt", "witness"])
        assert.equal(afterAck.body.includes(secret), false);
    });
    await t.test("concurrent AGE requests create one open request", async () => {
      const customer = await client();
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          customer.request("POST", "/me/age-credential-requests", {}),
        ),
      );
      assert(responses.every((response) => response.statusCode === 200));
      assert.equal(new Set(responses.map((response) => response.json().id)).size, 1);
      assert.equal(
        await db.ageCredentialRequest.count({
          where: { userId: customer.user.id, status: "PENDING" },
        }),
        1,
      );
      const repeated = await customer.request("POST", "/me/age-credential-requests", {});
      assert.equal(repeated.statusCode, 200, repeated.body);
      assert.equal(repeated.json().id, responses[0].json().id);
      assert.equal(
        await db.ageCredentialRequest.count({
          where: { userId: customer.user.id, status: "PENDING" },
        }),
        1,
      );
    });
    await t.test("concurrent Issuer claims allow exactly one issuance", async () => {
      const customer = await client();
      const admin = await client(true);
      const request = await db.ageCredentialRequest.create({
        data: {
          userId: customer.user.id,
          operatorId: admin.user.id,
          status: "APPROVED",
          reviewedAt: new Date(),
          verificationMethod:"IN_PERSON",recordSubmittedAt:new Date(),recordReviewedAt:new Date(),consentAt:new Date(),
        },
      });
      const now = new Date();
      const credentials = [randomUUID(), randomUUID()];
      const results = await Promise.all(
        credentials.map((credentialId) =>
          claimAgeCredentialIssuance(db, {
            requestId: request.id,
            userId: customer.user.id,
            credentialId,
            issuedAt: now,
            expiresAt: new Date(now.getTime() + 86_400_000),
            issuerKeyId: "test-issuer:v1",
          }),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1);
      const winner = credentials[results.findIndex(Boolean)];
      await finalizeAgeCredentialIssuance(db, request.id, winner);
      const issued = await db.ageCredentialRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(issued.status, "ISSUED");
      assert.equal(issued.credentialId, winner);
      assert.equal(
        await db.auditLog.count({
          where: {
            action: "AGE_CREDENTIAL_ISSUED_BY_CLI",
            objectId: `${request.id}:${winner}`,
          },
        }),
        1,
      );
      assert.equal(
        await claimAgeCredentialIssuance(db, {
          requestId: request.id,
          userId: customer.user.id,
          credentialId: randomUUID(),
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 86_400_000),
          issuerKeyId: "test-issuer:v1",
        }),
        false,
      );
    });
  });
} finally {
  await app.close();
  await db.$disconnect();
}
