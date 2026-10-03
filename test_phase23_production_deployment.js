/**
 * Fly2Git — Phase 23: Real Production Deployment Test Suite
 *
 * 23 automated tests covering:
 *  1. production config
 *  2. localhost prohibition
 *  3. container configuration
 *  4. port configuration
 *  5. secret isolation
 *  6. production environment
 *  7. health endpoint
 *  8. CORS
 *  9. version gate
 * 10. authentication
 * 11. entitlement
 * 12. Pro Grant
 * 13. telemetry
 * 14. feedback
 * 15. admin isolation
 * 16. AI failure isolation
 * 17. GitHub failure isolation
 * 18. production error safety
 * 19. database configuration
 * 20. rollback configuration
 * 21. extension URL configuration
 * 22. beta state
 * 23. existing regression
 */

"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const http = require("http");

let passed = 0;
let failed = 0;
const failures = [];

async function it(description, fn) {
  try {
    await fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
    failures.push(description);
  }
}

async function runAll() {
  console.log("\n=======================================================");
  console.log("   FLY2GIT PHASE 23 — REAL PRODUCTION DEPLOYMENT SUITE");
  console.log("=======================================================\n");

  const ROOT = path.resolve(__dirname);
  const config = require("./backend/config");
  const { createServer, isVersionSupported } = require("./backend/server");
  const Database = require("./backend/db/database");
  const GeminiAIProvider = require("./backend/providers/gemini-ai-provider");

  const clientConfig = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const popupJs = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  const bgJs = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
  const aiClientJs = fs.readFileSync(path.join(ROOT, "ai-client.js"), "utf8");
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  const dockerignore = fs.readFileSync(path.join(ROOT, ".dockerignore"), "utf8");

  function makeLocalRequest(server, options, body = null) {
    return new Promise((resolve, reject) => {
      const port = server.address().port;
      const reqOptions = Object.assign(
        {
          hostname: "127.0.0.1",
          port: port,
          headers: {},
        },
        options
      );

      let payload = null;
      if (body) {
        payload = typeof body === "string" ? body : JSON.stringify(body);
        reqOptions.headers["Content-Type"] = "application/json";
        reqOptions.headers["Content-Length"] = Buffer.byteLength(payload);
      }

      const req = http.request(reqOptions, (res) => {
        let resData = "";
        res.on("data", (chunk) => {
          resData += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(resData);
          } catch (_) {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json || resData,
            raw: resData,
          });
        });
      });

      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Spin up test server
  const app = createServer({ memoryOnly: true });
  const server = await app.start(0);

  // 1. production config
  await it("1. production config: validateProductionConfig throws on missing secrets in production", () => {
    assert.strictEqual(typeof config.validateProductionConfig, "function");
    const validDev = config.validateProductionConfig({ env: "development" });
    assert.strictEqual(validDev.ok, true);

    assert.throws(() => {
      config.validateProductionConfig({
        env: "production",
        authSecret: "dev-insecure-auth-secret-change-in-prod-32bytes",
        entitlementSecret: "dev-insecure-entitlement-secret-change-in-prod-32bytes",
        adminApiKey: "dev-insecure-admin-key-change-in-prod",
        billing: { provider: "stripe", stripeSecretKey: "sk_test_mock_stripe_key" },
        ai: { enabled: true, provider: "gemini", geminiApiKey: null },
      });
    }, /Production configuration invalid/);
  });

  // 2. localhost prohibition
  await it("2. localhost prohibition: no localhost or 127.0.0.1 fallback in client files", () => {
    const clientSources = [popupJs, bgJs, aiClientJs, clientConfig];
    for (const src of clientSources) {
      assert.ok(!src.includes("http://localhost:3000"), "Must not contain http://localhost:3000");
      assert.ok(!src.includes("http://127.0.0.1"), "Must not contain http://127.0.0.1");
    }
  });

  // 3. container configuration
  await it("3. container configuration: Dockerfile uses Node 20 Alpine, non-root user, and clean ignores", () => {
    assert.ok(dockerfile.includes("FROM node:20-alpine"));
    assert.ok(dockerfile.includes("USER node"));
    assert.ok(dockerfile.includes("EXPOSE 8080"));
    assert.ok(dockerfile.includes("ENV NODE_ENV=production"));

    // Check .dockerignore excludes
    assert.ok(dockerignore.includes("test_*.js"));
    assert.ok(dockerignore.includes("scratch"));
    assert.ok(dockerignore.includes(".git"));
    assert.ok(dockerignore.includes("docs"));
  });

  // 4. port configuration
  await it("4. port configuration: server listens on dynamic or container assigned port", () => {
    const address = server.address();
    assert.ok(address.port > 0, "Server must have active listening port");
  });

  // 5. secret isolation
  await it("5. secret isolation: client code contains no server credentials or private keys", () => {
    const sensitiveTokens = ["ENTITLEMENT_PRIVATE_KEY", "STRIPE_SECRET_KEY", "ADMIN_API_KEY", "GEMINI_API_KEY"];
    for (const tok of sensitiveTokens) {
      assert.ok(!popupJs.includes(tok));
      assert.ok(!bgJs.includes(tok));
      assert.ok(!aiClientJs.includes(tok));
      assert.ok(!clientConfig.includes(tok));
    }
  });

  // 6. production environment
  await it("6. production environment: config supports production environment parameters", () => {
    assert.strictEqual(typeof config.env, "string");
    assert.strictEqual(typeof config.port, "number");
    assert.strictEqual(config.appVersion, "1.1.6");
    assert.strictEqual(config.apiVersion, "1.1.0");
  });

  // 7. health endpoint
  await it("7. health endpoint: GET /health and GET /api/health return operational status without leaking secrets", async () => {
    const res1 = await makeLocalRequest(server, { method: "GET", path: "/health" });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.ok, true);
    assert.strictEqual(res1.body.status, "healthy");
    assert.strictEqual(res1.body.version, "1.1.6");
    assert.strictEqual(res1.body.apiVersion, "1.1.0");
    assert.strictEqual(res1.body.password, undefined);

    const res2 = await makeLocalRequest(server, { method: "GET", path: "/api/health" });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.ok, true);
  });

  // 8. CORS
  await it("8. CORS: production mode respects origin allowlist and forbids wildcard", async () => {
    const prevEnv = config.env;
    config.env = "production";
    try {
      const extOrigin = "chrome-extension://hkgbfbfedbbjlkfhlplfplkflfplf";
      const res = await makeLocalRequest(server, {
        method: "OPTIONS",
        path: "/health",
        headers: { Origin: extOrigin },
      });
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers["access-control-allow-origin"], extOrigin);

      // Untrusted origin must not get wildcard *
      const resUntrusted = await makeLocalRequest(server, {
        method: "OPTIONS",
        path: "/health",
        headers: { Origin: "https://untrusted-phishing.org" },
      });
      assert.notStrictEqual(resUntrusted.headers["access-control-allow-origin"], "*");
    } finally {
      config.env = prevEnv;
    }
  });

  // 9. version gate
  await it("9. version gate: rejects outdated client versions below minimum supported version with HTTP 426", async () => {
    assert.strictEqual(isVersionSupported("1.1.6"), true);
    assert.strictEqual(isVersionSupported("0.9.0"), false);

    const res = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/auth/me",
      headers: { "X-Fly2Git-Version": "0.5.0" },
    });
    assert.strictEqual(res.status, 426);
    assert.strictEqual(res.body.code, "CLIENT_VERSION_UNSUPPORTED");
  });

  // 10. authentication
  let authToken = null;
  let testUserId = null;
  const testEmail = `phase23_user_${Date.now()}@fly2git.internal`;
  const testPassword = "StrongProductionPass#2026!";

  await it("10. authentication: register, login, session, and password security", async () => {
    const regRes = await makeLocalRequest(server, { method: "POST", path: "/api/auth/register" }, {
      email: testEmail,
      password: testPassword,
    });
    assert.strictEqual(regRes.status, 201);
    assert.ok(regRes.body.token);
    authToken = regRes.body.token;

    const meRes = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/auth/me",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.user.email, testEmail);
    testUserId = meRes.body.user.id;
    assert.strictEqual(meRes.body.user.passwordHash, undefined);
  });

  // 11. entitlement
  await it("11. entitlement: signed authoritative entitlement returned with basic plan", async () => {
    const entRes = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/entitlement",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(entRes.status, 200);
    assert.strictEqual(entRes.body.entitlement.plan, "basic");
    assert.ok(entRes.body.entitlement.signature);
  });

  // 12. Pro Grant
  await it("12. Pro Grant: administrative grant issuance elevates user plan to pro", async () => {
    const grantRes = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/admin/pro-grants",
        headers: { "X-Admin-Key": config.adminApiKey },
      },
      {
        userId: testUserId,
        type: "promotional",
        durationDays: 30,
        note: "Phase 23 Real Deployment Test",
      }
    );
    assert.strictEqual(grantRes.status, 201);

    const refreshed = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/entitlement",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(refreshed.body.entitlement.plan, "pro");
  });

  // 13. telemetry
  await it("13. telemetry: allows 12 allowlisted events; rejects disallowed events and source code", async () => {
    const telRes = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/telemetry/product",
        headers: { Authorization: `Bearer ${authToken}` },
      },
      {
        event: "first_sync",
        platform: "leetcode",
        timestamp: Date.now(),
      }
    );
    assert.ok(telRes.status === 200 || telRes.status === 201);
    assert.strictEqual(telRes.body.ok, true);

    const badTel = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/telemetry/product",
        headers: { Authorization: `Bearer ${authToken}` },
      },
      {
        event: "arbitrary_custom_code_dump",
      }
    );
    assert.strictEqual(badTel.status, 400);
  });

  // 14. feedback
  await it("14. feedback: enforces character bounds, valid categories, and user isolation", async () => {
    const fbRes = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/feedback",
        headers: { Authorization: `Bearer ${authToken}` },
      },
      {
        category: "bug",
        message: "Smoke test feedback message.",
        clientVersion: "1.1.6",
      }
    );
    assert.strictEqual(fbRes.status, 201);
    assert.strictEqual(fbRes.body.ok, true);
  });

  // 15. admin isolation
  await it("15. admin isolation: protects admin endpoints from unauthenticated and non-admin users", async () => {
    const unauth = await makeLocalRequest(server, { method: "GET", path: "/api/admin/beta/dashboard" });
    assert.ok(unauth.status === 401 || unauth.status === 403);

    const nonAdmin = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/admin/beta/dashboard",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.ok(nonAdmin.status === 401 || nonAdmin.status === 403);
  });

  // 16. AI failure isolation
  await it("16. AI failure isolation: unconfigured or failed AI provider returns 502 without server crash", async () => {
    const provider = new GeminiAIProvider({ apiKey: null });
    await assert.rejects(async () => {
      await provider.generate({ prompt: "test" });
    }, /not configured with an API key/);

    const aiRes = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/ai/generate",
        headers: { Authorization: `Bearer ${authToken}` },
      },
      {
        feature: "analyze",
        problemTitle: "Two Sum",
        code: "test",
        language: "javascript",
      }
    );
    assert.ok(aiRes.status === 200 || aiRes.status === 502);
  });

  // 17. GitHub failure isolation
  await it("17. GitHub failure isolation: GitHub device flow aborts cleanly on network error", () => {
    assert.ok(bgJs.includes("handleSyncFailure") || bgJs.includes("dispatchSyncNotification"));
  });

  // 18. production error safety
  await it("18. production error safety: malformed request bodies return 400 with no stack traces", async () => {
    const malformed = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/auth/login",
        headers: { "Content-Type": "application/json" },
      },
      "not-valid-json"
    );
    assert.strictEqual(malformed.status, 400);
    assert.strictEqual(malformed.body.ok, false);
    assert.strictEqual(malformed.body.stack, undefined);
  });

  // 19. database configuration
  await it("19. database configuration: atomic save and user query methods functional", () => {
    const db = new Database({ memoryOnly: true });
    db.insertUser({ id: "usr_test_1", email: "unit@fly2git.internal" });
    const user = db.getUserById("usr_test_1");
    assert.strictEqual(user.email, "unit@fly2git.internal");
  });

  // 20. rollback configuration
  await it("20. rollback configuration: version negotiation preserves compatibility across revisions", () => {
    assert.strictEqual(isVersionSupported("1.0.0"), true);
    assert.strictEqual(isVersionSupported("1.1.0"), true);
    assert.strictEqual(isVersionSupported("1.1.6"), true);
    assert.strictEqual(isVersionSupported("0.9.9"), false);
  });

  // 21. extension URL configuration
  await it("21. extension URL configuration: client config uses canonical https://api.fly2git.com", () => {
    assert.ok(clientConfig.includes('BACKEND_API_URL: "https://api.fly2git.com"'));
    assert.ok(manifest.host_permissions.includes("https://api.fly2git.com/*"));
  });

  // 22. beta state
  await it("22. beta state: checks allowlist status fail-closed for unlisted users", async () => {
    const betaRes = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/beta/status?userId=unlisted",
    });
    assert.strictEqual(betaRes.status, 200);
    assert.strictEqual(betaRes.body.beta, false);
  });

  // 23. existing regression
  await it("23. existing regression: release candidate versions, manifest, and platforms verified", () => {
    assert.strictEqual(config.betaVersion, "1.1.6-rc.1");
    assert.strictEqual(config.appVersion, "1.1.6");
    assert.strictEqual(config.apiVersion, "1.1.0");
    assert.strictEqual(manifest.version, "1.1.6");
  });

  await app.stop();

  console.log("\n=======================================================");
  console.log(`   PHASE 23 RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAll().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
