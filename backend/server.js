// Fly2Git Backend — Server & API Router (Phase 12C + Phase 14 Pro Grants + Phase 19 Beta Pilot)
// Production HTTP server with raw webhook body support, CORS, and endpoint routing.

const http = require("http");
const crypto = require("crypto");
const url = require("url");
const config = require("./config");
const Database = require("./db/database");
const StripeBillingProvider = require("./providers/stripe-provider");
const AuthService = require("./services/auth-service");
const { EntitlementService } = require("./services/entitlement-service");
const BillingService = require("./services/billing-service");
const { ProGrantService } = require("./services/pro-grant-service");
const { PlatformSlotService } = require("./services/platform-slot-service");
const { AutomationService } = require("./services/automation-service");
const { AnalyticsService } = require("./services/analytics-service");
const AIUsageService = require("./services/ai-usage-service");
const { AIService } = require("./services/ai-service");
const { CodingCoachService } = require("./services/coding-coach-service");
const { CodingIntelligenceService } = require("./services/coding-intelligence-service");
const { ProductTelemetryService } = require("./services/product-telemetry-service");
const { BetaCohortService } = require("./services/beta-cohort-service");
const { BetaMetricsService } = require("./services/beta-metrics-service");

const APP_VERSION = "1.1.6";
const API_VERSION = "1.1.0";
const MIN_SUPPORTED_CLIENT_VERSION = "1.0.0";

