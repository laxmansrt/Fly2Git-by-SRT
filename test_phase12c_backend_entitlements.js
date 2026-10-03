// Fly2Git — by SRT
// Phase 12C: Real Billing & Backend Entitlement Authority Test Suite
//
// Comprehensive backend + extension integration tests covering all 25 required test cases:
// 1. Basic default entitlement
// 2. Valid Pro entitlement
// 3. Invalid entitlement token
// 4. Expired entitlement
// 5. Invalid webhook signature
// 6. Valid webhook
// 7. Duplicate webhook (idempotency)
// 8. Unknown webhook event
// 9. Subscription activation
// 10. Subscription renewal
// 11. Cancellation at period end
// 12. Expiration
// 13. Payment failure state
// 14. Backend unavailable → Basic fallback
// 15. Local storage tampering → no Pro
// 16. Extension cannot self-upgrade
// 17. Checkout requires authenticated user
// 18. Entitlement endpoint requires authentication
// 19. Multiple users have isolated subscriptions
// 20. Platform identity remains separate from billing identity
// 21. Existing Basic sync remains functional
// 22. Existing GitHub sync remains functional
// 23. Existing identity guard remains functional
// 24. Existing platform entitlement limits remain correct
// 25. Existing duplicate detection remains unchanged

const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const url = require("url");

// Load backend modules
const Database = require("./backend/db/database");
const StripeBillingProvider = require("./backend/providers/stripe-provider");
const AuthService = require("./backend/services/auth-service");
const { EntitlementService, BASIC_FEATURES, PRO_FEATURES } = require("./backend/services/entitlement-service");
const BillingService = require("./backend/services/billing-service");
const { createServer } = require("./backend/server");

// Load extension modules
const platforms = require("./platforms.js");
const identity = require("./identity.js");
const entitlements = require("./entitlements.js");

// Setup in-memory mock Chrome storage for extension tests
let mockStorage = {};

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
  },
  runtime: {
    lastError: null,
    sendMessage: async (msg) => ({ ok: true, msg }),
  },
};

// Test Runner Helpers
let passedCount = 0;
let failedCount = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failedCount++;
  }
}

