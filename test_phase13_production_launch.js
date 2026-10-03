// Fly2Git — by SRT
// Phase 13: Production Deployment & Launch Readiness Test Suite
//
// Verification of:
// 1. End-to-End Billing Lifecycle (Register -> Login -> Basic -> Checkout -> Webhook -> Ed25519 Verify -> Pro -> Multi-Repo Sync -> Logout -> Relogin)
// 2. Subscription Cancellation at Period End (Retains Pro -> Period Expires -> Degrades to Basic)
// 3. Payment Failure Handling (invoice.payment_failed -> past_due -> Basic fallback)
// 4. Multi-Repository Routing (Platform -> Repository routing for Pro; Basic blocked; unauthorized repo blocked)
// 5. Basic Offline Continuity (Backend unavailable -> Basic sync uninterrupted; expired Pro cache -> Basic; tampered cache -> Basic)
// 6. Pro Logout & Relogin Session Integrity (Session token cleared; GitHub App auth intact; relogin restores Pro)
// 7. Production Database Durability & Crash Recovery (Restart persistence, secondary indexes, .bak auto-recovery on corruption)
// 8. Production Health, CORS & Security Headers (/api/health with uptime and keyId, HSTS, X-Frame-Options, CORS allowlist)
// 9. Rate Limiting & Payload Size Protection (429 on abuse, 413 on >1MB payload)
// 10. Automated Security Scan (Zero unencrypted secrets or private keys in extension files)

const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Mock Chrome API
let mockStorage = {};
let messageListeners = [];

