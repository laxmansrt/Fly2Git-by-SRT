// Fly2Git Backend — Pro Grant / Allowlist Service (Phase 14)
// Server-side only: manages founder, team, beta, and promotional Pro grants.
// NEVER expose grant logic in the Chrome extension (popup.js, entitlements.js, content.js, inject.js).

const crypto = require("crypto");

/** Valid grant types */
const GRANT_TYPES = Object.freeze(["founder", "team", "beta", "promotional"]);

/** Valid grant statuses */
const GRANT_STATUSES = Object.freeze(["active", "revoked"]);

class ProGrantService {
  constructor(database) {
    this.db = database;
  }

  /**
   * Creates a new Pro grant for a user.
   * @param {object} params
   * @param {string} params.userId - Target user ID (must exist in DB)
   * @param {string} params.type - One of: founder, team, beta, promotional
   * @param {number|null} params.expiresAt - Unix timestamp or null for permanent
   * @param {string} params.grantedBy - Admin identifier who issued the grant
   * @param {string} params.note - Reason / audit note
   * @returns {object} The created grant record
   */
  createGrant({ userId, type, expiresAt = null, grantedBy, note = "" }) {
    // ---- Input validation ----
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required and must be a string");
      err.statusCode = 400;
      throw err;
    }
    if (!type || !GRANT_TYPES.includes(type)) {
      const err = new Error(`Invalid grant type. Must be one of: ${GRANT_TYPES.join(", ")}`);
      err.statusCode = 400;
      throw err;
    }
    if (!grantedBy || typeof grantedBy !== "string") {
      const err = new Error("grantedBy is required (admin identifier)");
      err.statusCode = 400;
      throw err;
    }
    if (expiresAt !== null && expiresAt !== undefined) {
      const ts = Number(expiresAt);
      if (!Number.isFinite(ts) || ts < 0) {
        const err = new Error("expiresAt must be a valid Unix timestamp or null");
        err.statusCode = 400;
        throw err;
      }
    }

    // ---- Verify target user exists ----
    const user = this.db.getUserById(userId);
    if (!user) {
      const err = new Error("Target user not found");
      err.statusCode = 404;
      throw err;
    }

    // ---- Check for duplicate active grant ----
    const existing = this.getActiveGrantForUser(userId);
    if (existing) {
      const err = new Error("User already has an active Pro grant. Revoke the existing grant first.");
      err.statusCode = 409;
      throw err;
    }

    const grantId = `grant_${crypto.randomBytes(12).toString("hex")}`;
    const now = Date.now();

    const record = {
      id: grantId,
      userId,
      type,
      status: "active",
      grantedAt: now,
      expiresAt: expiresAt !== null && expiresAt !== undefined ? Number(expiresAt) : null,
      grantedBy,
      note: typeof note === "string" ? note.slice(0, 500) : "",
      updatedAt: now,
    };

    this.db.insertProGrant(record);

    // Audit trail
    this.db.recordAuditEvent({
      action: "pro_grant_created",
      grantId,
      userId,
      type,
      grantedBy,
      note: record.note,
      expiresAt: record.expiresAt,
      timestamp: now,
    });

    return { ...record };
  }

  /**
   * Revokes a Pro grant by ID.
   * @param {string} grantId
   * @param {string} revokedBy - Admin identifier revoking the grant
   * @returns {object} The updated grant record
   */
  revokeGrant(grantId, revokedBy) {
    if (!grantId || typeof grantId !== "string") {
      const err = new Error("grantId is required");
      err.statusCode = 400;
      throw err;
    }
    if (!revokedBy || typeof revokedBy !== "string") {
      const err = new Error("revokedBy is required (admin identifier)");
      err.statusCode = 400;
      throw err;
    }

    const grant = this.db.getProGrantById(grantId);
    if (!grant) {
      const err = new Error("Grant not found");
      err.statusCode = 404;
      throw err;
    }

    if (grant.status === "revoked") {
      const err = new Error("Grant is already revoked");
      err.statusCode = 409;
      throw err;
    }

    const now = Date.now();
    const updated = this.db.updateProGrant(grantId, {
      status: "revoked",
      updatedAt: now,
    });

    // Audit trail
    this.db.recordAuditEvent({
      action: "pro_grant_revoked",
      grantId,
      userId: grant.userId,
      revokedBy,
      timestamp: now,
    });

    return { ...updated };
  }

  /**
   * Lists all grants, optionally filtered by status or userId.
   * @param {object} filters
   * @param {string} [filters.status] - Filter by grant status
   * @param {string} [filters.userId] - Filter by user ID
   * @returns {Array} Array of grant records
   */
  listGrants(filters = {}) {
    let grants = this.db.getAllProGrants();

    if (filters.status && GRANT_STATUSES.includes(filters.status)) {
      grants = grants.filter((g) => g.status === filters.status);
    }
    if (filters.userId && typeof filters.userId === "string") {
      grants = grants.filter((g) => g.userId === filters.userId);
    }

    return grants.map((g) => ({ ...g }));
  }

  /**
   * Gets a single grant by ID.
   * @param {string} grantId
   * @returns {object|null}
   */
  getGrantById(grantId) {
    const g = this.db.getProGrantById(grantId);
    return g ? { ...g } : null;
  }

  /**
   * Returns the active, non-expired grant for a user, or null.
   * An active grant with expiresAt = null is permanent (until revoked).
   * An expired grant immediately stops granting Pro.
   * @param {string} userId
   * @returns {object|null}
   */
  getActiveGrantForUser(userId) {
    if (!userId) return null;
    const grants = this.db.getProGrantsByUserId(userId);
    const now = Date.now();

    for (const grant of grants) {
      if (grant.status !== "active") continue;
      // If expiresAt is null → permanent until revoked
      if (grant.expiresAt === null) return { ...grant };
      // If expiresAt is set, enforce expiry
      if (grant.expiresAt > now) return { ...grant };
    }

    return null;
  }

  /**
   * Determines if a user has Pro access through a grant.
   * Called by EntitlementService to check grant-based entitlement.
   * @param {string} userId
   * @returns {boolean}
   */
  userHasActiveGrant(userId) {
    return this.getActiveGrantForUser(userId) !== null;
  }
}

module.exports = {
  ProGrantService,
  GRANT_TYPES,
  GRANT_STATUSES,
};
