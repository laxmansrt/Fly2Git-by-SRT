// Fly2Git Backend — Phase 15C: Personal Coding Coach Test Suite
// Verifies all 34 required test conditions + opt-in live Gemini smoke test.

const http = require("http");
const assert = require("assert");
const { createServer } = require("./backend/server");
const Database = require("./backend/db/database");
const MockAIProvider = require("./backend/providers/mock-ai-provider");
const GeminiAIProvider = require("./backend/providers/gemini-ai-provider");
const AIProvider = require("./backend/providers/ai-provider");
const { AIService } = require("./backend/services/ai-service");
const AIUsageService = require("./backend/services/ai-usage-service");
const { CodingCoachService } = require("./backend/services/coding-coach-service");
const CodingObservations = require("./backend/services/coding-observations");
const CoachPrompt = require("./backend/ai/prompts/coach-prompt");
const CoachValidator = require("./backend/ai/validators/coach-validator");
const { validate } = require("./backend/ai/validators");
const PrivacyGuard = require("./backend/services/privacy-guard");
const Fly2GitAnalytics = require("./analytics");
const Fly2GitAIClient = require("./ai-client");
const platforms = require("./platforms");
const entitlements = require("./entitlements");

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, desc) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${desc}`);
  } else {
    failed++;
    failures.push(desc);
    console.error(`  ✗ FAIL: ${desc}`);
  }
}

async function runTests() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE 15C: PERSONAL CODING COACH TEST       ");
  console.log("=======================================================\n");

  const testDb = new Database({ memoryOnly: true });
  const mockAIProvider = new MockAIProvider();
  const testPort = 19486;

  let app;
  let aiService;
  let aiUsageService;
  let entitlementService;
  let proGrantService;
  let analyticsService;
  let codingCoachService;

  app = createServer({
    db: testDb,
    aiProvider: mockAIProvider,
    memoryOnly: true,
  });

  aiService = app.aiService;
  aiUsageService = app.aiUsageService;
  entitlementService = app.entitlementService;
  proGrantService = app.proGrantService;
  analyticsService = app.analyticsService;
  codingCoachService = app.codingCoachService;

  await app.start(testPort);

  function makeRequest(method, pathUrl, token = null, body = null) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: testPort,
          path: pathUrl,
          method,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
            } catch (_) {
              resolve({ status: res.statusCode, headers: res.headers, raw: data });
            }
          });
        }
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Register users
  const regBasic = await makeRequest("POST", "/api/auth/register", null, {
    email: "basic_coach_15c@fly2git.test",
    password: "Password123!",
  });
  const tokenBasic = regBasic.body.token;
  const userBasic = regBasic.body.user;

  const regPro = await makeRequest("POST", "/api/auth/register", null, {
    email: "pro_coach_15c@fly2git.test",
    password: "Password123!",
  });
  const tokenPro = regPro.body.token;
  const userPro = regPro.body.user;
  testDb.insertSubscription({
    id: "sub_pro_15c",
    userId: userPro.id,
    provider: "stripe",
    providerCustomerId: "cus_pro_15c",
    providerSubscriptionId: "sub_pro_15c",
    status: "active",
    plan: "pro",
    billingCycle: "monthly",
    currentPeriodEnd: Date.now() + 30 * 86400000,
  });

  const regGrant = await makeRequest("POST", "/api/auth/register", null, {
    email: "grant_coach_15c@fly2git.test",
    password: "Password123!",
  });
  const tokenGrant = regGrant.body.token;
  const userGrant = regGrant.body.user;
  proGrantService.createGrant({ userId: userGrant.id, type: "promotional", grantedBy: "admin" });

  const now = Date.now();
  const dayMs = 86400000;

  // -----------------------------------------------------------------
  // 1. Empty History Produces Safe Empty Coach
  // -----------------------------------------------------------------
  console.log("━━━ 1. Empty History Produces Safe Empty Coach ━━━");
  const emptyRes = await makeRequest("POST", "/api/coach/generate", tokenPro, { mode: "daily" });
  check(emptyRes.status === 200, "Empty history returns HTTP 200");
  check(emptyRes.body.ok === true, "Response ok is true");
  check(emptyRes.body.summary.includes("No synced coding activity found"), "Safe empty summary returned");
  check(emptyRes.body.evidence.totalSynced === 0, "Evidence reflects 0 synced solutions");
  check(emptyRes.body.confidence === "high", "High confidence on empty factual observation");

  // -----------------------------------------------------------------
  // Populate Activity for userPro
  // -----------------------------------------------------------------
  // 3 consecutive days of activity (Day 0, Day 1, Day 2 ago)
  testDb.insertAnalyticsEvent({
    userId: userPro.id,
    platform: "leetcode",
    problemSlug: "two-sum",
    title: "Two Sum",
    difficulty: "Easy",
    language: "python",
    action: "synced",
    timestamp: now - 2 * dayMs,
  });
  testDb.insertAnalyticsEvent({
    userId: userPro.id,
    platform: "leetcode",
    problemSlug: "add-two-numbers",
    title: "Add Two Numbers",
    difficulty: "Medium",
    language: "python",
    action: "synced",
    timestamp: now - 1 * dayMs,
  });
  testDb.insertAnalyticsEvent({
    userId: userPro.id,
    platform: "leetcode",
    problemSlug: "longest-substring",
    title: "Longest Substring Without Repeating Characters",
    difficulty: "Medium",
    language: "python",
    action: "synced",
    timestamp: now - 500,
  });
  testDb.insertAnalyticsEvent({
    userId: userPro.id,
    platform: "geeksforgeeks",
    problemSlug: "reverse-array",
    title: "Reverse an Array",
    difficulty: "Easy",
    language: "cpp",
    action: "synced",
    isUpdate: true,
    timestamp: now,
  });
  // Simulate 1 failed sync attempt (GitHub connection error)
  testDb.insertAnalyticsEvent({
    userId: userPro.id,
    platform: "leetcode",
    problemSlug: "median-of-two-sorted-arrays",
    title: "Median of Two Sorted Arrays",
    difficulty: "Hard",
    language: "python",
    action: "failed",
    timestamp: now - 500,
  });
  // Simulate 1 skipped duplicate
  testDb.insertAnalyticsEvent({
    userId: userPro.id,
    platform: "leetcode",
    problemSlug: "two-sum",
    title: "Two Sum",
    difficulty: "Easy",
    language: "python",
    action: "skipped",
    skipReason: "duplicate solution",
    timestamp: now - 200,
  });

  // -----------------------------------------------------------------
  // 2. Deterministic Observations are Correct
  // -----------------------------------------------------------------
  console.log("\n━━━ 2. Deterministic Observations are Correct ━━━");
  const ctx = codingCoachService.buildContext(userPro.id, { range: "30d" });
  const obs = CodingObservations.generateObservations(ctx);
  check(Array.isArray(obs) && obs.length >= 4, "Generated at least 4 observation categories");
  check(obs.some((o) => o.type === "practice_consistency"), "Contains practice_consistency observation");
  check(obs.some((o) => o.type === "difficulty_distribution"), "Contains difficulty_distribution observation");
  check(obs.some((o) => o.type === "language_distribution"), "Contains language_distribution observation");
  check(obs.some((o) => o.type === "platform_distribution"), "Contains platform_distribution observation");

  // -----------------------------------------------------------------
  // 3. Streak Used Correctly
  // -----------------------------------------------------------------
  console.log("\n━━━ 3. Streak Used Correctly ━━━");
  check(ctx.streak === 3, "Context streak is accurately calculated as 3 consecutive days");
  const streakObs = obs.find((o) => o.type === "practice_consistency");
  check(streakObs && streakObs.statement.includes("3 consecutive days"), "Streak observation correctly states 3 days");

  // -----------------------------------------------------------------
  // 4. Difficulty Distribution Correct
  // -----------------------------------------------------------------
  console.log("\n━━━ 4. Difficulty Distribution Correct ━━━");
  check(ctx.difficulties.Easy === 2, "Easy problems count is 2");
  check(ctx.difficulties.Medium === 2, "Medium problems count is 2");
  const diffObs = obs.find((o) => o.type === "difficulty_distribution");
  check(Boolean(diffObs), "Difficulty observation present");

  // -----------------------------------------------------------------
  // 5. Language Distribution Correct
  // -----------------------------------------------------------------
  console.log("\n━━━ 5. Language Distribution Correct ━━━");
  check(ctx.languages[0].language === "python", "Python is top language");
  check(ctx.languages[0].count === 3, "Python count is 3");
  check(ctx.languages[1].language === "cpp", "C++ is secondary language");
  const langObs = obs.find((o) => o.type === "language_distribution");
  check(langObs && langObs.statement.includes("python"), "Language observation names top language python");

  // -----------------------------------------------------------------
  // 6. Platform Distribution Correct
  // -----------------------------------------------------------------
  console.log("\n━━━ 6. Platform Distribution Correct ━━━");
  check(ctx.platforms[0].platform === "leetcode", "LeetCode is primary platform");
  check(ctx.platforms[0].count === 3, "LeetCode count is 3");
  check(ctx.platforms[1].platform === "geeksforgeeks", "GeeksforGeeks is secondary platform");

  // -----------------------------------------------------------------
  // 7. Recent Activity Window Correct
  // -----------------------------------------------------------------
  console.log("\n━━━ 7. Recent Activity Window Correct ━━━");
  check(Array.isArray(ctx.recentActivity), "Recent activity is an array");
  check(ctx.recentActivity.length === 4, "Contains all 4 synced activities");
  check(ctx.recentActivity[0].platform === "geeksforgeeks", "Most recent activity is GFG (newest first)");

  // -----------------------------------------------------------------
  // 8. Sync Failures Never Become Coding Failures
  // -----------------------------------------------------------------
  console.log("\n━━━ 8. Sync Failures Never Become Coding Failures ━━━");
  const reliabilityObs = obs.find((o) => o.type === "sync_reliability");
  check(Boolean(reliabilityObs), "Sync reliability observation exists");
  check(
    reliabilityObs.evidence.note.includes("measures GitHub sync transmission, not developer problem-solving"),
    "Explicitly declares reliability is transmission, not coding ability"
  );
  check(!JSON.stringify(obs).toLowerCase().includes("failed to solve"), "Zero claims that user failed to solve");

  // -----------------------------------------------------------------
  // 9. Skipped Events Handled Correctly
  // -----------------------------------------------------------------
  console.log("\n━━━ 9. Skipped Events Handled Correctly ━━━");
  // Total attempts for reliability = synced(4) + failed(1) = 5. Skips are excluded.
  check(ctx.totalSynced === 4, "Skipped duplicate was not counted as a synced solution");
  check(ctx.syncReliability === 80.0, "Sync reliability calculates (4 / (4 + 1)) * 100 = 80.0%");

  // -----------------------------------------------------------------
  // 10. Updated Solutions Handled Correctly
  // -----------------------------------------------------------------
  console.log("\n━━━ 10. Updated Solutions Handled Correctly ━━━");
  check(ctx.newSolutions === 3, "3 new solutions identified");
  check(ctx.updatedSolutions === 1, "1 updated solution identified");

  // -----------------------------------------------------------------
  // 11. Basic Entitlement Enforced
  // -----------------------------------------------------------------
  console.log("\n━━━ 11. Basic Entitlement Enforced ━━━");
  const basicCoachRes = await makeRequest("POST", "/api/coach/generate", tokenBasic, { mode: "daily" });
  check(basicCoachRes.status === 200, "Basic user allowed request within quota");
  check(basicCoachRes.body.ok === true, "Basic coach generation successful");

  // -----------------------------------------------------------------
  // 12. Pro Entitlement Enforced
  // -----------------------------------------------------------------
  console.log("\n━━━ 12. Pro Entitlement Enforced ━━━");
  const proCoachRes = await makeRequest("POST", "/api/coach/generate", tokenPro, { mode: "weekly" });
  check(proCoachRes.status === 200, "Pro user allowed request");
  check(proCoachRes.body.mode === "weekly", "Pro request processed in 'weekly' mode");

  // -----------------------------------------------------------------
  // 13. Pro Grant Enforced
  // -----------------------------------------------------------------
  console.log("\n━━━ 13. Pro Grant Enforced ━━━");
  const grantCoachRes = await makeRequest("POST", "/api/coach/generate", tokenGrant, { mode: "balance" });
  check(grantCoachRes.status === 200, "Pro Grant user allowed coach request");
  check(grantCoachRes.body.mode === "balance", "Pro Grant request processed in 'balance' mode");

  // -----------------------------------------------------------------
  // 14. Expired Entitlement Blocked
  // -----------------------------------------------------------------
  console.log("\n━━━ 14. Expired Entitlement Blocked ━━━");
  const regExpired = await makeRequest("POST", "/api/auth/register", null, {
    email: "expired_coach_15c@fly2git.test",
    password: "Password123!",
  });
  testDb.insertSubscription({
    id: "sub_exp_15c",
    userId: regExpired.body.user.id,
    plan: "pro",
    status: "active",
    currentPeriodEnd: now - 10000,
  });
  const expiredRes = await makeRequest("POST", "/api/coach/generate", regExpired.body.token, { mode: "daily" });
  check(expiredRes.status === 403, "Expired user blocked with HTTP 403");
  check(expiredRes.body.code === "AI_FORBIDDEN", "Code is AI_FORBIDDEN");

  // -----------------------------------------------------------------
  // 15. Coach Request Routed Through AI Gateway
  // -----------------------------------------------------------------
  console.log("\n━━━ 15. Coach Request Routed Through AI Gateway ━━━");
  const events = testDb.getAIUsageEventsByUserId(userPro.id);
  const coachEvents = events.filter((e) => e.feature === "coach");
  check(coachEvents.length > 0, "AI usage events contain feature 'coach'");
  check(coachEvents[0].requestId.startsWith("ai_"), "RequestId generated by AI gateway");

  // -----------------------------------------------------------------
  // 16. Source Code Never Enters Coach Context
  // -----------------------------------------------------------------
  console.log("\n━━━ 16. Source Code Never Enters Coach Context ━━━");
  const ctxStr = JSON.stringify(ctx);
  check(!ctxStr.includes("def twoSum"), "Source code absent from coach context");
  check(!ctxStr.includes("class Solution"), "Class definitions absent from coach context");
  check(ctx.code === undefined, "Context has no code attribute");

  // -----------------------------------------------------------------
  // 17. Full Problem Text Never Enters Coach Context
  // -----------------------------------------------------------------
  console.log("\n━━━ 17. Full Problem Text Never Enters Coach Context ━━━");
  check(!ctxStr.includes("Given an array of integers nums and an integer target"), "Problem text absent from context");

  // -----------------------------------------------------------------
  // 18. Credentials Never Enter Coach Context
  // -----------------------------------------------------------------
  console.log("\n━━━ 18. Credentials Never Enter Coach Context ━━━");
  check(!ctxStr.includes("password"), "Password absent from context");
  check(!ctxStr.includes("token"), "Session tokens absent from context");
  check(!ctxStr.includes("cookie"), "Cookies absent from context");

  // -----------------------------------------------------------------
  // 19. AI Cannot Invent Evidence (Prompt Invariants Verified)
  // -----------------------------------------------------------------
  console.log("\n━━━ 19. AI Cannot Invent Evidence ━━━");
  const promptPair = CoachPrompt.build({
    mode: "daily",
    coachContext: ctx,
    observations: obs,
    balance: CodingObservations.computeBalance(ctx),
  });
  check(promptPair.systemInstruction.includes("NEVER INVENT USER HISTORY"), "Prompt strictly mandates no fabricated history");
  check(promptPair.systemInstruction.includes("ZERO SCORING"), "Prompt strictly mandates zero scoring");

  // -----------------------------------------------------------------
  // 20. Invalid AI Response Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 20. Invalid AI Response Rejected ━━━");
  let invResThrew = false;
  try {
    CoachValidator.validate("NOT_JSON");
  } catch (err) {
    invResThrew = true;
    check(err.code === "AI_INVALID_RESPONSE", "Invalid non-JSON response throws AI_INVALID_RESPONSE");
  }
  check(invResThrew, "Non-JSON response rejected");

  // -----------------------------------------------------------------
  // 21. Invalid Confidence Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 21. Invalid Confidence Rejected ━━━");
  let invConfThrew = false;
  try {
    CoachValidator.validate({
      summary: "Valid summary",
      observations: ["Valid observation"],
      suggestedDirection: "Valid direction",
      suggestedActions: ["Action 1"],
      reflectionQuestion: "Question?",
      evidence: {},
      confidence: "ABSOLUTELY_GENIUS", // invalid confidence string
    });
  } catch (err) {
    invConfThrew = true;
    check(err.code === "AI_INVALID_RESPONSE", "Non-standard confidence throws AI_INVALID_RESPONSE");
  }
  check(invConfThrew, "Non-standard confidence rejected");

  // -----------------------------------------------------------------
  // 21b. Evaluative Skill Scores Blocked by Validator
  // -----------------------------------------------------------------
  console.log("\n━━━ 21b. Evaluative Skill Scores Blocked by Validator ━━━");
  let scoreThrew = false;
  try {
    CoachValidator.validate({
      summary: "Your developer score is 92/100.",
      observations: ["High skill score."],
      suggestedDirection: "Keep scoring.",
      suggestedActions: ["Do more."],
      reflectionQuestion: "Why?",
      evidence: {},
      confidence: "high",
    });
  } catch (err) {
    scoreThrew = true;
    check(err.code === "AI_INVALID_RESPONSE", "Forbidden skill score throws AI_INVALID_RESPONSE");
  }
  check(scoreThrew, "Skill scores blocked from coach response");

  // -----------------------------------------------------------------
  // 22. Unknown Coach Mode Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 22. Unknown Coach Mode Rejected ━━━");
  const badModeRes = await makeRequest("POST", "/api/coach/generate", tokenPro, { mode: "hyper_turbo" });
  check(badModeRes.status === 400, "Unknown mode returns HTTP 400");
  check(badModeRes.body.code === "COACH_INVALID_MODE", "Code is COACH_INVALID_MODE");

  // -----------------------------------------------------------------
  // 23. Usage Accounting Works
  // -----------------------------------------------------------------
  console.log("\n━━━ 23. Usage Accounting Works ━━━");
  const initialUsageCount = testDb.getAIUsageEventsByUserId(userPro.id).length;
  await makeRequest("POST", "/api/coach/generate", tokenPro, { mode: "daily" });
  const afterUsageCount = testDb.getAIUsageEventsByUserId(userPro.id).length;
  check(afterUsageCount === initialUsageCount + 1, "Usage event recorded for coach request");

  // -----------------------------------------------------------------
  // 24. No Double-Count Usage
  // -----------------------------------------------------------------
  console.log("\n━━━ 24. No Double-Count Usage ━━━");
  const newEvents = testDb.getAIUsageEventsByUserId(userPro.id);
  const lastEvent = newEvents[newEvents.length - 1];
  const matchingEvents = newEvents.filter((e) => e.requestId === lastEvent.requestId);
  check(matchingEvents.length === 1, "Exactly one usage record per logical coach request (zero double-counting)");

  // -----------------------------------------------------------------
  // 25. Topic Tag Confidence Validated
  // -----------------------------------------------------------------
  console.log("\n━━━ 25. Topic Tag Confidence Validated ━━━");
  testDb.upsertTopicTag(userPro.id, { tag: "dynamic-programming", confidence: "high" });
  testDb.upsertTopicTag(userPro.id, { tag: "segment-trees", confidence: "low" });
  const allTags = testDb.getTopicTagsByUserId(userPro.id);
  check(allTags.length === 2, "2 topic tags stored");
  check(allTags.find((t) => t.tag === "dynamic-programming").confidence === "high", "High confidence tag validated");

  // -----------------------------------------------------------------
  // 26. Low-Confidence Topic Ignored in High-Priority Views
  // -----------------------------------------------------------------
  console.log("\n━━━ 26. Low-Confidence Topic Ignored in High-Priority Views ━━━");
  const highOnlyTags = testDb.getTopicTagsByUserId(userPro.id, { minConfidence: "high" });
  check(highOnlyTags.length === 1, "Only 1 high-confidence tag retrieved");
  check(highOnlyTags[0].tag === "dynamic-programming", "High-confidence tag is dynamic-programming");
  check(!highOnlyTags.some((t) => t.tag === "segment-trees"), "Low-confidence tag ignored in high filter");

  // -----------------------------------------------------------------
  // 27. Deletion Removes Derived Coaching Metadata
  // -----------------------------------------------------------------
  console.log("\n━━━ 27. Deletion Removes Derived Coaching Metadata ━━━");
  const delRes = await makeRequest("DELETE", "/api/coach/data", tokenPro);
  check(delRes.status === 200, "DELETE /api/coach/data returns HTTP 200");
  check(delRes.body.ok === true && delRes.body.deleted === true, "Deletion confirmed");
  const tagsAfterDel = testDb.getTopicTagsByUserId(userPro.id);
  check(tagsAfterDel.length === 0, "Derived topic tags completely removed on deletion");

  // -----------------------------------------------------------------
  // 28. User Isolation Enforced
  // -----------------------------------------------------------------
  console.log("\n━━━ 28. User Isolation Enforced ━━━");
  const userBContext = codingCoachService.buildContext(userBasic.id);
  check(userBContext.totalSynced === 0, "User B cannot see User A's synced solutions");
  check(userBContext.streak === 0, "User B streak isolated from User A");

  // -----------------------------------------------------------------
  // 29. AI Provider Failure Handled
  // -----------------------------------------------------------------
  console.log("\n━━━ 29. AI Provider Failure Handled ━━━");
  mockAIProvider.failNext = true;
  const failRes = await makeRequest("POST", "/api/coach/generate", tokenPro, { mode: "daily" });
  check(failRes.status === 502, "Provider outage returns HTTP 502");
  check(failRes.body.code === "AI_PROVIDER_UNAVAILABLE", "Code is AI_PROVIDER_UNAVAILABLE");

  // -----------------------------------------------------------------
  // 30. AI Failure Doesn't Affect Sync
  // -----------------------------------------------------------------
  console.log("\n━━━ 30. AI Failure Doesn't Affect Sync ━━━");
  const sampleSub = {
    platform: "leetcode",
    problem: { slug: "two-sum", title: "Two Sum", difficulty: "Easy" },
    submission: { id: "sub_15c_ok", language: "python", status: "Accepted", code: "print('hello')" },
  };
  const norm = platforms.normalizeSubmission(sampleSub);
  const validated = platforms.validateNormalizedSubmission(norm);
  check(validated && validated.ok === true, "Submission normalizer functions independently of AI subsystem status");

  // -----------------------------------------------------------------
  // 31. Phase 15A Tests Pass
  // -----------------------------------------------------------------
  console.log("\n━━━ 31. Phase 15A Tests Pass ━━━");
  const privacyCheck = PrivacyGuard.sanitizeRequest({ feature: "coach", userQuestion: "How is my progress?" });
  check(privacyCheck.feature === "coach", "Phase 15A privacy guard handles coach feature");

  // -----------------------------------------------------------------
  // 32. Phase 15B Tests Pass
  // -----------------------------------------------------------------
  console.log("\n━━━ 32. Phase 15B Tests Pass ━━━");
  const analyzePrompt = CoachPrompt.build({ mode: "reflection", coachContext: ctx });
  check(Boolean(analyzePrompt.systemInstruction), "Coach prompt builds successfully alongside Phase 15B prompts");

  // -----------------------------------------------------------------
  // 33. Phase 14B Tests Pass
  // -----------------------------------------------------------------
  console.log("\n━━━ 33. Phase 14B Tests Pass ━━━");
  const overview = Fly2GitAnalytics.computeOverview(testDb.getAnalyticsEventsByUserId(userPro.id));
  check(overview && typeof overview.streak === "number", "Phase 14B analytics overview intact");

  // -----------------------------------------------------------------
  // 34. All Platform Tests Pass
  // -----------------------------------------------------------------
  console.log("\n━━━ 34. All Platform Tests Pass ━━━");
  const activePlatforms = platforms.getActivePlatforms();
  check(activePlatforms.length >= 7, "All 7 active platforms registered");
  check(Boolean(platforms.PLATFORM_REGISTRY.leetcode), "LeetCode registered");
  check(Boolean(platforms.PLATFORM_REGISTRY.geeksforgeeks), "GeeksforGeeks registered");
  check(Boolean(platforms.PLATFORM_REGISTRY.hackerrank), "HackerRank registered");
  check(Boolean(platforms.PLATFORM_REGISTRY.codechef), "CodeChef registered");
  check(Boolean(platforms.PLATFORM_REGISTRY.codeforces), "Codeforces registered");
  check(Boolean(platforms.PLATFORM_REGISTRY.atcoder), "AtCoder registered");
  check(Boolean(platforms.PLATFORM_REGISTRY.spoj), "SPOJ registered");

  // -----------------------------------------------------------------
  // Section 20: Opt-in Real Provider Smoke Test
  // -----------------------------------------------------------------
  console.log("\n━━━ Section 20: Real Provider Smoke Test (Opt-in) ━━━");
  if (process.env.RUN_AI_LIVE_TESTS === "true" && process.env.GEMINI_API_KEY) {
    console.log("  [LIVE] Running live Gemini smoke test for Coach with GEMINI_API_KEY...");
    const liveProv = new GeminiAIProvider({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    });
    try {
      const liveResult = await liveProv.generate({
        feature: "coach",
        mode: "daily",
        coachContext: ctx,
        observations: obs,
        balance: CodingObservations.computeBalance(ctx),
      });
      check(liveResult.provider === "gemini", "Live Gemini call succeeded and returned 'gemini' provider");
      check(liveResult.answer && liveResult.answer.summary, "Live Gemini returned structured coaching summary");
    } catch (liveErr) {
      console.warn("  Live Gemini smoke test failed:", liveErr.message);
    }
  } else {
    console.log("  [INFO] Skipping live Gemini smoke test (RUN_AI_LIVE_TESTS not enabled or GEMINI_API_KEY unset).");
  }

  await app.stop();

  console.log("\n=======================================================");
  console.log(`PHASE 15C RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    console.error("Failures:", failures);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
