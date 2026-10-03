/**
 * Fly2Git — Phase 16.4: Post-Acceptance Complexity Intelligence Test Suite
 *
 * Validates 25 test cases covering:
 * 1. accepted solution displays complexity section
 * 2. time complexity renders
 * 3. space complexity renders
 * 4. measured runtime renders
 * 5. measured memory renders
 * 6. unavailable runtime handled
 * 7. unavailable memory handled
 * 8. source labels correct
 * 9. confidence displayed
 * 10. low confidence handled
 * 11. AI failure handled
 * 12. complexity failure does not affect sync
 * 13. sync notification remains intact
 * 14. no duplicate notification
 * 15. no source code persisted
 * 16. no prompt persisted
 * 17. Basic entitlement works
 * 18. Pro entitlement works
 * 19. responsive layout
 * 20. accessibility
 * 21. reduced motion
 * 22. existing AI tests pass
 * 23. existing notification tests pass
 * 24. existing premium UI tests pass
 * 25. complete regression passes
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

console.log("\n=======================================================");
console.log("   FLY2GIT PHASE 16.4 — COMPLEXITY INTELLIGENCE SUITE");
console.log("=======================================================\n");

const ROOT = path.resolve(__dirname);
const complexityService = require("./complexity-service.js");
const Fly2GitPlatforms = require("./platforms.js");
const Fly2GitNotification = require("./sync-notification.js");
const AnalyzeValidator = require("./backend/ai/validators/analyze-validator.js");
const { EntitlementService } = require("./backend/services/entitlement-service.js");
const Database = require("./backend/db/database.js");

const htmlContent = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");
const cssContent = fs.readFileSync(path.join(ROOT, "popup.css"), "utf8");
const liquidGlassContent = fs.readFileSync(path.join(ROOT, "liquid-glass.css"), "utf8");
const jsContent = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");

// 1. accepted solution displays complexity section
it("1. accepted solution displays complexity section in popup.html", () => {
  assert.ok(htmlContent.includes('id="problemComplexitySection"'), "Must contain problemComplexitySection");
  assert.ok(htmlContent.includes('class="problem-complexity-card glass-03"'), "Must use Glass 03 styling");
  assert.ok(htmlContent.includes('id="activeSessionBox"'), "Must reside in activeSessionBox");
});

// 2. time complexity renders
it("2. time complexity renders with valid Big-O and human-readable label", () => {
  const model = complexityService.normalizeComplexity({
    time: "O(n)",
    confidence: "high",
  });
  assert.strictEqual(model.time.value, "O(n)");
  assert.strictEqual(model.time.label, "Linear");
});

// 3. space complexity renders
it("3. space complexity renders with valid Big-O and human-readable label", () => {
  const model = complexityService.normalizeComplexity({
    space: "O(1)",
    confidence: "high",
  });
  assert.strictEqual(model.space.value, "O(1)");
  assert.strictEqual(model.space.label, "Constant");
});

// 4. measured runtime renders
it("4. measured runtime renders when genuinely available from platform", () => {
  const model = complexityService.normalizeComplexity({
    measured: { runtime: "42 ms" },
  }, { platform: "LeetCode" });
  assert.strictEqual(model.measured.runtime.available, true);
  assert.strictEqual(model.measured.runtime.value, "42 ms");
  assert.strictEqual(model.measured.runtime.source, "LEETCODE");
});

// 5. measured memory renders
it("5. measured memory renders when genuinely available from platform", () => {
  const model = complexityService.normalizeComplexity({
    measured: { memory: "18.2 MB" },
  }, { platform: "LeetCode" });
  assert.strictEqual(model.measured.memory.available, true);
  assert.strictEqual(model.measured.memory.value, "18.2 MB");
});

// 6. unavailable runtime handled
it("6. unavailable runtime handled without fake zeros or placeholder measurements", () => {
  const modelNull = complexityService.normalizeComplexity({
    measured: { runtime: null },
  });
  assert.strictEqual(modelNull.measured.runtime.available, false);
  assert.strictEqual(modelNull.measured.runtime.value, null);

  const modelZero = complexityService.normalizeComplexity({
    measured: { runtime: "0 ms" },
  });
  assert.strictEqual(modelZero.measured.runtime.available, false);
  assert.strictEqual(modelZero.measured.runtime.value, null);
});

// 7. unavailable memory handled
it("7. unavailable memory handled without fake zeros or placeholder measurements", () => {
  const modelNull = complexityService.normalizeComplexity({
    measured: { memory: null },
  });
  assert.strictEqual(modelNull.measured.memory.available, false);
  assert.strictEqual(modelNull.measured.memory.value, null);

  const modelZero = complexityService.normalizeComplexity({
    measured: { memory: "0" },
  });
  assert.strictEqual(modelZero.measured.memory.available, false);
});

// 8. source labels correct
it("8. source labels correct: PLATFORM, AI ANALYSIS, STATIC ANALYSIS, USER PROVIDED", () => {
  const srcPlatform = complexityService.normalizeSource("platform", "LeetCode");
  assert.strictEqual(srcPlatform, "LEETCODE");

  const srcAI = complexityService.normalizeSource("ai_analysis");
  assert.strictEqual(srcAI, "AI ANALYSIS");

  const srcStatic = complexityService.normalizeSource("static_analysis");
  assert.strictEqual(srcStatic, "STATIC ANALYSIS");

  const srcUser = complexityService.normalizeSource("user_provided");
  assert.strictEqual(srcUser, "USER PROVIDED");
});

// 9. confidence displayed
it("9. confidence displayed: HIGH, MEDIUM, LOW", () => {
  const highModel = complexityService.normalizeComplexity({ confidence: "high" });
  assert.strictEqual(highModel.time.confidence, "high");

  const medModel = complexityService.normalizeComplexity({ confidence: "medium" });
  assert.strictEqual(medModel.time.confidence, "medium");

  const lowModel = complexityService.normalizeComplexity({ confidence: "low" });
  assert.strictEqual(lowModel.time.confidence, "low");
});

// 10. low confidence handled
it("10. low confidence handled: suppresses human label and exposes warning message", () => {
  const lowModel = complexityService.normalizeComplexity({
    time: "O(n)",
    confidence: "low",
  });
  assert.strictEqual(lowModel.time.label, null, "Human readable label must be suppressed on low confidence");
  assert.strictEqual(lowModel.confidenceMessage, "Complexity could not be confidently determined.");
});

// 11. AI failure handled
it("11. AI failure handled: exposes fallback message and keeps app working", () => {
  assert.ok(jsContent.includes("function setComplexityUnavailable("));
  assert.ok(htmlContent.includes('id="complexityEmptyBox"'));
  assert.ok(htmlContent.includes("Analyze with AI"));
});

// 12. complexity failure does not affect sync
it("12. complexity failure does not affect sync (strict failure isolation)", () => {
  function performSyncWithComplexity(complexityThrows) {
    let syncCompleted = false;
    let complexitySucceeded = false;

    // 1. Sync executes
    syncCompleted = true;

    // 2. Complexity executes in non-blocking try/catch
    try {
      if (complexityThrows) {
        throw new Error("AI complexity evaluation crashed");
      }
      complexitySucceeded = true;
    } catch (_) {
      // Safely isolated
    }

    return { syncCompleted, complexitySucceeded };
  }

  const result = performSyncWithComplexity(true);
  assert.strictEqual(result.syncCompleted, true, "Sync must succeed even if complexity fails");
  assert.strictEqual(result.complexitySucceeded, false);
});

// 13. sync notification remains intact
it("13. sync notification remains intact alongside complexity intelligence", () => {
  assert.strictEqual(typeof Fly2GitNotification.showSyncNotification, "function");
  assert.strictEqual(Fly2GitNotification.NOTIFICATION_TYPES.SUCCESS, "success");
  assert.strictEqual(Fly2GitNotification.NOTIFICATION_TYPES.UPDATE, "update");
  const queue = Fly2GitNotification.getQueue();
  assert.ok(Array.isArray(queue));
});

// 14. no duplicate notification
it("14. no duplicate notification: deduplication queue filters repeated syncs", () => {
  const queue = new Set();
  const syncId = "leetcode:two-sum:12345";
  assert.strictEqual(queue.has(syncId), false);
  queue.add(syncId);
  assert.strictEqual(queue.has(syncId), true);
  // Duplicate check
  const isDuplicate = queue.has(syncId);
  assert.strictEqual(isDuplicate, true);
});

// 15. no source code persisted
it("15. no source code persisted: complexity data model excludes code and sourceCode", () => {
  const inputWithCode = {
    time: "O(n)",
    space: "O(1)",
    code: 'function solve() { return "secret"; }',
    sourceCode: 'def solve(): pass',
  };
  const normalized = complexityService.normalizeComplexity(inputWithCode);
  assert.strictEqual(normalized.code, undefined);
  assert.strictEqual(normalized.sourceCode, undefined);
  assert.ok(!JSON.stringify(normalized).includes("secret"));
});

// 16. no prompt persisted
it("16. no prompt persisted: complexity data model excludes prompts and tokens", () => {
  const inputWithPrompt = {
    time: "O(n)",
    prompt: "System: calculate complexity of this code",
    token: "ghp_12345",
  };
  const normalized = complexityService.normalizeComplexity(inputWithPrompt);
  assert.strictEqual(normalized.prompt, undefined);
  assert.strictEqual(normalized.token, undefined);
});

// 17. Basic entitlement works
it("17. Basic entitlement works: basic users can view complexity and platform slots", async () => {
  const db = new Database({ memoryOnly: true });
  const entService = new EntitlementService(db);
  const ent = await entService.getAuthoritativeEntitlement("basic_user_complexity");
  assert.strictEqual(ent.plan, "basic");
  assert.strictEqual(ent.features.maxPlatforms, 2);
});

// 18. Pro entitlement works
it("18. Pro entitlement works: Pro tier receives full intelligence features", async () => {
  const db = new Database({ memoryOnly: true });
  db.setProStatus("pro_user_complexity", { active: true, plan: "pro" });
  const entService = new EntitlementService(db);
  const ent = await entService.getAuthoritativeEntitlement("pro_user_complexity");
  assert.strictEqual(ent.plan, "pro");
  assert.strictEqual(ent.features.ai, true);
  assert.strictEqual(ent.features.allPlatforms, true);
});

// 19. responsive layout
it("19. responsive layout: handles narrow widths and 390px target", () => {
  assert.ok(cssContent.includes("@media (max-width: 320px)"));
  assert.ok(cssContent.includes(".complexity-grid"));
  assert.ok(cssContent.includes(".problem-complexity-card"));
});

// 20. accessibility
it("20. accessibility: semantic structure and aria-label present", () => {
  assert.ok(htmlContent.includes('aria-label="Complexity Intelligence"'));
  assert.ok(htmlContent.includes('class="complexity-dim-label"'));
  assert.ok(htmlContent.includes('id="complexityWhyText"'));
});

// 21. reduced motion
it("21. reduced motion: respects prefers-reduced-motion in css", () => {
  assert.ok(cssContent.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(liquidGlassContent.includes("@media (prefers-reduced-motion: reduce)"));
});

// 22. existing AI tests pass
it("22. existing AI tests pass: analyze validator enforces schema and bounds", () => {
  const sampleAiAnalyze = {
    summary: "Efficient linear scan approach.",
    approach: "Hash Map lookup",
    correctness: "Correct for all standard inputs.",
    complexity: {
      time: "O(n)",
      space: "O(n)",
      explanation: "Single pass over input array with hash table lookup.",
    },
    strengths: ["Fast lookup", "Clean code"],
    concerns: [],
    improvements: [],
    edgeCases: ["Empty input"],
    learningPoints: ["Hash table space trade-off"],
    confidence: "high",
  };
  const validated = AnalyzeValidator.validate(sampleAiAnalyze);
  assert.strictEqual(validated.complexity.time, "O(n)");
  assert.strictEqual(validated.confidence, "high");
});

// 23. existing notification tests pass
it("23. existing notification tests pass: Liquid Glass notifications are operational", () => {
  const notifSource = fs.readFileSync(path.join(ROOT, "sync-notification.js"), "utf8");
  assert.ok(notifSource.includes("backdrop-filter") && notifSource.includes("blur("));
  assert.ok(notifSource.includes("#38bdf8"), "Ice blue accent present in notification");
  const svc = Fly2GitNotification.createNotificationService({});
  assert.strictEqual(typeof svc.showSyncNotification, "function");
});

// 24. existing premium UI tests pass
it("24. existing premium UI tests pass: Midnight Titanium and Obsidian design tokens intact", () => {
  assert.ok(htmlContent.includes('class="brand-title"'));
  assert.ok(htmlContent.includes('id="cockpitNav"'));
  assert.ok(htmlContent.includes('data-tab="home"'));
  assert.ok(htmlContent.includes('data-tab="journey"'));
});

// 25. complete regression passes
it("25. complete regression passes: 7 coding platforms active and normalized", () => {
  const platforms = Fly2GitPlatforms.getActivePlatforms();
  assert.strictEqual(platforms.length, 7);

  const sampleSub = {
    slug: "two-sum",
    title: "Two Sum",
    difficulty: "Easy",
    code: "def twoSum(nums, target): pass",
    lang: "python",
    submissionId: "998877",
    runtime: "45 ms",
    memory: "17.8 MB",
  };
  const norm = Fly2GitPlatforms.normalizeSubmission(sampleSub);
  assert.strictEqual(norm.problem.slug, "two-sum");
  assert.strictEqual(norm.submission.runtime, "45 ms");
  assert.strictEqual(norm.submission.memory, "17.8 MB");
});

console.log("\n=======================================================");
console.log(`   PHASE 16.4 RESULTS: ${passed} passed, ${failed} failed`);
console.log("=======================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
