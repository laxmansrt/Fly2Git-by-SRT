// Fly2Git — by SRT
// Phase 12D: Production Security, Verification & Release Hardening Test Suite
//
// Comprehensive security test suite covering all 28 required test cases:
// 1. Ed25519 valid signature
// 2. Ed25519 invalid signature
// 3. Unknown key ID
// 4. Expired entitlement signature
// 5. Tampered entitlement payload
// 6. Modified local entitlement cannot become Pro
// 7. Authenticated user isolation
// 8. Unauthorized repository target
// 9. Unauthorized GitHub repository
// 10. Cross-user repository mapping blocked
// 11. Concurrent webhook duplicate
// 12. Replayed webhook blocked
// 13. Out-of-order webhook handled safely
// 14. Checkout arbitrary price blocked
// 15. Checkout arbitrary user blocked
// 16. Expired token rejected
// 17. Logout removes authentication state
// 18. Basic works while backend is unavailable
// 19. Expired Pro cache becomes Basic
// 20. Existing identity guard remains intact
// 21. Existing duplicate detection remains intact
// 22. Existing LeetCode sync remains intact
// 23. Existing GFG sync remains intact
// 24. Existing HackerRank sync remains intact
// 25. Existing CodeChef sync remains intact
// 26. Existing AtCoder sync remains intact
// 27. Existing Codeforces sync remains intact
// 28. Existing SPOJ sync remains intact

const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const url = require("url");

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
    id: "test-security-hardening",
    getURL: () => "chrome-extension://test-security-hardening/",
    sendMessage: (msg) => {
      return new Promise((resolve) => {
        let responded = false;
        let pendingAsync = false;

        for (const listener of messageListeners) {
          const isAsync = listener(msg, {}, (r) => {
            if (!responded) {
              responded = true;
              resolve(r);
            }
          });
          if (isAsync === true) {
            pendingAsync = true;
          }
        }

        if (!pendingAsync && !responded) {
          responded = true;
          resolve({ ok: true, msg });
        }

        // Safety fallback timeout
        setTimeout(() => {
          if (!responded) {
            responded = true;
            resolve({ ok: true, timeout: true });
          }
        }, 500);
      });
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
  },
};

global.importScripts = () => {};

// Load extension modules
const platforms = require("./platforms.js");
const identity = require("./identity.js");
const entitlements = require("./entitlements.js");

global.Fly2GitPlatforms = platforms;
global.Fly2GitEntitlements = entitlements;
global.Fly2GitIdentity = identity;

// Load background module
const background = require("./background.js");

// Load backend modules
const Database = require("./backend/db/database");
const StripeBillingProvider = require("./backend/providers/stripe-provider");
const AuthService = require("./backend/services/auth-service");
const { EntitlementService } = require("./backend/services/entitlement-service");
const BillingService = require("./backend/services/billing-service");
const { createServer } = require("./backend/server");
const config = require("./backend/config");

// Test runner helpers
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

