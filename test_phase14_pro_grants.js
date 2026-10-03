// Fly2Git Phase 14 — Pro Grant / Allowlist System Tests
// Comprehensive test coverage for:
// - ProGrantService CRUD operations
// - Entitlement priority (grant > subscription > basic)
// - Expiry and revocation enforcement
// - Admin endpoint authorization
// - Audit trail
// - Edge cases and security

const http = require("http");
const crypto = require("crypto");
const Database = require("./backend/db/database");
const { ProGrantService, GRANT_TYPES, GRANT_STATUSES } = require("./backend/services/pro-grant-service");
const { EntitlementService, PRO_FEATURES, BASIC_FEATURES } = require("./backend/services/entitlement-service");
const AuthService = require("./backend/services/auth-service");
const { createServer } = require("./backend/server");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.error(`  ✗ FAIL: ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

// Helper: generate test Ed25519 keypair
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
const pubPem = publicKey.export({ type: "spki", format: "pem" });

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

const ADMIN_KEY = "test-admin-key-for-testing-only";

// ============================================================
// 1. ProGrantService Unit Tests
// ============================================================

async function runSuite() {
section("1. ProGrantService — createGrant");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);

  // Valid grant creation
  const grant = svc.createGrant({
    userId: user.id,
    type: "founder",
    grantedBy: "admin@fly2git.com",
    note: "Founder access",
  });
  assert(grant.id.startsWith("grant_"), "Grant ID has correct prefix");
  assertEqual(grant.userId, user.id, "Grant userId matches");
  assertEqual(grant.type, "founder", "Grant type is founder");
  assertEqual(grant.status, "active", "Grant status is active");
  assertEqual(grant.expiresAt, null, "Grant expiresAt is null (permanent)");
  assertEqual(grant.grantedBy, "admin@fly2git.com", "Grant grantedBy correct");
  assertEqual(grant.note, "Founder access", "Grant note correct");
  assert(typeof grant.grantedAt === "number", "Grant grantedAt is a timestamp");
}

section("1b. ProGrantService — createGrant with expiry");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);
  const futureTs = Date.now() + 7 * 24 * 60 * 60 * 1000;

  const grant = svc.createGrant({
    userId: user.id,
    type: "beta",
    expiresAt: futureTs,
    grantedBy: "admin",
    note: "Beta access for 7 days",
  });
  assertEqual(grant.expiresAt, futureTs, "Grant expiresAt matches future timestamp");
  assertEqual(grant.type, "beta", "Grant type is beta");
}

section("1c. ProGrantService — input validation");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);

  // Missing userId
  let threw = false;
  try {
    svc.createGrant({ type: "founder", grantedBy: "admin" });
  } catch (e) {
    threw = true;
    assertEqual(e.statusCode, 400, "Missing userId → 400");
  }
  assert(threw, "Missing userId throws");

  // Invalid type
  threw = false;
  try {
    svc.createGrant({ userId: user.id, type: "vip", grantedBy: "admin" });
  } catch (e) {
    threw = true;
    assertEqual(e.statusCode, 400, "Invalid type → 400");
  }
  assert(threw, "Invalid type throws");

  // Missing grantedBy
  threw = false;
  try {
    svc.createGrant({ userId: user.id, type: "founder" });
  } catch (e) {
    threw = true;
    assertEqual(e.statusCode, 400, "Missing grantedBy → 400");
  }
  assert(threw, "Missing grantedBy throws");

  // User not found
  threw = false;
  try {
    svc.createGrant({ userId: "usr_nonexistent", type: "founder", grantedBy: "admin" });
  } catch (e) {
    threw = true;
    assertEqual(e.statusCode, 404, "Unknown user → 404");
  }
  assert(threw, "Unknown user throws");

  // Invalid expiresAt
  threw = false;
  try {
    svc.createGrant({ userId: user.id, type: "founder", grantedBy: "admin", expiresAt: "not-a-number" });
  } catch (e) {
    threw = true;
    assertEqual(e.statusCode, 400, "Invalid expiresAt → 400");
  }
  assert(threw, "Invalid expiresAt throws");
}

section("1d. ProGrantService — duplicate active grant prevention");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);

  svc.createGrant({ userId: user.id, type: "founder", grantedBy: "admin" });

  let threw = false;
  try {
    svc.createGrant({ userId: user.id, type: "beta", grantedBy: "admin" });
  } catch (e) {
    threw = true;
    assertEqual(e.statusCode, 409, "Duplicate active grant → 409");
  }
  assert(threw, "Duplicate active grant throws conflict");
}

section("2. ProGrantService — revokeGrant");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);

  const grant = svc.createGrant({ userId: user.id, type: "team", grantedBy: "admin" });
  const revoked = svc.revokeGrant(grant.id, "admin@fly2git.com");

  assertEqual(revoked.status, "revoked", "Revoked grant status is revoked");
  assert(revoked.updatedAt >= grant.grantedAt, "updatedAt is updated");

  // Verify double-revoke fails
  let threw = false;
  try {
    svc.revokeGrant(grant.id, "admin");
  } catch (e) {
    threw = true;
    assertEqual(e.statusCode, 409, "Double revoke → 409");
  }
  assert(threw, "Double revoke throws conflict");

  // Verify revoke of nonexistent grant
  threw = false;
  try {
    svc.revokeGrant("grant_nonexistent", "admin");
  } catch (e) {
    threw = true;
    assertEqual(e.statusCode, 404, "Nonexistent grant revoke → 404");
  }
  assert(threw, "Nonexistent grant revoke throws not found");
}

section("3. ProGrantService — getActiveGrantForUser");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);

  // No grants
  assertEqual(svc.getActiveGrantForUser(user.id), null, "No grants → null");

  // Active permanent grant
  const grant = svc.createGrant({ userId: user.id, type: "founder", grantedBy: "admin" });
  const active = svc.getActiveGrantForUser(user.id);
  assertEqual(active.id, grant.id, "Active permanent grant found");

  // Revoked grant → no active grant
  svc.revokeGrant(grant.id, "admin");
  assertEqual(svc.getActiveGrantForUser(user.id), null, "Revoked grant → null");
}

section("3b. ProGrantService — expired grant enforcement");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);

  // Create a grant that already expired
  const pastTs = Date.now() - 1000;
  // Insert directly into db to bypass validation timing issues
  db.insertProGrant({
    id: "grant_expired_test",
    userId: user.id,
    type: "promotional",
    status: "active",
    grantedAt: Date.now() - 100000,
    expiresAt: pastTs,
    grantedBy: "admin",
    note: "Expired promo",
  });

  const result = svc.getActiveGrantForUser(user.id);
  assertEqual(result, null, "Expired grant returns null (immediately stops granting Pro)");
}

section("3c. ProGrantService — userHasActiveGrant");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);

  assertEqual(svc.userHasActiveGrant(user.id), false, "No grant → false");

  svc.createGrant({ userId: user.id, type: "team", grantedBy: "admin" });
  assertEqual(svc.userHasActiveGrant(user.id), true, "Active grant → true");
}

section("4. ProGrantService — listGrants with filters");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user1 = createTestUser(db, "user1@test.com");
  const user2 = createTestUser(db, "user2@test.com");

  svc.createGrant({ userId: user1.id, type: "founder", grantedBy: "admin" });
  const g2 = svc.createGrant({ userId: user2.id, type: "beta", grantedBy: "admin" });
  svc.revokeGrant(g2.id, "admin");

  const allGrants = svc.listGrants();
  assertEqual(allGrants.length, 2, "All grants returned");

  const activeOnly = svc.listGrants({ status: "active" });
  assertEqual(activeOnly.length, 1, "Only active grants filtered");
  assertEqual(activeOnly[0].userId, user1.id, "Active grant belongs to user1");

  const revokedOnly = svc.listGrants({ status: "revoked" });
  assertEqual(revokedOnly.length, 1, "Only revoked grants filtered");

  const user1Grants = svc.listGrants({ userId: user1.id });
  assertEqual(user1Grants.length, 1, "User1 grants filtered");
}

// ============================================================
// 5. Entitlement Priority Tests
// ============================================================

section("5. Entitlement Priority — Grant > Subscription > Basic");
{
  const db = createTestDb();
  const grantSvc = new ProGrantService(db);
  const entSvc = new EntitlementService(db, {
    proGrantService: grantSvc,
    privateKey: privPem,
    publicKey: pubPem,
  });

  const user = createTestUser(db);

  // No grant, no subscription → Basic
  let ent = await entSvc.getAuthoritativeEntitlement(user.id);
  assertEqual(ent.plan, "basic", "No grant, no sub → basic");
  assertEqual(ent.features.allPlatforms, false, "Basic features");

  // Add subscription → Pro via subscription
  db.insertSubscription({
    id: `sub_test`,
    userId: user.id,
    status: "active",
    billingCycle: "monthly",
    currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });

  ent = await entSvc.getAuthoritativeEntitlement(user.id);
  assertEqual(ent.plan, "pro", "Active subscription → pro");
  assertEqual(ent.features.allPlatforms, true, "Pro features");
  assertEqual(ent.grantType, undefined, "No grant type when sub-based");

  // Add grant → Pro via grant (even with active subscription)
  grantSvc.createGrant({ userId: user.id, type: "founder", grantedBy: "admin" });

  ent = await entSvc.getAuthoritativeEntitlement(user.id);
  assertEqual(ent.plan, "pro", "Grant + sub → pro");
  assertEqual(ent.grantType, "founder", "grantType indicates founder when grant active");

  // Revoke grant → Pro via subscription still
  const grants = grantSvc.listGrants({ userId: user.id, status: "active" });
  grantSvc.revokeGrant(grants[0].id, "admin");

  ent = await entSvc.getAuthoritativeEntitlement(user.id);
  assertEqual(ent.plan, "pro", "Revoked grant but active sub → still pro");
  assertEqual(ent.grantType, undefined, "No grantType after revocation");
}

section("5b. Entitlement Priority — Grant without subscription");
{
  const db = createTestDb();
  const grantSvc = new ProGrantService(db);
  const entSvc = new EntitlementService(db, {
    proGrantService: grantSvc,
    privateKey: privPem,
    publicKey: pubPem,
  });

  const user = createTestUser(db);

  // Grant only, no subscription → Pro
  grantSvc.createGrant({ userId: user.id, type: "beta", grantedBy: "admin" });

  const ent = await entSvc.getAuthoritativeEntitlement(user.id);
  assertEqual(ent.plan, "pro", "Grant without sub → pro");
  assertEqual(ent.status, "active", "Status is active");
  assertEqual(ent.billingCycle, null, "No billing cycle for grant-only");
  assertEqual(ent.grantType, "beta", "grantType is beta");
}

section("5c. Entitlement — Expired grant falls back correctly");
{
  const db = createTestDb();
  const grantSvc = new ProGrantService(db);
  const entSvc = new EntitlementService(db, {
    proGrantService: grantSvc,
    privateKey: privPem,
    publicKey: pubPem,
  });

  const user = createTestUser(db);

  // Insert expired grant directly
  db.insertProGrant({
    id: "grant_expiry_test",
    userId: user.id,
    type: "promotional",
    status: "active",
    grantedAt: Date.now() - 100000,
    expiresAt: Date.now() - 1000, // Already expired
    grantedBy: "admin",
    note: "Expired",
  });

  const ent = await entSvc.getAuthoritativeEntitlement(user.id);
  assertEqual(ent.plan, "basic", "Expired grant → basic");
}

section("5d. Entitlement — Signature verifies correctly with grant metadata");
{
  const db = createTestDb();
  const grantSvc = new ProGrantService(db);
  const entSvc = new EntitlementService(db, {
    proGrantService: grantSvc,
    privateKey: privPem,
    publicKey: pubPem,
  });

  const user = createTestUser(db);
  grantSvc.createGrant({ userId: user.id, type: "founder", grantedBy: "admin" });

  const ent = await entSvc.getAuthoritativeEntitlement(user.id);
  assert(ent.signature && ent.signature.length > 0, "Entitlement has signature");

  const valid = entSvc.verifySignature(ent);
  assert(valid, "Signature verifies for grant-based entitlement");
}

section("5e. Entitlement — No proGrantService configured (backward compatibility)");
{
  const db = createTestDb();
  // No proGrantService passed → should work as before
  const entSvc = new EntitlementService(db, {
    privateKey: privPem,
    publicKey: pubPem,
  });

  const user = createTestUser(db);
  const ent = await entSvc.getAuthoritativeEntitlement(user.id);
  assertEqual(ent.plan, "basic", "Without grant service → basic (backward compat)");
}

// ============================================================
// 6. Audit Trail Tests
// ============================================================

section("6. Audit Trail — Grant and Revoke");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);

  const grant = svc.createGrant({ userId: user.id, type: "founder", grantedBy: "ceo@fly2git.com", note: "Founding member" });

  const createEvents = db.getAuditEvents({ action: "pro_grant_created" });
  assertEqual(createEvents.length, 1, "Create audit event recorded");
  assertEqual(createEvents[0].grantId, grant.id, "Audit event has correct grantId");
  assertEqual(createEvents[0].grantedBy, "ceo@fly2git.com", "Audit event has grantedBy");
  assertEqual(createEvents[0].userId, user.id, "Audit event has userId");

  svc.revokeGrant(grant.id, "admin@fly2git.com");

  const revokeEvents = db.getAuditEvents({ action: "pro_grant_revoked" });
  assertEqual(revokeEvents.length, 1, "Revoke audit event recorded");
  assertEqual(revokeEvents[0].revokedBy, "admin@fly2git.com", "Revoke audit has revokedBy");

  const allEvents = db.getAuditEvents({ userId: user.id });
  assertEqual(allEvents.length, 2, "Both audit events for user");
}

// ============================================================
// 7. Database Persistence Tests
// ============================================================

section("7. Database — Pro Grant persistence and indexes");
{
  const db = createTestDb();
  const user = createTestUser(db);

  const inserted = db.insertProGrant({
    id: "grant_persist_test",
    userId: user.id,
    type: "team",
    status: "active",
    grantedBy: "admin",
    note: "Persistence test",
  });

  // Retrieve by ID
  const byId = db.getProGrantById("grant_persist_test");
  assertEqual(byId.id, "grant_persist_test", "Retrieved by ID");
  assertEqual(byId.userId, user.id, "userId persisted");

  // Retrieve by userId
  const byUser = db.getProGrantsByUserId(user.id);
  assertEqual(byUser.length, 1, "Retrieved by userId");

  // Get all
  const all = db.getAllProGrants();
  assertEqual(all.length, 1, "getAllProGrants works");

  // Update
  const updated = db.updateProGrant("grant_persist_test", { status: "revoked" });
  assertEqual(updated.status, "revoked", "Status updated");
  assertEqual(updated.userId, user.id, "userId immutable after update");
  assertEqual(updated.grantedBy, "admin", "grantedBy immutable after update");

  // Delete
  const deleted = db.deleteProGrant("grant_persist_test");
  assert(deleted, "Delete returns true");
  assertEqual(db.getProGrantById("grant_persist_test"), null, "Grant deleted");
  assertEqual(db.getProGrantsByUserId(user.id).length, 0, "Index cleaned after delete");

  // Delete nonexistent
  assertEqual(db.deleteProGrant("nonexistent"), false, "Delete nonexistent returns false");
}

section("7b. Database — reset clears grants and audit");
{
  const db = createTestDb();
  const user = createTestUser(db);
  db.insertProGrant({ id: "g1", userId: user.id, type: "founder", grantedBy: "admin" });
  db.recordAuditEvent({ action: "test", timestamp: Date.now() });

  db.reset();
  assertEqual(db.getAllProGrants().length, 0, "Grants cleared after reset");
  assertEqual(db.getAuditEvents().length, 0, "Audit events cleared after reset");
}

// ============================================================
// 8. HTTP Admin Endpoint Tests
// ============================================================

section("8. Admin Endpoints — Integration Tests");
{
  const app = createServer({
    memoryOnly: true,
    _testAdminKey: ADMIN_KEY,
  });

  // Override admin key for testing
  const origKey = require("./backend/config").adminApiKey;
  require("./backend/config").adminApiKey = ADMIN_KEY;

  const port = 19876 + Math.floor(Math.random() * 1000);

  await app.start(port);

  function makeRequest(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      let postData = null;
      const reqHeaders = { ...headers };
      if (body !== null) {
        postData = typeof body === "string" ? body : JSON.stringify(body);
        if (!reqHeaders["Content-Type"]) {
          reqHeaders["Content-Type"] = "application/json";
        }
        reqHeaders["Content-Length"] = Buffer.byteLength(postData);
      }

      const opts = {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: reqHeaders,
      };

      const req = http.request(opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });

      req.on("error", reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  try {
    // Register a test user first
    const regRes = await makeRequest("POST", "/api/auth/register", {
      email: "granttest@fly2git.com",
      password: "securepassword123",
    });
    assertEqual(regRes.status, 201, "User registered");
    const testUserId = regRes.body.user.id;
    const userToken = regRes.body.token;

    // ---- 8a. No admin key → 403 ----
    let res = await makeRequest("POST", "/api/admin/pro-grants", {
      userId: testUserId,
      type: "founder",
      grantedBy: "admin",
    });
    assertEqual(res.status, 403, "No admin key → 403");

    res = await makeRequest("GET", "/api/admin/pro-grants");
    assertEqual(res.status, 403, "GET without admin key → 403");

    // ---- 8b. Wrong admin key → 403 ----
    res = await makeRequest("POST", "/api/admin/pro-grants", {
      userId: testUserId,
      type: "founder",
      grantedBy: "admin",
    }, { "X-Admin-Key": "wrong-key" });
    assertEqual(res.status, 403, "Wrong admin key → 403");

    // ---- 8c. User token instead of admin key → 403 ----
    res = await makeRequest("POST", "/api/admin/pro-grants", {
      userId: testUserId,
      type: "founder",
      grantedBy: "admin",
    }, { "Authorization": `Bearer ${userToken}` });
    assertEqual(res.status, 403, "User Bearer token not valid for admin → 403");

    // ---- 8d. Valid admin key → create grant ----
    res = await makeRequest("POST", "/api/admin/pro-grants", {
      userId: testUserId,
      type: "founder",
      grantedBy: "admin@fly2git.com",
      note: "API test grant",
    }, { "X-Admin-Key": ADMIN_KEY });
    assertEqual(res.status, 201, "Grant created with admin key");
    assertEqual(res.body.ok, true, "Response ok");
    assertEqual(res.body.grant.type, "founder", "Grant type correct");
    assertEqual(res.body.grant.userId, testUserId, "Grant userId correct");
    const grantId = res.body.grant.id;

    // ---- 8e. List grants ----
    res = await makeRequest("GET", "/api/admin/pro-grants", null, {
      "X-Admin-Key": ADMIN_KEY,
    });
    assertEqual(res.status, 200, "List grants 200");
    assert(res.body.grants.length >= 1, "At least 1 grant listed");

    // ---- 8f. List with status filter ----
    res = await makeRequest("GET", "/api/admin/pro-grants?status=active", null, {
      "X-Admin-Key": ADMIN_KEY,
    });
    assertEqual(res.status, 200, "Filtered list 200");
    assert(res.body.grants.every((g) => g.status === "active"), "All returned grants are active");

    // ---- 8g. Verify entitlement reflects grant ----
    res = await makeRequest("GET", "/api/entitlement", null, {
      "Authorization": `Bearer ${userToken}`,
    });
    assertEqual(res.status, 200, "Entitlement endpoint 200");
    assertEqual(res.body.entitlement.plan, "pro", "User now has Pro via grant");

    // ---- 8h. Revoke grant via DELETE ----
    res = await makeRequest("DELETE", `/api/admin/pro-grants/${grantId}`, {
      revokedBy: "admin@fly2git.com",
    }, { "X-Admin-Key": ADMIN_KEY });
    assertEqual(res.status, 200, "Grant revoked 200");
    assertEqual(res.body.grant ? res.body.grant.status : undefined, "revoked", "Grant status is revoked");

    // ---- 8i. Verify entitlement falls back to Basic after revocation ----
    res = await makeRequest("GET", "/api/entitlement", null, {
      "Authorization": `Bearer ${userToken}`,
    });
    assertEqual(res.status, 200, "Entitlement after revoke 200");
    assertEqual(res.body.entitlement.plan, "basic", "User back to Basic after grant revoked");

    // ---- 8j. DELETE on already-revoked grant → error ----
    res = await makeRequest("DELETE", `/api/admin/pro-grants/${grantId}`, {
      revokedBy: "admin",
    }, { "X-Admin-Key": ADMIN_KEY });
    assertEqual(res.status, 409, "Double revoke → 409");

    // ---- 8k. DELETE on nonexistent grant → error ----
    res = await makeRequest("DELETE", "/api/admin/pro-grants/grant_doesnt_exist", {
      revokedBy: "admin",
    }, { "X-Admin-Key": ADMIN_KEY });
    assertEqual(res.status, 404, "Nonexistent grant DELETE → 404");

    // ---- 8l. Create grant for nonexistent user → error ----
    res = await makeRequest("POST", "/api/admin/pro-grants", {
      userId: "usr_nonexistent",
      type: "beta",
      grantedBy: "admin",
    }, { "X-Admin-Key": ADMIN_KEY });
    assertEqual(res.status, 404, "Grant for nonexistent user → 404");

    // ---- 8m. Duplicate active grant → error ----
    // First create a new grant
    res = await makeRequest("POST", "/api/admin/pro-grants", {
      userId: testUserId,
      type: "team",
      grantedBy: "admin",
    }, { "X-Admin-Key": ADMIN_KEY });
    assertEqual(res.status, 201, "Second grant created after revocation");

    // Try to create another while first is active
    res = await makeRequest("POST", "/api/admin/pro-grants", {
      userId: testUserId,
      type: "beta",
      grantedBy: "admin",
    }, { "X-Admin-Key": ADMIN_KEY });
    assertEqual(res.status, 409, "Duplicate active grant via API → 409");

  } finally {
    // Restore original config
    require("./backend/config").adminApiKey = origKey;
    await app.stop();
  }
}

// ============================================================
// 9. Security Tests
// ============================================================

section("9. Security — Grant logic NOT in extension files");
{
  const fs = require("fs");
  const path = require("path");
  const projectRoot = path.resolve(__dirname);

  const extensionFiles = [
    "popup.js",
    "entitlements.js",
    "content.js",
    "inject.js",
  ];

  const grantPatterns = [
    /ProGrant/i,
    /pro-grant/i,
    /createGrant/i,
    /revokeGrant/i,
    /grantedBy/i,
    /proGrantService/i,
    /admin.*grant/i,
  ];

  for (const file of extensionFiles) {
    const filePath = path.join(projectRoot, file);
    if (!fs.existsSync(filePath)) {
      passed++;
      continue; // File doesn't exist, which is fine
    }
    const content = fs.readFileSync(filePath, "utf8");
    for (const pattern of grantPatterns) {
      const found = pattern.test(content);
      assert(!found, `${file} must NOT contain grant logic (pattern: ${pattern})`);
    }
  }
}

section("9b. Security — Admin key constant-time comparison");
{
  // Verify the admin key check uses timingSafeEqual (structural check)
  const fs = require("fs");
  const serverCode = fs.readFileSync(require("path").resolve(__dirname, "backend/server.js"), "utf8");
  assert(serverCode.includes("timingSafeEqual"), "Server uses timingSafeEqual for admin key");
  assert(serverCode.includes("x-admin-key"), "Server checks X-Admin-Key header");
}

section("9c. Security — Note truncation");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);

  const longNote = "A".repeat(1000);
  const grant = svc.createGrant({
    userId: user.id,
    type: "promotional",
    grantedBy: "admin",
    note: longNote,
  });
  assert(grant.note.length <= 500, "Note truncated to 500 chars max");
}

// ============================================================
// 10. Edge Cases
// ============================================================

section("10. Edge Cases — null/undefined userId");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);

  assertEqual(svc.getActiveGrantForUser(null), null, "null userId → null");
  assertEqual(svc.getActiveGrantForUser(undefined), null, "undefined userId → null");
  assertEqual(svc.userHasActiveGrant(""), false, "empty userId → false");
}

section("10b. Edge Cases — Grant after revoke allows new grant");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);
  const user = createTestUser(db);

  const g1 = svc.createGrant({ userId: user.id, type: "beta", grantedBy: "admin" });
  svc.revokeGrant(g1.id, "admin");

  // Should now be able to create a new grant
  const g2 = svc.createGrant({ userId: user.id, type: "team", grantedBy: "admin" });
  assert(g2.id !== g1.id, "New grant has different ID");
  assertEqual(g2.status, "active", "New grant is active");
  assertEqual(svc.userHasActiveGrant(user.id), true, "User has active grant after re-grant");
}

section("10c. Edge Cases — All valid grant types");
{
  const db = createTestDb();
  const svc = new ProGrantService(db);

  for (const type of GRANT_TYPES) {
    const user = createTestUser(db, `${type}@test.com`);
    const grant = svc.createGrant({ userId: user.id, type, grantedBy: "admin" });
    assertEqual(grant.type, type, `Grant type '${type}' works`);
  }

  assertEqual(GRANT_TYPES.length, 4, "Exactly 4 grant types");
  assert(GRANT_TYPES.includes("founder"), "founder type exists");
  assert(GRANT_TYPES.includes("team"), "team type exists");
  assert(GRANT_TYPES.includes("beta"), "beta type exists");
  assert(GRANT_TYPES.includes("promotional"), "promotional type exists");
}

section("10d. Edge Cases — GRANT_STATUSES frozen");
{
  assertEqual(GRANT_STATUSES.length, 2, "Exactly 2 statuses");
  assert(GRANT_STATUSES.includes("active"), "active status exists");
  assert(GRANT_STATUSES.includes("revoked"), "revoked status exists");
}

// ============================================================
// Summary
// ============================================================

  console.log("\n" + "═".repeat(60));
  console.log(`Pro Grant Tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  • ${f}`));
  }
  console.log("═".repeat(60));
  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("FATAL ERROR in Phase 14 suite:", err);
  process.exit(1);
});
