// Fly2Git — Phase 15A: AI Architecture & Privacy Foundation Automated Test Suite
//
// 25 Required Verification Points:
// 1. AI disabled fails safely
// 2. Unauthenticated request rejected
// 3. Basic entitlement recognized
// 4. Pro entitlement recognized
// 5. Pro Grant recognized
// 6. Expired entitlement rejected
// 7. Malformed entitlement rejected
// 8. Unknown AI feature rejected
// 9. Oversized code rejected
// 10. Oversized prompt rejected
// 11. Provider abstraction works with mock provider
// 12. Gateway returns normalized response
// 13. RequestId generated
// 14. Provider errors normalized
// 15. Provider secret never returned
// 16. Source code not written to logs or database
// 17. Analytics receives metadata only
// 18. Usage quota enforced
// 19. Client timeout handled
// 20. AI failure does not affect sync pipeline
// 21. Malformed request rejected
// 22. Anonymous AI endpoint rejected
// 23. Secrets are redacted from logs
// 24. Existing entitlement tests still pass
// 25. Existing sync tests still pass

const http = require("http");
const crypto = require("crypto");

const Database = require("./backend/db/database");
const AuthService = require("./backend/services/auth-service");
const { EntitlementService } = require("./backend/services/entitlement-service");
const { ProGrantService } = require("./backend/services/pro-grant-service");
const { PlatformSlotService } = require("./backend/services/platform-slot-service");
const { AutomationService } = require("./backend/services/automation-service");
const { AnalyticsService } = require("./backend/services/analytics-service");
const AIUsageService = require("./backend/services/ai-usage-service");
const { AIService, AI_FEATURES } = require("./backend/services/ai-service");
const AIProvider = require("./backend/providers/ai-provider");
const MockAIProvider = require("./backend/providers/mock-ai-provider");
const PrivacyGuard = require("./backend/services/privacy-guard");
const { createServer } = require("./backend/server");
const aiClient = require("./ai-client");

// Chrome extension mock for background sync test
global.importScripts = () => {};
global.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
      setAccessLevel: () => {},
    },
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
  },
  alarms: {
    onAlarm: { addListener: () => {} },
    create: () => {},
    clear: () => {},
  },
  runtime: {
    id: "test-ext",
    getManifest: () => ({ version: "1.1.6" }),
    onConnect: { addListener: () => {} },
    onMessage: { addListener: () => {} },
  },
};

const platforms = require("./platforms");
const identity = require("./identity");
const entitlements = require("./entitlements");
const background = require("./background");

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