function parseVersion(v) {
  if (typeof v !== "string") return [0, 0, 0];
  const parts = v.trim().replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function isVersionSupported(clientVer, minVer = MIN_SUPPORTED_CLIENT_VERSION) {
  if (!clientVer) return true;
  const [cMaj, cMin, cPatch] = parseVersion(clientVer);
  const [mMaj, mMin, mPatch] = parseVersion(minVer);
  if (cMaj !== mMaj) return cMaj > mMaj;
  if (cMin !== mMin) return cMin > mMin;
  return cPatch >= mPatch;
}

function createServer(options = {}) {
  const db = options.db || new Database({ filePath: config.dbPath, memoryOnly: options.memoryOnly });
  const billingProvider = options.billingProvider || new StripeBillingProvider(config.billing);
  const authService = options.authService || new AuthService(db);
  const proGrantService = options.proGrantService || new ProGrantService(db);
  const platformSlotService = options.platformSlotService || new PlatformSlotService(db);
  const entitlementService =
    options.entitlementService || new EntitlementService(db, { proGrantService, platformSlotService });
  const billingService = options.billingService || new BillingService(db, billingProvider, entitlementService);
  const automationService = options.automationService || new AutomationService(db, entitlementService);
  const analyticsService = options.analyticsService || new AnalyticsService(db, entitlementService);
  const aiUsageService = options.aiUsageService || new AIUsageService(db);
  const aiService =
    options.aiService ||
    new AIService(db, entitlementService, aiUsageService, {
      ...options,
      provider: options.aiProvider || options.provider,
    });
  const codingCoachService =
    options.codingCoachService || new CodingCoachService(db, entitlementService, aiService, options);
  const codingIntelligenceService =
    options.codingIntelligenceService ||
    new CodingIntelligenceService(db, entitlementService, aiService, options);
  const productTelemetryService =
    options.productTelemetryService ||
    new ProductTelemetryService(db, { retentionDays: config.productTelemetryRetentionDays || 90 });
  const betaCohortService =
    options.betaCohortService ||
    new BetaCohortService(db, { maxCohortSize: 500 });
  const betaMetricsService =
    options.betaMetricsService ||
    new BetaMetricsService(db, productTelemetryService, betaCohortService);

  const server = http.createServer(async (req, res) => {
    // Production-ready Security Headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-API-Version", API_VERSION);
    res.setHeader("X-App-Version", APP_VERSION);
    if (config.env === "production" || req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    // CORS policy: Wildcard forbidden in production
    const isProduction = config.env === "production";
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
      : [config.fly2gitOrigin || "https://fly2git.com", "https://app.fly2git.com"];

    const reqOrigin = req.headers["origin"] || "";
    let allowOrigin = "*";
    if (isProduction) {
      const isAllowed =
        allowedOrigins.includes(reqOrigin) ||
        reqOrigin.startsWith("chrome-extension://");
      allowOrigin = isAllowed ? reqOrigin : allowedOrigins[0];
    }

    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Admin-Key, stripe-signature, X-Fly2Git-Version, X-Client-Version"
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Buffer incoming body with 1MB maximum limit (Request Size Limit)
    const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB
    let bodySize = 0;
    let bodyExceeded = false;
    const chunks = [];

    req.on("data", (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        bodyExceeded = true;
      } else {
        chunks.push(chunk);
      }
    });

    req.on("end", async () => {
      // Helper for JSON responses
      function sendJson(status, data) {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      }

      if (bodyExceeded) {
        return sendJson(413, { ok: false, error: "Payload Too Large (1MB maximum)" });
      }

      const rawBody = Buffer.concat(chunks);
      let jsonBody = {};
      if (rawBody.length > 0 && req.headers["content-type"]?.includes("application/json")) {
        try {
          jsonBody = JSON.parse(rawBody.toString("utf8"));
        } catch (_err) {
          // If request specifies JSON content-type but fails parsing, return 400 Bad Request
          return sendJson(400, { ok: false, error: "Malformed JSON payload" });
        }
      }

      // Release Safety: Verify client version compatibility (Phase 18 Section 8)
      const clientVerHeader = req.headers["x-fly2git-version"] || req.headers["x-client-version"] || "";
      if (
        clientVerHeader &&
        pathname.startsWith("/api/") &&
        pathname !== "/api/health" &&
        !pathname.startsWith("/api/webhooks/")
      ) {
        if (!isVersionSupported(clientVerHeader)) {
          return sendJson(426, {
            ok: false,
            code: "CLIENT_VERSION_UNSUPPORTED",
            error: `Client version ${clientVerHeader} unsupported. Minimum supported version is ${MIN_SUPPORTED_CLIENT_VERSION}. Please update Fly2Git.`,
            minSupportedVersion: MIN_SUPPORTED_CLIENT_VERSION,
            appVersion: APP_VERSION,
            apiVersion: API_VERSION,
          });
        }
      }

      // Rate Limiting helper (in-memory sliding window)
      const clientIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1")
        .split(",")[0]
        .trim();

      if (!options._rateLimits) {
        options._rateLimits = {
          auth: new Map(), // ip -> { count, resetAt }
          checkout: new Map(), // ip -> { count, resetAt }
          slotChange: new Map(), // ip -> { count, resetAt }
        };
      }

      function checkRateLimit(type, limit = 15, windowMs = 60000) {
        const map = options._rateLimits[type];
        if (!map) return true;
        const now = Date.now();
        let record = map.get(clientIp);
        if (!record || now > record.resetAt) {
          map.set(clientIp, { count: 1, resetAt: now + windowMs });
          return true;
        }
        if (record.count >= limit) {
          return false;
        }
        record.count++;
        return true;
      }

      // Auth middleware helper
      function authenticate() {
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) return null;
        return authService.verifyToken(token);
      }

      // Admin authentication: requires X-Admin-Key header with valid admin API key
      function authenticateAdmin() {
        const adminKey = req.headers["x-admin-key"] || "";
        if (!adminKey || typeof adminKey !== "string") return false;
        // Constant-time comparison to prevent timing attacks
        const expected = config.adminApiKey;
        if (!expected || expected.length === 0) return false;
        if (adminKey.length !== expected.length) return false;
        const a = Buffer.from(adminKey);
        const b = Buffer.from(expected);
        try {
          return crypto.timingSafeEqual(a, b);
        } catch {
          return false;
        }
      }

      try {
        // --- Health ---
        if ((pathname === "/health" || pathname === "/api/health") && req.method === "GET") {
          return sendJson(200, {
            ok: true,
            status: "healthy",
            service: "fly2git-entitlements",
            version: APP_VERSION,
            apiVersion: API_VERSION,
            environment: config.env,
            uptime: Math.floor(process.uptime()),
            keyId: config.entitlementKeyId,
            timestamp: new Date().toISOString(),
          });
        }

        // --- Auth Routes ---
        if (pathname === "/api/auth/register" && req.method === "POST") {
          if (!checkRateLimit("auth", 15, 60000)) {
            return sendJson(429, { ok: false, error: "Too many authentication requests. Please try again later." });
          }
          const { email, password } = jsonBody;
          const result = await authService.register(email, password);
          return sendJson(201, { ok: true, ...result });
        }

        if (pathname === "/api/auth/login" && req.method === "POST") {
          if (!checkRateLimit("auth", 15, 60000)) {
            return sendJson(429, { ok: false, error: "Too many authentication requests. Please try again later." });
          }
          const { email, password } = jsonBody;
          const result = await authService.login(email, password);
          return sendJson(200, { ok: true, ...result });
        }

        if (pathname === "/api/auth/me" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });
          const user = db.getUserById(session.sub);
          return sendJson(200, { ok: true, user: { id: user.id, email: user.email } });
        }

        // --- Entitlement Route (Protected) ---
        if (pathname === "/api/entitlement" && req.method === "GET") {
          const session = authenticate();
          if (!session) {
            // Unauthenticated callers receive default Basic entitlement
            const basic = entitlementService.getDefaultBasicEntitlement(null);
            return sendJson(200, { ok: true, entitlement: basic, authenticated: false });
          }
          const entitlement = await entitlementService.getAuthoritativeEntitlement(session.sub);
          return sendJson(200, { ok: true, entitlement, authenticated: true });
        }

        // --- Checkout Route (Protected & Hardened) ---
        if (pathname === "/api/checkout/create-session" && req.method === "POST") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Authentication required for checkout" });

          if (!checkRateLimit("checkout", 15, 60000)) {
            return sendJson(429, { ok: false, error: "Too many checkout requests. Please try again later." });
          }

          // Security: Whitelist billing cycle. Never trust client-supplied arbitrary price or user ID.
          const validCycle = jsonBody.billingCycle === "yearly" ? "yearly" : "monthly";

          const checkoutSession = await billingService.createCheckoutSession(session.sub, {
            billingCycle: validCycle,
            successUrl: jsonBody.successUrl,
            cancelUrl: jsonBody.cancelUrl,
          });
          return sendJson(200, { ok: true, session: checkoutSession });
        }

        // --- Webhook Route (Public with Signature Verification) ---
        if (pathname === "/api/webhooks/payment" && req.method === "POST") {
          const signature = req.headers["stripe-signature"] || "";
          const result = await billingService.processWebhook(rawBody, signature);
          return sendJson(200, result);
        }

        // --- Billing Management Routes ---
        if (pathname === "/api/billing/cancel" && req.method === "POST") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          const updated = await billingService.cancelSubscription(session.sub);
          return sendJson(200, { ok: true, entitlement: updated });
        }

        if ((pathname === "/api/billing/portal" || pathname === "/api/billing/portal-session") && req.method === "POST") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          const portal = await billingService.createCustomerPortalSession(session.sub);
          return sendJson(200, { ok: true, url: portal.url });
        }

        // --- Repository Targets (Multi-Repo Architecture Preparation) ---
        if (pathname === "/api/repositories/targets" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });
          const targets = db.getRepositoryTargetsByUserId(session.sub);
          return sendJson(200, { ok: true, targets });
        }

        if (pathname === "/api/repositories/targets" && req.method === "POST") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });
          const ent = await entitlementService.getAuthoritativeEntitlement(session.sub);
          if (ent.plan !== "pro") {
            return sendJson(403, { ok: false, error: "Multi-repository mapping requires Fly2Git Pro" });
          }
          const target = db.insertRepositoryTarget({
            userId: session.sub,
            githubOwner: jsonBody.githubOwner,
            githubRepo: jsonBody.githubRepo,
            platform: jsonBody.platform,
          });
          return sendJson(201, { ok: true, target });
        }

        // ===================================================================
        // Platform Slot Governance Routes (Phase 13A)
        // Authoritative slot management with 30-day cooldown enforcement
        // ===================================================================

        if (pathname === "/api/platform-slots" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });
          const ent = await entitlementService.getAuthoritativeEntitlement(session.sub);
          const isPro = ent.plan === "pro";
          const slots = platformSlotService.getSlots(session.sub, ent.plan);
          return sendJson(200, {
            ok: true,
            plan: ent.plan,
            isPro,
            platformSlots: slots,
            selectedPlatforms: slots.map((s) => s.platform),
          });
        }

        if (pathname === "/api/platform-slots/change" && req.method === "POST") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          if (!checkRateLimit("slotChange", 30, 60000)) {
            return sendJson(429, { ok: false, error: "Too many slot change requests. Please try again later." });
          }

          // Authoritatively derive everything on backend:
          // Strictly ignore any client-supplied userId, plan, activatedAt, nextChangeAt
          const userId = session.sub;
          const ent = await entitlementService.getAuthoritativeEntitlement(userId);
          const isPro = ent.plan === "pro";

          const { slot, platform } = jsonBody;

          try {
            const result = platformSlotService.changeSlot({
              userId,
              slot,
              platform,
              isPro,
            });

            // Refresh authoritative entitlement state
            await entitlementService.getAuthoritativeEntitlement(userId);

            return sendJson(200, {
              ok: true,
              plan: ent.plan,
              slot: result.slot,
              platformSlots: result.platformSlots,
              noop: Boolean(result.noop),
            });
          } catch (slotErr) {
            if (slotErr.code === "PLATFORM_CHANGE_COOLDOWN") {
              return sendJson(429, {
                ok: false,
                code: "PLATFORM_CHANGE_COOLDOWN",
                error: slotErr.message,
                slot: slotErr.slot,
                currentPlatform: slotErr.currentPlatform,
                requestedPlatform: slotErr.requestedPlatform,
                nextChangeAt: slotErr.nextChangeAt,
              });
            }
            if (slotErr.code === "PLATFORM_ALREADY_SELECTED") {
              return sendJson(400, {
                ok: false,
                code: "PLATFORM_ALREADY_SELECTED",
                error: "PLATFORM_ALREADY_SELECTED",
                message: slotErr.message,
              });
            }
            return sendJson(slotErr.statusCode || 400, {
              ok: false,
              error: slotErr.message,
            });
          }
        }

        // ===================================================================
        // Advanced Automation Routes (Phase 14A)
        // Pro-only customization with authoritative server-side enforcement
        // ===================================================================

        if (pathname === "/api/automation/settings" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          const result = await automationService.getSettings(session.sub);
          return sendJson(200, {
            ok: true,
            isPro: result.isPro,
            settings: result.settings,
            updatedAt: result.updatedAt,
          });
        }

        if (pathname === "/api/automation/settings" && req.method === "PUT") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const result = await automationService.saveSettings(session.sub, jsonBody);
            return sendJson(200, {
              ok: true,
              isPro: result.isPro,
              settings: result.settings,
              updatedAt: result.updatedAt,
            });
          } catch (err) {
            return sendJson(err.statusCode || 400, {
              ok: false,
              code: err.code || "AUTOMATION_ERROR",
              error: err.message,
            });
          }
        }

        // ===================================================================
        // Personal Coding Analytics Routes (Phase 14B)
        // Pro-only personal analytics derived strictly from sync metadata
        // ===================================================================

        // POST /api/analytics/events — record activity event from extension
        if (pathname === "/api/analytics/events" && req.method === "POST") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const result = await analyticsService.recordEvent(session.sub, jsonBody);
            return sendJson(200, { ok: true, ...result });
          } catch (err) {
            return sendJson(err.statusCode || 400, {
              ok: false,
              code: err.code || "ANALYTICS_ERROR",
              error: err.message,
            });
          }
        }

        // GET /api/analytics/overview — dashboard overview statistics
        if (pathname === "/api/analytics/overview" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const range = parsedUrl.query.range || "30d";
            const tz = parsedUrl.query.tz !== undefined ? Number(parsedUrl.query.tz) : 0;
            const overview = await analyticsService.getOverview(session.sub, { range, timezoneOffset: tz });
            return sendJson(200, overview);
          } catch (err) {
            return sendJson(err.statusCode || 400, {
              ok: false,
              code: err.code || "ANALYTICS_ERROR",
              error: err.message,
            });
          }
        }

        // GET /api/analytics/activity — daily activity timeline for chart
        if (pathname === "/api/analytics/activity" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const range = parsedUrl.query.range || "30d";
            const tz = parsedUrl.query.tz !== undefined ? Number(parsedUrl.query.tz) : 0;
            const timeline = await analyticsService.getActivityTimeline(session.sub, { range, timezoneOffset: tz });
            return sendJson(200, timeline);
          } catch (err) {
            return sendJson(err.statusCode || 400, {
              ok: false,
              code: err.code || "ANALYTICS_ERROR",
              error: err.message,
            });
          }
        }

        // GET /api/analytics/export — export sanitized metadata as CSV or JSON
        if (pathname === "/api/analytics/export" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const format = parsedUrl.query.format === "csv" ? "csv" : "json";
            const range = parsedUrl.query.range || "all";
            const exportRes = await analyticsService.exportData(session.sub, { format, range });

            res.setHeader("Content-Type", exportRes.contentType);
            res.setHeader("Content-Disposition", `attachment; filename="${exportRes.filename}"`);
            res.writeHead(200);
            res.end(exportRes.content);
            return;
          } catch (err) {
            return sendJson(err.statusCode || 400, {
              ok: false,
              code: err.code || "ANALYTICS_ERROR",
              error: err.message,
            });
          }
        }

        // DELETE /api/analytics — user deletes their personal analytics
        if (pathname === "/api/analytics" && req.method === "DELETE") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const delRes = await analyticsService.deleteUserData(session.sub);
            if (codingCoachService && typeof codingCoachService.deleteUserData === "function") {
              codingCoachService.deleteUserData(session.sub);
            }
            if (codingIntelligenceService && typeof codingIntelligenceService.deleteUserData === "function") {
              codingIntelligenceService.deleteUserData(session.sub);
            }
            return sendJson(200, delRes);
          } catch (err) {
            return sendJson(err.statusCode || 400, {
              ok: false,
              code: err.code || "ANALYTICS_ERROR",
              error: err.message,
            });
          }
        }

        // ===================================================================
        // AI Gateway Routes (Phase 15A)
        // Provider-agnostic AI endpoint: requires authenticated user session.
        // The extension never communicates directly with AI providers.
        // ===================================================================

        // POST /api/ai/generate
        if (pathname === "/api/ai/generate" && req.method === "POST") {
          const session = authenticate();
          if (!session) {
            return sendJson(401, {
              ok: false,
              success: false,
              code: "AI_UNAUTHORIZED",
              error: "Authentication required for AI operations",
            });
          }

          try {
            const result = await aiService.generate(session.sub, jsonBody);
            return sendJson(200, { ok: true, ...result });
          } catch (err) {
            return sendJson(err.statusCode || 500, {
              ok: false,
              success: false,
              code: err.code || "AI_INTERNAL_ERROR",
              error: err.message,
              requestId: err.requestId || undefined,
              quota: err.quota || undefined,
            });
          }
        }

        // ===================================================================
        // Personal Coding Coach Routes (Phase 15C)
        // Objective, evidence-based coaching using existing sync metadata.
        // ===================================================================

        // POST /api/coach/generate
        if (pathname === "/api/coach/generate" && req.method === "POST") {
          const session = authenticate();
          if (!session) {
            return sendJson(401, {
              ok: false,
              success: false,
              code: "AI_UNAUTHORIZED",
              error: "Authentication required for Personal Coding Coach",
            });
          }

          try {
            const result = await codingCoachService.generateCoaching(session.sub, jsonBody);
            return sendJson(200, { ok: true, ...result });
          } catch (err) {
            return sendJson(err.statusCode || 500, {
              ok: false,
              success: false,
              code: err.code || "AI_INTERNAL_ERROR",
              error: err.message,
              requestId: err.requestId || undefined,
              quota: err.quota || undefined,
            });
          }
        }

        // GET /api/coach/context — retrieve deterministic context & observations
        if (pathname === "/api/coach/context" && req.method === "GET") {
          const session = authenticate();
          if (!session) {
            return sendJson(401, { ok: false, error: "Unauthorized" });
          }

          try {
            const context = codingCoachService.buildContext(session.sub, parsedUrl.query);
            return sendJson(200, { ok: true, context });
          } catch (err) {
            return sendJson(err.statusCode || 500, { ok: false, error: err.message });
          }
        }

        // DELETE /api/coach/data — user deletes their derived coaching metadata
        if (pathname === "/api/coach/data" && req.method === "DELETE") {
          const session = authenticate();
          if (!session) {
            return sendJson(401, { ok: false, error: "Unauthorized" });
          }

          try {
            const delRes = codingCoachService.deleteUserData(session.sub);
            return sendJson(200, delRes);
          } catch (err) {
            return sendJson(err.statusCode || 500, { ok: false, error: err.message });
          }
        }

        // ===================================================================
        // Coding Intelligence Routes (Phase 15D)
        // Structured practice history, navigation, and observation.
        // Invariants: Zero skill score, zero employability inference, no PII.
        // ===================================================================

        // GET /api/intelligence/patterns — pattern activity aggregation
        if (pathname === "/api/intelligence/patterns" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const ent = await entitlementService.getAuthoritativeEntitlement(session.sub);
            const now = Date.now();
            if (!ent || ent.status === "expired" || (typeof ent.expiresAt === "number" && now > ent.expiresAt)) {
              return sendJson(403, { ok: false, code: "ENTITLEMENT_EXPIRED", error: "Subscription has expired" });
            }

            const isPro = ent.plan === "pro";
            const fullIntel = codingIntelligenceService.buildIntelligence(session.sub, parsedUrl.query);
            const patterns = isPro ? fullIntel.patterns : fullIntel.patterns.slice(0, 3);

            return sendJson(200, {
              ok: true,
              patterns,
              totalObserved: fullIntel.totalObserved,
              period: fullIntel.period,
              isPro,
              preview: !isPro,
            });
          } catch (err) {
            return sendJson(err.statusCode || 500, { ok: false, error: err.message });
          }
        }

        // GET /api/intelligence/journey — chronological coding journey timeline
        if (pathname === "/api/intelligence/journey" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const ent = await entitlementService.getAuthoritativeEntitlement(session.sub);
            const now = Date.now();
            if (!ent || ent.status === "expired" || (typeof ent.expiresAt === "number" && now > ent.expiresAt)) {
              return sendJson(403, { ok: false, code: "ENTITLEMENT_EXPIRED", error: "Subscription has expired" });
            }

            const isPro = ent.plan === "pro";
            const fullIntel = codingIntelligenceService.buildIntelligence(session.sub, parsedUrl.query);
            const journey = isPro ? fullIntel.journey : fullIntel.journey.slice(0, 2);

            return sendJson(200, {
              ok: true,
              journey,
              range: parsedUrl.query.range || "all",
              isPro,
              preview: !isPro,
            });
          } catch (err) {
            return sendJson(err.statusCode || 500, { ok: false, error: err.message });
          }
        }

        // POST /api/intelligence/problem-context — current problem personal history
        if (pathname === "/api/intelligence/problem-context" && req.method === "POST") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const context = codingIntelligenceService.getCurrentProblemContext(session.sub, jsonBody);
            return sendJson(200, { ok: true, ...context });
          } catch (err) {
            return sendJson(err.statusCode || 500, { ok: false, error: err.message });
          }
        }

        // POST /api/intelligence/explain — AI-grounded pattern explanation
        if (pathname === "/api/intelligence/explain" && req.method === "POST") {
          const session = authenticate();
          if (!session) {
            return sendJson(401, {
              ok: false,
              success: false,
              code: "AI_UNAUTHORIZED",
              error: "Authentication required for Coding Intelligence",
            });
          }

          try {
            const result = await codingIntelligenceService.explainIntelligence(session.sub, jsonBody);
            return sendJson(200, { ok: true, ...result });
          } catch (err) {
            return sendJson(err.statusCode || 500, {
              ok: false,
              success: false,
              code: err.code || "AI_INTERNAL_ERROR",
              error: err.message,
              requestId: err.requestId || undefined,
              quota: err.quota || undefined,
            });
          }
        }

        // GET /api/intelligence/coverage — pattern coverage activity
        if (pathname === "/api/intelligence/coverage" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const coverage = codingIntelligenceService.getPatternCoverage(session.sub, parsedUrl.query);
            return sendJson(200, { ok: true, coverage });
          } catch (err) {
            return sendJson(err.statusCode || 500, { ok: false, error: err.message });
          }
        }

        // GET /api/intelligence/relationships — observed co-occurrences
        if (pathname === "/api/intelligence/relationships" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const relationships = codingIntelligenceService.getPatternRelationships(session.sub, parsedUrl.query);
            return sendJson(200, { ok: true, relationships });
          } catch (err) {
            return sendJson(err.statusCode || 500, { ok: false, error: err.message });
          }
        }

        // GET /api/intelligence/exploration — deterministic candidates
        if (pathname === "/api/intelligence/exploration" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const explorationCandidates = codingIntelligenceService.getExplorationCandidates(session.sub, parsedUrl.query);
            return sendJson(200, { ok: true, explorationCandidates });
          } catch (err) {
            return sendJson(err.statusCode || 500, { ok: false, error: err.message });
          }
        }

        // DELETE /api/intelligence/data — delete derived intelligence metadata
        if (pathname === "/api/intelligence/data" && req.method === "DELETE") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          try {
            const delRes = codingIntelligenceService.deleteUserData(session.sub);
            return sendJson(200, delRes);
          } catch (err) {
            return sendJson(err.statusCode || 500, { ok: false, error: err.message });
          }
        }

        // ===================================================================
        // Admin-Only Pro Grant Management Routes (Phase 14)
        // All routes require X-Admin-Key header with valid admin API key.
        // Ordinary users CANNOT access these endpoints.
        // ===================================================================

        if (pathname === "/api/admin/pro-grants" && req.method === "POST") {
          if (!authenticateAdmin()) {
            return sendJson(403, { ok: false, error: "Forbidden: Admin access required" });
          }
          const { userId, type, expiresAt, grantedBy, note } = jsonBody;
          // Never accept userId from client sessions — admin explicitly specifies target user
          const grant = proGrantService.createGrant({
            userId,
            type,
            expiresAt: expiresAt !== undefined ? expiresAt : null,
            grantedBy: grantedBy || "admin",
            note: note || "",
          });
          return sendJson(201, { ok: true, grant });
        }

        if (pathname === "/api/admin/pro-grants" && req.method === "GET") {
          if (!authenticateAdmin()) {
            return sendJson(403, { ok: false, error: "Forbidden: Admin access required" });
          }
          const filters = {};
          if (parsedUrl.query.status) filters.status = parsedUrl.query.status;
          if (parsedUrl.query.userId) filters.userId = parsedUrl.query.userId;
          const grants = proGrantService.listGrants(filters);
          return sendJson(200, { ok: true, grants });
        }

        // DELETE /api/admin/pro-grants/:id — revoke a grant
        const grantDeleteMatch = pathname.match(/^\/api\/admin\/pro-grants\/([a-zA-Z0-9_-]+)$/);
        if (grantDeleteMatch && req.method === "DELETE") {
          if (!authenticateAdmin()) {
            return sendJson(403, { ok: false, error: "Forbidden: Admin access required" });
          }
          const grantId = grantDeleteMatch[1];
          const revokedBy = jsonBody.revokedBy || req.headers["x-admin-identity"] || "admin";
          const revoked = proGrantService.revokeGrant(grantId, revokedBy);
          return sendJson(200, { ok: true, grant: revoked });
        }

        // ===================================================================
        // Beta Validation, Telemetry & Product Feedback Routes (Phase 18)
        // Privacy-first telemetry, bounded feedback, safe diagnostics & beta
        // ===================================================================

        // POST /api/telemetry/product (and /api/product-telemetry) — record product event
        if ((pathname === "/api/telemetry/product" || pathname === "/api/product-telemetry") && req.method === "POST") {
          const session = authenticate();
          // Never accept client-provided userId as authoritative when session is present
          const userId = session ? session.sub : (jsonBody.userId || "anonymous");

          try {
            const result = productTelemetryService.recordEvent(
              {
                ...jsonBody,
                userId,
              },
              {
                userId,
                telemetryEnabled: jsonBody.productTelemetryEnabled !== false,
              }
            );

            if (!result.ok) {
              return sendJson(400, { ok: false, error: result.error });
            }
            return sendJson(200, { ok: true, ...result });
          } catch (telErr) {
            // Failure isolation: telemetry failure must never break callers
            return sendJson(200, { ok: false, skipped: true, error: telErr.message });
          }
        }

        // GET /api/telemetry/product (and /api/product-telemetry) — view authenticated user's telemetry (Isolation check)
        if ((pathname === "/api/telemetry/product" || pathname === "/api/product-telemetry") && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          const telemetry = productTelemetryService.getUserTelemetry(session.sub, parsedUrl.query);
          return sendJson(200, { ok: true, telemetry });
        }

        // DELETE /api/product-telemetry — user deletes product telemetry without affecting sync, AI, analytics, or billing
        if (pathname === "/api/product-telemetry" && req.method === "DELETE") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          const delRes = productTelemetryService.deleteUserTelemetry(session.sub);
          return sendJson(200, { ok: true, ...delRes });
        }

        // POST /api/feedback — submit user feedback (bounded & sanitized)
        if (pathname === "/api/feedback" && req.method === "POST") {
          const session = authenticate();
          const userId = session ? session.sub : "anonymous";
          const { category, message, appVersion, platform, context } = jsonBody;

          const ALLOWED_CATEGORIES = ["bug", "confusing", "feature_request", "feedback"];
          if (!category || !ALLOWED_CATEGORIES.includes(category)) {
            return sendJson(400, {
              ok: false,
              code: "INVALID_CATEGORY",
              error: `Category must be one of: ${ALLOWED_CATEGORIES.join(", ")}`,
            });
          }

          if (typeof message !== "string" || message.trim().length === 0) {
            return sendJson(400, { ok: false, code: "EMPTY_MESSAGE", error: "Feedback message cannot be empty" });
          }

          if (message.length > 2000) {
            return sendJson(400, {
              ok: false,
              code: "MESSAGE_TOO_LONG",
              error: "Feedback message exceeds maximum length of 2000 characters",
            });
          }

          try {
            const feedbackRecord = db.insertFeedback({
              userId,
              category,
              message: message.trim(),
              appVersion: typeof appVersion === "string" ? appVersion.slice(0, 32) : APP_VERSION,
              platform: typeof platform === "string" ? platform.slice(0, 32) : "unknown",
              context: context && typeof context === "object" ? context : {},
            });

            // Automatically record feedback_submitted product telemetry event if enabled
            try {
              productTelemetryService.recordEvent({
                event: "feedback_submitted",
                userId,
                appVersion: feedbackRecord.appVersion,
                platform: feedbackRecord.platform,
              });
            } catch (_ignore) {
              // Failure isolation: telemetry failure must never break feedback
            }

            return sendJson(201, {
              ok: true,
              id: feedbackRecord.id,
              message: "Feedback submitted successfully",
            });
          } catch (fbErr) {
            return sendJson(500, { ok: false, error: fbErr.message });
          }
        }

        // GET /api/feedback — view authenticated user's feedback submissions (Isolation check)
        if (pathname === "/api/feedback" && req.method === "GET") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });

          const feedback = db.getFeedbackByUserId(session.sub);
          return sendJson(200, { ok: true, feedback });
        }

        // GET /api/beta/status — return minimal beta status and feature flags for authenticated user
        if (pathname === "/api/beta/status" && req.method === "GET") {
          const session = authenticate();
          if (!session) {
            return sendJson(200, { ok: true, beta: false, flags: {} });
          }

          const betaStatus = db.getBetaStatus(session.sub);
          const isBeta = Boolean(betaStatus && betaStatus.beta_enabled && !betaStatus.expired);

          // Server-controlled feature flags for beta rollout (Section 9)
          // Flags never bypass entitlement: entitlement remains authoritative
          const flags = {
            betaTelemetry: isBeta,
            betaAI: isBeta,
            betaCoach: isBeta,
            betaIntelligence: isBeta,
          };

          return sendJson(200, {
            ok: true,
            beta: isBeta,
            beta_user: Boolean(betaStatus && betaStatus.beta_user),
            beta_expires_at: betaStatus?.beta_expires_at || null,
            flags,
          });
        }

        // Admin-Only Beta Allowlist Routes
        if (pathname === "/api/admin/beta/allowlist" && req.method === "POST") {
          if (!authenticateAdmin()) {
            return sendJson(403, { ok: false, error: "Forbidden: Admin access required" });
          }
          const { userId, beta_enabled, beta_expires_at } = jsonBody;
          if (!userId) {
            return sendJson(400, { ok: false, error: "userId is required" });
          }
          const updated = db.setBetaStatus(userId, {
            beta_enabled: beta_enabled !== false,
            beta_expires_at: typeof beta_expires_at === "number" ? beta_expires_at : null,
          });
          return sendJson(200, { ok: true, beta: updated });
        }

        const betaTargetMatch = pathname.match(/^\/api\/admin\/beta\/allowlist\/([a-zA-Z0-9_-]+)$/);
        if (betaTargetMatch && req.method === "GET") {
          if (!authenticateAdmin()) {
            return sendJson(403, { ok: false, error: "Forbidden: Admin access required" });
          }
          const targetUserId = betaTargetMatch[1];
          const status = db.getBetaStatus(targetUserId);
          return sendJson(200, { ok: true, beta: status });
        }

        // Phase 19: Admin-only beta dashboard
        if (pathname === "/api/admin/beta/dashboard" && req.method === "GET") {
          const adminKey = req.headers["x-admin-key"];
          if (adminKey !== config.adminApiKey) {
            return sendJson(403, { ok: false, error: "Forbidden" });
          }
          try {
            const dashboard = betaMetricsService.getDashboard();
            return sendJson(200, { ok: true, dashboard });
          } catch (err) {
            return sendJson(500, { ok: false, error: "Dashboard generation failed" });
          }
        }

        // Phase 19: Admin cohort management — revoke beta
        if (pathname === "/api/admin/beta/revoke" && req.method === "POST") {
          const adminKey = req.headers["x-admin-key"];
          if (adminKey !== config.adminApiKey) {
            return sendJson(403, { ok: false, error: "Forbidden" });
          }
          const { userId } = jsonBody;
          if (!userId) return sendJson(400, { ok: false, error: "Missing userId" });
          const result = betaCohortService.revokeBeta(userId);
          return sendJson(result.ok ? 200 : 400, result);
        }

        // Phase 19: Record onboarding event
        if (pathname === "/api/beta/onboarding" && req.method === "POST") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });
          const { step, platform, appVersion } = jsonBody;
          const result = betaMetricsService.recordOnboardingEvent(
            session.sub, step, { platform, appVersion }
          );
          return sendJson(result.ok ? 200 : 400, result);
        }

        // Phase 19: Record activation (first sync)
        if (pathname === "/api/beta/activation" && req.method === "POST") {
          const session = authenticate();
          if (!session) return sendJson(401, { ok: false, error: "Unauthorized" });
          const { installTimestamp, onboardingCompletedTimestamp, platform, appVersion } = jsonBody;
          const result = betaMetricsService.recordActivation(
            session.sub, { installTimestamp, onboardingCompletedTimestamp, platform, appVersion }
          );
          return sendJson(result.ok ? 200 : 400, result);
        }

        return sendJson(404, { ok: false, error: "Endpoint not found" });
      } catch (err) {
        console.error("[Fly2Git][Server] Request error:", err.message);
        return sendJson(err.statusCode || 500, { ok: false, error: err.message });
      }
    });
  });

  return {
    server,
    db,
    authService,
    entitlementService,
    billingService,
    billingProvider,
    proGrantService,
    platformSlotService,
    automationService,
    analyticsService,
    aiUsageService,
    aiService,
    codingCoachService,
    codingIntelligenceService,
    productTelemetryService,
    betaCohortService,
    betaMetricsService,
    APP_VERSION,
    API_VERSION,
    MIN_SUPPORTED_CLIENT_VERSION,
    start: (port) =>
      new Promise((resolve) => {
        server.listen(port || config.port, () => {
          console.log(`[Fly2Git][Backend] Server listening on port ${port || config.port}`);
          resolve(server);
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  };
}

if (require.main === module) {
  const app = createServer();
  app.start().then(() => {
    const shutdown = () => {
      console.log("[Fly2Git][Backend] Graceful shutdown initiated...");
      app.stop().then(() => {
        console.log("[Fly2Git][Backend] Server stopped cleanly.");
        process.exit(0);
      });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  });
}

module.exports = {
  createServer,
  APP_VERSION,
  API_VERSION,
  MIN_SUPPORTED_CLIENT_VERSION,
  parseVersion,
  isVersionSupported,
};

