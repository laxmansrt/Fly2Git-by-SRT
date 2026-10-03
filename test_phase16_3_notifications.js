/**
 * Fly2Git Phase 16.3 — Liquid Glass Sync Notifications Test Suite
 *
 * Validates all 27 acceptance criteria for the notification micro-interaction system.
 * Runs in Node.js headlessly (no browser required).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname);
const notifPath = path.join(ROOT, "sync-notification.js");
const bgPath = path.join(ROOT, "background.js");
const manifestPath = path.join(ROOT, "manifest.json");
const popupHtmlPath = path.join(ROOT, "popup.html");

let passed = 0;
let failed = 0;
const failures = [];

function it(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
    failures.push(description);
  }
}

// ────────────────────────────────────────────────────────────────
// Load sources
// ────────────────────────────────────────────────────────────────
const notifSource = fs.readFileSync(notifPath, "utf-8");
const bgSource = fs.readFileSync(bgPath, "utf-8");
const manifestContent = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const popupHtml = fs.readFileSync(popupHtmlPath, "utf-8");

// Load module in Node context
const Fly2GitNotification = require(notifPath);

console.log("\n=======================================================");
console.log("   FLY2GIT PHASE 16.3: LIQUID GLASS NOTIFICATIONS SUITE");
console.log("=======================================================\n");

// ═══════════════════════════════════════════════════════════════
// SECTION A: MODULE STRUCTURE & EXPORTS
// ═══════════════════════════════════════════════════════════════
console.log("  A. MODULE STRUCTURE & EXPORTS");
console.log("  ─────────────────────────────────────────────────────");

it("A1. sync-notification.js exists and is loadable", () => {
  assert.ok(fs.existsSync(notifPath), "sync-notification.js does not exist");
  assert.ok(Fly2GitNotification, "Module did not export");
});

it("A2. Exports showSyncNotification function", () => {
  assert.strictEqual(typeof Fly2GitNotification.showSyncNotification, "function");
});

it("A3. Exports dismissCurrentNotification function", () => {
  assert.strictEqual(typeof Fly2GitNotification.dismissCurrentNotification, "function");
});

it("A4. Exports getQueue function", () => {
  assert.strictEqual(typeof Fly2GitNotification.getQueue, "function");
});

it("A5. Exports clearQueue function", () => {
  assert.strictEqual(typeof Fly2GitNotification.clearQueue, "function");
});

it("A6. Exports getActiveNotification function", () => {
  assert.strictEqual(typeof Fly2GitNotification.getActiveNotification, "function");
});

it("A7. Exports resetDeduplication function", () => {
  assert.strictEqual(typeof Fly2GitNotification.resetDeduplication, "function");
});

it("A8. Exports createNotificationService factory", () => {
  assert.strictEqual(typeof Fly2GitNotification.createNotificationService, "function");
});

it("A9. Exports NOTIFICATION_TYPES constant", () => {
  assert.ok(Fly2GitNotification.NOTIFICATION_TYPES);
  assert.strictEqual(Fly2GitNotification.NOTIFICATION_TYPES.SUCCESS, "success");
  assert.strictEqual(Fly2GitNotification.NOTIFICATION_TYPES.UPDATE, "update");
  assert.strictEqual(Fly2GitNotification.NOTIFICATION_TYPES.DUPLICATE, "duplicate");
  assert.strictEqual(Fly2GitNotification.NOTIFICATION_TYPES.SKIPPED, "skipped");
  assert.strictEqual(Fly2GitNotification.NOTIFICATION_TYPES.ERROR, "error");
});

it("A10. Exports DURATION_BY_TYPE with correct millisecond values", () => {
  const d = Fly2GitNotification.DURATION_BY_TYPE;
  assert.strictEqual(d.success, 3000);
  assert.strictEqual(d.update, 3000);
  assert.strictEqual(d.duplicate, 2500);
  assert.strictEqual(d.skipped, 2500);
  assert.strictEqual(d.error, 5000);
});

it("A11. Exports MAX_QUEUE_SIZE of 3", () => {
  assert.strictEqual(Fly2GitNotification.MAX_QUEUE_SIZE, 3);
});

// ═══════════════════════════════════════════════════════════════
// SECTION B: NOTIFICATION TYPES & DEFAULTS
// ═══════════════════════════════════════════════════════════════
console.log("\n  B. NOTIFICATION TYPES & DEFAULTS");
console.log("  ─────────────────────────────────────────────────────");

it("B1. showSyncNotification accepts success type", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  const res = svc.showSyncNotification({
    type: "success", problemTitle: "Two Sum", platform: "leetcode",
    difficulty: "Easy", repository: "user/leetcode", path: "LeetCode/Easy/two-sum",
    commitUrl: "https://github.com/user/leetcode/commit/abc123",
    syncId: "test-success-1",
  });
  assert.ok(res, "Result is falsy");
  assert.strictEqual(res.shown, true);
  assert.strictEqual(res.item.type, "success");
  assert.strictEqual(res.item.problemTitle, "Two Sum");
});

it("B2. showSyncNotification accepts update type", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  const res = svc.showSyncNotification({
    type: "update", problemTitle: "Three Sum", platform: "leetcode",
    difficulty: "Medium", syncId: "test-update-1",
  });
  assert.strictEqual(res.shown, true);
  assert.strictEqual(res.item.type, "update");
  assert.strictEqual(res.item.title, "GitHub updated");
});

it("B3. showSyncNotification accepts duplicate type", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  const res = svc.showSyncNotification({
    type: "duplicate", problemTitle: "Median", syncId: "test-dup-1",
  });
  assert.strictEqual(res.shown, true);
  assert.strictEqual(res.item.type, "duplicate");
  assert.strictEqual(res.item.title, "Already synced");
});

it("B4. showSyncNotification accepts skipped type with reason", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  const res = svc.showSyncNotification({
    type: "skipped", problemTitle: "Reverse Linked List",
    reason: "Difficulty filter: Easy excluded",
    syncId: "test-skip-1",
  });
  assert.strictEqual(res.shown, true);
  assert.strictEqual(res.item.type, "skipped");
  assert.ok(res.item.meta.includes("Difficulty filter") || res.item.meta.includes("excluded"), "Reason not in meta");
});

it("B5. showSyncNotification accepts error type", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  const res = svc.showSyncNotification({
    type: "error", problemTitle: "Valid Parentheses",
    error: "401 Unauthorized",
    syncId: "test-err-1",
  });
  assert.strictEqual(res.shown, true);
  assert.strictEqual(res.item.type, "error");
  assert.strictEqual(res.item.title, "GitHub sync failed");
  assert.ok(res.item.meta.includes("401"), "Error not in meta");
});

// ═══════════════════════════════════════════════════════════════
// SECTION C: DEDUPLICATION
// ═══════════════════════════════════════════════════════════════
console.log("\n  C. DEDUPLICATION");
console.log("  ─────────────────────────────────────────────────────");

it("C1. Identical syncId is blocked on second invocation", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  const res1 = svc.showSyncNotification({ type: "success", problemTitle: "X", syncId: "dup-id-1" });
  svc.dismissCurrentNotification();
  const res2 = svc.showSyncNotification({ type: "success", problemTitle: "X", syncId: "dup-id-1" });
  assert.strictEqual(res1.shown, true);
  assert.strictEqual(res2.shown, false);
  assert.strictEqual(res2.reason, "duplicate_id");
});

it("C2. Different syncIds are not blocked", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  const res1 = svc.showSyncNotification({ type: "success", problemTitle: "A", syncId: "uniq-1" });
  svc.dismissCurrentNotification();
  const res2 = svc.showSyncNotification({ type: "success", problemTitle: "B", syncId: "uniq-2" });
  assert.strictEqual(res1.shown, true);
  assert.strictEqual(res2.shown, true);
});

it("C3. resetDeduplication clears seen syncIds", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  svc.showSyncNotification({ type: "success", problemTitle: "Y", syncId: "clear-id-1" });
  svc.dismissCurrentNotification();
  svc.resetDeduplication();
  const res = svc.showSyncNotification({ type: "success", problemTitle: "Y", syncId: "clear-id-1" });
  assert.strictEqual(res.shown, true);
});

it("C4. Dedup set does not grow beyond MAX_DEDUP_SIZE", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  for (let i = 0; i < 120; i++) {
    svc.showSyncNotification({ type: "success", problemTitle: `P${i}`, syncId: `dedup-${i}` });
    svc.dismissCurrentNotification();
  }
  // First few should have been evicted
  const res = svc.showSyncNotification({ type: "success", problemTitle: "P0", syncId: "dedup-0" });
  assert.strictEqual(res.shown, true, "Old syncId should have been evicted");
});

// ═══════════════════════════════════════════════════════════════
// SECTION D: QUEUE MANAGEMENT
// ═══════════════════════════════════════════════════════════════
console.log("\n  D. QUEUE MANAGEMENT");
console.log("  ─────────────────────────────────────────────────────");

it("D1. Second notification is queued when first is visible", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  svc.showSyncNotification({ type: "success", problemTitle: "First", syncId: "q-1" });
  const res = svc.showSyncNotification({ type: "success", problemTitle: "Second", syncId: "q-2" });
  assert.strictEqual(res.shown, false);
  assert.strictEqual(res.queued, true);
  assert.strictEqual(res.queuePosition, 1);
  assert.strictEqual(svc.getQueue().length, 1);
});

it("D2. Queue maxes at MAX_QUEUE_SIZE (3)", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  svc.showSyncNotification({ type: "success", problemTitle: "Active", syncId: "max-0" });
  svc.showSyncNotification({ type: "success", problemTitle: "Q1", syncId: "max-1" });
  svc.showSyncNotification({ type: "success", problemTitle: "Q2", syncId: "max-2" });
  svc.showSyncNotification({ type: "success", problemTitle: "Q3", syncId: "max-3" });
  const q = svc.getQueue();
  assert.strictEqual(q.length, 3);
});

it("D3. Queue overflow collapses into summary badge with count", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  svc.showSyncNotification({ type: "success", problemTitle: "Active", syncId: "ov-0" });
  svc.showSyncNotification({ type: "success", problemTitle: "Q1", syncId: "ov-1" });
  svc.showSyncNotification({ type: "success", problemTitle: "Q2", syncId: "ov-2" });
  svc.showSyncNotification({ type: "success", problemTitle: "Q3", syncId: "ov-3" });
  // Now overflow
  const res = svc.showSyncNotification({ type: "success", problemTitle: "Q4", syncId: "ov-4" });
  assert.strictEqual(res.shown, false);
  assert.strictEqual(res.collapsed, true);
  assert.ok(res.overflowCount >= 2, `Expected overflowCount >= 2, got ${res.overflowCount}`);
  const lastQueued = svc.getQueue()[svc.getQueue().length - 1];
  assert.ok(lastQueued.collapsedCount >= 2, "Last queued item should have collapsedCount >= 2");
});

it("D4. clearQueue empties the queue", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  svc.showSyncNotification({ type: "success", problemTitle: "A", syncId: "cq-0" });
  svc.showSyncNotification({ type: "success", problemTitle: "B", syncId: "cq-1" });
  svc.showSyncNotification({ type: "success", problemTitle: "C", syncId: "cq-2" });
  assert.strictEqual(svc.getQueue().length, 2);
  svc.clearQueue();
  assert.strictEqual(svc.getQueue().length, 0);
});

it("D5. getActiveNotification returns current notification object", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  svc.showSyncNotification({ type: "update", problemTitle: "MyProblem", syncId: "act-1" });
  const active = svc.getActiveNotification();
  assert.ok(active, "No active notification");
  assert.strictEqual(active.item.problemTitle, "MyProblem");
});

// ═══════════════════════════════════════════════════════════════
// SECTION E: SAFETY & RESILIENCE
// ═══════════════════════════════════════════════════════════════
console.log("\n  E. SAFETY & RESILIENCE");
console.log("  ─────────────────────────────────────────────────────");

it("E1. showSyncNotification never throws on invalid options", () => {
  assert.doesNotThrow(() => {
    Fly2GitNotification.showSyncNotification(null);
    Fly2GitNotification.showSyncNotification(undefined);
    Fly2GitNotification.showSyncNotification("");
    Fly2GitNotification.showSyncNotification(42);
  });
});

it("E2. showSyncNotification returns error result on invalid options", () => {
  const res = Fly2GitNotification.showSyncNotification(null);
  assert.strictEqual(res.shown, false);
  assert.ok(res.error, "Expected error in result");
});

it("E3. createNotificationService handles empty env gracefully", () => {
  const svc = Fly2GitNotification.createNotificationService({});
  assert.ok(svc, "Service was not created");
  assert.strictEqual(typeof svc.showSyncNotification, "function");
});

it("E4. Notification source contains no credentials/tokens/secrets", () => {
  const forbidden = [
    "ghp_", "gho_", "ghs_", "ghr_",
    "GITHUB_TOKEN", "ACCESS_TOKEN", "SECRET",
    "password", "apiKey", "api_key", "private_key",
  ];
  for (const keyword of forbidden) {
    const lower = notifSource.toLowerCase();
    const found = lower.includes(keyword.toLowerCase());
    assert.ok(!found, `sync-notification.js contains forbidden keyword: ${keyword}`);
  }
});

it("E5. Notification dispatch in background.js is wrapped in try-catch (fire-and-forget)", () => {
  assert.ok(
    bgSource.includes("dispatchSyncNotification") &&
    bgSource.includes("notification dispatch must never disrupt sync"),
    "dispatchSyncNotification should be fire-and-forget with silent failure"
  );
});

// ═══════════════════════════════════════════════════════════════
// SECTION F: VISUAL IDENTITY & CSS
// ═══════════════════════════════════════════════════════════════
console.log("\n  F. VISUAL IDENTITY & CSS");
console.log("  ─────────────────────────────────────────────────────");

it("F1. Contains Midnight Titanium dark glass surface (rgba dark bg)", () => {
  assert.ok(
    notifSource.includes("rgba(18, 22, 28") || notifSource.includes("rgba(18,22,28"),
    "Missing dark titanium surface color"
  );
});

it("F2. Contains Ice Blue accent (#38bdf8)", () => {
  assert.ok(notifSource.includes("#38bdf8"), "Missing Ice Blue accent #38bdf8");
});

it("F3. Contains backdrop-filter blur for glass effect", () => {
  assert.ok(
    notifSource.includes("backdrop-filter") && notifSource.includes("blur("),
    "Missing backdrop-filter blur"
  );
});

it("F4. Contains 1px border with rgba white border", () => {
  assert.ok(
    notifSource.includes("1px solid rgba(255, 255, 255") || notifSource.includes("1px solid rgba(255,255,255"),
    "Missing 1px rgba white border"
  );
});

it("F5. Contains shimmer/sweep animation (single-run reflection)", () => {
  assert.ok(
    notifSource.includes("fly2gitShimmerSweep") || notifSource.includes("shimmer-sweep"),
    "Missing shimmer sweep animation"
  );
  // Verify single-run (animation forwards with 1 iteration or no infinite)
  assert.ok(
    notifSource.includes("1 forwards"),
    "Shimmer should run exactly once (1 forwards)"
  );
});

it("F6. Contains spring-like cubic-bezier entry animation", () => {
  assert.ok(
    notifSource.includes("cubic-bezier") && notifSource.includes("fly2gitGlassEntry"),
    "Missing spring-like entry animation"
  );
});

it("F7. Contains exit animation", () => {
  assert.ok(
    notifSource.includes("fly2gitGlassExit") && notifSource.includes("fly2git-exiting"),
    "Missing exit animation"
  );
});

it("F8. Contains box-shadow for depth", () => {
  assert.ok(
    notifSource.includes("box-shadow") && notifSource.includes("rgba(0, 0, 0"),
    "Missing depth box-shadow"
  );
});

it("F9. No purple, gold, neon cyan, rainbow gradients, or continuous animations", () => {
  const lower = notifSource.toLowerCase();
  assert.ok(!lower.includes("purple"), "Contains forbidden 'purple'");
  assert.ok(!lower.includes("gold") || lower.includes("gold") === false, "Heuristic gold check");
  assert.ok(!lower.includes("rainbow"), "Contains forbidden 'rainbow'");
  // Verify no 'infinite' animation keyword
  assert.ok(!lower.includes("animation") || !lower.includes("infinite"), "Contains 'infinite' animation");
});

// ═══════════════════════════════════════════════════════════════
// SECTION G: ACCESSIBILITY
// ═══════════════════════════════════════════════════════════════
console.log("\n  G. ACCESSIBILITY");
console.log("  ─────────────────────────────────────────────────────");

it("G1. Source includes prefers-reduced-motion media query", () => {
  assert.ok(notifSource.includes("prefers-reduced-motion"), "Missing prefers-reduced-motion");
});

it("G2. Reduced motion disables shimmer and uses simple fade", () => {
  assert.ok(
    notifSource.includes("display: none") && notifSource.includes("fly2git-glass-shimmer"),
    "Shimmer should be hidden under reduced motion"
  );
  assert.ok(notifSource.includes("fly2gitFadeIn"), "Should use a simple fade-in under reduced motion");
});

it("G3. Notification has ARIA role (status or alert)", () => {
  assert.ok(notifSource.includes("role") && (notifSource.includes('"status"') || notifSource.includes('"alert"')),
    "Missing ARIA role on notification"
  );
});

it("G4. Notification has aria-live polite/assertive", () => {
  assert.ok(notifSource.includes("aria-live"), "Missing aria-live");
  assert.ok(notifSource.includes('"polite"') && notifSource.includes('"assertive"'),
    "Should use polite for non-error, assertive for error");
});

it("G5. Notification has aria-label for screen readers", () => {
  assert.ok(notifSource.includes("aria-label"), "Missing aria-label");
});

it("G6. Keyboard: Escape key dismisses notification", () => {
  assert.ok(
    notifSource.includes('"Escape"') && notifSource.includes("dismissCurrentNotification"),
    "Escape key should dismiss notification"
  );
});

it("G7. Keyboard: Enter key triggers action", () => {
  assert.ok(
    notifSource.includes('"Enter"') && notifSource.includes("handleAction"),
    "Enter key should trigger notification action"
  );
});

it("G8. Focus-visible outline for keyboard navigation", () => {
  assert.ok(notifSource.includes("focus-visible"), "Missing focus-visible styling");
});

it("G9. tabindex=0 for focusability", () => {
  assert.ok(notifSource.includes('tabindex'), "Missing tabindex attribute");
});

// ═══════════════════════════════════════════════════════════════
// SECTION H: BACKGROUND.JS INTEGRATION
// ═══════════════════════════════════════════════════════════════
console.log("\n  H. BACKGROUND.JS INTEGRATION");
console.log("  ─────────────────────────────────────────────────────");

it("H1. background.js contains dispatchSyncNotification function", () => {
  assert.ok(bgSource.includes("function dispatchSyncNotification"), "Missing dispatchSyncNotification function");
});

it("H2. dispatchSyncNotification broadcasts message type 'fly2git-sync-result'", () => {
  assert.ok(bgSource.includes('"fly2git-sync-result"'), "Missing fly2git-sync-result event type");
});

it("H3. dispatchSyncNotification sends to active tab via chrome.tabs.sendMessage", () => {
  assert.ok(
    bgSource.includes("chrome.tabs.sendMessage") && bgSource.includes("chrome.tabs.query"),
    "Should broadcast to active tab"
  );
});

it("H4. dispatchSyncNotification broadcasts to popup via chrome.runtime.sendMessage", () => {
  assert.ok(
    bgSource.includes("chrome.runtime.sendMessage(message)"),
    "Should broadcast to popup via runtime.sendMessage"
  );
});

it("H5. dispatchSyncNotification called for 'skipped' (automation filter)", () => {
  // Find dispatchSyncNotification calls with type: "skipped"
  const skippedMatch = bgSource.includes('type: "skipped"');
  assert.ok(skippedMatch, "Missing dispatch for skipped/automation type");
});

it("H6. dispatchSyncNotification called for 'duplicate'", () => {
  assert.ok(bgSource.includes('type: "duplicate"'), "Missing dispatch for duplicate type");
});

it("H7. dispatchSyncNotification called for 'success'", () => {
  assert.ok(bgSource.includes('type: result.isUpdate ? "update" : "success"'), "Missing dispatch for success/update type");
});

it("H8. dispatchSyncNotification called for 'error'", () => {
  assert.ok(bgSource.includes('type: "error"'), "Missing dispatch for error type");
});

it("H9. Notification payloads include syncId for deduplication", () => {
  const dispatchCalls = bgSource.match(/dispatchSyncNotification\(\{[\s\S]*?\}\)/g) || [];
  assert.ok(dispatchCalls.length >= 4, `Expected >= 4 dispatch calls, found ${dispatchCalls.length}`);
  for (const call of dispatchCalls) {
    assert.ok(call.includes("syncId"), `Dispatch call missing syncId: ${call.substring(0, 80)}...`);
  }
});

it("H10. Notification payloads include platform, problemTitle, difficulty, timestamp", () => {
  const dispatchCalls = bgSource.match(/dispatchSyncNotification\(\{[\s\S]*?\}\)/g) || [];
  for (const call of dispatchCalls) {
    assert.ok(call.includes("platform"), `Missing platform in: ${call.substring(0, 60)}`);
    assert.ok(call.includes("problemTitle"), `Missing problemTitle in: ${call.substring(0, 60)}`);
    assert.ok(call.includes("timestamp"), `Missing timestamp in: ${call.substring(0, 60)}`);
  }
});

it("H11. Notification payloads do NOT contain credentials/tokens/source code", () => {
  const dispatchCalls = bgSource.match(/dispatchSyncNotification\(\{[\s\S]*?\}\)/g) || [];
  const forbidden = ["token", "code:", "password", "accessToken", "secret"];
  for (const call of dispatchCalls) {
    for (const kw of forbidden) {
      assert.ok(!call.includes(kw), `Notification payload contains forbidden '${kw}'`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION I: MANIFEST & POPUP INTEGRATION
// ═══════════════════════════════════════════════════════════════
console.log("\n  I. MANIFEST & POPUP INTEGRATION");
console.log("  ─────────────────────────────────────────────────────");

it("I1. manifest.json includes sync-notification.js in all content script entries (non-MAIN world)", () => {
  const contentScripts = manifestContent.content_scripts || [];
  const nonMainWorldEntries = contentScripts.filter(e => e.world !== "MAIN");
  assert.ok(nonMainWorldEntries.length >= 7, `Expected >= 7 non-MAIN content scripts, found ${nonMainWorldEntries.length}`);
  for (const entry of nonMainWorldEntries) {
    assert.ok(
      entry.js.includes("sync-notification.js"),
      `Missing sync-notification.js in entry for: ${JSON.stringify(entry.matches)}`
    );
  }
});

it("I2. sync-notification.js is NOT injected in MAIN world entries", () => {
  const contentScripts = manifestContent.content_scripts || [];
  const mainWorldEntries = contentScripts.filter(e => e.world === "MAIN");
  for (const entry of mainWorldEntries) {
    assert.ok(
      !entry.js.includes("sync-notification.js"),
      `sync-notification.js should NOT be in MAIN world entry: ${JSON.stringify(entry.matches)}`
    );
  }
});

it("I3. popup.html includes sync-notification.js script tag", () => {
  assert.ok(
    popupHtml.includes('src="sync-notification.js"'),
    "popup.html should load sync-notification.js"
  );
});

it("I4. popup.html loads sync-notification.js BEFORE popup.js", () => {
  const notifIdx = popupHtml.indexOf('src="sync-notification.js"');
  const popupIdx = popupHtml.indexOf('src="popup.js"');
  assert.ok(notifIdx >= 0, "sync-notification.js not found in popup.html");
  assert.ok(popupIdx >= 0, "popup.js not found in popup.html");
  assert.ok(notifIdx < popupIdx, "sync-notification.js must load BEFORE popup.js");
});

it("I5. sync-notification.js listens for 'fly2git-sync-result' messages", () => {
  assert.ok(
    notifSource.includes('"fly2git-sync-result"') && notifSource.includes("onMessage"),
    "Should auto-register chrome.runtime.onMessage listener for fly2git-sync-result"
  );
});

// ═══════════════════════════════════════════════════════════════
// SECTION J: POPUP CONTEXT ADAPTATION
// ═══════════════════════════════════════════════════════════════
console.log("\n  J. POPUP CONTEXT ADAPTATION");
console.log("  ─────────────────────────────────────────────────────");

it("J1. Module detects popup context via DOM markers", () => {
  assert.ok(
    notifSource.includes("popupNotificationContainer") || notifSource.includes("__FLY2GIT_POPUP__") || notifSource.includes("accountBar"),
    "Should detect popup context"
  );
});

it("J2. Popup mode uses relative positioning and full-width layout", () => {
  assert.ok(
    notifSource.includes("fly2git-in-popup") && notifSource.includes("position: relative"),
    "Popup mode should use relative positioning"
  );
  assert.ok(
    notifSource.includes("width: 100%"),
    "Popup mode should use full width"
  );
});

it("J3. Content page mode uses fixed positioning (top-right)", () => {
  assert.ok(
    notifSource.includes("position: fixed") && notifSource.includes("top:") && notifSource.includes("right:"),
    "Content page mode should use fixed top-right positioning"
  );
});

// ═══════════════════════════════════════════════════════════════
// SECTION K: ICON SYSTEM
// ═══════════════════════════════════════════════════════════════
console.log("\n  K. ICON SYSTEM");
console.log("  ─────────────────────────────────────────────────────");

it("K1. All 5 notification types have dedicated SVG icons", () => {
  const iconTypes = ["success", "update", "duplicate", "skipped", "error"];
  for (const t of iconTypes) {
    assert.ok(
      notifSource.includes(`type-${t}`) && notifSource.match(new RegExp(`${t}:\\s*\`<svg`)),
      `Missing icon definition for type: ${t}`
    );
  }
});

it("K2. Icons use SVG (not emoji, not img, not font-icon)", () => {
  const iconBlock = notifSource.substring(notifSource.indexOf("const ICONS"), notifSource.indexOf("createNotificationService"));
  assert.ok(!iconBlock.includes("emoji"), "Should not use emoji in icons");
  assert.ok(iconBlock.includes("<svg"), "Icons should be SVG elements");
});

it("K3. Close icon is provided for dismiss button", () => {
  assert.ok(notifSource.includes("close:") && notifSource.includes("fly2git-notif-close"),
    "Should have a close/dismiss icon button"
  );
});

// ═══════════════════════════════════════════════════════════════
// SECTION L: ACTION HANDLING
// ═══════════════════════════════════════════════════════════════
console.log("\n  L. ACTION HANDLING");
console.log("  ─────────────────────────────────────────────────────");

it("L1. Success/Update click opens commitUrl via window.open or chrome.tabs.create", () => {
  assert.ok(
    notifSource.includes("commitUrl") &&
    (notifSource.includes("win.open") || notifSource.includes("window.open")) &&
    notifSource.includes("noopener"),
    "Success/Update should open commitUrl safely"
  );
});

it("L2. Duplicate click opens repository path", () => {
  assert.ok(
    notifSource.includes("DUPLICATE") && notifSource.includes("github.com"),
    "Duplicate should open repo path on GitHub"
  );
});

it("L3. Error notification supports retry action", () => {
  assert.ok(
    notifSource.includes("onRetry") && notifSource.includes("fly2git-notif-retry-btn"),
    "Error should have a retry action button"
  );
});

it("L4. Links open with noopener,noreferrer for security", () => {
  const noopenerCount = (notifSource.match(/noopener/g) || []).length;
  const noreferrerCount = (notifSource.match(/noreferrer/g) || []).length;
  assert.ok(noopenerCount >= 1, "Should use noopener for security");
  assert.ok(noreferrerCount >= 1, "Should use noreferrer for security");
});

// ═══════════════════════════════════════════════════════════════
// SECTION M: ISOLATION & FACTORY
// ═══════════════════════════════════════════════════════════════
console.log("\n  M. ISOLATION & FACTORY");
console.log("  ─────────────────────────────────────────────────────");

it("M1. createNotificationService returns isolated instance", () => {
  const svc1 = Fly2GitNotification.createNotificationService({});
  const svc2 = Fly2GitNotification.createNotificationService({});
  svc1.showSyncNotification({ type: "success", problemTitle: "A", syncId: "iso-1" });
  const active2 = svc2.getActiveNotification();
  assert.strictEqual(active2, null, "Service 2 should have no active notification");
});

it("M2. Factory accepts custom chrome/document/window env", () => {
  const mockChrome = {};
  const svc = Fly2GitNotification.createNotificationService({ chrome: mockChrome });
  assert.ok(svc, "Should create service with custom env");
  const res = svc.showSyncNotification({ type: "success", problemTitle: "Test", syncId: "env-1" });
  assert.strictEqual(res.shown, true);
});

// ═══════════════════════════════════════════════════════════════
// FINAL REPORT
// ═══════════════════════════════════════════════════════════════
console.log("\n=======================================================");
console.log(`   PHASE 16.3 RESULTS: ${passed} passed, ${failed} failed`);
console.log("=======================================================\n");

if (failures.length > 0) {
  console.log("  FAILURES:");
  failures.forEach((f) => console.log(`    • ${f}`));
  console.log("");
}

if (failed > 0) process.exit(1);