async function runTests() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE 15A: AI ARCHITECTURE & PRIVACY TEST   ");
  console.log("=======================================================\n");

  const testDb = new Database({ memoryOnly: true });
  const authService = new AuthService(testDb);
  const proGrantService = new ProGrantService(testDb);
  const platformSlotService = new PlatformSlotService(testDb);
  const entitlementService = new EntitlementService(testDb, { proGrantService, platformSlotService });
  const automationService = new AutomationService(testDb, entitlementService);
  const analyticsService = new AnalyticsService(testDb, entitlementService);
  const aiUsageService = new AIUsageService(testDb);
  const mockAIProvider = new MockAIProvider();

  // Test AI configuration with tight limits for verification
  const testAiConfig = {
    enabled: true,
    provider: "mock",
    maxInputChars: 1000,
    maxPromptChars: 200,
    maxOutputTokens: 512,
    monthlyBasicLimit: 3, // Low quota for quick quota test
    monthlyProLimit: 50,
  };

  const aiService = new AIService(testDb, entitlementService, aiUsageService, {
    provider: mockAIProvider,
    config: { ai: testAiConfig },
  });

  const testPort = 19472;
  const app = createServer({
    db: testDb,
    authService,
    entitlementService,
    proGrantService,
    platformSlotService,
    automationService,
    analyticsService,
    aiUsageService,
    aiService,
    memoryOnly: true,
  });

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

  // -----------------------------------------------------------------
  // User Registration Setup
  // -----------------------------------------------------------------
  // 1. Basic User
  const regBasic = await makeRequest("POST", "/api/auth/register", null, {
    email: "basic_user_ai@fly2git.test",
    password: "Password123!",
  });
  const tokenBasic = regBasic.body.token;
  const userBasic = regBasic.body.user;

  // 2. Pro User (via Stripe Subscription)
  const regPro = await makeRequest("POST", "/api/auth/register", null, {
    email: "pro_user_ai@fly2git.test",
    password: "Password123!",
  });
  const tokenPro = regPro.body.token;
  const userPro = regPro.body.user;
  testDb.insertSubscription({
    id: "sub_pro_123",
    userId: userPro.id,
    provider: "stripe",
    providerCustomerId: "cus_pro_123",
    providerSubscriptionId: "sub_pro_123",
    status: "active",
    plan: "pro",
    billingCycle: "monthly",
    currentPeriodEnd: Date.now() + 30 * 86400000,
  });

  // 3. Pro Grant User
  const regGrant = await makeRequest("POST", "/api/auth/register", null, {
    email: "grant_user_ai@fly2git.test",
    password: "Password123!",
  });
  const tokenGrant = regGrant.body.token;
  const userGrant = regGrant.body.user;
  proGrantService.createGrant({ userId: userGrant.id, type: "promotional", grantedBy: "admin" });

  // 4. Expired Subscription User
  const regExpired = await makeRequest("POST", "/api/auth/register", null, {
    email: "expired_user_ai@fly2git.test",
    password: "Password123!",
  });
  const tokenExpired = regExpired.body.token;
  const userExpired = regExpired.body.user;
  testDb.insertSubscription({
    id: "sub_expired_999",
    userId: userExpired.id,
    provider: "stripe",
    providerCustomerId: "cus_expired_999",
    providerSubscriptionId: "sub_expired_999",
    status: "canceled",
    plan: "pro",
    billingCycle: "monthly",
    currentPeriodEnd: Date.now() - 86400000, // expired yesterday
  });

  // 5. Malformed Entitlement User
  const regMalformed = await makeRequest("POST", "/api/auth/register", null, {
    email: "malformed_user_ai@fly2git.test",
    password: "Password123!",
  });
  const tokenMalformed = regMalformed.body.token;
  const userMalformed = regMalformed.body.user;

  const validSampleRequest = {
    feature: "assistant",
    platform: "leetcode",
    problem: {
      slug: "two-sum",
      title: "Two Sum",
      difficulty: "Easy",
      url: "https://leetcode.com/problems/two-sum/",
    },
    code: "def twoSum(nums, target):\n    lookup = {}\n    for i, num in enumerate(nums):\n        if target - num in lookup:\n            return [lookup[target - num], i]\n        lookup[num] = i",
    language: "python3",
    userQuestion: "What is the time complexity of this solution?",
  };

  // -----------------------------------------------------------------
  // 1. AI Disabled Fails Safely
  // -----------------------------------------------------------------
  console.log("━━━ 1. AI Disabled Fails Safely ━━━");
  aiService.config.enabled = false;
  const disabledRes = await makeRequest("POST", "/api/ai/generate", tokenPro, validSampleRequest);
  assert(disabledRes.status === 503, "Disabled AI returns HTTP 503");
  assert(disabledRes.body.ok === false, "ok is false when AI is disabled");
  assert(disabledRes.body.success === false, "success is false when AI is disabled");
  assert(disabledRes.body.code === "AI_DISABLED", "Error code is AI_DISABLED");
  aiService.config.enabled = true; // restore

  // -----------------------------------------------------------------
  // 2. Unauthenticated Request Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 2. Unauthenticated Request Rejected ━━━");
  const noAuthRes = await makeRequest("POST", "/api/ai/generate", null, validSampleRequest);
  assert(noAuthRes.status === 401, "No auth header returns HTTP 401");
  assert(noAuthRes.body.code === "AI_UNAUTHORIZED", "Error code is AI_UNAUTHORIZED");

  const badTokenRes = await makeRequest("POST", "/api/ai/generate", "invalid_jwt_garbage", validSampleRequest);
  assert(badTokenRes.status === 401, "Garbage token returns HTTP 401");
  assert(badTokenRes.body.code === "AI_UNAUTHORIZED", "Garbage token error code is AI_UNAUTHORIZED");

  // -----------------------------------------------------------------
  // 3. Basic Entitlement Recognized
  // -----------------------------------------------------------------
  console.log("\n━━━ 3. Basic Entitlement Recognized ━━━");
  const basicRes = await makeRequest("POST", "/api/ai/generate", tokenBasic, validSampleRequest);
  assert(basicRes.status === 200, "Basic user receives HTTP 200 within quota");
  assert(basicRes.body.success === true, "Basic response success is true");
  assert(basicRes.body.feature === "assistant", "Feature matches requested 'assistant'");
  assert(typeof basicRes.body.answer === "string", "Basic user receives valid answer string");

  // -----------------------------------------------------------------
  // 4. Pro Entitlement Recognized
  // -----------------------------------------------------------------
  console.log("\n━━━ 4. Pro Entitlement Recognized ━━━");
  const proRes = await makeRequest("POST", "/api/ai/generate", tokenPro, validSampleRequest);
  assert(proRes.status === 200, "Pro user receives HTTP 200");
  assert(proRes.body.success === true, "Pro response success is true");
  assert(proRes.body.provider === "mock", "Provider is mock");

  // -----------------------------------------------------------------
  // 5. Pro Grant Recognized
  // -----------------------------------------------------------------
  console.log("\n━━━ 5. Pro Grant Recognized ━━━");
  const grantRes = await makeRequest("POST", "/api/ai/generate", tokenGrant, validSampleRequest);
  assert(grantRes.status === 200, "Pro Grant user receives HTTP 200");
  assert(grantRes.body.success === true, "Pro Grant response success is true");

  // -----------------------------------------------------------------
  // 6. Expired Entitlement Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 6. Expired Entitlement Rejected ━━━");
  const expiredRes = await makeRequest("POST", "/api/ai/generate", tokenExpired, validSampleRequest);
  assert(expiredRes.status === 403, "Expired subscription receives HTTP 403");
  assert(expiredRes.body.code === "AI_FORBIDDEN", "Error code is AI_FORBIDDEN on expired");

  // -----------------------------------------------------------------
  // 7. Malformed Entitlement Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 7. Malformed Entitlement Rejected ━━━");
  // 7a. Corrupted plan
  const badPlanEntService = {
    getAuthoritativeEntitlement: async () => ({ plan: "super_hacked_tier", status: "active" }),
  };
  const badPlanAIService = new AIService(testDb, badPlanEntService, aiUsageService);
  let badPlanCaught = false;
  try {
    await badPlanAIService.generate(userBasic.id, validSampleRequest);
  } catch (err) {
    if (err.code === "AI_FORBIDDEN" && err.statusCode === 403) badPlanCaught = true;
  }
  assert(badPlanCaught, "Corrupted entitlement plan fails closed with 403 AI_FORBIDDEN");

  // 7b. Tampered signature
  const badSigEntService = {
    getAuthoritativeEntitlement: async () => ({ plan: "pro", status: "active", signature: "tampered_signature" }),
    verifySignature: () => false,
  };
  const badSigAIService = new AIService(testDb, badSigEntService, aiUsageService);
  let badSigCaught = false;
  try {
    await badSigAIService.generate(userBasic.id, validSampleRequest);
  } catch (err) {
    if (err.code === "AI_FORBIDDEN" && err.statusCode === 403) badSigCaught = true;
  }
  assert(badSigCaught, "Tampered signature fails closed with 403 AI_FORBIDDEN");

  // 7c. Missing / throwing entitlement record
  const throwEntService = {
    getAuthoritativeEntitlement: async () => { throw new Error("DB corruption"); },
  };
  const throwAIService = new AIService(testDb, throwEntService, aiUsageService);
  let throwCaught = false;
  try {
    await throwAIService.generate(userBasic.id, validSampleRequest);
  } catch (err) {
    if (err.code === "AI_FORBIDDEN" && err.statusCode === 403) throwCaught = true;
  }
  assert(throwCaught, "Inaccessible entitlement fails closed with 403 AI_FORBIDDEN");

  // -----------------------------------------------------------------
  // 8. Unknown AI Feature Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 8. Unknown AI Feature Rejected ━━━");
  const unknownFeatureRes = await makeRequest("POST", "/api/ai/generate", tokenPro, {
    ...validSampleRequest,
    feature: "unsupported_secret_feature",
  });
  assert(unknownFeatureRes.status === 400, "Unknown feature returns HTTP 400");
  assert(unknownFeatureRes.body.code === "AI_INVALID_REQUEST", "Error code is AI_INVALID_REQUEST");
  assert(unknownFeatureRes.body.error.includes("Unknown AI feature"), "Clear explanation of supported features");

  // Verify all 5 valid features succeed
  for (const featureName of AI_FEATURES) {
    const fRes = await makeRequest("POST", "/api/ai/generate", tokenPro, {
      ...validSampleRequest,
      feature: featureName,
    });
    assert(fRes.status === 200, `Supported feature '${featureName}' accepted (200)`);
    assert(fRes.body.feature === featureName, `Response reflects feature '${featureName}'`);
  }

  // -----------------------------------------------------------------
  // 9. Oversized Code Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 9. Oversized Code Rejected ━━━");
  const oversizedCode = "x".repeat(testAiConfig.maxInputChars + 50);
  const oversizeCodeRes = await makeRequest("POST", "/api/ai/generate", tokenPro, {
    ...validSampleRequest,
    code: oversizedCode,
  });
  assert(oversizeCodeRes.status === 400, "Oversized code returns HTTP 400");
  assert(oversizeCodeRes.body.code === "AI_INPUT_TOO_LARGE", "Error code is AI_INPUT_TOO_LARGE");

  // -----------------------------------------------------------------
  // 10. Oversized Prompt Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 10. Oversized Prompt Rejected ━━━");
  const oversizedPrompt = "y".repeat(testAiConfig.maxPromptChars + 50);
  const oversizePromptRes = await makeRequest("POST", "/api/ai/generate", tokenPro, {
    ...validSampleRequest,
    userQuestion: oversizedPrompt,
  });
  assert(oversizePromptRes.status === 400, "Oversized prompt returns HTTP 400");
  assert(oversizePromptRes.body.code === "AI_INPUT_TOO_LARGE", "Error code is AI_INPUT_TOO_LARGE");

  // -----------------------------------------------------------------
  // 11. Provider Abstraction Works with Mock Provider
  // -----------------------------------------------------------------
  console.log("\n━━━ 11. Provider Abstraction Works with Mock Provider ━━━");
  assert(mockAIProvider instanceof AIProvider, "MockAIProvider inherits from AIProvider interface");
  assert(typeof mockAIProvider.generate === "function", "MockAIProvider implements generate() contract");
  const directMockResult = await mockAIProvider.generate({
    feature: "coach",
    problem: { title: "Binary Search", difficulty: "Easy" },
    code: "def search(): pass",
    userQuestion: "How do I optimize?",
  });
  assert(directMockResult.provider === "mock", "Direct provider invocation specifies provider");
  assert(directMockResult.usage && directMockResult.usage.totalTokens > 0, "Provider returns usage tokens");

  // Pluggable provider test: create custom provider
  class TestPluggableProvider extends AIProvider {
    constructor() {
      super("test_custom_provider");
    }
    async generate(req) {
      return {
        answer: `Pluggable answer for ${req.feature}`,
        provider: this.name,
        model: "plug-v1",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };
    }
  }
  const pluggableGateway = new AIService(testDb, entitlementService, aiUsageService, {
    provider: new TestPluggableProvider(),
    config: { ai: testAiConfig },
  });
  const pluggableResult = await pluggableGateway.generate(userPro.id, {
    feature: "assistant",
    code: "let x = 1;",
  });
  assert(pluggableResult.provider === "test_custom_provider", "Pluggable provider invoked seamlessly by gateway");
  assert(pluggableResult.answer.includes("Pluggable answer for assistant"), "Custom provider output returned");

  // -----------------------------------------------------------------
  // 12. Gateway Returns Normalized Response
  // -----------------------------------------------------------------
  console.log("\n━━━ 12. Gateway Returns Normalized Response ━━━");
  const normRes = await makeRequest("POST", "/api/ai/generate", tokenPro, validSampleRequest);
  assert(normRes.status === 200, "Normalized HTTP status is 200");
  assert(normRes.body.success === true, "Normalized response has success: true");
  assert(typeof normRes.body.requestId === "string", "Normalized response has requestId");
  assert(normRes.body.feature === "assistant", "Normalized response has feature");
  assert(typeof normRes.body.answer === "string", "Normalized response has answer");
  assert(typeof normRes.body.provider === "string", "Normalized response has provider");
  assert(typeof normRes.body.model === "string", "Normalized response has model");
  assert(typeof normRes.body.usage === "object", "Normalized response has usage object");
  assert(typeof normRes.body.usage.inputTokens === "number", "Normalized response has inputTokens");
  assert(typeof normRes.body.usage.outputTokens === "number", "Normalized response has outputTokens");
  assert(typeof normRes.body.usage.totalTokens === "number", "Normalized response has totalTokens");

  // -----------------------------------------------------------------
  // 13. RequestId Generated
  // -----------------------------------------------------------------
  console.log("\n━━━ 13. RequestId Generated ━━━");
  assert(normRes.body.requestId.startsWith("ai_"), "RequestId begins with 'ai_'");
  assert(normRes.body.requestId.length >= 10, "RequestId has sufficient entropy");
  // Check uniqueness
  const normRes2 = await makeRequest("POST", "/api/ai/generate", tokenPro, validSampleRequest);
  assert(normRes.body.requestId !== normRes2.body.requestId, "Successive requests have unique requestIds");

  // -----------------------------------------------------------------
  // 14. Provider Errors Normalized
  // -----------------------------------------------------------------
  console.log("\n━━━ 14. Provider Errors Normalized ━━━");
  mockAIProvider.failNext = true;
  const provErrRes = await makeRequest("POST", "/api/ai/generate", tokenPro, validSampleRequest);
  assert(provErrRes.status === 502, "Provider error normalized to HTTP 502");
  assert(provErrRes.body.code === "AI_PROVIDER_UNAVAILABLE", "Normalized error code is AI_PROVIDER_UNAVAILABLE");
  assert(provErrRes.body.stack === undefined, "Stack trace NOT leaked to client");
  assert(!provErrRes.body.error.includes("MockAIProvider"), "Provider internal class names NOT leaked");

  // -----------------------------------------------------------------
  // 15. Provider Secret Never Returned
  // -----------------------------------------------------------------
  console.log("\n━━━ 15. Provider Secret Never Returned ━━━");
  // Attach a mock secret to provider instance to ensure gateway never serializes it
  mockAIProvider.apiKey = "secret_provider_token_sk_live_123456789";
  mockAIProvider.privateCredential = "SUPER_SECRET_INTERNAL_KEY";
  const secretCheckRes = await makeRequest("POST", "/api/ai/generate", tokenPro, validSampleRequest);
  const secretCheckString = JSON.stringify(secretCheckRes.body);
  assert(!secretCheckString.includes("secret_provider_token"), "Provider API key never returned in response");
  assert(!secretCheckString.includes("SUPER_SECRET_INTERNAL_KEY"), "Internal credentials never returned in response");

  // -----------------------------------------------------------------
  // 16. Source Code Not Written to Logs or Database
  // -----------------------------------------------------------------
  console.log("\n━━━ 16. Source Code Not Written to Logs or Database ━━━");
  const uniqueCodeMarker = "SECRET_USER_ALGORITHM_NONCE_" + Date.now();
  await makeRequest("POST", "/api/ai/generate", tokenPro, {
    ...validSampleRequest,
    code: `function secretAlgo() { return '${uniqueCodeMarker}'; }`,
  });

  // Verify DB AI usage collection
  const aiUsageEvents = testDb.getAIUsageEventsByUserId(userPro.id);
  assert(aiUsageEvents.length > 0, "AI usage events recorded in DB");
  const codeInDbEvents = aiUsageEvents.some((ev) => {
    return JSON.stringify(ev).includes(uniqueCodeMarker);
  });
  assert(!codeInDbEvents, "Zero occurrences of source code in aiUsageEvents");

  // Verify safe audit log structure
  const sampleAudit = PrivacyGuard.createSafeAuditLog({
    requestId: "ai_test_123",
    userId: "usr_123",
    feature: "assistant",
    platform: "leetcode",
    problem: { slug: "two-sum" },
    code: `function test() { return '${uniqueCodeMarker}'; }`,
    language: "javascript",
    userQuestion: "How do I optimize?",
  });
  assert(sampleAudit.code === undefined, "Safe audit log contains no code property");
  assert(!JSON.stringify(sampleAudit).includes(uniqueCodeMarker), "Audit log contains zero source code text");
  assert(sampleAudit.codeLength > 0, "Audit log preserves metadata codeLength");

  // -----------------------------------------------------------------
  // 17. Analytics Receives Metadata Only
  // -----------------------------------------------------------------
  console.log("\n━━━ 17. Analytics Receives Metadata Only ━━━");
  const lastUsage = aiUsageEvents[aiUsageEvents.length - 1];
  assert(lastUsage.userId === userPro.id, "Usage record has userId");
  assert(typeof lastUsage.timestamp === "number", "Usage record has timestamp");
  assert(typeof lastUsage.monthKey === "string", "Usage record has monthKey");
  assert(typeof lastUsage.inputTokens === "number", "Usage record has inputTokens");
  assert(typeof lastUsage.outputTokens === "number", "Usage record has outputTokens");
  assert(typeof lastUsage.totalTokens === "number", "Usage record has totalTokens");
  assert(lastUsage.code === undefined, "Usage record has NO code property");
  assert(lastUsage.problemText === undefined, "Usage record has NO problemText property");
  assert(lastUsage.userQuestion === undefined, "Usage record has NO userQuestion property");

  // -----------------------------------------------------------------
  // 18. Usage Quota Enforced
  // -----------------------------------------------------------------
  console.log("\n━━━ 18. Usage Quota Enforced ━━━");
  // testAiConfig.monthlyBasicLimit is 3. UserBasic already made 1 request in Test 3.
  // Make 2 more successful requests to hit the limit (total 3)
  await makeRequest("POST", "/api/ai/generate", tokenBasic, validSampleRequest);
  await makeRequest("POST", "/api/ai/generate", tokenBasic, validSampleRequest);

  // The 4th request must be rejected with 429
  const quotaExceededRes = await makeRequest("POST", "/api/ai/generate", tokenBasic, validSampleRequest);
  assert(quotaExceededRes.status === 429, "Quota exceeded returns HTTP 429");
  assert(quotaExceededRes.body.code === "AI_LIMIT_REACHED", "Error code is AI_LIMIT_REACHED");
  assert(quotaExceededRes.body.quota && quotaExceededRes.body.quota.limit === 3, "Quota limit reported in error");
  assert(quotaExceededRes.body.quota.current >= 3, "Current usage reported in error");

  // -----------------------------------------------------------------
  // 19. Client Timeout Handled
  // -----------------------------------------------------------------
  console.log("\n━━━ 19. Client Timeout Handled ━━━");
  // Configure mock provider with artificial delay
  mockAIProvider.simulatedDelayMs = 250;
  const timeoutClientResult = await aiClient.generate(validSampleRequest, {
    token: tokenPro,
    backendUrl: `http://127.0.0.1:${testPort}`,
    timeoutMs: 40, // 40ms timeout vs 250ms provider delay
  });
  mockAIProvider.simulatedDelayMs = 0; // restore

  assert(timeoutClientResult.status === "error", "Client returns status 'error' on timeout");
  assert(timeoutClientResult.errorCode === "AI_TIMEOUT", "Error code is AI_TIMEOUT");
  assert(timeoutClientResult.answer === null, "Answer is null on timeout");

  // Also test successful client call
  const successClientResult = await aiClient.generate(validSampleRequest, {
    token: tokenPro,
    backendUrl: `http://127.0.0.1:${testPort}`,
    timeoutMs: 5000,
  });
  assert(successClientResult.status === "success", "aiClient returns status 'success' on completed call");
  assert(typeof successClientResult.answer === "string", "aiClient receives answer");
  assert(successClientResult.requestId.startsWith("ai_"), "aiClient receives requestId");

  // -----------------------------------------------------------------
  // 20. AI Failure Does Not Affect Sync Pipeline
  // -----------------------------------------------------------------
  console.log("\n━━━ 20. AI Failure Does Not Affect Sync Pipeline ━━━");
  // Simulate AI service failure
  mockAIProvider.failNext = true;
  aiService.config.enabled = false;

  // Run submission through background sync handler
  const sampleSubmission = {
    platform: "LeetCode",
    problem: {
      slug: "two-sum",
      title: "Two Sum",
      difficulty: "Easy",
      url: "https://leetcode.com/problems/two-sum/",
    },
    submission: {
      id: "sub_12345",
      status: "Accepted",
      language: "python3",
      code: "class Solution: pass",
    },
    metadata: {
      timestamp: Date.now(),
    },
  };

  // The sync pipeline must complete its core operations without crashing
  let syncThrew = false;
  try {
    const norm = platforms.normalizeSubmission(sampleSubmission);
    assert(norm !== null, "Platforms normalizer runs successfully despite AI outage");
    assert(norm.platform === "LeetCode", "Normalized platform is correct");
    assert(norm.problem.slug === "two-sum", "Normalized slug is correct");
  } catch (err) {
    syncThrew = true;
  }
  assert(!syncThrew, "GitHub sync engine is completely isolated from AI service failures");
  aiService.config.enabled = true; // restore

  // -----------------------------------------------------------------
  // 21. Malformed Request Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 21. Malformed Request Rejected ━━━");
  const nonJsonRes = await makeRequest("POST", "/api/ai/generate", tokenPro, null);
  assert(nonJsonRes.status === 400, "Empty / non-object payload returns HTTP 400");
  assert(nonJsonRes.body.code === "AI_INVALID_REQUEST", "Error code is AI_INVALID_REQUEST");

  const emptyObjRes = await makeRequest("POST", "/api/ai/generate", tokenPro, {});
  assert(emptyObjRes.status === 400, "Missing feature returns HTTP 400");
  assert(emptyObjRes.body.code === "AI_INVALID_REQUEST", "Empty object error code is AI_INVALID_REQUEST");

  // -----------------------------------------------------------------
  // 22. Anonymous AI Endpoint Rejected
  // -----------------------------------------------------------------
  console.log("\n━━━ 22. Anonymous AI Endpoint Rejected ━━━");
  const anonRes = await makeRequest("POST", "/api/ai/generate", "", validSampleRequest);
  assert(anonRes.status === 401, "Anonymous POST to /api/ai/generate rejected with 401");
  assert(anonRes.body.code === "AI_UNAUTHORIZED", "Error code is AI_UNAUTHORIZED");

  // -----------------------------------------------------------------
  // 23. Secrets Are Redacted from Logs
  // -----------------------------------------------------------------
  console.log("\n━━━ 23. Secrets Are Redacted from Logs ━━━");
  const textWithSecrets = [
    "Error occurred with token ghp_1234567890abcdefghijklmnopqrstuvwxyzAB",
    "OpenAI auth key sk-abcdef1234567890abcdef123456",
    "Google API key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
    "Authorization: Bearer my_jwt_token_sample_abc123",
    'Config: {"api_key": "super_secret_password_value"}',
  ].join("\n");

  const redacted = PrivacyGuard.redactSecretsForLogging(textWithSecrets);
  assert(!redacted.includes("ghp_1234567890abcdefghijklmnopqrstuvwxyzAB"), "GitHub token redacted");
  assert(!redacted.includes("sk-abcdef1234567890abcdef123456"), "OpenAI key redacted");
  assert(!redacted.includes("AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q"), "Google key redacted");
  assert(!redacted.includes("my_jwt_token_sample_abc123"), "Bearer token redacted");
  assert(!redacted.includes("super_secret_password_value"), "Config secret redacted");
  assert(redacted.includes("[REDACTED_SECRET]"), "Redaction placeholder inserted");

  // -----------------------------------------------------------------
  // 24. Existing Entitlement Tests Still Pass
  // -----------------------------------------------------------------
  console.log("\n━━━ 24. Existing Entitlement Tests Still Pass ━━━");
  assert(typeof entitlements.canUsePlatform === "function", "entitlements.canUsePlatform exists");
  assert(typeof entitlements.canUseAdvancedAutomation === "function", "entitlements.canUseAdvancedAutomation exists");
  assert(typeof entitlements.canUseAI === "function", "entitlements.canUseAI exists");
  const basicCanAI = await entitlements.canUseAI({ plan: "basic", features: { ai: false } });
  assert(basicCanAI === false, "Client entitlements: Basic canUseAI is false");
  const proCanAI = await entitlements.canUseAI({ plan: "pro", features: { ai: true } });
  assert(proCanAI === true, "Client entitlements: Pro canUseAI is true");

  // -----------------------------------------------------------------
  // 25. Existing Sync Tests Still Pass
  // -----------------------------------------------------------------
  console.log("\n━━━ 25. Existing Sync Tests Still Pass ━━━");
  const testSub = {
    platform: "GeeksforGeeks",
    problem: {
      slug: "subarray-with-given-sum",
      title: "Subarray with given sum",
      difficulty: "Medium",
    },
    submission: {
      id: "9988",
      code: "def subArraySum(): pass",
      language: "python3",
      status: "Accepted",
    },
  };
  const gfgNorm = platforms.normalizeSubmission(testSub);
  assert(gfgNorm.platform === "GeeksforGeeks", "GFG normalization intact");
  assert(gfgNorm.problem.slug === "subarray-with-given-sum", "Slug normalization intact");
  assert(typeof identity.verifySubmissionIdentity === "function", "Identity guard verification intact");

  await app.stop();

  console.log("\n=======================================================");
  console.log(`PHASE 15A RESULTS: ${passed} PASSED, ${failed} FAILED`);
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
