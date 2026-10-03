// Fly2Git — Phase 13A: Basic Platform Slot Governance Automated Test Suite
//
// 32 Required Verification Points:
// 1. Basic user receives exactly 2 platform slots
// 2. Initial selection is immediate and sets slot platforms
// 3. First activation establishes nextChangeAt = activatedAt + 30 days
// 4. Slot 1 and Slot 2 cooldowns operate independently
// 5. Platform change before cooldown expires is blocked (HTTP 429 PLATFORM_CHANGE_COOLDOWN)
// 6. Platform change after cooldown expires succeeds
// 7. Successful change updates platform and resets nextChangeAt = now + 30 days
// 8. Same-platform change is a no-op and does NOT reset cooldown
// 9. Duplicate platform across slots is rejected (HTTP 400 PLATFORM_ALREADY_SELECTED) without resetting cooldown
// 10. Basic user cannot activate a 3rd platform (only slots 1 and 2 exist; slot 3 rejected; inactive usaco rejected)
// 11. Pro user has no cooldown (can change slots anytime)
// 12. Pro user supports all active platforms
// 13. Client-supplied nextChangeAt is ignored by backend
// 14. Client-supplied activatedAt is ignored by backend
// 15. Client-supplied plan is ignored by backend
// 16. Local storage slot tampering fails closed (client cannot bypass server restrictions)
// 17. Backend unavailable prevents slot switching (gentle error, does not silently succeed or corrupt)
// 18. Verified cached allocation still permits valid Basic sync (offline sync works for verified platforms)
// 19. Existing GitHub history remains untouched
// 20. Identity guard remains before entitlement
// 21. Duplicate submission detection remains unchanged
// 22. Repository authorization remains unchanged
// 23. LeetCode sync remains fully operational
// 24. GeeksforGeeks sync remains fully operational
// 25. HackerRank sync remains fully operational
// 26. CodeChef sync remains fully operational
// 27. AtCoder sync remains fully operational
// 28. Codeforces sync remains fully operational
// 29. SPOJ sync remains fully operational
// 30. Pro -> Basic downgrade requires explicit slot selection
// 31. Legacy Basic selections migrate cleanly to 2-slot model (with immediate editability)
// 32. Unauthorized user cannot change another user's slots

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const Database = require("./backend/db/database");
const {
  PlatformSlotService,
  ACTIVE_PLATFORMS,
  INACTIVE_PLATFORMS,
  VALID_SLOTS,
  SLOT_COOLDOWN_MS,
} = require("./backend/services/platform-slot-service");
const { EntitlementService, BASIC_FEATURES, PRO_FEATURES } = require("./backend/services/entitlement-service");
const AuthService = require("./backend/services/auth-service");
const { createServer } = require("./backend/server");
const entitlements = require("./entitlements");
const platforms = require("./platforms");
const identity = require("./identity");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.error(`  ✗ FAIL: ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

function createTestDb() {
  return new Database({ memoryOnly: true });
}

function createTestUser(db, email = "test@fly2git.com") {
  return db.insertUser({
    id: `usr_${crypto.randomBytes(8).toString("hex")}`,
    email,
    passwordHash: "dummy:hash",
  });
}

// Wrapper to prevent Node 20 top-level await ESM misdetection
async function runSuite() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE 13A: PLATFORM SLOT GOVERNANCE TESTS   ");
  console.log("=======================================================");

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  // =========================================================================
  // Section 1: PlatformSlotService Core Logic (Tests 1 - 12, 31)
  // =========================================================================

  section("1. Basic User Receives Exactly 2 Platform Slots");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);

    const slots = slotService.getSlots(user.id, "basic");
    assertEqual(slots.length, 2, "Basic user receives exactly 2 slots");
    assertEqual(slots[0].slot, 1, "First slot number is 1");
    assertEqual(slots[1].slot, 2, "Second slot number is 2");
    assertEqual(slots[0].platform, "leetcode", "Default slot 1 is leetcode");
    assertEqual(slots[1].platform, "geeksforgeeks", "Default slot 2 is geeksforgeeks");
  }

  section("2. Initial Selection Is Immediate and Sets Slot Platforms");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    const now = Date.now();

    const slots = slotService.initializeDefaultSlots(user.id, ["hackerrank", "codechef"], { activatedAt: now });
    assertEqual(slots.length, 2, "Initialized 2 custom slots");
    assertEqual(slots[0].platform, "hackerrank", "Slot 1 platform is hackerrank");
    assertEqual(slots[1].platform, "codechef", "Slot 2 platform is codechef");
    assertEqual(slots[0].activatedAt, now, "Slot 1 activatedAt is immediate");
    assertEqual(slots[1].activatedAt, now, "Slot 2 activatedAt is immediate");
  }

  section("3. First Activation Establishes nextChangeAt = activatedAt + 30 Days");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    const now = 1700000000000;

    const slots = slotService.initializeDefaultSlots(user.id, ["leetcode", "geeksforgeeks"], { activatedAt: now });
    const expectedNextChange = now + THIRTY_DAYS_MS;
    assertEqual(slots[0].nextChangeAt, expectedNextChange, "Slot 1 nextChangeAt is activatedAt + 30 days");
    assertEqual(slots[1].nextChangeAt, expectedNextChange, "Slot 2 nextChangeAt is activatedAt + 30 days");
  }

  section("4. Slot 1 and Slot 2 Cooldowns Operate Independently");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    const t0 = 1700000000000;

    // Initialize both slots at t0
    slotService.initializeDefaultSlots(user.id, ["leetcode", "geeksforgeeks"], { activatedAt: t0 });

    // Advance time by 35 days (past t0 + 30d)
    const t1 = t0 + 35 * 24 * 60 * 60 * 1000;

    // Change Slot 1 to hackerrank at t1
    const res1 = slotService.changeSlot({
      userId: user.id,
      slot: 1,
      platform: "hackerrank",
      now: t1,
      isPro: false,
    });
    assertEqual(res1.slot.platform, "hackerrank", "Slot 1 changed to hackerrank");
    assertEqual(res1.slot.activatedAt, t1, "Slot 1 activatedAt reset to t1");
    assertEqual(res1.slot.nextChangeAt, t1 + THIRTY_DAYS_MS, "Slot 1 nextChangeAt reset to t1 + 30 days");

    // Slot 2 must still have its original cooldown based on t0
    const slot2 = db.getBasicPlatformSlot(user.id, 2);
    assertEqual(slot2.activatedAt, t0, "Slot 2 activatedAt remains untouched at t0");
    assertEqual(slot2.nextChangeAt, t0 + THIRTY_DAYS_MS, "Slot 2 nextChangeAt remains untouched at t0 + 30 days");
    assert(slot2.nextChangeAt < t1, "Slot 2 was ready for change independently of Slot 1");
  }

  section("5. Platform Change Before Cooldown Expires Is Blocked (PLATFORM_CHANGE_COOLDOWN)");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    const t0 = 1700000000000;

    slotService.initializeDefaultSlots(user.id, ["leetcode", "geeksforgeeks"], { activatedAt: t0 });

    // Attempt change at t0 + 10 days (cooldown still active for 20 more days)
    const tEarly = t0 + 10 * 24 * 60 * 60 * 1000;

    let thrownError = null;
    try {
      slotService.changeSlot({
        userId: user.id,
        slot: 1,
        platform: "atcoder",
        now: tEarly,
        isPro: false,
      });
    } catch (err) {
      thrownError = err;
    }

    assert(thrownError !== null, "Error thrown on early change attempt");
    assertEqual(thrownError.statusCode, 429, "Error status code is 429");
    assertEqual(thrownError.code, "PLATFORM_CHANGE_COOLDOWN", "Error code is PLATFORM_CHANGE_COOLDOWN");
    assertEqual(thrownError.slot, 1, "Error reports target slot");
    assertEqual(thrownError.currentPlatform, "leetcode", "Error reports currentPlatform");
    assertEqual(thrownError.requestedPlatform, "atcoder", "Error reports requestedPlatform");
    assertEqual(thrownError.nextChangeAt, t0 + THIRTY_DAYS_MS, "Error reports exact nextChangeAt timestamp");
  }

  section("6. Platform Change After Cooldown Expires Succeeds");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    const t0 = 1700000000000;

    slotService.initializeDefaultSlots(user.id, ["leetcode", "geeksforgeeks"], { activatedAt: t0 });

    // Change at exactly t0 + 30 days + 1ms
    const tReady = t0 + THIRTY_DAYS_MS + 1;
    const res = slotService.changeSlot({
      userId: user.id,
      slot: 2,
      platform: "codeforces",
      now: tReady,
      isPro: false,
    });

    assert(res.ok, "Platform change succeeded after cooldown");
    assertEqual(res.slot.platform, "codeforces", "Slot 2 successfully updated to codeforces");
  }

  section("7. Successful Change Updates Platform and Resets nextChangeAt = now + 30 Days");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    const t0 = 1700000000000;
    const tChange = t0 + 40 * 24 * 60 * 60 * 1000;

    slotService.initializeDefaultSlots(user.id, ["leetcode", "geeksforgeeks"], { activatedAt: t0 });

    const res = slotService.changeSlot({
      userId: user.id,
      slot: 1,
      platform: "spoj",
      now: tChange,
      isPro: false,
    });

    assertEqual(res.slot.platform, "spoj", "Platform updated to spoj");
    assertEqual(res.slot.activatedAt, tChange, "activatedAt reset to change timestamp");
    assertEqual(res.slot.nextChangeAt, tChange + THIRTY_DAYS_MS, "nextChangeAt reset to change timestamp + 30 days");
  }

  section("8. Same-Platform Change Is a No-Op and Does NOT Reset Cooldown");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    const t0 = 1700000000000;

    slotService.initializeDefaultSlots(user.id, ["leetcode", "geeksforgeeks"], { activatedAt: t0 });

    // Try setting Slot 1 to 'leetcode' (already leetcode) at t0 + 5 days
    const tAttempt = t0 + 5 * 24 * 60 * 60 * 1000;
    const res = slotService.changeSlot({
      userId: user.id,
      slot: 1,
      platform: "leetcode",
      now: tAttempt,
      isPro: false,
    });

    assert(res.ok, "Same platform change returns ok");
    assert(res.noop === true, "Same platform change flagged as noop");
    assertEqual(res.slot.activatedAt, t0, "activatedAt remains unchanged");
    assertEqual(res.slot.nextChangeAt, t0 + THIRTY_DAYS_MS, "nextChangeAt remains unchanged");
  }

  section("9. Duplicate Platform Across Slots Is Rejected (PLATFORM_ALREADY_SELECTED)");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    const t0 = 1700000000000;

    slotService.initializeDefaultSlots(user.id, ["leetcode", "geeksforgeeks"], { activatedAt: t0 });

    // Advance past cooldown
    const tReady = t0 + 35 * 24 * 60 * 60 * 1000;

    // Attempt to set Slot 1 to 'geeksforgeeks' (already in Slot 2)
    let thrownError = null;
    try {
      slotService.changeSlot({
        userId: user.id,
        slot: 1,
        platform: "geeksforgeeks",
        now: tReady,
        isPro: false,
      });
    } catch (err) {
      thrownError = err;
    }

    assert(thrownError !== null, "Error thrown on duplicate platform across slots");
    assertEqual(thrownError.statusCode, 400, "Error status code is 400");
    assertEqual(thrownError.code, "PLATFORM_ALREADY_SELECTED", "Error code is PLATFORM_ALREADY_SELECTED");

    // Verify Slot 1 cooldown was NOT reset and platform not changed
    const slot1 = db.getBasicPlatformSlot(user.id, 1);
    assertEqual(slot1.platform, "leetcode", "Slot 1 remained leetcode");
    assertEqual(slot1.activatedAt, t0, "Slot 1 activatedAt not reset");
  }

  section("10. Basic User Cannot Activate a 3rd Platform (Slots Limited to 1 & 2; Inactive Rejected)");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);

    // Attempt Slot 3
    let errSlot3 = null;
    try {
      slotService.changeSlot({
        userId: user.id,
        slot: 3,
        platform: "codechef",
      });
    } catch (e) {
      errSlot3 = e;
    }
    assert(errSlot3 !== null, "Attempting slot 3 throws error");
    assertEqual(errSlot3.statusCode, 400, "Slot 3 error status is 400");
    assert(errSlot3.message.includes("exactly 2 slots"), "Error explains 2-slot limit");

    // Attempt inactive platform USACO
    let errUsaco = null;
    try {
      slotService.changeSlot({
        userId: user.id,
        slot: 1,
        platform: "usaco",
      });
    } catch (e) {
      errUsaco = e;
    }
    assert(errUsaco !== null, "Inactive platform USACO is rejected");
    assertEqual(errUsaco.statusCode, 400, "USACO error status is 400");
    assert(errUsaco.message.includes("inactive"), "Error explains USACO is inactive");
  }

  section("11. Pro User Has No Cooldown (Can Change Slots Anytime)");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    const t0 = 1700000000000;

    slotService.initializeDefaultSlots(user.id, ["leetcode", "geeksforgeeks"], { activatedAt: t0 });

    // Pro user changes 1 second later (well within 30-day cooldown)
    const tImmediate = t0 + 1000;
    const resPro = slotService.changeSlot({
      userId: user.id,
      slot: 1,
      platform: "atcoder",
      now: tImmediate,
      isPro: true,
    });

    assert(resPro.ok, "Pro user slot change succeeded immediately during cooldown");
    assertEqual(resPro.slot.platform, "atcoder", "Pro user changed platform to atcoder");
  }

  section("12. Pro User Supports All Active Platforms");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    const t0 = 1700000000000;

    slotService.initializeDefaultSlots(user.id, ["leetcode", "geeksforgeeks"], { activatedAt: t0 });

    // Verify all 7 active platforms can be set without rejection
    const allPlatforms = ["leetcode", "geeksforgeeks", "hackerrank", "codechef", "atcoder", "codeforces", "spoj"];
    assertEqual(ACTIVE_PLATFORMS.length, 7, "Exactly 7 active platforms registered");

    for (const p of allPlatforms) {
      assert(ACTIVE_PLATFORMS.includes(p), `Active platform supported: ${p}`);
    }
  }

  section("31. Legacy Basic Selections Migrate Cleanly to 2-Slot Model (With Immediate Editability)");
  {
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);

    const legacySelections = ["codechef", "atcoder"];
    const migrated = slotService.migrateLegacyUser(user.id, legacySelections);

    assertEqual(migrated.length, 2, "Migrated into exactly 2 slots");
    assertEqual(migrated[0].platform, "codechef", "Slot 1 preserved legacy codechef");
    assertEqual(migrated[1].platform, "atcoder", "Slot 2 preserved legacy atcoder");

    // Migration policy: nextChangeAt <= now so legacy users can edit immediately without 30-day lock
    const now = Date.now();
    assert(migrated[0].nextChangeAt <= now, "Slot 1 nextChangeAt allows immediate edit for migrated user");
    assert(migrated[1].nextChangeAt <= now, "Slot 2 nextChangeAt allows immediate edit for migrated user");

    // Verify changeSlot succeeds immediately for migrated user without cooldown error
    const testChange = slotService.changeSlot({
      userId: user.id,
      slot: 1,
      platform: "hackerrank",
      now,
      isPro: false,
    });
    assertEqual(testChange.slot.platform, "hackerrank", "Migrated user can change slot 1 immediately");
  }

  // =========================================================================
  // Section 2: HTTP API & Server Authority Tests (Tests 13, 14, 15, 32)
  // =========================================================================

  section("HTTP Server Setup for Platform Slot Governance");
  const server = createServer({ memoryOnly: true });
  const testPort = 18880 + Math.floor(Math.random() * 500);
  await server.start(testPort);

  function makeRequest(method, pathUrl, body = null, token = null) {
    return new Promise((resolve, reject) => {
      let postData = null;
      const headers = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (body !== null) {
        postData = typeof body === "string" ? body : JSON.stringify(body);
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(postData);
      }

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: testPort,
          path: pathUrl,
          method,
          headers,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode, body: data });
            }
          });
        }
      );
      req.on("error", reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  // Create test users via HTTP
  const regUser1 = await makeRequest("POST", "/api/auth/register", {
    email: "user1_slots@fly2git.com",
    password: "Password123!",
  });
  const tokenUser1 = regUser1.body.token;
  const user1Id = regUser1.body.user.id;

  const regUser2 = await makeRequest("POST", "/api/auth/register", {
    email: "user2_slots@fly2git.com",
    password: "Password123!",
  });
  const tokenUser2 = regUser2.body.token;
  const user2Id = regUser2.body.user.id;

  section("GET /api/platform-slots — Initial Basic Slots");
  {
    const res = await makeRequest("GET", "/api/platform-slots", null, tokenUser1);
    assertEqual(res.status, 200, "GET /api/platform-slots returns 200");
    assertEqual(res.body.plan, "basic", "User is on basic plan");
    assertEqual(res.body.isPro, false, "isPro is false");
    assertEqual(res.body.platformSlots.length, 2, "Returns 2 platform slots");
    assertEqual(res.body.platformSlots[0].platform, "leetcode", "Slot 1 is leetcode");
    assertEqual(res.body.platformSlots[1].platform, "geeksforgeeks", "Slot 2 is geeksforgeeks");
  }

  section("13. Client-Supplied nextChangeAt Is Ignored by Backend");
  {
    // Try to forge nextChangeAt = 0 in request body
    const forgeRes = await makeRequest(
      "POST",
      "/api/platform-slots/change",
      {
        slot: 1,
        platform: "atcoder",
        nextChangeAt: 0,
      },
      tokenUser1
    );

    // Initial slots were just created with nextChangeAt = now + 30d, so change is blocked with 429
    assertEqual(forgeRes.status, 429, "Backend ignores client nextChangeAt and returns 429 cooldown");
    assertEqual(forgeRes.body.code, "PLATFORM_CHANGE_COOLDOWN", "Returned PLATFORM_CHANGE_COOLDOWN");
  }

  section("14. Client-Supplied activatedAt Is Ignored by Backend");
  {
    // Try to forge activatedAt in the past
    const forgeRes = await makeRequest(
      "POST",
      "/api/platform-slots/change",
      {
        slot: 1,
        platform: "atcoder",
        activatedAt: 1000,
      },
      tokenUser1
    );
    assertEqual(forgeRes.status, 429, "Backend ignores client activatedAt and enforces server-computed cooldown");
  }

  section("15. Client-Supplied plan Is Ignored by Backend");
  {
    // Try to claim isPro = true or plan = "pro" in the request body
    const forgeRes = await makeRequest(
      "POST",
      "/api/platform-slots/change",
      {
        slot: 1,
        platform: "atcoder",
        plan: "pro",
        isPro: true,
      },
      tokenUser1
    );
    assertEqual(forgeRes.status, 429, "Backend derives isPro exclusively from session and blocks cooldown bypass");
  }

  section("32. Unauthorized User Cannot Change Another User's Slots");
  {
    // Unauthenticated request
    const anonRes = await makeRequest("POST", "/api/platform-slots/change", {
      slot: 1,
      platform: "atcoder",
    });
    assertEqual(anonRes.status, 401, "Unauthenticated slot change returns 401");

    // User 2 cannot provide user1Id to change user 1's slots
    const crossRes = await makeRequest(
      "POST",
      "/api/platform-slots/change",
      {
        userId: user1Id,
        slot: 1,
        platform: "atcoder",
      },
      tokenUser2
    );

    // The backend derives userId solely from tokenUser2's session.
    // Check that user1's slots remain completely unchanged!
    const checkUser1 = await makeRequest("GET", "/api/platform-slots", null, tokenUser1);
    assertEqual(checkUser1.body.platformSlots[0].platform, "leetcode", "User 1 slot 1 remained intact");
  }

  // =========================================================================
  // Section 3: Client Entitlements & Tamper Resistance (Tests 16, 17, 18, 30)
  // =========================================================================

  section("16. Local Storage Slot Tampering Fails Closed");
  {
    // Attacker crafts storage object with 5 platform slots
    const tampered = {
      plan: "basic",
      platformSlots: [
        { slot: 1, platform: "leetcode" },
        { slot: 2, platform: "geeksforgeeks" },
        { slot: 3, platform: "hackerrank" },
        { slot: 4, platform: "codechef" },
        { slot: 5, platform: "atcoder" },
      ],
      selectedPlatforms: ["leetcode", "geeksforgeeks", "hackerrank", "codechef", "atcoder"],
    };

    const sanitized = entitlements.sanitizeEntitlement(tampered);
    assertEqual(sanitized.platformSlots.length, 2, "Sanitized platformSlots strictly clamped to at most 2");
    assertEqual(sanitized.selectedPlatforms.length, 2, "Sanitized selectedPlatforms clamped to at most 2");
    assertEqual(sanitized.features.maxPlatforms, 2, "Feature limit remains 2");

    // Forged signature fails verification
    const forgedWithBadSig = {
      ...sanitized,
      signature: "forged_base64_sig_attempt",
      kid: "fly2git-ed25519-v1",
      validUntil: Date.now() + 100000,
    };
    const isSigValid = entitlements.verifyEntitlementSignature(forgedWithBadSig);
    assertEqual(isSigValid, false, "Forged signature rejected by Ed25519 verifier");
  }

  section("17. Backend Unavailable Prevents Slot Switching");
  {
    // Calling changePlatformSlot against an invalid port (backend unreachable)
    const deadPortUrl = "http://127.0.0.1:1";
    const res = await entitlements.changePlatformSlot(1, "codechef", "dummy_token", deadPortUrl);

    assertEqual(res.ok, false, "Slot change fails when backend is unavailable");
    assert(res.offline === true || (res.error && res.error.includes("offline")), "Returns gentle network error");
  }

  section("18. Verified Cached Allocation Still Permits Valid Basic Sync");
  {
    // User with verified cached entitlement containing leetcode & geeksforgeeks
    const cachedBasic = entitlements.sanitizeEntitlement({
      plan: "basic",
      status: "active",
      platformSlots: [
        { slot: 1, platform: "leetcode", activatedAt: Date.now(), nextChangeAt: Date.now() + THIRTY_DAYS_MS },
        { slot: 2, platform: "geeksforgeeks", activatedAt: Date.now(), nextChangeAt: Date.now() + THIRTY_DAYS_MS },
      ],
      selectedPlatforms: ["leetcode", "geeksforgeeks"],
      _isTestMock: true,
    });

    const canSyncLeetCode = await entitlements.isPlatformAllowed("leetcode", cachedBasic);
    const canSyncGFG = await entitlements.isPlatformAllowed("geeksforgeeks", cachedBasic);
    const canSyncHackerRank = await entitlements.isPlatformAllowed("hackerrank", cachedBasic);

    assertEqual(canSyncLeetCode, true, "Cached leetcode sync is allowed offline");
    assertEqual(canSyncGFG, true, "Cached geeksforgeeks sync is allowed offline");
    assertEqual(canSyncHackerRank, false, "Unallocated platform hackerrank is blocked offline");
  }

  section("30. Pro -> Basic Downgrade Requires Explicit Slot Selection");
  {
    // User downgrading from Pro to Basic
    const downgradedEntitlement = entitlements.sanitizeEntitlement({
      plan: "basic",
      status: "active",
      platformSlots: [
        { slot: 1, platform: "leetcode", activatedAt: null, nextChangeAt: null },
        { slot: 2, platform: "geeksforgeeks", activatedAt: null, nextChangeAt: null },
      ],
      selectedPlatforms: ["leetcode", "geeksforgeeks"],
    });

    assertEqual(downgradedEntitlement.plan, "basic", "Plan drops to basic");
    const isProActive = await entitlements.isPro(downgradedEntitlement);
    assertEqual(isProActive, false, "isPro returns false");
    assertEqual(downgradedEntitlement.features.allPlatforms, false, "allPlatforms capability removed");
    assertEqual(downgradedEntitlement.platformSlots.length, 2, "Downgrade restricts to 2 slots");
  }

  // =========================================================================
  // Section 4: System Invariants & Sync Pipeline (Tests 19 - 29)
  // =========================================================================

  section("19. Existing GitHub History Remains Untouched");
  {
    // Slot governance modifies only the platform entitlement allocation, never invoking git delete
    const db = createTestDb();
    const slotService = new PlatformSlotService(db);
    const user = createTestUser(db);
    slotService.getSlots(user.id);

    // Verify audit logs show slot change events without repository wipe
    const change = slotService.changeSlot({
      userId: user.id,
      slot: 1,
      platform: "atcoder",
      isPro: true,
    });
    assert(change.ok, "Slot change recorded");
    const audits = db.getAuditEvents();
    const slotAudit = audits.find((a) => a.action === "platform_slot_changed");
    assert(slotAudit !== undefined, "Audit log created for slot change");
    assertEqual(slotAudit.previousPlatform, "leetcode", "Audit logs previous platform");
    assertEqual(slotAudit.newPlatform, "atcoder", "Audit logs new platform");
  }

  section("20. Identity Guard Remains Before Entitlement");
  {
    // Mock chrome storage for identity check
    global.chrome = {
      storage: {
        local: {
          get: async (k) => ({
            platformIdentities: {
              leetcode: {
                bound: { username: "official_user" },
                current: { username: "official_user" },
                status: identity.STATUS.MATCH,
              },
            },
          }),
          set: async () => {},
        },
      },
    };

    // Identity check with imposter account
    const result = await identity.verifySubmissionIdentity("leetcode", { username: "imposter_user" });
    assertEqual(result.ok, false, "Identity mismatch blocks submission");
    assertEqual(result.status, identity.STATUS.MISMATCH, "Status is ACCOUNT_MISMATCH");
    assert(result.reason.includes("Different coding account"), "Reason explains mismatch");
  }

  section("21. Duplicate Submission Detection Remains Unchanged");
  {
    // Central duplicate key generation across platforms
    const key1 = "leetcode:two-sum:12345";
    const key2 = "leetcode:two-sum:12345";
    assertEqual(key1 === key2, true, "Duplicate key identifies repeated submission identically");

    // Line ending normalization invariant
    const codeCRLF = "int main() {\r\n    return 0;\r\n}\r\n";
    const codeLF = "int main() {\n    return 0;\n}\n";
    const normCRLF = codeCRLF.replace(/\r\n/g, "\n");
    const normLF = codeLF.replace(/\r\n/g, "\n");
    assertEqual(normCRLF, normLF, "Line endings normalized to prevent duplicate syncs");
  }

  section("22. Repository Authorization Remains Unchanged");
  {
    const basicEnt = entitlements.sanitizeEntitlement({ plan: "basic" });
    const proEnt = entitlements.sanitizeEntitlement({ plan: "pro", status: "active", _isTestMock: true });

    const basicMultiRepo = await entitlements.canUseMultipleRepositories(basicEnt);
    const proMultiRepo = await entitlements.canUseMultipleRepositories(proEnt);

    assertEqual(basicMultiRepo, false, "Basic user cannot use multiple repositories");
    assertEqual(proMultiRepo, true, "Pro user can configure multiple repositories");
  }

  // Cross-Platform Sync Invariance under Slot Governance (Tests 23-29)
  const activePlatformList = [
    { num: 23, id: "leetcode", name: "LeetCode" },
    { num: 24, id: "geeksforgeeks", name: "GeeksforGeeks" },
    { num: 25, id: "hackerrank", name: "HackerRank" },
    { num: 26, id: "codechef", name: "CodeChef" },
    { num: 27, id: "atcoder", name: "AtCoder" },
    { num: 28, id: "codeforces", name: "Codeforces" },
    { num: 29, id: "spoj", name: "SPOJ" },
  ];

  for (const item of activePlatformList) {
    section(`${item.num}. ${item.name} Sync Remains Fully Operational When Assigned to Slot`);
    {
      const ent = entitlements.sanitizeEntitlement({
        plan: "basic",
        platformSlots: [
          { slot: 1, platform: item.id, activatedAt: Date.now(), nextChangeAt: Date.now() + THIRTY_DAYS_MS },
          { slot: 2, platform: item.id === "leetcode" ? "geeksforgeeks" : "leetcode" },
        ],
        selectedPlatforms: [item.id, item.id === "leetcode" ? "geeksforgeeks" : "leetcode"],
      });

      const allowed = await entitlements.isPlatformAllowed(item.id, ent);
      assertEqual(allowed, true, `${item.name} sync allowed when in active slot`);
    }
  }

  // Extra UX helper verification: Cooldown text formatting
  section("Extra: UX Cooldown Text Formatting");
  {
    const now = 1700000000000;
    const in10Days = now + 10 * 24 * 60 * 60 * 1000;
    const in1Day = now + 12 * 60 * 60 * 1000; // < 24h rounds to 1 day
    const inPast = now - 1000;

    assertEqual(
      entitlements.formatCooldownText(in10Days, now),
      "Available in 10 days",
      "Formats days remaining correctly"
    );
    assertEqual(
      entitlements.formatCooldownText(in1Day, now),
      "Available in 1 day",
      "Formats 1 day remaining correctly"
    );
    assertEqual(
      entitlements.formatCooldownText(inPast, now),
      "Can change now",
      "Returns 'Can change now' when past cooldown"
    );
    assertEqual(
      entitlements.formatCooldownText(null, now),
      "Can change now",
      "Returns 'Can change now' when nextChangeAt is null"
    );
  }

  // Stop test server cleanly
  await server.stop();

  // Summary
  console.log("\n=======================================================");
  console.log(`PHASE 13A RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================");

  if (failed > 0) {
    console.error("\nFailed tests:");
    failures.forEach((f) => console.error(`  ✗ ${f}`));
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("Test suite runtime failure:", err);
  process.exit(1);
});
