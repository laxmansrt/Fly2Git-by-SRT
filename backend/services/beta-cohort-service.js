// Fly2Git Backend — Beta Cohort Service (Phase 19)
// Manages controlled private beta cohort with server-authoritative allowlist.
// NEVER hardcodes beta emails in the extension.
// NEVER trusts client-provided userId as authoritative.
// Supports: beta enabled, beta expiration, beta revoked.
// Fails closed: if beta state is unavailable, user is NOT in beta.

"use strict";

class BetaCohortService {
  constructor(database, options = {}) {
    this.db = database;
    this.maxCohortSize = options.maxCohortSize || 500;
  }

  /**
   * Check if a user is an active beta participant.
   * Fails closed: returns false if state is unavailable.
   *
   * @param {string} userId — server-authenticated userId (NEVER client-provided)
   * @returns {{ active: boolean, reason?: string, expiresAt?: number }}
   */
  isBetaActive(userId) {
    if (!userId || typeof userId !== "string") {
      return { active: false, reason: "missing_user" };
    }

    try {
      const record = this.db.betaAllowlist.get(userId);
      if (!record) {
        return { active: false, reason: "not_in_cohort" };
      }

      // Check revocation
      if (record.beta_revoked === true) {
        return { active: false, reason: "revoked" };
      }

      // Check enabled
      if (!record.beta_enabled) {
        return { active: false, reason: "disabled" };
      }

      // Check expiration
      if (record.beta_expires_at && typeof record.beta_expires_at === "number") {
        if (Date.now() > record.beta_expires_at) {
          return { active: false, reason: "expired" };
        }
      }

      return {
        active: true,
        expiresAt: record.beta_expires_at || null,
      };
    } catch (_) {
      // Fail closed on any error
      return { active: false, reason: "error" };
    }
  }

  /**
   * Add a user to the beta cohort (admin only).
   *
   * @param {string} userId
   * @param {object} [options]
   * @param {number} [options.expiresAt]
   * @returns {{ ok: boolean, error?: string }}
   */
  addToCohort(userId, options = {}) {
    if (!userId || typeof userId !== "string") {
      return { ok: false, error: "Missing userId" };
    }

    // Enforce cohort size limit
    if (this.db.betaAllowlist.size >= this.maxCohortSize) {
      const existing = this.db.betaAllowlist.get(userId);
      if (!existing) {
        return { ok: false, error: "Beta cohort is full" };
      }
    }

    const record = {
      userId,
      beta_enabled: true,
      beta_revoked: false,
      beta_expires_at: typeof options.expiresAt === "number" ? options.expiresAt : null,
      addedAt: Date.now(),
      updatedAt: new Date().toISOString(),
    };

    this.db.betaAllowlist.set(userId, record);
    this.db.save();
    return { ok: true, record: { ...record } };
  }

  /**
   * Revoke a user's beta access (admin only).
   * Different from removing: preserves the record for auditing.
   *
   * @param {string} userId
   * @returns {{ ok: boolean }}
   */
  revokeBeta(userId) {
    if (!userId) return { ok: false, error: "Missing userId" };

    const existing = this.db.betaAllowlist.get(userId);
    if (!existing) {
      return { ok: false, error: "User not in beta cohort" };
    }

    existing.beta_enabled = false;
    existing.beta_revoked = true;
    existing.revokedAt = Date.now();
    existing.updatedAt = new Date().toISOString();
    this.db.betaAllowlist.set(userId, existing);
    this.db.save();
    return { ok: true };
  }

  /**
   * Remove a user from the beta cohort entirely (admin only).
   *
   * @param {string} userId
   * @returns {{ ok: boolean }}
   */
  removeFromCohort(userId) {
    if (!userId) return { ok: false, error: "Missing userId" };
    const existed = this.db.betaAllowlist.delete(userId);
    if (existed) this.db.save();
    return { ok: true, removed: Boolean(existed) };
  }

  /**
   * List all beta cohort members (admin only).
   * Returns safe metadata only.
   *
   * @returns {Array<object>}
   */
  listCohort() {
    const members = [];
    for (const [userId, record] of this.db.betaAllowlist.entries()) {
      members.push({
        userId,
        beta_enabled: Boolean(record.beta_enabled),
        beta_revoked: Boolean(record.beta_revoked),
        beta_expires_at: record.beta_expires_at || null,
        addedAt: record.addedAt || null,
      });
    }
    return members;
  }

  /**
   * Get cohort summary statistics.
   *
   * @returns {object}
   */
  getCohortSummary() {
    let total = 0;
    let active = 0;
    let revoked = 0;
    let expired = 0;

    const now = Date.now();
    for (const record of this.db.betaAllowlist.values()) {
      total++;
      if (record.beta_revoked) {
        revoked++;
      } else if (record.beta_expires_at && now > record.beta_expires_at) {
        expired++;
      } else if (record.beta_enabled) {
        active++;
      }
    }

    return { total, active, revoked, expired };
  }
}

module.exports = { BetaCohortService };
