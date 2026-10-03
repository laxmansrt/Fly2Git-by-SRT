// Fly2Git Backend — Central Configuration (Phase 12C)
// Safe configuration loading with secret isolation.
// NEVER logs secrets or tokens.

const path = require("path");

const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT, 10) || 3000,
  frontendUrl: process.env.FRONTEND_URL || "chrome-extension://fly2git",
  fly2gitOrigin: process.env.FLY2GIT_ORIGIN || "https://fly2git.com",

  // Secrets: must be set in production, fallback to development defaults for local tests
  authSecret: process.env.AUTH_SECRET || "dev-insecure-auth-secret-change-in-prod-32bytes",
  entitlementSecret:
    process.env.ENTITLEMENT_SIGNING_SECRET || "dev-insecure-entitlement-secret-change-in-prod-32bytes",

  // Asymmetric Entitlement Signing (Ed25519)
  entitlementKeyId: process.env.ENTITLEMENT_KEY_ID || "fly2git-ed25519-v1",
  entitlementPrivateKey:
    process.env.ENTITLEMENT_PRIVATE_KEY ||
    "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIJHNxgfLgVWkhR+iURDMk+N3/67H8roTQFyGOlQnGCN5\n-----END PRIVATE KEY-----",
  entitlementPublicKey:
    process.env.ENTITLEMENT_PUBLIC_KEY ||
    "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEApgDUWz73ysyXO+Ov0TDDZFLL0uwEra8G5Sn028KZeKQ=\n-----END PUBLIC KEY-----",

  // Billing Provider
  billing: {
    provider: process.env.PAYMENT_PROVIDER || "stripe",
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || "sk_test_mock_stripe_key",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "whsec_mock_stripe_webhook_secret",
    monthlyPriceId:
      process.env.STRIPE_PRICE_MONTHLY || process.env.PAYMENT_PRICE_MONTHLY || "price_pro_monthly_test",
    yearlyPriceId:
      process.env.STRIPE_PRICE_YEARLY || process.env.PAYMENT_PRICE_YEARLY || "price_pro_yearly_test",
  },

  // Admin Access (Phase 14 — Pro Grants)
  adminApiKey: process.env.ADMIN_API_KEY || "dev-insecure-admin-key-change-in-prod",

  // Token expiries
  authExpiresInMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  entitlementTtlMs: 24 * 60 * 60 * 1000, // 24 hours cache TTL

  // Database path if file-based
  dbPath: process.env.DATABASE_PATH || path.join(__dirname, "../data/fly2git_backend.json"),

  // AI Architecture & Governance (Phase 15A)
  // Server-side only: Extension must NEVER contain AI provider credentials.
  ai: {
    enabled: process.env.AI_ENABLED !== "false",
    provider: process.env.AI_PROVIDER || "mock",
    geminiApiKey: process.env.GEMINI_API_KEY || null,
    geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    maxInputChars: parseInt(process.env.AI_MAX_INPUT_CHARS, 10) || 30000,
    maxPromptChars: parseInt(process.env.AI_MAX_PROMPT_CHARS, 10) || 5000,
    maxOutputTokens: parseInt(process.env.AI_MAX_OUTPUT_TOKENS, 10) || 2048,
    monthlyBasicLimit: parseInt(process.env.AI_MONTHLY_BASIC_LIMIT, 10) || 5,
    monthlyProLimit: parseInt(process.env.AI_MONTHLY_PRO_LIMIT, 10) || 200,
  },

  // Beta & Product Telemetry (Phase 18)
  productTelemetryRetentionDays: parseInt(process.env.PRODUCT_TELEMETRY_RETENTION_DAYS, 10) || 90,

  // Beta Release Candidate (Phase 20)
  betaVersion: process.env.FLY2GIT_BETA_VERSION || "1.1.6-rc.1",
  appVersion: "1.1.6",
  apiVersion: "1.1.0",
};

/**
 * Strict production configuration validator.
 * In production (NODE_ENV=production), rejects default/insecure secrets and ensures required variables exist.
 *
 * @param {object} [cfg]
 * @returns {{ ok: boolean }}
 */
function validateProductionConfig(cfg = config) {
  if (cfg.env !== "production") return { ok: true };
  const missing = [];
  if (!process.env.AUTH_SECRET || cfg.authSecret.includes("dev-insecure")) {
    missing.push("AUTH_SECRET");
  }
  if (!process.env.ENTITLEMENT_SIGNING_SECRET || cfg.entitlementSecret.includes("dev-insecure")) {
    missing.push("ENTITLEMENT_SIGNING_SECRET");
  }
  if (!process.env.ADMIN_API_KEY || cfg.adminApiKey.includes("dev-insecure")) {
    missing.push("ADMIN_API_KEY");
  }
  if (cfg.billing.provider === "stripe" && (!process.env.STRIPE_SECRET_KEY || cfg.billing.stripeSecretKey.includes("sk_test_mock"))) {
    missing.push("STRIPE_SECRET_KEY");
  }
  if (cfg.ai.enabled && cfg.ai.provider === "gemini" && !cfg.ai.geminiApiKey) {
    missing.push("GEMINI_API_KEY");
  }
  if (missing.length > 0) {
    const err = new Error(`Production configuration invalid. Missing required variables: ${missing.join(", ")}`);
    err.missing = missing;
    throw err;
  }
  return { ok: true };
}

config.validateProductionConfig = validateProductionConfig;

module.exports = config;
