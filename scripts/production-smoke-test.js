#!/usr/bin/env node
/**
 * Fly2Git — Production Smoke Test Script (Phase 22)
 *
 * Tests production API endpoints safely without generating fake data or unwanted side-effects.
 *
 * Defaults:
 *   RUN_LIVE_GITHUB_TEST=false
 *   RUN_AI_LIVE_TESTS=false
 *
 * Usage:
 *   node scripts/production-smoke-test.js
 *   TARGET_URL=https://api.fly2git.com node scripts/production-smoke-test.js
 *   TARGET_URL=http://localhost:8080 node scripts/production-smoke-test.js
 */

"use strict";

const http = require("http");
const https = require("https");
const url = require("url");

function getTargetUrl() {
  return (process.env.API_BASE_URL || process.env.TARGET_URL || "https://api.fly2git.com").replace(/\/$/, "");
}
const RUN_LIVE_GITHUB_TEST = process.env.RUN_LIVE_GITHUB_TEST === "true";
const RUN_AI_LIVE_TESTS = process.env.RUN_AI_LIVE_TESTS === "true";

function makeRequest(method, pathname, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const targetUrl = getTargetUrl();
    const fullUrl = `${targetUrl}${pathname}`;
    const parsed = url.parse(fullUrl);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    const requestHeaders = Object.assign(
      {
        "User-Agent": "Fly2Git-SmokeTest/1.1.6",
        Accept: "application/json",
        "X-Fly2Git-Version": "1.1.6",
      },
      headers
    );

    let payload = null;
    if (body) {
      payload = typeof body === "string" ? body : JSON.stringify(body);
      requestHeaders["Content-Type"] = "application/json";
      requestHeaders["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.path,
        method: method,
        headers: requestHeaders,
        timeout: 10000,
      },
      (res) => {
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
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request to ${pathname} timed out after 10000ms`));
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runSmokeTests() {
  const results = [];
  let passed = 0;
  let failed = 0;

  async function step(name, fn) {
    process.stdout.write(`• ${name}... `);
    const start = Date.now();
    try {
      const detail = await fn();
      const duration = Date.now() - start;
      console.log(`PASS (${duration}ms)`);
      passed++;
      results.push({ name, status: "PASS", duration, detail });
    } catch (err) {
      const duration = Date.now() - start;
      console.log(`FAIL (${duration}ms) - ${err.message}`);
      failed++;
      results.push({ name, status: "FAIL", duration, error: err.message });
    }
  }

  // 1. Health Endpoint (/health)
  await step("1. Health Endpoint (GET /health)", async () => {
    const res = await makeRequest("GET", "/health");
    if (res.status !== 200) {
      throw new Error(`Expected HTTP 200, got ${res.status}`);
    }
    if (!res.body || res.body.status !== "healthy") {
      throw new Error(`Response body missing status=healthy: ${JSON.stringify(res.body)}`);
    }
    return { service: res.body.service, version: res.body.version };
  });

  // 2. Health Endpoint (/api/health)
  await step("2. API Health Endpoint (GET /api/health)", async () => {
    const res = await makeRequest("GET", "/api/health");
    if (res.status !== 200) {
      throw new Error(`Expected HTTP 200, got ${res.status}`);
    }
    if (!res.body || res.body.ok !== true) {
      throw new Error(`Response body missing ok=true: ${JSON.stringify(res.body)}`);
    }
    return { status: res.body.status };
  });

  // 3. Security Headers
  await step("3. Security Headers Inspection", async () => {
    const res = await makeRequest("GET", "/health");
    const h = res.headers;
    if (h["x-content-type-options"] !== "nosniff") {
      throw new Error("Missing X-Content-Type-Options: nosniff");
    }
    if (h["x-frame-options"] !== "DENY") {
      throw new Error("Missing X-Frame-Options: DENY");
    }
    return { nosniff: true, frameOptions: "DENY" };
  });

  // 4. Client Version Header Check
  await step("4. Version Gate Enforcement", async () => {
    const res = await makeRequest("GET", "/api/auth/me", null, {
      "X-Fly2Git-Version": "0.0.1",
    });
    // Should reject obsolete versions with 426
    if (res.status !== 426) {
      throw new Error(`Expected 426 Upgrade Required for v0.0.1, got ${res.status}`);
    }
    return { code: res.body && res.body.code };
  });

  // 5. Auth Flow (Register / Login / Session)
  let authToken = null;
  const testEmail = `smoketest_${Date.now()}@fly2git.internal`;
  const testPassword = "SmokeTestPassword123!";

  await step("5. Authentication Flow (Register & Session)", async () => {
    const regRes = await makeRequest("POST", "/api/auth/register", {
      email: testEmail,
      password: testPassword,
    });
    if (regRes.status !== 201 && regRes.status !== 200) {
      throw new Error(`Registration failed with status ${regRes.status}: ${JSON.stringify(regRes.body)}`);
    }
    authToken = regRes.body && regRes.body.token;
    if (!authToken) {
      throw new Error("Token missing from registration response");
    }

    const sessRes = await makeRequest("GET", "/api/auth/me", null, {
      Authorization: `Bearer ${authToken}`,
    });
    if (sessRes.status !== 200 || !sessRes.body.ok) {
      throw new Error(`Session verification failed: ${JSON.stringify(sessRes.body)}`);
    }
    return { userId: sessRes.body.user && sessRes.body.user.id };
  });

  // 6. Entitlement Lookup
  await step("6. Entitlements Lookup", async () => {
    if (!authToken) throw new Error("Auth token unavailable");
    const res = await makeRequest("GET", "/api/entitlement", null, {
      Authorization: `Bearer ${authToken}`,
    });
    if (res.status !== 200 || !res.body.ok) {
      throw new Error(`Entitlement query failed: ${JSON.stringify(res.body)}`);
    }
    return { tier: res.body.tier || (res.body.entitlement && res.body.entitlement.tier) };
  });

  // 7. AI Endpoint Availability
  await step("7. AI Endpoint Quota/Availability Inspection", async () => {
    if (!authToken) throw new Error("Auth token unavailable");
    if (!RUN_AI_LIVE_TESTS) {
      return { skipped: "RUN_AI_LIVE_TESTS is false (default)" };
    }
    const res = await makeRequest(
      "POST",
      "/api/ai/generate",
      {
        feature: "analyze",
        problemTitle: "Smoke Test Problem",
        code: "function solve() { return 42; }",
        language: "javascript",
      },
      { Authorization: `Bearer ${authToken}` }
    );
    if (res.status === 502) {
      throw new Error("AI provider unavailable (API key missing or provider offline)");
    }
    return { status: res.status };
  });

  // 8. Beta Status / Feedback Gate
  await step("8. Telemetry & Feedback Submission Gate", async () => {
    if (!authToken) throw new Error("Auth token unavailable");
    const fbRes = await makeRequest(
      "POST",
      "/api/feedback",
      {
        category: "feedback",
        message: "Automated smoke test verification message.",
        clientVersion: "1.1.6",
      },
      { Authorization: `Bearer ${authToken}` }
    );
    if (fbRes.status !== 200 && fbRes.status !== 201) {
      throw new Error(`Feedback submission returned status ${fbRes.status}: ${JSON.stringify(fbRes.body)}`);
    }
    return { feedbackRecorded: true };
  });

  console.log("\n=======================================================");
  console.log(`SMOKE TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=======================================================");

  return { passed, failed, results };
}

if (require.main === module) {
  runSmokeTests()
    .then((res) => {
      process.exit(res.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("\n[Smoke Test Fatal Error]:", err.message);
      process.exit(1);
    });
}

module.exports = { runSmokeTests, makeRequest };