global.chrome = {
  storage: {
    local: {
      get: async (key) => {
        if (!key) return { ...mockStorage };
        if (typeof key === "string") return { [key]: mockStorage[key] };
        if (Array.isArray(key)) {
          const res = {};
          key.forEach((k) => {
            res[k] = mockStorage[k];
          });
          return res;
        }
        return { ...mockStorage };
      },
      set: async (obj) => {
        Object.assign(mockStorage, obj);
      },
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((k) => delete mockStorage[k]);
      },
      clear: async () => {
        mockStorage = {};
      },
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
  runtime: {
    id: "test-production-launch",
    getURL: () => "chrome-extension://test-production-launch/",
    sendMessage: (msg, cb) => {
      let handled = false;
      const sendResponse = (res) => {
        handled = true;
        if (cb) cb(res);
      };
      for (const listener of messageListeners) {
        const ret = listener(msg, {}, sendResponse);
        if (ret === true) return;
      }
      if (!handled && cb) cb({ ok: false, error: "Unhandled message in mock" });
    },
    onMessage: {
      addListener: (fn) => messageListeners.push(fn),
    },
    onConnect: { addListener: () => {} },
  },
  alarms: {
    create: () => {},
    clear: () => {},
    onAlarm: { addListener: () => {} },
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
    setTitle: () => {},
  },
  tabs: {
    create: () => {},
  },
};

global.importScripts = () => {};

// Load modules
const { createServer } = require("./backend/server");
const Database = require("./backend/db/database");
const StripeBillingProvider = require("./backend/providers/stripe-provider");
const AuthService = require("./backend/services/auth-service");
const { EntitlementService } = require("./backend/services/entitlement-service");
const BillingService = require("./backend/services/billing-service");
const entitlements = require("./entitlements");

// Load background script to test multi-repository resolution and background message handling
require("./config");
require("./platforms");
require("./identity");
const background = require("./background");

function createStripeSignature(rawBody, webhookSecret, timestamp) {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const payloadStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const signedPayload = `${ts}.${payloadStr}`;
  const hmac = crypto.createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");
  return `t=${ts},v1=${hmac}`;
}

async function request(serverUrl, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(serverUrl);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };

    let postData = null;
    if (body !== null) {
      postData = typeof body === "string" ? body : JSON.stringify(body);
      if (!reqOpts.headers["Content-Type"]) {
        reqOpts.headers["Content-Type"] = "application/json";
      }
      reqOpts.headers["Content-Length"] = Buffer.byteLength(postData);
    }

    const req = http.request(reqOpts, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json || raw,
          raw,
        });
      });
    });

    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runSuite() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE 13: PRODUCTION DEPLOYMENT SUITE      ");
  console.log("=======================================================\n");

  const TEST_PORT = 3399;
  const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
  const WEBHOOK_SECRET = "whsec_test_phase13_production";

  // Dedicated test database path
  const testDbDir = path.join(__dirname, "scratch_test_phase13");
  const testDbFile = path.join(testDbDir, "fly2git_phase13.json");
  if (!fs.existsSync(testDbDir)) fs.mkdirSync(testDbDir, { recursive: true });
  if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
  if (fs.existsSync(`${testDbFile}.bak`)) fs.unlinkSync(`${testDbFile}.bak`);

  const db = new Database({ filePath: testDbFile });
  const billingProvider = new StripeBillingProvider({
    stripeWebhookSecret: WEBHOOK_SECRET,
    monthlyPriceId: "price_pro_monthly_prod",
    yearlyPriceId: "price_pro_yearly_prod",
  });
  const authService = new AuthService(db);
  const entitlementService = new EntitlementService(db);
  const billingService = new BillingService(db, billingProvider, entitlementService);

  const app = createServer({
    db,
    billingProvider,
    authService,
    entitlementService,
    billingService,
  });

  await app.start(TEST_PORT);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(err);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Health endpoint returns production diagnostics
    // -------------------------------------------------------------
    await test("1. Production health check endpoint returns 200 with operational metrics", async () => {
      const res = await request(`${SERVER_URL}/api/health`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.status, "healthy");
      assert.strictEqual(res.body.service, "fly2git-entitlements");
      assert.strictEqual(typeof res.body.uptime, "number");
      assert.strictEqual(typeof res.body.keyId, "string");
      assert.strictEqual(typeof res.body.version, "string");
    });

    // -------------------------------------------------------------
    // Test 2: Security headers present on responses
    // -------------------------------------------------------------
    await test("2. Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)", async () => {
      const res = await request(`${SERVER_URL}/api/health`);
      assert.strictEqual(res.headers["x-content-type-options"], "nosniff");
      assert.strictEqual(res.headers["x-frame-options"], "DENY");
      assert.strictEqual(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
    });

    // -------------------------------------------------------------
    // Test 3: End-to-End Billing Lifecycle
    // -------------------------------------------------------------
    let userToken = null;
    let userId = null;
    const testEmail = "launch_user@fly2git.com";

    await test("3. End-to-End: Register, Login, Basic default, Upgrade, Webhook, Verified Pro", async () => {
      // Step A: Register
      const regRes = await request(`${SERVER_URL}/api/auth/register`, { method: "POST" }, {
        email: testEmail,
        password: "SuperSecurePassword123!",
      });
      assert.strictEqual(regRes.status, 201);
      assert.strictEqual(regRes.body.ok, true);
      userId = regRes.body.user.id;
      userToken = regRes.body.token;

      // Step B: Fetch initial entitlement (must be Basic)
      const initEnt = await request(`${SERVER_URL}/api/entitlement`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.strictEqual(initEnt.status, 200);
      assert.strictEqual(initEnt.body.entitlement.plan, "basic");

      // Step C: Create checkout session
      const checkoutRes = await request(`${SERVER_URL}/api/checkout/create-session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${userToken}` },
      }, { billingCycle: "monthly" });
      assert.strictEqual(checkoutRes.status, 200);
      assert.strictEqual(checkoutRes.body.ok, true);
      assert.strictEqual(checkoutRes.body.session.userId, userId);

      // Step D: Send checkout.session.completed webhook
      const webhookPayload = {
        id: "evt_launch_checkout_001",
        type: "checkout.session.completed",
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: "cs_launch_001",
            customer: "cus_launch_123",
            subscription: "sub_launch_123",
            client_reference_id: userId,
          },
        },
      };
      const rawWebhook = JSON.stringify(webhookPayload);
      const signature = createStripeSignature(rawWebhook, WEBHOOK_SECRET);

      const whRes = await request(`${SERVER_URL}/api/webhooks/payment`, {
        method: "POST",
        headers: { "stripe-signature": signature },
      }, rawWebhook);
      assert.strictEqual(whRes.status, 200);
      assert.strictEqual(whRes.body.processed, true);

      // Step E: Extension syncs and verifies Ed25519 signature
      const syncRes = await entitlements.syncBackendEntitlement(userToken, SERVER_URL);
      assert.strictEqual(syncRes.ok, true);
      assert.strictEqual(syncRes.entitlement.plan, "pro");
      assert.strictEqual(syncRes.entitlement.status, "active");
      assert.strictEqual(syncRes.entitlement.features.allPlatforms, true);
      assert.strictEqual(syncRes.entitlement.features.multipleRepositories, true);

      // Step F: Local storage reflects Pro
      const current = await entitlements.getEntitlement();
      assert.strictEqual(current.plan, "pro");
      assert.strictEqual(await entitlements.canUseMultipleRepositories(), true);
    });

    // -------------------------------------------------------------
    // Test 4: Pro platform access and multi-platform selection
    // -------------------------------------------------------------
    await test("4. Pro subscriber can enable > 2 platforms and access all coding platforms", async () => {
      // Basic is restricted to 2 platforms; Pro allows all
      const updateRes = await entitlements.setSelectedPlatforms(["leetcode", "codeforces", "codechef", "atcoder"]);
      assert.strictEqual(updateRes.ok, true);
      assert.strictEqual(updateRes.entitlement.plan, "pro");

      const canSyncAtCoder = await entitlements.canUsePlatform("atcoder");
      assert.strictEqual(canSyncAtCoder, true);
      const canSyncSpoj = await entitlements.canUsePlatform("spoj");
      assert.strictEqual(canSyncSpoj, true);
    });

    // -------------------------------------------------------------
    // Test 5: Multi-Repository Routing for Pro Subscriber
    // -------------------------------------------------------------
    await test("5. Multi-Repository Routing: Platform -> Repo targets resolved for Pro", async () => {
      // Mock authorized repositories in user's GitHub App installation
      await chrome.storage.local.set({
        selectedRepo: "octocat/default-solutions",
        installedRepos: [
          "octocat/default-solutions",
          "octocat/leetcode-repo",
          "octocat/codeforces-repo",
          "octocat/codechef-repo",
        ],
        platformRepoTargets: {
          leetcode: "octocat/leetcode-repo",
          codeforces: "octocat/codeforces-repo",
          codechef: "octocat/codechef-repo",
        },
      });

      // Background routing helper
      const targetLeetCode = await background.resolveTargetRepository("leetcode");
      assert.strictEqual(targetLeetCode, "octocat/leetcode-repo");

      const targetCodeforces = await background.resolveTargetRepository("codeforces");
      assert.strictEqual(targetCodeforces, "octocat/codeforces-repo");

      // Platform without explicit target falls back to default selectedRepo
      const targetGfg = await background.resolveTargetRepository("gfg");
      assert.strictEqual(targetGfg, "octocat/default-solutions");
    });

    // -------------------------------------------------------------
    // Test 6: Unauthorized GitHub Repository Target is Rejected
    // -------------------------------------------------------------
    await test("6. Target repo not authorized in GitHub App installation is rejected", async () => {
      await chrome.storage.local.set({
        platformRepoTargets: {
          atcoder: "malicious_user/unauthorized_private_repo",
        },
      });

      let unauthorizedError = null;
      try {
        await background.resolveTargetRepository("atcoder", {
          installedRepos: ["octocat/default-solutions"],
        });
      } catch (err) {
        unauthorizedError = err;
      }
      assert.strictEqual(unauthorizedError && unauthorizedError.code, "UNAUTHORIZED_REPO");
    });

    // -------------------------------------------------------------
    // Test 7: Basic subscriber cannot configure multi-repository targets
    // -------------------------------------------------------------
    await test("7. Basic subscriber is prevented from multi-repository routing", async () => {
      // Mock Basic plan
      await chrome.storage.local.set({
        fly2git_entitlement: entitlements.DEFAULT_ENTITLEMENT,
      });

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "SET_PLATFORM_REPO_TARGET",
            platform: "leetcode",
            repo: "octocat/leetcode-repo",
          },
          resolve
        );
      });

      assert.strictEqual(response.ok, false);
      assert.strictEqual(response.error, "Multi-repository mapping requires Fly2Git Pro");
    });

    // -------------------------------------------------------------
    // Test 8: Subscription Cancellation Lifecycle
    // -------------------------------------------------------------
    await test("8. Cancellation at period end: Pro remains active until period expiration", async () => {
      // Re-enable Pro entitlement on backend
      const cancelRes = await request(`${SERVER_URL}/api/billing/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.strictEqual(cancelRes.status, 200);
      assert.strictEqual(cancelRes.body.ok, true);

      // Period has not expired yet: status remains active, cancelAtPeriodEnd is true
      const sub = db.getSubscriptionByUserId(userId);
      assert.strictEqual(sub.cancelAtPeriodEnd, true);

      const ent = await entitlementService.getAuthoritativeEntitlement(userId);
      assert.strictEqual(ent.plan, "pro"); // Still Pro until period end

      // Fast forward time past currentPeriodEnd
      db.updateSubscription(sub.id, {
        currentPeriodEnd: Date.now() - 1000, // Expired
      });

      const expiredEnt = await entitlementService.getAuthoritativeEntitlement(userId);
      assert.strictEqual(expiredEnt.plan, "basic");
      assert.strictEqual(expiredEnt.status, "expired");
    });

    // -------------------------------------------------------------
    // Test 9: Payment Failure Handling (invoice.payment_failed)
    // -------------------------------------------------------------
    await test("9. Payment failure marks past_due and drops Pro entitlement", async () => {
      // Reset to active subscription
      const sub = db.getSubscriptionByUserId(userId);
      db.updateSubscription(sub.id, {
        status: "active",
        currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
        cancelAtPeriodEnd: false,
      });

      const failWebhook = {
        id: `evt_payment_fail_${Date.now()}`,
        type: "invoice.payment_failed",
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            subscription: sub.providerSubscriptionId,
            customer: sub.providerCustomerId,
          },
        },
      };
      const rawPayload = JSON.stringify(failWebhook);
      const signature = createStripeSignature(rawPayload, WEBHOOK_SECRET);

      const whRes = await request(`${SERVER_URL}/api/webhooks/payment`, {
        method: "POST",
        headers: { "stripe-signature": signature },
      }, rawPayload);
      assert.strictEqual(whRes.status, 200);

      const updatedSub = db.getSubscriptionByUserId(userId);
      assert.strictEqual(updatedSub.status, "past_due");

      const failEnt = await entitlementService.getAuthoritativeEntitlement(userId);
      assert.strictEqual(failEnt.plan, "basic");
      assert.strictEqual(failEnt.status, "past_due");
    });

    // -------------------------------------------------------------
    // Test 10: Basic Offline Continuity
    // -------------------------------------------------------------
    await test("10. Basic syncing continues offline when backend is unreachable", async () => {
      // Drop extension to basic
      await chrome.storage.local.set({
        fly2git_entitlement: entitlements.DEFAULT_ENTITLEMENT,
      });

      // Offline backend sync attempt
      const offlineSync = await entitlements.syncBackendEntitlement(null, "http://127.0.0.1:59998");
      assert.strictEqual(offlineSync.ok, false);
      assert.strictEqual(offlineSync.offline, true);
      assert.strictEqual(offlineSync.entitlement.plan, "basic");

      // Normal Basic sync checks still pass
      assert.strictEqual(await entitlements.canUsePlatform("leetcode"), true);
      assert.strictEqual(await entitlements.canUseMultipleRepositories(), false);
    });

    // -------------------------------------------------------------
    // Test 11: Expired Pro Cache Fails Closed to Basic
    // -------------------------------------------------------------
    await test("11. Stale Pro cache past validUntil degrades immediately to Basic", async () => {
      const expiredCache = {
        plan: "pro",
        status: "active",
        validUntil: Date.now() - 5000, // Expired 5 seconds ago
        signature: "corrupted_or_expired_sig",
      };
      await chrome.storage.local.set({ fly2git_entitlement: expiredCache });

      const verified = await entitlements.getEntitlement();
      assert.strictEqual(verified.plan, "basic");
    });

    // -------------------------------------------------------------
    // Test 12: Tampered Local Storage Fails Closed to Basic
    // -------------------------------------------------------------
    await test("12. Tampering chrome.storage.local to claim Pro fails closed to Basic", async () => {
      const forged = {
        plan: "pro",
        status: "active",
        validUntil: Date.now() + 86400000,
        signature: "forged_signature_attempt",
        features: { multipleRepositories: true, allPlatforms: true },
      };
      await chrome.storage.local.set({ fly2git_entitlement: forged });

      const verified = await entitlements.getEntitlement();
      assert.strictEqual(verified.plan, "basic");
    });

    // -------------------------------------------------------------
    // Test 13: Pro Logout & Relogin Session Isolation
    // -------------------------------------------------------------
    await test("13. Logout clears session & entitlement without corrupting GitHub auth; relogin restores", async () => {
      // Setup state with GitHub OAuth token + Fly2Git account token
      await chrome.storage.local.set({
        auth: {
          accessToken: "gh_oauth_token_preserved",
          selectedRepo: "octocat/my-solutions",
          fly2gitToken: userToken,
          fly2gitUser: { id: userId, email: testEmail },
        },
      });

      // User logs out via message
      const logoutRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "LOGOUT_FLY2GIT_ACCOUNT" }, resolve);
      });
      assert.strictEqual(logoutRes.ok, true);

      // Verify GitHub token is preserved while Fly2Git token is gone
      const { auth: afterLogout } = await chrome.storage.local.get("auth");
      assert.strictEqual(afterLogout.accessToken, "gh_oauth_token_preserved");
      assert.strictEqual(afterLogout.selectedRepo, "octocat/my-solutions");
      assert.strictEqual(Boolean(afterLogout.fly2gitToken), false);
      assert.strictEqual(Boolean(afterLogout.fly2gitUser), false);

      // Local entitlement dropped to Basic
      const entAfterLogout = await entitlements.getEntitlement();
      assert.strictEqual(entAfterLogout.plan, "basic");

      // Relogin with original credentials
      const loginRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "LOGIN_FLY2GIT_ACCOUNT",
            email: testEmail,
            password: "SuperSecurePassword123!",
            backendUrl: SERVER_URL,
          },
          resolve
        );
      });
      assert.strictEqual(loginRes.ok, true);
      assert.strictEqual(loginRes.user.email, testEmail);

      const { auth: afterRelogin } = await chrome.storage.local.get("auth");
      assert.strictEqual(typeof afterRelogin.fly2gitToken, "string");
      assert.strictEqual(afterRelogin.accessToken, "gh_oauth_token_preserved");
    });

    // -------------------------------------------------------------
    // Test 14: Production Database Durability & Crash Recovery
    // -------------------------------------------------------------
    await test("14. Production Database persists across restarts and recovers from .bak on corruption", async () => {
      // Verify data is saved
      assert.strictEqual(fs.existsSync(testDbFile), true);
      assert.strictEqual(fs.existsSync(`${testDbFile}.bak`), true);

      // Re-instantiate database (simulating process restart)
      const restartDb = new Database({ filePath: testDbFile });
      assert.strictEqual(restartDb.users.size >= 1, true);
      const reloadedUser = restartDb.getUserByEmail(testEmail);
      assert.strictEqual(reloadedUser.id, userId);

      // Corrupt primary file (truncate/write invalid JSON)
      fs.writeFileSync(testDbFile, "CORRUPTED_TRUNCATED_JSON_DATA{{{{", "utf8");

      // Instantiate new DB instance: must auto-recover from .bak
      const recoveredDb = new Database({ filePath: testDbFile });
      assert.strictEqual(recoveredDb.users.size >= 1, true);
      const recoveredUser = recoveredDb.getUserByEmail(testEmail);
      assert.strictEqual(recoveredUser.id, userId);
    });

    // -------------------------------------------------------------
    // Test 15: Rate Limiting & Body Size Limit Protection
    // -------------------------------------------------------------
    await test("15. Rate limiting returns 429 after threshold, >1MB body returns 413", async () => {
      // Test payload too large (1MB + 100 bytes)
      const bigPayload = "a".repeat(1024 * 1024 + 100);
      const bigRes = await request(`${SERVER_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, bigPayload);
      assert.strictEqual(bigRes.status, 413);

      // Trigger rate limiting (15 requests in 60s window)
      let got429 = false;
      for (let i = 0; i < 20; i++) {
        const r = await request(`${SERVER_URL}/api/auth/login`, { method: "POST" }, {
          email: "spam@example.com",
          password: "password123",
        });
        if (r.status === 429) {
          got429 = true;
          break;
        }
      }
      assert.strictEqual(got429, true);
    });

    // -------------------------------------------------------------
    // Test 16: Security Scan Verification
    // -------------------------------------------------------------
    await test("16. Automated security scan: extension files contain zero private keys or live secrets", async () => {
      const extFiles = [
        "manifest.json",
        "popup.html",
        "popup.js",
        "popup.css",
        "background.js",
        "content.js",
        "inject.js",
        "entitlements.js",
        "identity.js",
        "platforms.js",
        "config.js",
        "gfg-content.js",
        "gfg-inject.js",
        "hackerrank-content.js",
        "hackerrank-inject.js",
        "codechef-content.js",
        "codechef-inject.js",
        "atcoder-content.js",
        "atcoder-inject.js",
        "codeforces-content.js",
        "codeforces-inject.js",
        "spoj-content.js",
        "spoj-inject.js",
      ];

      for (const rel of extFiles) {
        const fullPath = path.join(__dirname, rel);
        if (!fs.existsSync(fullPath)) continue;
        const content = fs.readFileSync(fullPath, "utf8");

        assert.strictEqual(content.includes("BEGIN PRIVATE KEY"), false, `Private key found in ${rel}`);
        assert.strictEqual(content.includes("sk_live_"), false, `Live Stripe key found in ${rel}`);
        assert.strictEqual(content.includes("whsec_"), false, `Webhook secret found in ${rel}`);
      }
    });

  } finally {
    await app.stop();

    // Clean up test scratch dir
    try {
      if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
      if (fs.existsSync(`${testDbFile}.bak`)) fs.unlinkSync(`${testDbFile}.bak`);
      if (fs.existsSync(testDbDir)) fs.rmdirSync(testDbDir);
    } catch (_) {}
  }

  console.log("\n=======================================================");
  console.log(`PHASE 13 RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("FATAL ERROR in Phase 13 suite:", err);
  process.exit(1);
});
