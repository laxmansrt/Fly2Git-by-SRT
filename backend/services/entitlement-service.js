// Fly2Git Backend — Entitlement Authority Service (Phase 12C + Phase 14 Pro Grants)
// Authoritative subscription-to-entitlement calculation and cryptographic signing.

const crypto = require("crypto");
const config = require("../config");

const BASIC_FEATURES = Object.freeze({
  maxPlatforms: 2,
  allPlatforms: false,
  multipleRepositories: false,
  advancedAutomation: false,
  analytics: false,
  ai: false,
});

const PRO_FEATURES = Object.freeze({
  maxPlatforms: Infinity,
  allPlatforms: true,
  multipleRepositories: true,
  advancedAutomation: true,
  analytics: true,
  ai: true,
});

class EntitlementService {
  constructor(database, options = {}) {
    this.db = database;
    this.cacheTtlMs = options.cacheTtlMs || config.entitlementTtlMs;
    this.keyId = options.keyId || config.entitlementKeyId || "fly2git-ed25519-v1";
    this.privateKey = options.privateKey || config.entitlementPrivateKey;
    this.publicKey = options.publicKey || config.entitlementPublicKey;
    // Pro Grant service injection (Phase 14)
    this.proGrantService = options.proGrantService || null;
    // Platform Slot service injection (Phase 13A)
    this.platformSlotService = options.platformSlotService || null;
  }

  /**
   * Builds canonical string representation of an entitlement for signing and verification.
   */
  getCanonical(entObj, kid) {
    return [
      entObj.userId || "",
      entObj.plan,
      entObj.status,
      entObj.billingCycle || "",
      entObj.expiresAt || "",
      entObj.issuedAt,
      kid || entObj.kid || this.keyId,
    ].join(":");
  }

  /**
   * Generates a tamper-proof Ed25519 asymmetric signature for an entitlement object.
   * Only the server with the private key can sign.
   */
  signEntitlement(entObj, kid) {
    const keyId = kid || entObj.kid || this.keyId;
    const canonical = this.getCanonical(entObj, keyId);
    return crypto.sign(null, Buffer.from(canonical, "utf8"), this.privateKey).toString("hex");
  }

  /**
   * Cryptographically verifies an entitlement record signature using the Ed25519 public key.
   */
  verifySignature(entObj, trustedKeyId = null, trustedPublicKey = null) {
    if (!entObj || !entObj.signature || !entObj.issuedAt) return false;

    // Verify key ID / version
    const kid = entObj.kid || this.keyId;
    const expectedKid = trustedKeyId || this.keyId;
    if (kid !== expectedKid) {
      return false; // Unknown or unsupported key ID
    }

    // Verify clock skew / future timestamps (reject if more than 60s in future)
    if (typeof entObj.issuedAt === "number" && entObj.issuedAt > Date.now() + 60000) {
      return false;
    }

    // Verify cache validity TTL
    if (entObj.validUntil && Date.now() > entObj.validUntil) {
      return false; // Cache entry expired
    }

    const canonical = this.getCanonical(entObj, kid);
    const pubKey = trustedPublicKey || this.publicKey;

    try {
      const sigBuf = Buffer.from(entObj.signature, "hex");
      return crypto.verify(null, Buffer.from(canonical, "utf8"), pubKey, sigBuf);
    } catch (_err) {
      return false;
    }
  }

  /**
   * Evaluates the authoritative entitlement for a user based on database records.
   */
  async getAuthoritativeEntitlement(userId) {
    if (!userId) return this.getDefaultBasicEntitlement(null);

    const now = Date.now();

    // ---- Priority 1: Active Pro Grant (Phase 14) ----
    let grantedPro = false;
    let grantType = null;
    if (this.proGrantService) {
      const activeGrant = this.proGrantService.getActiveGrantForUser(userId);
      if (activeGrant) {
        grantedPro = true;
        grantType = activeGrant.type;
      }
    }

    // ---- Priority 2: Active Stripe Subscription ----
    const subscription = this.db.getSubscriptionByUserId(userId);

    let subscriptionPro = false;
    let status = "inactive";
    let billingCycle = null;
    let expiresAt = null;

    if (subscription) {
      billingCycle = subscription.billingCycle || "monthly";
      expiresAt = subscription.currentPeriodEnd || null;

      if (subscription.status === "active" || subscription.status === "trial") {
        if (!expiresAt || now <= expiresAt) {
          subscriptionPro = true;
          status = "active";
        } else {
          status = "expired";
        }
      } else if (subscription.status === "canceled") {
        if (subscription.cancelAtPeriodEnd && expiresAt && now <= expiresAt) {
          subscriptionPro = true;
          status = "active";
        } else {
          status = "expired";
        }
      } else if (subscription.status === "expired") {
        status = "expired";
      } else if (subscription.status === "past_due") {
        status = "past_due";
      }
    }

    // ---- Resolve final entitlement ----
    const isPro = grantedPro || subscriptionPro;

    const issuedAt = now;
    const validUntil = now + this.cacheTtlMs;

    const baseRecord = {
      userId,
      version: 1,
      plan: isPro ? "pro" : "basic",
      billingCycle: subscriptionPro ? billingCycle : null,
      status: isPro ? "active" : (status === "expired" ? "expired" : (status === "past_due" ? "past_due" : "inactive")),
      expiresAt: subscriptionPro ? expiresAt : null,
      features: isPro ? Object.assign({}, PRO_FEATURES) : Object.assign({}, BASIC_FEATURES),
      issuedAt,
      validUntil,
      kid: this.keyId,
    };

    // Include grant metadata when grant is the source of Pro
    if (grantedPro) {
      baseRecord.grantType = grantType;
    }

    // Attach authoritative platform slots and selected platforms (Phase 13A)
    if (isPro) {
      baseRecord.platformSlots = [];
      baseRecord.selectedPlatforms = [];
    } else if (this.platformSlotService && userId) {
      const slots = this.platformSlotService.getSlots(userId, "basic");
      baseRecord.platformSlots = slots;
      baseRecord.selectedPlatforms = slots.map((s) => s.platform);
    } else {
      baseRecord.platformSlots = [
        { slot: 1, platform: "leetcode", activatedAt: null, nextChangeAt: null },
        { slot: 2, platform: "geeksforgeeks", activatedAt: null, nextChangeAt: null },
      ];
      baseRecord.selectedPlatforms = ["leetcode", "geeksforgeeks"];
    }

    const signature = this.signEntitlement(baseRecord);
    const fullRecord = { ...baseRecord, signature };

    // Persist latest evaluated state
    this.db.setEntitlement(fullRecord);

    return fullRecord;
  }

  getDefaultBasicEntitlement(userId) {
    const now = Date.now();
    const base = {
      userId: userId || "anonymous",
      version: 1,
      plan: "basic",
      billingCycle: null,
      status: "inactive",
      expiresAt: null,
      features: Object.assign({}, BASIC_FEATURES),
      platformSlots: [
        { slot: 1, platform: "leetcode", activatedAt: null, nextChangeAt: null },
        { slot: 2, platform: "geeksforgeeks", activatedAt: null, nextChangeAt: null },
      ],
      selectedPlatforms: ["leetcode", "geeksforgeeks"],
      issuedAt: now,
      validUntil: now + this.cacheTtlMs,
      kid: this.keyId,
    };
    base.signature = this.signEntitlement(base);
    return base;
  }
}

module.exports = {
  EntitlementService,
  BASIC_FEATURES,
  PRO_FEATURES,
};