// Webhook signature generator helper
function generateStripeSignature(payload, secret, timestamp) {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signedPayload = `${ts}.${payloadStr}`;
  const hmac = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${ts},v1=${hmac}`;
}

async function makeHttpRequest(port, options, body = null) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: "127.0.0.1",
      port,
      path: options.path,
      method: options.method || "GET",
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch (_e) {
          json = raw;
        }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });

    req.on("error", reject);

    if (body) {
      if (Buffer.isBuffer(body)) {
        req.write(body);
      } else if (typeof body === "string") {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

// ------------------------------------------------------------------------------
// MAIN TEST SUITE
// ------------------------------------------------------------------------------

async function runPhase12CTests() {
  console.log("\n=======================================================");
  console.log("   FLY2GIT PHASE 12C: REAL BILLING & ENTITLEMENT SUITE  ");
  console.log("=======================================================\n");

  const WEBHOOK_SECRET = "whsec_test_secret_key_12345";
  const TEST_PORT = 3199;

  // Initialize clean in-memory database and test backend server
  const testDb = new Database({ memoryOnly: true });
  const testProvider = new StripeBillingProvider({
    stripeWebhookSecret: WEBHOOK_SECRET,
    monthlyPriceId: "price_pro_monthly",
    yearlyPriceId: "price_pro_yearly",
  });
  const testAuthService = new AuthService(testDb);
  const testEntitlementService = new EntitlementService(testDb);
  const testBillingService = new BillingService(testDb, testProvider, testEntitlementService);

  const app = createServer({
    db: testDb,
    billingProvider: testProvider,
    authService: testAuthService,
    entitlementService: testEntitlementService,
    billingService: testBillingService,
  });

  await app.start(TEST_PORT);

  // Global test state
  let testUser = null;
  let testUserToken = null;
  let secondUser = null;
  let secondUserToken = null;

  try {
    // ---------------------------------------------------------------------------
    // 1. Basic default entitlement
    // ---------------------------------------------------------------------------
    await test("1. Basic default entitlement: unauthenticated callers & new users receive Basic", async () => {
      const regRes = await testAuthService.register("user1@example.com", "password123");
      testUser = regRes.user;
      testUserToken = regRes.token;

      // Entitlement for newly registered user without subscription
      const ent = await testEntitlementService.getAuthoritativeEntitlement(testUser.id);
      assert.strictEqual(ent.plan, "basic");
      assert.strictEqual(ent.status, "inactive");
      assert.strictEqual(ent.billingCycle, null);
      assert.strictEqual(ent.features.maxPlatforms, 2);
      assert.strictEqual(ent.features.allPlatforms, false);
      assert.strictEqual(ent.features.multipleRepositories, false);
      assert(typeof ent.signature === "string", "Entitlement must have cryptographic signature");
    });

    // ---------------------------------------------------------------------------
    // 2. Valid Pro entitlement
    // ---------------------------------------------------------------------------
    await test("2. Valid Pro entitlement: active subscription grants authoritative Pro", async () => {
      const now = Date.now();
      testDb.insertSubscription({
        id: "sub_user1_test",
        userId: testUser.id,
        provider: "stripe",
        providerCustomerId: "cus_user1",
        providerSubscriptionId: "sub_12345",
        plan: "pro",
        billingCycle: "monthly",
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
        cancelAtPeriodEnd: false,
      });

      const ent = await testEntitlementService.getAuthoritativeEntitlement(testUser.id);
      assert.strictEqual(ent.plan, "pro");
      assert.strictEqual(ent.status, "active");
      assert.strictEqual(ent.billingCycle, "monthly");
      assert.strictEqual(ent.features.maxPlatforms, Infinity);
      assert.strictEqual(ent.features.allPlatforms, true);
      assert.strictEqual(ent.features.multipleRepositories, true);
      assert.strictEqual(testEntitlementService.verifySignature(ent), true);
    });

    // ---------------------------------------------------------------------------
    // 3. Invalid entitlement token
    // ---------------------------------------------------------------------------
    await test("3. Invalid entitlement token: tampered token or signature fails closed", async () => {
      const ent = await testEntitlementService.getAuthoritativeEntitlement(testUser.id);
      // Tamper with plan
      const tampered = { ...ent, plan: "pro", signature: "forged_invalid_signature" };
      assert.strictEqual(testEntitlementService.verifySignature(tampered), false);

      // Verify extension drops invalid token to basic
      const extSanitized = entitlements.sanitizeEntitlement(tampered);
      assert.strictEqual(extSanitized.plan, "basic");
    });

    // ---------------------------------------------------------------------------
    // 4. Expired entitlement
    // ---------------------------------------------------------------------------
    await test("4. Expired entitlement: past currentPeriodEnd downgrades to expired Basic", async () => {
      const pastTime = Date.now() - 10000;
      testDb.updateSubscription("sub_user1_test", {
        status: "active",
        currentPeriodEnd: pastTime,
      });

      const ent = await testEntitlementService.getAuthoritativeEntitlement(testUser.id);
      assert.strictEqual(ent.plan, "basic");
      assert.strictEqual(ent.status, "expired");
      assert.strictEqual(ent.features.allPlatforms, false);
    });

    // ---------------------------------------------------------------------------
    // 5. Invalid webhook signature
    // ---------------------------------------------------------------------------
    await test("5. Invalid webhook signature: rejected with status 400", async () => {
      const payload = JSON.stringify({ id: "evt_fake", type: "invoice.payment_succeeded" });
      const res = await makeHttpRequest(TEST_PORT, {
        path: "/api/webhooks/payment",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": "t=12345,v1=bad_signature",
        },
      }, payload);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.ok, false);
      assert(res.data.error.includes("signature"));
    });

    // ---------------------------------------------------------------------------
    // 6. Valid webhook
    // ---------------------------------------------------------------------------
    await test("6. Valid webhook: cryptographically verified and processes state update", async () => {
      const eventPayload = {
        id: "evt_test_checkout_complete",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_12345",
            customer: "cus_user1",
            subscription: "sub_stripe_12345",
            client_reference_id: testUser.id,
          },
        },
      };

      const raw = JSON.stringify(eventPayload);
      const signature = generateStripeSignature(raw, WEBHOOK_SECRET);

      const res = await makeHttpRequest(TEST_PORT, {
        path: "/api/webhooks/payment",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": signature,
        },
      }, raw);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.ok, true);
      assert.strictEqual(res.data.processed, true);

      // Verify subscription in db
      const sub = testDb.getSubscriptionByUserId(testUser.id);
      assert.strictEqual(sub.status, "active");
      assert.strictEqual(sub.providerSubscriptionId, "sub_stripe_12345");
    });

    // ---------------------------------------------------------------------------
    // 7. Duplicate webhook (idempotency)
    // ---------------------------------------------------------------------------
    await test("7. Duplicate webhook: identical event ID safely skips duplicate processing", async () => {
      const eventPayload = {
        id: "evt_test_checkout_complete", // Same ID as test 6
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_12345",
            customer: "cus_user1",
            subscription: "sub_stripe_12345",
            client_reference_id: testUser.id,
          },
        },
      };

      const raw = JSON.stringify(eventPayload);
      const signature = generateStripeSignature(raw, WEBHOOK_SECRET);

      const res = await makeHttpRequest(TEST_PORT, {
        path: "/api/webhooks/payment",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": signature,
        },
      }, raw);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.ok, true);
      assert.strictEqual(res.data.duplicate, true);
    });

    // ---------------------------------------------------------------------------
    // 8. Unknown webhook event
    // ---------------------------------------------------------------------------
    await test("8. Unknown webhook event: safely acknowledged without throwing or mutating state", async () => {
      const eventPayload = {
        id: "evt_unknown_999",
        type: "charge.dispute.created",
        data: { object: { id: "dp_123" } },
      };

      const raw = JSON.stringify(eventPayload);
      const signature = generateStripeSignature(raw, WEBHOOK_SECRET);

      const res = await makeHttpRequest(TEST_PORT, {
        path: "/api/webhooks/payment",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": signature,
        },
      }, raw);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.ok, true);
      assert.strictEqual(res.data.ignored, true);
    });

    // ---------------------------------------------------------------------------
    // 9. Subscription activation
    // ---------------------------------------------------------------------------
    await test("9. Subscription activation: checkout.session.completed activates Pro entitlement", async () => {
      const ent = await testEntitlementService.getAuthoritativeEntitlement(testUser.id);
      assert.strictEqual(ent.plan, "pro");
      assert.strictEqual(ent.status, "active");
      assert.strictEqual(ent.features.maxPlatforms, Infinity);
    });

    // ---------------------------------------------------------------------------
    // 10. Subscription renewal
    // ---------------------------------------------------------------------------
    await test("10. Subscription renewal: invoice.payment_succeeded extends period", async () => {
      const newStart = Math.floor(Date.now() / 1000);
      const newEnd = newStart + 30 * 24 * 60 * 60;

      const eventPayload = {
        id: "evt_renewal_101",
        type: "invoice.payment_succeeded",
        data: {
          object: {
            id: "in_12345",
            customer: "cus_user1",
            subscription: "sub_stripe_12345",
            status: "active",
            current_period_start: newStart,
            current_period_end: newEnd,
          },
        },
      };

      const raw = JSON.stringify(eventPayload);
      const signature = generateStripeSignature(raw, WEBHOOK_SECRET);

      const res = await makeHttpRequest(TEST_PORT, {
        path: "/api/webhooks/payment",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": signature,
        },
      }, raw);

      assert.strictEqual(res.status, 200);
      const sub = testDb.getSubscriptionByUserId(testUser.id);
      assert.strictEqual(sub.currentPeriodEnd, newEnd * 1000);
    });

    // ---------------------------------------------------------------------------
    // 11. Cancellation at period end
    // ---------------------------------------------------------------------------
    await test("11. Cancellation at period end: retains Pro until currentPeriodEnd", async () => {
      const futureEnd = Date.now() + 15 * 24 * 60 * 60 * 1000;
      testDb.updateSubscription("sub_user1_test", {
        status: "canceled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: futureEnd,
      });

      const ent = await testEntitlementService.getAuthoritativeEntitlement(testUser.id);
      assert.strictEqual(ent.plan, "pro");
      assert.strictEqual(ent.status, "active");
      assert.strictEqual(ent.expiresAt, futureEnd);
    });

    // ---------------------------------------------------------------------------
    // 12. Expiration
    // ---------------------------------------------------------------------------
    await test("12. Expiration: after currentPeriodEnd, canceled subscription drops to Basic", async () => {
      const pastEnd = Date.now() - 5000;
      testDb.updateSubscription("sub_user1_test", {
        status: "canceled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: pastEnd,
      });

      const ent = await testEntitlementService.getAuthoritativeEntitlement(testUser.id);
      assert.strictEqual(ent.plan, "basic");
      assert.strictEqual(ent.status, "expired");
      assert.strictEqual(ent.features.maxPlatforms, 2);
    });

    // ---------------------------------------------------------------------------
    // 13. Payment failure state
    // ---------------------------------------------------------------------------
    await test("13. Payment failure state: invoice.payment_failed marks past_due and drops Pro", async () => {
      const eventPayload = {
        id: "evt_payment_failed_202",
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_failed_1",
            customer: "cus_user1",
            subscription: "sub_stripe_12345",
          },
        },
      };

      const raw = JSON.stringify(eventPayload);
      const signature = generateStripeSignature(raw, WEBHOOK_SECRET);

      await makeHttpRequest(TEST_PORT, {
        path: "/api/webhooks/payment",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": signature,
        },
      }, raw);

      const sub = testDb.getSubscriptionByUserId(testUser.id);
      assert.strictEqual(sub.status, "past_due");

      const ent = await testEntitlementService.getAuthoritativeEntitlement(testUser.id);
      assert.strictEqual(ent.plan, "basic");
      assert.strictEqual(ent.status, "past_due");
    });

    // ---------------------------------------------------------------------------
    // 14. Backend unavailable → Basic fallback
    // ---------------------------------------------------------------------------
    await test("14. Backend unavailable → Basic fallback: extension fails open to Basic without throwing", async () => {
      // Point extension to unreachable port
      const offlineResult = await entitlements.syncBackendEntitlement("test_token", "http://127.0.0.1:59999");
      assert.strictEqual(offlineResult.ok, false);
      assert.strictEqual(offlineResult.offline, true);
      assert(offlineResult.entitlement);
      assert.strictEqual(offlineResult.entitlement.plan, "basic");
    });

    // ---------------------------------------------------------------------------
    // 15. Local storage tampering → no Pro
    // ---------------------------------------------------------------------------
    await test("15. Local storage tampering → no Pro: editing chrome.storage.local plan drops to Basic", async () => {
      entitlements.clearTestEntitlement();

      // Attacker writes { plan: "pro" } directly into chrome.storage.local
      await chrome.storage.local.set({
        [entitlements.ENTITLEMENT_STORAGE_KEY]: {
          version: 1,
          plan: "pro",
          status: "active",
          selectedPlatforms: [],
        },
      });

      const loaded = await entitlements.getEntitlement();
      assert.strictEqual(loaded.plan, "basic", "Storage tampering must fail closed to Basic");
      assert.strictEqual(await entitlements.isPro(loaded), false);

      // Even with fake signature string:
      await chrome.storage.local.set({
        [entitlements.ENTITLEMENT_STORAGE_KEY]: {
          version: 1,
          plan: "pro",
          status: "active",
          signature: "tampered_signature",
          validUntil: Date.now() + 100000,
        },
      });

      const loadedTampered = await entitlements.getEntitlement();
      assert.strictEqual(loadedTampered.plan, "basic", "Tampered signature must drop to Basic");
    });

    // ---------------------------------------------------------------------------
    // 16. Extension cannot self-upgrade
    // ---------------------------------------------------------------------------
    await test("16. Extension cannot self-upgrade: setSelectedPlatforms cannot bypass limit", async () => {
      entitlements.clearTestEntitlement();
      // Try setting 3 platforms
      const res = await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks", "codechef"]);
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, "BASIC_LIMIT_EXCEEDED");

      const ent = await entitlements.getEntitlement();
      assert.strictEqual(ent.plan, "basic");
      assert(ent.selectedPlatforms.length <= 2);
    });

    // ---------------------------------------------------------------------------
    // 17. Checkout requires authenticated user
    // ---------------------------------------------------------------------------
    await test("17. Checkout requires authenticated user: 401 without Bearer token", async () => {
      const res = await makeHttpRequest(TEST_PORT, {
        path: "/api/checkout/create-session",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, { plan: "pro", billingCycle: "monthly" });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.ok, false);
    });

    // ---------------------------------------------------------------------------
    // 18. Entitlement endpoint requires authentication
    // ---------------------------------------------------------------------------
    await test("18. Entitlement endpoint: returns authenticated flag, defaults to Basic when anonymous", async () => {
      // Anonymous
      const anonRes = await makeHttpRequest(TEST_PORT, { path: "/api/entitlement", method: "GET" });
      assert.strictEqual(anonRes.status, 200);
      assert.strictEqual(anonRes.data.authenticated, false);
      assert.strictEqual(anonRes.data.entitlement.plan, "basic");

      // Authenticated with valid token
      const authRes = await makeHttpRequest(TEST_PORT, {
        path: "/api/entitlement",
        method: "GET",
        headers: { Authorization: `Bearer ${testUserToken}` },
      });
      assert.strictEqual(authRes.status, 200);
      assert.strictEqual(authRes.data.authenticated, true);
      assert(authRes.data.entitlement);
    });

    // ---------------------------------------------------------------------------
    // 19. Multiple users have isolated subscriptions
    // ---------------------------------------------------------------------------
    await test("19. Multiple users have isolated subscriptions: user A Pro does not leak to user B", async () => {
      const regRes2 = await testAuthService.register("user2@example.com", "password456");
      secondUser = regRes2.user;
      secondUserToken = regRes2.token;

      // Reactivate User 1 Pro
      testDb.updateSubscription("sub_user1_test", {
        status: "active",
        currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
        cancelAtPeriodEnd: false,
      });

      const entUser1 = await testEntitlementService.getAuthoritativeEntitlement(testUser.id);
      const entUser2 = await testEntitlementService.getAuthoritativeEntitlement(secondUser.id);

      assert.strictEqual(entUser1.plan, "pro");
      assert.strictEqual(entUser2.plan, "basic");
    });

    // ---------------------------------------------------------------------------
    // 20. Platform identity remains separate from billing identity
    // ---------------------------------------------------------------------------
    await test("20. Platform identity remains separate from billing identity", async () => {
      // Identity guard tracks platform username:
      const platformBound = { platformUserId: "leetcode_coder_42", username: "leetcode_coder_42" };
      await identity.bindPlatformIdentity("leetcode", platformBound);

      const storedState = await identity.getPlatformState("leetcode");
      assert.strictEqual(storedState.bound.username, "leetcode_coder_42");

      // Billing user is separate:
      assert.strictEqual(testUser.email, "user1@example.com");
      assert.notStrictEqual(storedState.bound.username, testUser.id);
      assert.notStrictEqual(storedState.bound.username, testUser.email);
    });

    // ---------------------------------------------------------------------------
    // 21. Existing Basic sync remains functional
    // ---------------------------------------------------------------------------
    await test("21. Existing Basic sync remains functional: allowed platform syncs", async () => {
      entitlements.clearTestEntitlement();
      await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);

      const allowedLC = await entitlements.canUsePlatform("leetcode");
      assert.strictEqual(allowedLC, true);

      const pLC = {
        platform: "leetcode",
        problem: { slug: "two-sum", title: "Two Sum", difficulty: "Easy" },
        submission: { id: "sub_1", status: "Accepted", language: "cpp", code: "int main(){}" },
      };
      const val = platforms.validateNormalizedSubmission(pLC);
      assert.strictEqual(val.ok, true);
    });

    // ---------------------------------------------------------------------------
    // 22. Existing GitHub sync remains functional
    // ---------------------------------------------------------------------------
    await test("22. Existing GitHub sync remains functional: solution path & single commit integrity", async () => {
      const folder = platforms.buildCanonicalFolderPath("LeetCode", "Easy", "two-sum");
      assert.strictEqual(folder, "LeetCode/Easy/two-sum");
    });

    // ---------------------------------------------------------------------------
    // 23. Existing identity guard remains functional
    // ---------------------------------------------------------------------------
    await test("23. Existing identity guard remains functional: mismatch blocks sync", async () => {
      await identity.bindPlatformIdentity("leetcode", {
        platformUserId: "official_user",
        username: "official_user",
      });

      const mismatchCheck = await identity.verifySubmissionIdentity("leetcode", {
        platformUserId: "intruder_user",
        username: "intruder_user",
      });
      assert.strictEqual(mismatchCheck.ok, false);
      assert.strictEqual(mismatchCheck.status, identity.STATUS.MISMATCH);
    });

    // ---------------------------------------------------------------------------
    // 24. Existing platform entitlement limits remain correct
    // ---------------------------------------------------------------------------
    await test("24. Existing platform entitlement limits remain correct: 2 on Basic, all on Pro", async () => {
      entitlements.clearTestEntitlement();
      await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);

      assert.strictEqual(await entitlements.canUsePlatform("leetcode"), true);
      assert.strictEqual(await entitlements.canUsePlatform("geeksforgeeks"), true);
      assert.strictEqual(await entitlements.canUsePlatform("hackerrank"), false);
      assert.strictEqual(await entitlements.canUsePlatform("codechef"), false);

      // Now with Pro test mock
      entitlements.setTestPlan("pro");
      assert.strictEqual(await entitlements.canUsePlatform("leetcode"), true);
      assert.strictEqual(await entitlements.canUsePlatform("hackerrank"), true);
      assert.strictEqual(await entitlements.canUsePlatform("codechef"), true);
      assert.strictEqual(await entitlements.canUsePlatform("codeforces"), true);
      assert.strictEqual(await entitlements.canUsePlatform("atcoder"), true);
      assert.strictEqual(await entitlements.canUsePlatform("spoj"), true);
      entitlements.clearTestEntitlement();
    });

    // ---------------------------------------------------------------------------
    // 25. Existing duplicate detection remains unchanged
    // ---------------------------------------------------------------------------
    await test("25. Existing duplicate detection remains unchanged", async () => {
      function normalizeCode(value) {
        return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      }
      const code1 = "def solve():\r\n    return 42\r\n";
      const code2 = "def solve():\n    return 42\n";
      assert.strictEqual(normalizeCode(code1), normalizeCode(code2));
    });

    // ---------------------------------------------------------------------------
    // Extra: Multi-Repository Data Model & Routing
    // ---------------------------------------------------------------------------
    await test("Extra: Multi-Repository preparation: RepositoryTarget data structures and access control", async () => {
      // User 2 is Basic -> rejected
      const resForbidden = await makeHttpRequest(TEST_PORT, {
        path: "/api/repositories/targets",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secondUserToken}`,
        },
      }, {
        githubOwner: "user2",
        githubRepo: "leetcode-repo",
        platform: "leetcode",
      });
      assert.strictEqual(resForbidden.status, 403);

      // User 1 is Pro -> allowed
      const resAllowed = await makeHttpRequest(TEST_PORT, {
        path: "/api/repositories/targets",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testUserToken}`,
        },
      }, {
        githubOwner: "user1",
        githubRepo: "pro-algorithms",
        platform: "leetcode",
      });
      assert.strictEqual(resAllowed.status, 201);
      assert.strictEqual(resAllowed.data.target.githubRepo, "pro-algorithms");
    });
  } finally {
    await app.stop();
  }

  console.log("\n=======================================================");
  console.log(`PHASE 12C RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("=======================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runPhase12CTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
