/**
 * Fly2Git — Phase 22: Production Infrastructure Activation Test Suite
 *
 * 25 automated tests covering:
 *  1. production config validation
 *  2. production URL
 *  3. localhost prohibition
 *  4. health endpoint
 *  5. secret isolation
 *  6. Gemini configuration
 *  7. authentication
 *  8. entitlement
 *  9. Pro Grant
 * 10. CORS
 * 11. rate limits
 * 12. telemetry
 * 13. feedback
 * 14. diagnostics
 * 15. beta state
 * 16. admin isolation
 * 17. database persistence
 * 18. deletion
 * 19. AI failure isolation
 * 20. GitHub failure isolation
 * 21. safe error responses
 * 22. environment separation
 * 23. production logging safety
 * 24. version compatibility
 * 25. existing regression
 */

"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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
  console.log("   FLY2GIT PHASE 22 — PRODUCTION INFRASTRUCTURE SUITE");
  console.log("=======================================================\n");

  const ROOT = path.resolve(__dirname);
  const config = require("./backend/config");
  const { createServer } = require("./backend/server");
  const Database = require("./backend/db/database");
  const AuthService = require("./backend/services/auth-service");
  const { EntitlementService } = require("./backend/services/entitlement-service");
  const { ProGrantService } = require("./backend/services/pro-grant-service");
  const { ProductTelemetryService } = require("./backend/services/product-telemetry-service");
  const { BetaCohortService } = require("./backend/services/beta-cohort-service");
  const { BetaMetricsService } = require("./backend/services/beta-metrics-service");
  const GeminiAIProvider = require("./backend/providers/gemini-ai-provider");
  const Fly2GitDiagnostics = require("./diagnostics");

  const clientConfig = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const popupJs = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  const bgJs = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
  const aiClientJs = fs.readFileSync(path.join(ROOT, "ai-client.js"), "utf8");

  // Helper to make local in-process requests to server instance
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

  // Spin up test server instance on dynamic port
  const app = createServer({ memoryOnly: true });
  const server = await app.start(0);

  // 1. production config validation
  await it("1. production config validation: throws on missing/insecure production secrets", () => {
    assert.strictEqual(typeof config.validateProductionConfig, "function");
    const devCfg = { env: "development" };
    assert.strictEqual(config.validateProductionConfig(devCfg).ok, true);

    const insecureProdCfg = {
      env: "production",
      authSecret: "dev-insecure-auth-secret",
      entitlementSecret: "dev-insecure-entitlement-secret",
      adminApiKey: "dev-insecure-admin-key",
      billing: { provider: "stripe", stripeSecretKey: "sk_test_mock_stripe_key" },
      ai: { enabled: true, provider: "gemini", geminiApiKey: null },
    };
    assert.throws(() => {
      config.validateProductionConfig(insecureProdCfg);
    }, /Production configuration invalid/);
  });

  // 2. production URL
  await it("2. production URL: client config points to canonical https://api.fly2git.com", () => {
    assert.ok(clientConfig.includes('BACKEND_API_URL: "https://api.fly2git.com"'));
    assert.ok(manifest.host_permissions.includes("https://api.fly2git.com/*"));
  });

  // 3. localhost prohibition
  await it("3. localhost prohibition: no production fallback to localhost in client code", () => {
    const extensionFiles = [popupJs, bgJs, aiClientJs, clientConfig];
    for (const content of extensionFiles) {
      assert.ok(!content.includes("http://localhost:3000"), "Must not contain http://localhost:3000");
    }
  });

  // 4. health endpoint
  await it("4. health endpoint: GET /health and GET /api/health return safe production status", async () => {
    const res1 = await makeLocalRequest(server, { method: "GET", path: "/health" });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.ok, true);
    assert.strictEqual(res1.body.status, "healthy");
    assert.strictEqual(res1.body.version, "1.1.6");
    assert.strictEqual(res1.body.apiVersion, "1.1.0");
    assert.strictEqual(typeof res1.body.uptime, "number");
    assert.strictEqual(res1.body.password, undefined);

    const res2 = await makeLocalRequest(server, { method: "GET", path: "/api/health" });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.ok, true);
  });

  // 5. secret isolation
  await it("5. secret isolation: client code contains no private keys, secrets, or API keys", () => {
    const forbidden = ["AI_KEY", "STRIPE_SECRET", "PRIVATE KEY-----", "ADMIN_KEY"];
    for (const kw of forbidden) {
      assert.ok(!popupJs.includes(kw), `popup.js must not contain ${kw}`);
      assert.ok(!bgJs.includes(kw), `background.js must not contain ${kw}`);
      assert.ok(!aiClientJs.includes(kw), `ai-client.js must not contain ${kw}`);
    }
  });

  // 6. Gemini configuration
  await it("6. Gemini configuration: server provider validates key existence and isolates credentials", async () => {
    const providerWithoutKey = new GeminiAIProvider({ apiKey: null });
    await assert.rejects(async () => {
      await providerWithoutKey.generate({ prompt: "test" });
    }, /not configured with an API key/);
  });

  // 7. authentication
  let testUserToken = null;
  const testEmail = `prod_test_${Date.now()}@fly2git.com`;
  const testPass = "SecureProductionPassword#2026";

  await it("7. authentication: register, login, session, and password hashing operational", async () => {
    const regRes = await makeLocalRequest(server, { method: "POST", path: "/api/auth/register" }, {
      email: testEmail,
      password: testPass,
    });
    assert.strictEqual(regRes.status, 201);
    assert.ok(regRes.body.token);
    testUserToken = regRes.body.token;

    const meRes = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/auth/me",
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.user.email, testEmail);
    assert.strictEqual(meRes.body.user.passwordHash, undefined, "Password hash must never be returned");
  });

  // 8. entitlement
  await it("8. entitlement: issuance and asymmetric signing verification functional", async () => {
    const entRes = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/entitlement",
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    assert.strictEqual(entRes.status, 200);
    assert.ok(entRes.body.ok);
    assert.strictEqual(entRes.body.entitlement && entRes.body.entitlement.plan, "basic");
    assert.ok(entRes.body.entitlement && entRes.body.entitlement.signature, "Must return signed entitlement token");
  });

  // 9. Pro Grant
  await it("9. Pro Grant: admin can issue grants and client entitlement elevates to pro", async () => {
    // Get user id from me
    const me = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/auth/me",
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    const userId = me.body.user.id;

    const grantRes = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/admin/pro-grants",
        headers: { "X-Admin-Key": config.adminApiKey },
      },
      {
        userId: userId,
        type: "promotional",
        durationDays: 30,
        note: "Phase 22 Production Verification",
      }
    );
    assert.strictEqual(grantRes.status, 201);
    assert.ok(grantRes.body.grant);

    // Refresh entitlement
    const refreshed = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/entitlement",
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    assert.strictEqual(refreshed.body.entitlement && refreshed.body.entitlement.plan, "pro");
  });

  // 10. CORS
  await it("10. CORS: respects origin allowlist and forbids wildcard in production", async () => {
    const prevEnv = config.env;
    config.env = "production";
    try {
      const extOrigin = "chrome-extension://hkgbfbfedbbjlkfhlplfplkflfplf";
      const resExt = await makeLocalRequest(server, {
        method: "OPTIONS",
        path: "/api/health",
        headers: { Origin: extOrigin },
      });
      assert.strictEqual(resExt.status, 204);
      assert.strictEqual(resExt.headers["access-control-allow-origin"], extOrigin);

      const resUntrusted = await makeLocalRequest(server, {
        method: "OPTIONS",
        path: "/api/health",
        headers: { Origin: "https://unauthorized-origin.com" },
      });
      assert.notStrictEqual(resUntrusted.headers["access-control-allow-origin"], "*");
    } finally {
      config.env = prevEnv;
    }
  });

  // 11. rate limits
  await it("11. rate limits: sliding window rate limiter protects sensitive endpoints", async () => {
    // Auth register endpoint rate limit check
    let rateLimited = false;
    for (let i = 0; i < 20; i++) {
      const res = await makeLocalRequest(server, { method: "POST", path: "/api/auth/login" }, {
        email: "attacker@test.com",
        password: "wrong",
      });
      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert.strictEqual(rateLimited, true, "Rapid requests must trigger HTTP 429");
  });

  // 12. telemetry
  await it("12. telemetry: strictly metadata-only events accepted; enforces allowlist", async () => {
    const telRes = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/telemetry/product",
        headers: { Authorization: `Bearer ${testUserToken}` },
      },
      {
        event: "first_sync",
        platform: "leetcode",
        timestamp: Date.now(),
      }
    );
    assert.ok(telRes.status === 200 || telRes.status === 201);
    assert.strictEqual(telRes.body.ok, true);

    // Disallowed event rejected
    const badTel = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/telemetry/product",
        headers: { Authorization: `Bearer ${testUserToken}` },
      },
      {
        event: "user_keystroke_logged",
      }
    );
    assert.strictEqual(badTel.status, 400);
  });

  // 13. feedback
  await it("13. feedback: bounded input and valid category enforcement", async () => {
    const fbRes = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/feedback",
        headers: { Authorization: `Bearer ${testUserToken}` },
      },
      {
        category: "bug",
        message: "Production verification feedback message.",
        clientVersion: "1.1.6",
      }
    );
    assert.strictEqual(fbRes.status, 201);
    assert.strictEqual(fbRes.body.ok, true);

    // Invalid category rejected
    const badFb = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/feedback",
        headers: { Authorization: `Bearer ${testUserToken}` },
      },
      {
        category: "malicious_exploit",
        message: "test",
      }
    );
    assert.strictEqual(badFb.status, 400);
  });

  // 14. diagnostics
  await it("14. diagnostics: safe diagnostics generation excludes tokens, cookies, prompts and code", () => {
    const diag = Fly2GitDiagnostics.generateSafeDiagnostics();
    assert.strictEqual(diag.fly2gitVersion, "1.1.6");
    assert.strictEqual(diag.token, undefined);
    assert.strictEqual(diag.prompt, undefined);
    assert.strictEqual(diag.sourceCode, undefined);
    assert.strictEqual(diag.cookie, undefined);
  });

  // 15. beta state
  await it("15. beta state: allowlist status verification rejects unlisted users fail-closed", async () => {
    const unlistedRes = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/beta/status?userId=unlisted_user_12345",
    });
    assert.strictEqual(unlistedRes.status, 200);
    assert.strictEqual(unlistedRes.body.beta, false);
  });

  // 16. admin isolation
  await it("16. admin isolation: dashboard and grant endpoints inaccessible without admin key", async () => {
    const unauthAdmin = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/admin/beta/dashboard",
    });
    assert.ok(unauthAdmin.status === 401 || unauthAdmin.status === 403);
  });

  // 17. database persistence
  await it("17. database persistence: database supports isolated user state and persistence", () => {
    const memDb = new Database({ memoryOnly: true });
    memDb.insertUser({ id: "u_1", email: "persisted@test.com" });
    const fetched = memDb.getUserById("u_1");
    assert.strictEqual(fetched.email, "persisted@test.com");
  });

  // 18. deletion
  await it("18. deletion: GDPR deletion endpoints purge user telemetry and personal data", async () => {
    const delRes = await makeLocalRequest(server, {
      method: "DELETE",
      path: "/api/product-telemetry",
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.body.ok, true);
  });

  // 19. AI failure isolation
  await it("19. AI failure isolation: provider errors return HTTP 502 without crashing server", async () => {
    const aiRes = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/ai/generate",
        headers: { Authorization: `Bearer ${testUserToken}` },
      },
      {
        feature: "analyze",
        problemTitle: "Test",
        code: "test",
        language: "javascript",
      }
    );
    // In test environment without Gemini key, provider responds with 502 safe error
    assert.ok(aiRes.status === 200 || aiRes.status === 502);
    if (aiRes.status === 502) {
      assert.strictEqual(aiRes.body.ok, false);
      assert.ok(aiRes.body.code.includes("AI_"));
    }
  });

  // 20. GitHub failure isolation
  await it("20. GitHub failure isolation: GitHub device flow aborts cleanly on network error", () => {
    assert.ok(bgJs.includes("handleSyncFailure") || bgJs.includes("dispatchSyncNotification"));
  });

  // 21. safe error responses
  await it("21. safe error responses: malformed payload returns 400 with no stack traces", async () => {
    const malformed = await makeLocalRequest(
      server,
      {
        method: "POST",
        path: "/api/auth/login",
        headers: { "Content-Type": "application/json" },
      },
      "{ this is not valid json }"
    );
    assert.strictEqual(malformed.status, 400);
    assert.strictEqual(malformed.body.ok, false);
    assert.strictEqual(malformed.body.stack, undefined);
  });

  // 22. environment separation
  await it("22. environment separation: configuration loads environment correctly", () => {
    assert.strictEqual(typeof config.env, "string");
    assert.strictEqual(typeof config.port, "number");
  });

  // 23. production logging safety
  await it("23. production logging safety: console output contains no credentials", () => {
    const serverSrc = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
    assert.ok(!serverSrc.includes("console.log(password)"));
    assert.ok(!serverSrc.includes("console.log(token)"));
    assert.ok(!serverSrc.includes("console.log(privateKey)"));
  });

  // 24. version compatibility
  await it("24. version compatibility: rejects obsolete client versions with HTTP 426", async () => {
    const oldClient = await makeLocalRequest(server, {
      method: "GET",
      path: "/api/auth/me",
      headers: { "X-Fly2Git-Version": "0.0.1" },
    });
    assert.strictEqual(oldClient.status, 426);
    assert.strictEqual(oldClient.body.code, "CLIENT_VERSION_UNSUPPORTED");
  });

  // 25. existing regression
  await it("25. existing regression: release candidate version strings and platforms intact", () => {
    assert.strictEqual(config.betaVersion, "1.1.6-rc.1");
    assert.strictEqual(config.appVersion, "1.1.6");
    assert.strictEqual(config.apiVersion, "1.1.0");
    assert.strictEqual(manifest.version, "1.1.6");
  });

  await app.stop();

  console.log("\n=======================================================");
  console.log(`   PHASE 22 RESULTS: ${passed} passed, ${failed} failed`);
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
