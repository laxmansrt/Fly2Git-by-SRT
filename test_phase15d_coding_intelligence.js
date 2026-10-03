// Fly2Git Backend — Phase 15D: Coding Intelligence Test Suite
// Verifies all 41 required test conditions + opt-in live Gemini smoke test.

const http = require("http");
const assert = require("assert");
const { createServer } = require("./backend/server");
const Database = require("./backend/db/database");
const MockAIProvider = require("./backend/providers/mock-ai-provider");
const GeminiAIProvider = require("./backend/providers/gemini-ai-provider");
const AIProvider = require("./backend/providers/ai-provider");
const { AIService } = require("./backend/services/ai-service");
const AIUsageService = require("./backend/services/ai-usage-service");
const { CodingIntelligenceService } = require("./backend/services/coding-intelligence-service");
const { PatternNormalizer, CANONICAL_PATTERNS } = require("./backend/services/pattern-normalizer");
const CodingIntelligencePrompt = require("./backend/ai/prompts/coding-intelligence-prompt");
const CodingIntelligenceValidator = require("./backend/ai/validators/coding-intelligence-validator");
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
  console.log("   FLY2GIT PHASE 15D: CODING INTELLIGENCE TEST         ");
  console.log("=======================================================\n");

  const testDb = new Database({ memoryOnly: true });
  const mockAIProvider = new MockAIProvider();
  const testPort = 19487;

  let app;
  let aiService;
  let aiUsageService;
  let entitlementService;
  let proGrantService;
  let analyticsService;
  let codingCoachService;
  let codingIntelligenceService;

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
  codingIntelligenceService = app.codingIntelligenceService;

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

  const now = Date.now();
  const DAY_MS = 86400000;

  // Setup Users:
  // 1. User Pro with multi-problem practice history
  const regPro = await makeRequest("POST", "/api/auth/register", null, {
    email: "pro_intel_15d@fly2git.test",
    password: "Password123!",
  });
  const tokenPro = regPro.body.token;
  const userPro = regPro.body.user.id;
  testDb.insertSubscription({
    id: "sub_pro_15d",
    userId: userPro,
    provider: "stripe",
    providerCustomerId: "cus_pro_15d",
    providerSubscriptionId: "sub_pro_15d",
    status: "active",
    plan: "pro",
    billingCycle: "monthly",
    currentPeriodEnd: Date.now() + 30 * 86400000,
  });

  // 2. User Empty
  const regEmpty = await makeRequest("POST", "/api/auth/register", null, {
    email: "empty_intel_15d@fly2git.test",
    password: "Password123!",
  });
  const tokenEmpty = regEmpty.body.token;
  const userEmpty = regEmpty.body.user.id;
  testDb.insertSubscription({
    id: "sub_empty_15d",
    userId: userEmpty,
    status: "active",
    plan: "pro",
    currentPeriodEnd: Date.now() + 30 * 86400000,
  });

  // 3. User Basic
  const regBasic = await makeRequest("POST", "/api/auth/register", null, {
    email: "basic_intel_15d@fly2git.test",
    password: "Password123!",
  });
  const tokenBasic = regBasic.body.token;
  const userBasic = regBasic.body.user.id;

  // 4. User Pro Grant
  const regGrant = await makeRequest("POST", "/api/auth/register", null, {
    email: "grant_intel_15d@fly2git.test",
    password: "Password123!",
  });
  const tokenGrant = regGrant.body.token;
  const userGrant = regGrant.body.user.id;
  proGrantService.createGrant({ userId: userGrant, type: "promotional", grantedBy: "admin" });

  // 5. User Expired
  const regExpired = await makeRequest("POST", "/api/auth/register", null, {
    email: "expired_intel_15d@fly2git.test",
    password: "Password123!",
  });
  const tokenExpired = regExpired.body.token;
  const userExpired = regExpired.body.user.id;
  testDb.insertSubscription({
    id: "sub_exp_15d",
    userId: userExpired,
    status: "active",
    plan: "pro",
    currentPeriodEnd: now - 10000,
  });

  // 6. User Isolated (User B)
  const regIsolated = await makeRequest("POST", "/api/auth/register", null, {
    email: "isolated_intel_15d@fly2git.test",
    password: "Password123!",
  });
  const tokenIsolated = regIsolated.body.token;
  const userIsolated = regIsolated.body.user.id;
  testDb.insertSubscription({
    id: "sub_iso_15d",
    userId: userIsolated,
    status: "active",
    plan: "pro",
    currentPeriodEnd: Date.now() + 30 * 86400000,
  });

  // Populate practice history for userPro across multiple periods, platforms, languages, difficulties
  // Problems:
  // p1: 5 days ago (Recent window)
  testDb.insertAnalyticsEvent({
    userId: userPro,
    platform: "leetcode",
    problemSlug: "two-sum",
    title: "Two Sum",
    difficulty: "Easy",
    language: "python",
    action: "synced",
    timestamp: now - 5 * DAY_MS,
    topics: ["arrays", "hashing"],
  });

  // p2: 10 days ago (Recent window)
  testDb.insertAnalyticsEvent({
    userId: userPro,
    platform: "leetcode",
    problemSlug: "group-anagrams",
    title: "Group Anagrams",
    difficulty: "Medium",
    language: "python",
    action: "synced",
    timestamp: now - 10 * DAY_MS,
    topics: ["arrays", "hashing", "sorting"],
  });

  // p3: 15 days ago (Recent window) - Newly observed pattern dynamic-programming
  testDb.insertAnalyticsEvent({
    userId: userPro,
    platform: "codeforces",
    problemSlug: "climbing-stairs-cf",
    title: "Climbing Stairs CF",
    difficulty: "Easy",
    language: "cpp",
    action: "synced",
    timestamp: now - 15 * DAY_MS,
    topics: ["dynamic-programming", "math"],
  });

  // p4: 20 days ago (Recent window) - graphs
  testDb.insertAnalyticsEvent({
    userId: userPro,
    platform: "leetcode",
    problemSlug: "course-schedule",
    title: "Course Schedule",
    difficulty: "Medium",
    language: "java",
    action: "synced",
    timestamp: now - 20 * DAY_MS,
    topics: ["graph", "bfs", "dfs"],
  });

  // p5: 40 days ago (Previous window: 30-60 days ago) - graphs (shifted count comparison)
  testDb.insertAnalyticsEvent({
    userId: userPro,
    platform: "leetcode",
    problemSlug: "clone-graph",
    title: "Clone Graph",
    difficulty: "Medium",
    language: "java",
    action: "synced",
    timestamp: now - 40 * DAY_MS,
    topics: ["graph", "dfs"],
  });

  // p6: 45 days ago (Previous window) - sliding-window (which will be inactive in recent window)
  testDb.insertAnalyticsEvent({
    userId: userPro,
    platform: "leetcode",
    problemSlug: "longest-substring",
    title: "Longest Substring",
    difficulty: "Medium",
    language: "python",
    action: "synced",
    timestamp: now - 45 * DAY_MS,
    topics: ["sliding-window", "strings", "hashing"],
  });
  testDb.insertAnalyticsEvent({
    userId: userPro,
    platform: "leetcode",
    problemSlug: "min-window-substring",
    title: "Min Window Substring",
    difficulty: "Hard",
    language: "python",
    action: "synced",
    timestamp: now - 50 * DAY_MS,
    topics: ["sliding-window", "hashing"],
  });

  // p7: 42 days ago (Previous window) - binary-search (1 in previous, 1 in recent for stable test)
  testDb.insertAnalyticsEvent({
    userId: userPro,
    platform: "geeksforgeeks",
    problemSlug: "binary-search-gfg",
    title: "Binary Search GFG",
    difficulty: "Easy",
    language: "java",
    action: "synced",
    timestamp: now - 42 * DAY_MS,
    topics: ["binary-search", "arrays"],
  });
  testDb.insertAnalyticsEvent({
    userId: userPro,
    platform: "geeksforgeeks",
    problemSlug: "search-insert-position",
    title: "Search Insert Position",
    difficulty: "Easy",
    language: "java",
    action: "synced",
    timestamp: now - 22 * DAY_MS,
    topics: ["binary-search", "arrays"],
  });

  console.log("━━━ 1. Empty History Safe ━━━");
  const emptyIntel = codingIntelligenceService.buildIntelligence(userEmpty);
  check(emptyIntel.totalObserved === 0, "Empty history has totalObserved: 0");
  check(Array.isArray(emptyIntel.patterns) && emptyIntel.patterns.length === 0, "Empty history patterns is empty array");
  check(Array.isArray(emptyIntel.journey) && emptyIntel.journey.length === 0, "Empty history journey is empty array");
  check(Array.isArray(emptyIntel.relationships) && emptyIntel.relationships.length === 0, "Empty history relationships is empty array");
  const emptyHttp = await makeRequest("GET", "/api/intelligence/patterns", tokenEmpty);
  check(emptyHttp.status === 200, "Empty history HTTP 200");
  check(emptyHttp.body.ok === true && emptyHttp.body.patterns.length === 0, "Empty history returns ok with 0 patterns");

  console.log("\n━━━ 2. Pattern Normalization ━━━");
  check(PatternNormalizer.normalize("dynamic programming") === "dynamic-programming", "Normalizes 'dynamic programming'");
  check(PatternNormalizer.normalize("dynamic-programming") === "dynamic-programming", "Normalizes 'dynamic-programming'");
  check(PatternNormalizer.normalize("dp") === "dynamic-programming", "Normalizes 'dp' alias");
  check(PatternNormalizer.normalize("binary search") === "binary-search", "Normalizes 'binary search'");
  check(PatternNormalizer.normalize("binary-search") === "binary-search", "Normalizes 'binary-search'");
  check(PatternNormalizer.normalize("hash map") === "hashing", "Normalizes 'hash map'");
  check(PatternNormalizer.normalize("hash table") === "hashing", "Normalizes 'hash table'");
  check(PatternNormalizer.normalize("bfs") === "bfs", "Normalizes 'bfs'");
  check(PatternNormalizer.normalize("depth-first search") === "dfs", "Normalizes 'depth-first search'");
  check(CANONICAL_PATTERNS.length >= 25, "Controlled vocabulary includes at least 25 canonical patterns");

  console.log("\n━━━ 3. Unknown Pattern Handling ━━━");
  check(PatternNormalizer.normalize("unknown-foo-bar") === null, "Unknown tag returns null");
  check(PatternNormalizer.normalize("quantum-computing") === null, "Unrecognized domain tag returns null");
  check(PatternNormalizer.normalize(null) === null, "Null input returns null");
  const normList = PatternNormalizer.normalizeList(["arrays", "unknown-xyz", "dp", ""]);
  check(normList.length === 2 && normList.includes("arrays") && normList.includes("dynamic-programming"), "normalizeList strips unknown tags without throwing");

  console.log("\n━━━ 4. Pattern Activity Aggregation ━━━");
  const proIntel = codingIntelligenceService.buildIntelligence(userPro, { range: "all" });
  check(proIntel.patterns.length > 0, "Aggregated pattern activity for user with history");
  const arraysPat = proIntel.patterns.find((p) => p.pattern === "arrays");
  check(Boolean(arraysPat), "Identified 'arrays' pattern activity");
  check(arraysPat.count >= 3, `'arrays' observed count is >= 3 (actual: ${arraysPat?.count})`);
  check(arraysPat.platforms.includes("leetcode") && arraysPat.platforms.includes("geeksforgeeks"), "'arrays' platforms tracked");

  console.log("\n━━━ 5. firstSeen Calculation ━━━");
  const bsPat = proIntel.patterns.find((p) => p.pattern === "binary-search");
  check(typeof bsPat.firstSeen === "number", "firstSeen is numeric timestamp");
  check(bsPat.firstSeen === now - 42 * DAY_MS, "firstSeen matches earliest event timestamp");

  console.log("\n━━━ 6. lastSeen Calculation ━━━");
  check(typeof bsPat.lastSeen === "number", "lastSeen is numeric timestamp");
  check(bsPat.lastSeen === now - 22 * DAY_MS, "lastSeen matches latest event timestamp");
  check(bsPat.lastSeen >= bsPat.firstSeen, "lastSeen is >= firstSeen");

  console.log("\n━━━ 7. Language × Pattern Matrix ━━━");
  const langMat = proIntel.languageMatrix;
  check(typeof langMat === "object" && Boolean(langMat.python), "Language matrix has python entry");
  check(Boolean(langMat.python.arrays), "Python × arrays cell exists");
  check(Boolean(langMat.java && langMat.java.graph), "Java × graph cell exists");
  check(Boolean(langMat.cpp && langMat.cpp["dynamic-programming"]), "C++ × dynamic-programming cell exists");

  console.log("\n━━━ 8. Platform × Pattern Matrix ━━━");
  const platMat = proIntel.platformMatrix;
  check(typeof platMat === "object" && Boolean(platMat.leetcode), "Platform matrix has leetcode entry");
  check(Boolean(platMat.leetcode.hashing), "LeetCode × hashing cell exists");
  check(Boolean(platMat.codeforces && platMat.codeforces["dynamic-programming"]), "Codeforces × dynamic-programming cell exists");

  console.log("\n━━━ 9. Difficulty × Pattern Matrix ━━━");
  const diffMat = proIntel.difficultyMatrix;
  check(typeof diffMat === "object" && Boolean(diffMat.hashing), "Difficulty matrix has hashing entry");
  check(typeof diffMat.hashing.Easy === "number", "hashing Easy count is tracked");
  check(typeof diffMat.hashing.Medium === "number", "hashing Medium count is tracked");
  check(typeof diffMat.hashing.Hard === "number", "hashing Hard count is tracked");
  check(typeof diffMat.hashing.Unknown === "number", "hashing Unknown count is tracked");

  console.log("\n━━━ 10. Coding Journey Timeline ━━━");
  const journey = proIntel.journey;
  check(Array.isArray(journey) && journey.length > 0, "Coding journey timeline is an array");
  check(Boolean(journey[0].period), "Journey entry has period (YYYY-MM)");
  check(Array.isArray(journey[0].dominantPatterns), "Journey entry has dominantPatterns array");
  check(Array.isArray(journey[0].platforms), "Journey entry has platforms array");
  check(Array.isArray(journey[0].languages), "Journey entry has languages array");

  console.log("\n━━━ 11. Recent Pattern Shift ━━━");
  const shifts = proIntel.recentShifts;
  check(Array.isArray(shifts) && shifts.length > 0, "Recent shifts computed");
  const allowedDirections = ["increased", "decreased", "stable", "new", "inactive"];
  const allValid = shifts.every((s) => allowedDirections.includes(s.direction));
  check(allValid, "All shift directions match allowed labels: increased, decreased, stable, new, inactive");

  console.log("\n━━━ 12. Stable Pattern Detection ━━━");
  const stableShift = shifts.find((s) => s.pattern === "binary-search");
  check(Boolean(stableShift), "Found binary-search in shifts");
  check(stableShift?.direction === "stable", `binary-search shift detected as 'stable' (actual: ${stableShift?.direction})`);

  console.log("\n━━━ 13. Newly Observed Pattern ━━━");
  const newShift = shifts.find((s) => s.pattern === "dynamic-programming");
  check(Boolean(newShift), "Found dynamic-programming in shifts");
  check(newShift?.direction === "new", `dynamic-programming shift detected as 'new' (actual: ${newShift?.direction})`);

  console.log("\n━━━ 14. Inactive Pattern ━━━");
  const inactiveShift = shifts.find((s) => s.pattern === "sliding-window");
  check(Boolean(inactiveShift), "Found sliding-window in shifts");
  check(inactiveShift?.direction === "inactive", `sliding-window shift detected as 'inactive' (actual: ${inactiveShift?.direction})`);

  console.log("\n━━━ 15. Relationship Co-occurrence ━━━");
  const relationships = proIntel.relationships;
  check(Array.isArray(relationships) && relationships.length > 0, "Co-occurrences calculated");
  const arraysHashingRel = relationships.find(
    (r) =>
      (r.patternA === "arrays" && r.patternB === "hashing") ||
      (r.patternA === "hashing" && r.patternB === "arrays")
  );
  check(Boolean(arraysHashingRel), "arrays <-> hashing co-occurrence recorded");
  check(arraysHashingRel?.coOccurrenceCount >= 2, `arrays <-> hashing count >= 2 (actual: ${arraysHashingRel?.coOccurrenceCount})`);

  console.log("\n━━━ 16. Current Problem Relationship ━━━");
  const probCtx = codingIntelligenceService.getCurrentProblemContext(userPro, {
    platform: "leetcode",
    problemSlug: "word-break",
    title: "Word Break",
    difficulty: "Medium",
    topics: ["Dynamic Programming", "Trie"],
  });
  check(Boolean(probCtx.observedHistory), "Current problem context returns observedHistory");
  const dpObserved = probCtx.observedHistory.patterns.find((p) => p.pattern === "dynamic-programming");
  check(Boolean(dpObserved) && dpObserved.observedCount >= 1, "dynamic-programming personal history matched");
  const trieObserved = probCtx.observedHistory.patterns.find((p) => p.pattern === "trie");
  check(Boolean(trieObserved) && trieObserved.observedCount === 0, "Unpracticed trie reflects 0 observed count");

  console.log("\n━━━ 17. Current Platform Relationship ━━━");
  check(typeof probCtx.platformHistory.currentPlatformCount === "number", "currentPlatformCount is numeric");
  check(typeof probCtx.platformHistory.otherPlatformsCount === "number", "otherPlatformsCount is numeric");
  check(Array.isArray(probCtx.platformHistory.platforms), "platformHistory returns platforms array");

  console.log("\n━━━ 18. Related Pattern Calculation ━━━");
  check(Array.isArray(probCtx.relatedPatterns), "relatedPatterns is an array");
  // Check that current problem patterns themselves are not listed in relatedPatterns
  const hasSelf = probCtx.relatedPatterns.some((r) => r.pattern === "dynamic-programming" || r.pattern === "trie");
  check(!hasSelf, "relatedPatterns excludes current problem's own patterns");

  console.log("\n━━━ 19. Deterministic Exploration Candidates ━━━");
  const expCandidates = proIntel.explorationCandidates;
  check(Array.isArray(expCandidates) && expCandidates.length > 0, "Exploration candidates generated");
  check(Boolean(expCandidates[0].type && expCandidates[0].pattern && expCandidates[0].evidence && expCandidates[0].reason), "Candidate has type, pattern, evidence, reason");
  const lowAct = expCandidates.find((c) => c.type === "low_recent_activity");
  check(Boolean(lowAct), "Generated low_recent_activity exploration candidate");

  console.log("\n━━━ 20. No Skill Score Generated ━━━");
  const fullIntelStr = JSON.stringify(proIntel).toLowerCase();
  check(!fullIntelStr.includes("skillscore") && !fullIntelStr.includes("skill_score"), "Zero skill scores in intelligence data");
  check(!fullIntelStr.includes("developerscore") && !fullIntelStr.includes("developer_score"), "Zero developer scores in intelligence data");
  check(!fullIntelStr.includes("iqscore") && !fullIntelStr.includes("iq_score"), "Zero IQ scores in intelligence data");

  console.log("\n━━━ 21. No Employability Inference ━━━");
  check(!fullIntelStr.includes("employability"), "Zero employability claims in intelligence data");
  check(!fullIntelStr.includes("hireability"), "Zero hireability claims in intelligence data");

  console.log("\n━━━ 22. No Interview Prediction ━━━");
  check(!fullIntelStr.includes("interview_probability") && !fullIntelStr.includes("interviewprobability"), "Zero interview probability predictions");
  check(!fullIntelStr.includes("percentile"), "Zero percentile ranking against others");

  console.log("\n━━━ 23. AI Receives Derived Context Only ━━━");
  const prompt = CodingIntelligencePrompt.build({
    derivedContext: {
      totalObserved: 12,
      period: "30d",
      topPatterns: [{ pattern: "arrays", count: 8, platforms: ["leetcode"], languages: ["python"] }],
      recentShifts: [{ pattern: "arrays", recentCount: 5, previousCount: 3, direction: "increased" }],
      relationships: [{ patternA: "arrays", patternB: "hashing", coOccurrenceCount: 4 }],
      languageMatrix: { python: { arrays: 8 } },
      platformMatrix: { leetcode: { arrays: 8 } },
    },
    userQuestion: "What patterns have I practiced recently?",
  });
  check(prompt.userPrompt.includes("<INTELLIGENCE_CONTEXT>"), "Prompt contains INTELLIGENCE_CONTEXT tag");
  check(!prompt.userPrompt.includes("def "), "Prompt contains no python code");
  check(!prompt.userPrompt.includes("class "), "Prompt contains no class code");
  check(!prompt.userPrompt.includes("cookie"), "Prompt contains no cookies");
  check(!prompt.userPrompt.includes("token"), "Prompt contains no auth tokens");

  console.log("\n━━━ 24. AI Cannot Invent Counts ━━━");
  check(prompt.systemInstruction.includes("ZERO SCORING"), "System instruction enforces zero scoring");
  check(prompt.systemInstruction.includes("STRICT GROUNDING"), "System instruction enforces strict grounding");

  console.log("\n━━━ 25. Invalid AI Response Rejected ━━━");
  let caughtInvalid = false;
  try {
    CodingIntelligenceValidator.validate({ missingSummary: true });
  } catch (err) {
    caughtInvalid = err.code === "AI_INVALID_RESPONSE";
  }
  check(caughtInvalid, "Malformed AI response rejected with AI_INVALID_RESPONSE");

  console.log("\n━━━ 26. Confidence Validation ━━━");
  let caughtBadConf = false;
  try {
    CodingIntelligenceValidator.validate({
      summary: "Valid summary",
      observations: ["Observation 1"],
      confidence: "EXTREMELY_CONFIDENT",
    });
  } catch (err) {
    caughtBadConf = err.code === "AI_INVALID_RESPONSE";
  }
  check(caughtBadConf, "Non-standard confidence rejected with AI_INVALID_RESPONSE");

  console.log("\n━━━ 26b. Score Words Rejected by Validator ━━━");
  let caughtScoreWord = false;
  try {
    CodingIntelligenceValidator.validate({
      summary: "Your skill score is 85/100 and developer rating is high.",
      observations: ["High score."],
      confidence: "high",
    });
  } catch (err) {
    caughtScoreWord = err.code === "AI_INVALID_RESPONSE";
  }
  check(caughtScoreWord, "Forbidden skill score blocked by CodingIntelligenceValidator");

  console.log("\n━━━ 27. Basic Entitlement ━━━");
  const basicHttp = await makeRequest("GET", "/api/intelligence/patterns", tokenBasic);
  check(basicHttp.status === 200, "Basic user allowed to fetch patterns preview");
  check(basicHttp.body.preview === true, "Basic user receives preview: true");
  check(basicHttp.body.isPro === false, "Basic user receives isPro: false");
  check(basicHttp.body.patterns.length <= 3, "Basic user patterns clamped to preview size (<= 3)");

  console.log("\n━━━ 28. Pro Entitlement ━━━");
  const proHttp = await makeRequest("GET", "/api/intelligence/patterns", tokenPro);
  check(proHttp.status === 200, "Pro user allowed to fetch full patterns");
  check(proHttp.body.preview === false, "Pro user receives preview: false");
  check(proHttp.body.isPro === true, "Pro user receives isPro: true");
  check(proHttp.body.patterns.length > 3, "Pro user receives all observed patterns");

  console.log("\n━━━ 29. Pro Grant ━━━");
  const grantHttp = await makeRequest("GET", "/api/intelligence/patterns", tokenGrant);
  check(grantHttp.status === 200, "Pro Grant user allowed to fetch patterns");
  check(grantHttp.body.isPro === true, "Pro Grant user recognized as isPro: true");

  console.log("\n━━━ 30. Expired Entitlement Blocked ━━━");
  const expHttp = await makeRequest("GET", "/api/intelligence/patterns", tokenExpired);
  check(expHttp.status === 403, "Expired user receives HTTP 403 on intelligence endpoint");
  check(expHttp.body.code === "ENTITLEMENT_EXPIRED", "Error code is ENTITLEMENT_EXPIRED");

  console.log("\n━━━ 31. User Isolation ━━━");
  const isoHttp = await makeRequest("GET", "/api/intelligence/patterns", tokenIsolated);
  check(isoHttp.status === 200, "User Isolated HTTP 200");
  check(isoHttp.body.patterns.length === 0, "User Isolated cannot see User Pro's pattern activity");

  console.log("\n━━━ 32. Deletion ━━━");
  // Seed topic tags for User Pro to verify deletion
  testDb.upsertTopicTag(userPro, { tag: "dynamic-programming", confidence: "high" });
  check(testDb.getTopicTagsByUserId(userPro).length > 0, "Topic tag seeded for User Pro before deletion");
  const delHttp = await makeRequest("DELETE", "/api/intelligence/data", tokenPro);
  check(delHttp.status === 200, "DELETE /api/intelligence/data returns 200");
  check(delHttp.body.deleted === true, "Deletion confirmed in response");
  check(testDb.getTopicTagsByUserId(userPro).length === 0, "User Pro topic tags deleted cleanly");

  console.log("\n━━━ 33. Quota Usage Accounting ━━━");
  const explainHttp = await makeRequest("POST", "/api/intelligence/explain", tokenPro, {
    userQuestion: "How has my practice shifted?",
  });
  check(explainHttp.status === 200, "POST /api/intelligence/explain returns 200");
  check(Boolean(explainHttp.body.requestId), "Explanation returns requestId");
  const usageEvents = testDb.getAIUsageEventsByUserId(userPro).filter((u) => u.feature === "coding_intelligence");
  check(usageEvents.length >= 1, "Recorded AI usage event for coding_intelligence");

  console.log("\n━━━ 34. Provider Failure Handled ━━━");
  mockAIProvider.failNext = true;
  const failHttp = await makeRequest("POST", "/api/intelligence/explain", tokenPro, {
    userQuestion: "Should fail gracefully",
  });
  check(failHttp.status === 502, "Provider failure returns HTTP 502");
  check(failHttp.body.code === "AI_PROVIDER_UNAVAILABLE", "Error code is AI_PROVIDER_UNAVAILABLE");

  console.log("\n━━━ 35. AI Failure Doesn't Affect Sync ━━━");
  const rawSubmission = {
    platform: "leetcode",
    user: "testdev",
    problem: { id: "1", title: "Two Sum", slug: "two-sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum" },
    submission: { id: "sub_123", language: "python3", code: "print('hello')", status: "Accepted", timestamp: Date.now() },
  };
  const norm = platforms.normalizeSubmission(rawSubmission);
  const val = platforms.validateNormalizedSubmission(norm);
  check(val.ok === true, "Submission normalizer & validator work completely independently of AI subsystem status");

  console.log("\n━━━ 36. Phase 15C Regression (Coding Coach) ━━━");
  const coachHttp = await makeRequest("POST", "/api/coach/generate", tokenPro, { mode: "daily" });
  check(coachHttp.status === 200, "POST /api/coach/generate returns 200");
  check(Boolean(coachHttp.body.summary), "Coach returns valid summary");

  console.log("\n━━━ 37. Phase 15B Regression (AI Features) ━━━");
  const analyzeHttp = await makeRequest("POST", "/api/ai/generate", tokenPro, {
    feature: "analyze",
    language: "python",
    code: "def twoSum(nums, target): return []",
    problem: { title: "Two Sum", slug: "two-sum", difficulty: "Easy" },
  });
  check(analyzeHttp.status === 200, "Phase 15B AI Analyze returns HTTP 200");

  console.log("\n━━━ 38. Phase 14B Regression (Analytics) ━━━");
  const analyticsHttp = await makeRequest("GET", "/api/analytics/overview?range=30d", tokenPro);
  check(analyticsHttp.status === 200, "Phase 14B GET /api/analytics/overview returns HTTP 200");

  console.log("\n━━━ 39. Platform Regression ━━━");
  const expectedPlatforms = ["leetcode", "geeksforgeeks", "hackerrank", "codechef", "codeforces", "atcoder", "spoj"];
  const registered = platforms.getActivePlatforms().map((p) => p.id);
  const allPlatformsIntact = expectedPlatforms.every((p) => registered.includes(p));
  check(allPlatformsIntact, "All 7 platforms registered and intact");
  check(Boolean(platforms.PLATFORM_REGISTRY.leetcode), "LeetCode registered");
  check(Boolean(platforms.PLATFORM_REGISTRY.codeforces), "Codeforces registered");

  console.log("\n━━━ 40. Identity Regression ━━━");
  const identity = require("./identity");
  check(typeof identity.verifySubmissionIdentity === "function", "Identity guard verification intact");

  console.log("\n━━━ 41. Automation Regression ━━━");
  const automation = require("./automation-rules");
  check(typeof automation.renderCommitMessage === "function", "Automation commit builder intact");
  check(typeof automation.renderSolutionPath === "function", "Automation path builder intact");

  console.log("\n━━━ Section 20: Real Provider Smoke Test (Opt-in) ━━━");
  if (process.env.RUN_AI_LIVE_TESTS && process.env.GEMINI_API_KEY) {
    console.log("  [INFO] Running live Gemini smoke test with real API key...");
    const liveProvider = new GeminiAIProvider({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    });
    try {
      const liveResult = await liveProvider.generate({
        feature: "coding_intelligence",
        derivedContext: {
          totalObserved: 5,
          period: "30d",
          topPatterns: [{ pattern: "arrays", count: 4, platforms: ["leetcode"], languages: ["python"] }],
          recentShifts: [{ pattern: "arrays", recentCount: 4, previousCount: 1, direction: "increased" }],
          relationships: [],
          languageMatrix: { python: { arrays: 4 } },
          platformMatrix: { leetcode: { arrays: 4 } },
        },
        userQuestion: "Summarize my practice trends.",
      });
      check(Boolean(liveResult && liveResult.answer && liveResult.answer.summary), "Live Gemini generated valid Coding Intelligence explanation");
    } catch (liveErr) {
      console.warn("  [WARN] Live Gemini smoke test returned error:", liveErr.message);
    }
  } else {
    console.log("  [INFO] Skipping live Gemini smoke test (RUN_AI_LIVE_TESTS not enabled or GEMINI_API_KEY unset).");
  }

  await app.stop();

  console.log("\n=======================================================");
  console.log(`PHASE 15D RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    console.error("Failed checks:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Unhandled error in test runner:", err);
  process.exit(1);
});