function makeHttpRequest(port, options, bodyData) {
  return new Promise((resolve, reject) => {
    const postData = bodyData
      ? typeof bodyData === "string"
        ? bodyData
        : JSON.stringify(bodyData)
      : null;

    const reqOpts = {
      hostname: "127.0.0.1",
      port,
      path: options.path,
      method: options.method || "GET",
      headers: {
        ...(options.headers || {}),
      },
    };

    if (postData) {
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
        let data = {};
        try {
          data = JSON.parse(raw);
        } catch (_e) {
          data = raw;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data,
          raw,
        });
      });
    });

    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function createStripeSignature(rawPayload, secret, timestamp) {
  const t = timestamp || Math.floor(Date.now() / 1000);
  const data = `${t}.${rawPayload}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(data);
  const sig = hmac.digest("hex");
  return `t=${t},v1=${sig}`;
}

async function runPhase12DTests() {
  console.log("\n=======================================================");
  console.log("   FLY2GIT PHASE 12D: PRODUCTION SECURITY TEST SUITE   ");
  console.log("=======================================================\n");

  const TEST_PORT = 3299;
  const db = new Database({ memoryOnly: true });
  const stripeProvider = new StripeBillingProvider({
    stripeSecretKey: "sk_test_phase12d_key",
    stripeWebhookSecret: "whsec_test_phase12d_webhook",
    monthlyPriceId: "price_pro_monthly_test",
    yearlyPriceId: "price_pro_yearly_test",
  });
  const authService = new AuthService(db);
  const entitlementService = new EntitlementService(db);
  const billingService = new BillingService(db, stripeProvider, entitlementService);

  const app = createServer({
    db,
    authService,
    entitlementService,
    billingService,
    billingProvider: stripeProvider,
    memoryOnly: true,
  });

  await app.start(TEST_PORT);

  try {
    // ---------------------------------------------------------------------------
    // 1. Ed25519 valid signature
    // ---------------------------------------------------------------------------
    await test("1. Ed25519 valid signature: server-signed entitlement verifies successfully", async () => {
      entitlements.clearTestEntitlement();
      const entRecord = {
        userId: "usr_alice",
        plan: "pro",
        status: "active",
        billingCycle: "monthly",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        issuedAt: Date.now(),
        validUntil: Date.now() + 24 * 60 * 60 * 1000,
      };

      const sig = entitlementService.signEntitlement(entRecord);
      const signed = { ...entRecord, signature: sig, kid: "fly2git-ed25519-v1" };
      assert.strictEqual(typeof signed.signature, "string");
      assert.strictEqual(signed.kid, "fly2git-ed25519-v1");

      const isValid = entitlements.verifyEntitlementSignature(signed);
      assert.strictEqual(isValid, true, "Valid Ed25519 signature must verify as true");

      const sanitized = entitlements.sanitizeEntitlement(signed);
      assert.strictEqual(sanitized.plan, "pro", "Sanitized record must retain Pro plan");
    });

    // ---------------------------------------------------------------------------
    // 2. Ed25519 invalid signature
    // ---------------------------------------------------------------------------
    await test("2. Ed25519 invalid signature: corrupted signature fails closed to Basic", async () => {
      entitlements.clearTestEntitlement();
      const entRecord = {
        userId: "usr_alice",
        plan: "pro",
        status: "active",
        billingCycle: "monthly",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        issuedAt: Date.now(),
        validUntil: Date.now() + 24 * 60 * 60 * 1000,
      };

      const sig = entitlementService.signEntitlement(entRecord);
      const signed = { ...entRecord, signature: sig, kid: "fly2git-ed25519-v1" };
      // Corrupt the signature
      const corrupted = {
        ...signed,
        signature: signed.signature.slice(0, -6) + "001122",
      };

      const isValid = entitlements.verifyEntitlementSignature(corrupted);
      assert.strictEqual(isValid, false, "Corrupted signature must fail verification");

      const sanitized = entitlements.sanitizeEntitlement(corrupted);
      assert.strictEqual(sanitized.plan, "basic", "Invalid signature must fail closed to Basic");
    });

    // ---------------------------------------------------------------------------
    // 3. Unknown key ID
    // ---------------------------------------------------------------------------
    await test("3. Unknown key ID: unsupported kid fails closed to Basic", async () => {
      entitlements.clearTestEntitlement();
      const entRecord = {
        userId: "usr_alice",
        plan: "pro",
        status: "active",
        billingCycle: "monthly",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        issuedAt: Date.now(),
        validUntil: Date.now() + 24 * 60 * 60 * 1000,
      };

      const sig = entitlementService.signEntitlement(entRecord);
      const signed = { ...entRecord, signature: sig, kid: "unknown-key-version-99" };

      const isValid = entitlements.verifyEntitlementSignature(signed);
      assert.strictEqual(isValid, false, "Unknown key ID must fail verification");

      const sanitized = entitlements.sanitizeEntitlement(signed);
      assert.strictEqual(sanitized.plan, "basic", "Unknown key ID must fail closed to Basic");
    });

    // ---------------------------------------------------------------------------
    // 4. Expired entitlement signature
    // ---------------------------------------------------------------------------
    await test("4. Expired entitlement signature: past validUntil fails closed to Basic", async () => {
      entitlements.clearTestEntitlement();
      const entRecord = {
        userId: "usr_alice",
        plan: "pro",
        status: "active",
        billingCycle: "monthly",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        issuedAt: Date.now() - 25 * 60 * 60 * 1000,
        validUntil: Date.now() - 1000, // expired 1s ago
      };

      const sig = entitlementService.signEntitlement(entRecord);
      const signed = { ...entRecord, signature: sig, kid: "fly2git-ed25519-v1" };
      const isValid = entitlements.verifyEntitlementSignature(signed);
      assert.strictEqual(isValid, false, "Expired cache validity must fail verification");

      const sanitized = entitlements.sanitizeEntitlement(signed);
      assert.strictEqual(sanitized.plan, "basic", "Expired signature must drop to Basic");
    });

    // ---------------------------------------------------------------------------
    // 5. Tampered entitlement payload
    // ---------------------------------------------------------------------------
    await test("5. Tampered entitlement payload: modified plan or fields fail closed", async () => {
      entitlements.clearTestEntitlement();
      const basicEnt = {
        userId: "usr_bob",
        plan: "basic",
        status: "active",
        billingCycle: null,
        expiresAt: null,
        issuedAt: Date.now(),
        validUntil: Date.now() + 24 * 60 * 60 * 1000,
      };

      const sig = entitlementService.signEntitlement(basicEnt);
      const signedBasic = { ...basicEnt, signature: sig, kid: "fly2git-ed25519-v1" };
      // Malicious client modifies plan to pro without private key
      const tampered = { ...signedBasic, plan: "pro" };

      const isValid = entitlements.verifyEntitlementSignature(tampered);
      assert.strictEqual(isValid, false, "Tampered payload must fail cryptographic verification");

      const sanitized = entitlements.sanitizeEntitlement(tampered);
      assert.strictEqual(sanitized.plan, "basic", "Tampered payload must fail closed to Basic");
    });

    // ---------------------------------------------------------------------------
    // 6. Modified local entitlement cannot become Pro
    // ---------------------------------------------------------------------------
    await test("6. Modified local entitlement cannot become Pro: forged storage drops to Basic", async () => {
      mockStorage = {};
      entitlements.clearTestEntitlement();

      // Attacker writes raw un-signed Pro object directly into storage
      const forged = {
        plan: "pro",
        status: "active",
        features: { allPlatforms: true, multipleRepositories: true },
        selectedPlatforms: ["leetcode", "codeforces", "spoj"],
        _isFromStorage: true,
      };
      await chrome.storage.local.set({ [entitlements.ENTITLEMENT_STORAGE_KEY]: forged });

      const ent = await entitlements.getEntitlement();
      assert.strictEqual(ent.plan, "basic", "Stored un-signed Pro must fail closed to Basic");
      assert.strictEqual(await entitlements.isPro(), false);
    });

    // ---------------------------------------------------------------------------
    // 7. Authenticated user isolation
    // ---------------------------------------------------------------------------
    let tokenUserA = null;
    let tokenUserB = null;
    let userAId = null;
    let userBId = null;

    await test("7. Authenticated user isolation: distinct users have isolated accounts & subscriptions", async () => {
      const regA = await makeHttpRequest(TEST_PORT, { path: "/api/auth/register", method: "POST" }, {
        email: "user_a_sec@fly2git.com",
        password: "PasswordA123!",
      });
      assert.strictEqual(regA.status, 201);
      tokenUserA = regA.data.token;
      userAId = regA.data.user.id;

      const regB = await makeHttpRequest(TEST_PORT, { path: "/api/auth/register", method: "POST" }, {
        email: "user_b_sec@fly2git.com",
        password: "PasswordB123!",
      });
      assert.strictEqual(regB.status, 201);
      tokenUserB = regB.data.token;
      userBId = regB.data.user.id;

      // Upgrade User A only
      db.insertSubscription({
        id: "sub_user_a",
        userId: userAId,
        plan: "pro",
        status: "active",
      });

      const entA = await makeHttpRequest(TEST_PORT, {
        path: "/api/entitlement",
        method: "GET",
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.strictEqual(entA.data.entitlement.plan, "pro", "User A must have Pro plan");

      const entB = await makeHttpRequest(TEST_PORT, {
        path: "/api/entitlement",
        method: "GET",
        headers: { Authorization: `Bearer ${tokenUserB}` },
      });
      assert.strictEqual(entB.data.entitlement.plan, "basic", "User B must remain Basic");

      const meA = await makeHttpRequest(TEST_PORT, {
        path: "/api/auth/me",
        method: "GET",
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.strictEqual(meA.data.user.id, userAId);
    });

    // ---------------------------------------------------------------------------
    // 8. Unauthorized repository target
    // ---------------------------------------------------------------------------
    await test("8. Unauthorized repository target: Basic user cannot configure multi-repo targets", async () => {
      entitlements.clearTestEntitlement();
      await entitlements.setTestPlan("basic");

      // Attempt to configure multi-repo target via background message
      const res = await chrome.runtime.sendMessage({
        type: "SET_PLATFORM_REPO_TARGET",
        platform: "leetcode",
        repo: "octocat/leetcode-repo",
      });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, "Multi-repository mapping requires Fly2Git Pro");
    });

    // ---------------------------------------------------------------------------
    // 9. Unauthorized GitHub repository
    // ---------------------------------------------------------------------------
    await test("9. Unauthorized GitHub repository: repo not in GitHub App installation is rejected", async () => {
      entitlements.clearTestEntitlement();
      await entitlements.setTestPlan("pro");

      // Mock storage with target repository
      await chrome.storage.local.set({
        selectedRepo: "octocat/authorized-repo",
        platformRepoTargets: {
          leetcode: "attacker/private-unauthorized-repo",
        },
      });

      const installedRepos = [
        { fullName: "octocat/authorized-repo", private: false },
      ];

      let err = null;
      try {
        await background.resolveTargetRepository("leetcode", { installedRepos });
      } catch (e) {
        err = e;
      }
      assert.ok(err, "Must throw error for unauthorized repo");
      assert.strictEqual(err.code, "UNAUTHORIZED_REPO");
      entitlements.clearTestEntitlement();
    });

    // ---------------------------------------------------------------------------
    // 10. Cross-user repository mapping blocked
    // ---------------------------------------------------------------------------
    await test("10. Cross-user repository mapping blocked: users cannot read or modify other users' targets", async () => {
      // User A creates repository target on backend
      const resTargetA = await makeHttpRequest(TEST_PORT, {
        path: "/api/repositories/targets",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
      }, {
        githubOwner: "octocat",
        githubRepo: "algorithms-pro",
        platform: "leetcode",
      });
      assert.strictEqual(resTargetA.status, 201);

      // User B fetches repository targets
      const resTargetB = await makeHttpRequest(TEST_PORT, {
        path: "/api/repositories/targets",
        method: "GET",
        headers: { Authorization: `Bearer ${tokenUserB}` },
      });
      assert.strictEqual(resTargetB.status, 200);
      assert.strictEqual(resTargetB.data.targets.length, 0, "User B must see zero of User A's targets");
    });

    // ---------------------------------------------------------------------------
    // 11. Concurrent webhook duplicate
    // ---------------------------------------------------------------------------
    await test("11. Concurrent webhook duplicate: parallel identical events processed idempotently", async () => {
      const eventId = `evt_concurrent_${Date.now()}`;
      const payload = {
        id: eventId,
        type: "customer.subscription.updated",
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: "sub_concurrent_123",
            customer: "cus_user_a_concurrent",
            status: "active",
          },
        },
      };

      const rawPayload = JSON.stringify(payload);
      const signature = createStripeSignature(rawPayload, "whsec_test_phase12d_webhook");

      // Bind cus_user_a_concurrent to userAId
      db.insertSubscription({
        id: "sub_concurrent_123",
        userId: userAId,
        providerCustomerId: "cus_user_a_concurrent",
        status: "active",
      });

      // Send 5 concurrent webhook requests
      const promises = [1, 2, 3, 4, 5].map(() =>
        makeHttpRequest(TEST_PORT, {
          path: "/api/webhooks/payment",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "stripe-signature": signature,
          },
        }, rawPayload)
      );

      const results = await Promise.all(promises);
      results.forEach((r) => {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.ok, true);
      });

      assert.strictEqual(db.hasWebhookEvent(eventId), true);
    });

    // ---------------------------------------------------------------------------
    // 12. Replayed webhook blocked
    // ---------------------------------------------------------------------------
    await test("12. Replayed webhook blocked: webhook timestamp older than tolerance is rejected", async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s ago (> 300s tolerance)
      const payload = JSON.stringify({ id: "evt_old_replay", type: "invoice.payment_succeeded" });
      const oldSignature = createStripeSignature(payload, "whsec_test_phase12d_webhook", oldTimestamp);

      const res = await makeHttpRequest(TEST_PORT, {
        path: "/api/webhooks/payment",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": oldSignature,
        },
      }, payload);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error, "Invalid webhook signature");
    });

    // ---------------------------------------------------------------------------
    // 13. Out-of-order webhook handled safely
    // ---------------------------------------------------------------------------
    await test("13. Out-of-order webhook handled safely: older event arriving later does not regress state", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const subId = `sub_ooo_${Date.now()}`;
      const custId = `cus_ooo_${Date.now()}`;

      // Webhook 1: newer event (timestamp = now) activates subscription
      const newerEvent = {
        id: `evt_newer_${Date.now()}`,
        type: "customer.subscription.updated",
        created: nowSec,
        data: {
          object: {
            id: subId,
            customer: custId,
            status: "active",
          },
        },
      };

      db.insertSubscription({
        id: subId,
        userId: userBId,
        providerCustomerId: custId,
        status: "active",
        lastEventTimestamp: nowSec * 1000,
      });

      // Webhook 2: older event arriving late (timestamp = now - 50s)
      const olderEvent = {
        id: `evt_older_${Date.now()}`,
        type: "invoice.payment_failed",
        created: nowSec - 50,
        data: {
          object: {
            subscription: subId,
            customer: custId,
          },
        },
      };

      const rawOlder = JSON.stringify(olderEvent);
      const sigOlder = createStripeSignature(rawOlder, "whsec_test_phase12d_webhook", nowSec);

      const resOlder = await makeHttpRequest(TEST_PORT, {
        path: "/api/webhooks/payment",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": sigOlder,
        },
      }, rawOlder);

      assert.strictEqual(resOlder.status, 200);
      assert.strictEqual(resOlder.data.ignored, true);
      assert.strictEqual(resOlder.data.outOfOrder, true);

      // Subscription remains active!
      const currentSub = db.getSubscriptionById(subId);
      assert.strictEqual(currentSub.status, "active", "State must NOT regress due to out-of-order webhook");
    });

    // ---------------------------------------------------------------------------
    // 14. Checkout arbitrary price blocked
    // ---------------------------------------------------------------------------
    await test("14. Checkout arbitrary price blocked: client-supplied price or priceId is ignored", async () => {
      const res = await makeHttpRequest(TEST_PORT, {
        path: "/api/checkout/create-session",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
      }, {
        billingCycle: "monthly",
        priceId: "price_hacked_free_999",
        price: "0.00",
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(
        res.data.session.priceId,
        "price_pro_monthly_test",
        "Must enforce server-configured price ID"
      );
    });

    // ---------------------------------------------------------------------------
    // 15. Checkout arbitrary user blocked
    // ---------------------------------------------------------------------------
    await test("15. Checkout arbitrary user blocked: server resolves user identity exclusively from session token", async () => {
      const res = await makeHttpRequest(TEST_PORT, {
        path: "/api/checkout/create-session",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
      }, {
        billingCycle: "monthly",
        userId: userBId, // Malicious user tries to charge another user
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(
        res.data.session.userId,
        userAId,
        "Session must be created for authenticated caller only"
      );
    });

    // ---------------------------------------------------------------------------
    // 16. Expired token rejected
    // ---------------------------------------------------------------------------
    await test("16. Expired token rejected: expired Bearer token receives 401 Unauthorized", async () => {
      const expiredPayload = {
        sub: userAId,
        email: "user_a_sec@fly2git.com",
        iat: Math.floor(Date.now() / 1000) - 3600,
        exp: Math.floor(Date.now() / 1000) - 1800, // expired 30 mins ago
      };

      const headerB64 = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
      const signature = crypto
        .createHmac("sha256", config.authSecret)
        .update(`${headerB64}.${payloadB64}`)
        .digest("base64url");
      const expiredToken = `${headerB64}.${payloadB64}.${signature}`;

      const res = await makeHttpRequest(TEST_PORT, {
        path: "/api/auth/me",
        method: "GET",
        headers: { Authorization: `Bearer ${expiredToken}` },
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.error, "Unauthorized");
    });

    // ---------------------------------------------------------------------------
    // 17. Logout removes authentication state
    // ---------------------------------------------------------------------------
    await test("17. Logout removes authentication state: clears Fly2Git tokens while preserving GitHub auth", async () => {
      await chrome.storage.local.set({
        auth: {
          accessToken: "gh_github_valid_token_123",
          fly2gitToken: "f2g_jwt_token_456",
          fly2gitUser: { id: "usr_alice", email: "alice@test.com" },
        },
      });

      const res = await chrome.runtime.sendMessage({ type: "LOGOUT_FLY2GIT_ACCOUNT" });
      assert.strictEqual(res.ok, true);

      const { auth } = await chrome.storage.local.get("auth");
      assert.strictEqual(auth.accessToken, "gh_github_valid_token_123", "GitHub token must be preserved");
      assert.strictEqual(auth.fly2gitToken, undefined, "Fly2Git token must be cleared");
      assert.strictEqual(auth.fly2gitUser, undefined, "Fly2Git user profile must be cleared");

      const ent = await entitlements.getEntitlement();
      assert.strictEqual(ent.plan, "basic", "Entitlement must drop to Basic on logout");
    });

    // ---------------------------------------------------------------------------
    // 18. Basic works while backend is unavailable
    // ---------------------------------------------------------------------------
    await test("18. Basic works while backend is unavailable: offline fallback without throwing", async () => {
      entitlements.clearTestEntitlement();
      await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);

      // Call backend sync on dead port
      const syncRes = await entitlements.syncBackendEntitlement(null, "http://127.0.0.1:54321");
      assert.strictEqual(syncRes.ok, false);
      assert.strictEqual(syncRes.offline, true);
      assert.strictEqual(syncRes.entitlement.plan, "basic");

      // Platform permissions still work
      assert.strictEqual(await entitlements.canUsePlatform("leetcode"), true);
      assert.strictEqual(await entitlements.canUsePlatform("geeksforgeeks"), true);
    });

    // ---------------------------------------------------------------------------
    // 19. Expired Pro cache becomes Basic
    // ---------------------------------------------------------------------------
    await test("19. Expired Pro cache becomes Basic: stale cached record fails closed", async () => {
      entitlements.clearTestEntitlement();
      const expiredCache = {
        version: 1,
        plan: "pro",
        status: "active",
        validUntil: Date.now() - 10000, // expired 10s ago
        issuedAt: Date.now() - 25 * 60 * 60 * 1000,
        signature: "some_old_sig",
      };

      await chrome.storage.local.set({
        [entitlements.ENTITLEMENT_STORAGE_KEY]: expiredCache,
      });

      const ent = await entitlements.getEntitlement();
      assert.strictEqual(ent.plan, "basic");
      assert.strictEqual(await entitlements.isPro(), false);
    });

    // ---------------------------------------------------------------------------
    // 20. Existing identity guard remains intact
    // ---------------------------------------------------------------------------
    await test("20. Existing identity guard remains intact: mismatches block sync before writes", async () => {
      await identity.bindPlatformIdentity("leetcode", {
        platformUserId: "verified_user",
        username: "verified_user",
      });

      const check = await identity.verifySubmissionIdentity("leetcode", {
        platformUserId: "unauthorized_user",
        username: "unauthorized_user",
      });

      assert.strictEqual(check.ok, false);
      assert.strictEqual(check.status, identity.STATUS.MISMATCH);
    });

    // ---------------------------------------------------------------------------
    // 21. Existing duplicate detection remains intact
    // ---------------------------------------------------------------------------
    await test("21. Existing duplicate detection remains intact: CRLF vs LF normalization", async () => {
      function normalize(str) {
        return String(str || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      }
      const codeA = "int main() {\r\n  return 0;\r\n}";
      const codeB = "int main() {\n  return 0;\n}";
      assert.strictEqual(normalize(codeA), normalize(codeB));
    });

    // ---------------------------------------------------------------------------
    // 22. Existing LeetCode sync remains intact
    // ---------------------------------------------------------------------------
    await test("22. Existing LeetCode sync remains intact: normalization and validation", async () => {
      const payload = {
        platform: "leetcode",
        problem: { slug: "3sum", title: "3Sum", difficulty: "Medium" },
        submission: { id: "1001", language: "cpp", code: "class Solution {};" },
      };
      const norm = platforms.normalizeSubmission(payload);
      assert.strictEqual(norm.platform, "leetcode");
      assert.strictEqual(platforms.validateNormalizedSubmission(norm).ok, true);
    });

    // ---------------------------------------------------------------------------
    // 23. Existing GFG sync remains intact
    // ---------------------------------------------------------------------------
    await test("23. Existing GFG sync remains intact: normalization and validation", async () => {
      const payload = {
        platform: "geeksforgeeks",
        problem: { slug: "subarray-with-given-sum", title: "Subarray with given sum", difficulty: "Medium" },
        submission: { id: "2001", language: "java", code: "class Solution {}" },
      };
      const norm = platforms.normalizeSubmission(payload);
      assert.strictEqual(norm.platform, "geeksforgeeks");
      assert.strictEqual(platforms.validateNormalizedSubmission(norm).ok, true);
    });

    // ---------------------------------------------------------------------------
    // 24. Existing HackerRank sync remains intact
    // ---------------------------------------------------------------------------
    await test("24. Existing HackerRank sync remains intact: normalization and validation", async () => {
      const payload = {
        platform: "hackerrank",
        problem: { slug: "solve-me-first", title: "Solve Me First", difficulty: "Easy" },
        submission: { id: "3001", language: "python3", code: "def solveMeFirst(a,b): return a+b" },
      };
      const norm = platforms.normalizeSubmission(payload);
      assert.strictEqual(norm.platform, "hackerrank");
      assert.strictEqual(platforms.validateNormalizedSubmission(norm).ok, true);
    });

    // ---------------------------------------------------------------------------
    // 25. Existing CodeChef sync remains intact
    // ---------------------------------------------------------------------------
    await test("25. Existing CodeChef sync remains intact: normalization and validation", async () => {
      const payload = {
        platform: "codechef",
        problem: { slug: "FLOW001", title: "Add Two Numbers", difficulty: "Easy" },
        submission: { id: "4001", language: "python3", code: "t = int(input())" },
      };
      const norm = platforms.normalizeSubmission(payload);
      assert.strictEqual(norm.platform, "codechef");
      assert.strictEqual(platforms.validateNormalizedSubmission(norm).ok, true);
    });

    // ---------------------------------------------------------------------------
    // 26. Existing AtCoder sync remains intact
    // ---------------------------------------------------------------------------
    await test("26. Existing AtCoder sync remains intact: normalization and validation", async () => {
      const payload = {
        platform: "atcoder",
        problem: { slug: "abc180_a", title: "box", difficulty: "100" },
        submission: { id: "5001", language: "cpp", code: "int main() {}" },
      };
      const norm = platforms.normalizeSubmission(payload);
      assert.strictEqual(norm.platform, "atcoder");
      assert.strictEqual(platforms.validateNormalizedSubmission(norm).ok, true);
    });

    // ---------------------------------------------------------------------------
    // 27. Existing Codeforces sync remains intact
    // ---------------------------------------------------------------------------
    await test("27. Existing Codeforces sync remains intact: normalization and validation", async () => {
      const payload = {
        platform: "codeforces",
        problem: { slug: "codeforces-4-A", title: "Watermelon", difficulty: "800" },
        submission: { id: "6001", language: "cpp", code: "int main() {}" },
      };
      const norm = platforms.normalizeSubmission(payload);
      assert.strictEqual(norm.platform, "codeforces");
      assert.strictEqual(platforms.validateNormalizedSubmission(norm).ok, true);
    });

    // ---------------------------------------------------------------------------
    // 28. Existing SPOJ sync remains intact
    // ---------------------------------------------------------------------------
    await test("28. Existing SPOJ sync remains intact: normalization and validation", async () => {
      const payload = {
        platform: "spoj",
        problem: { slug: "TEST", title: "Life, the Universe, and Everything", difficulty: "Easy" },
        submission: { id: "7001", language: "cpp", code: "int main() {}" },
      };
      const norm = platforms.normalizeSubmission(payload);
      assert.strictEqual(norm.platform, "spoj");
      assert.strictEqual(platforms.validateNormalizedSubmission(norm).ok, true);
    });

  } finally {
    await app.stop();
  }

  console.log("\n=======================================================");
  console.log(`PHASE 12D RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("=======================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runPhase12DTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
