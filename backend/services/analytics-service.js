// Fly2Git Backend — Analytics Service (Phase 14B)
// Authoritative backend management of Pro Personal Coding Analytics.
// Enforces:
// 1. Pro-only boundary: Basic users strictly receive 403 PRO_REQUIRED.
// 2. Strict user isolation: All operations derived from authenticated session userId.
// 3. Data minimization: Only metadata stored, never source code, tokens, or raw HTML.
// 4. Bounded exports & queries to guarantee performance and prevent resource exhaustion.

const Fly2GitAnalytics = require("../../analytics");

class AnalyticsService {
  constructor(database, entitlementService) {
    this.db = database;
    this.entitlementService = entitlementService;
  }

  /**
   * Helper to verify that the target user has an active or trial Pro entitlement.
   * @param {string} userId - User ID
   * @returns {Promise<boolean>}
   */
  async isProUser(userId) {
    if (!userId || typeof userId !== "string") return false;
    const ent = await this.entitlementService.getAuthoritativeEntitlement(userId);
    return ent.plan === "pro" && (ent.status === "active" || ent.status === "trial");
  }

  /**
   * Records a sanitized coding activity event for an authenticated Pro user.
   * Basic users are rejected silently or with PRO_REQUIRED without storing anything.
   * @param {string} userId - Canonical user ID from session
   * @param {object} eventData - Raw metadata event
   * @returns {Promise<object>}
   */
  async recordEvent(userId, eventData) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required");
      err.statusCode = 400;
      throw err;
    }

    const isPro = await this.isProUser(userId);
    if (!isPro) {
      // Do not collect analytics for Basic users
      return { recorded: false, reason: "PRO_REQUIRED" };
    }

    const sanitized = Fly2GitAnalytics.sanitizeEvent(eventData);
    if (!sanitized) {
      const err = new Error("Invalid analytics event format");
      err.statusCode = 400;
      throw err;
    }

    // Deduplication check: ignore identical event within 3 seconds
    const recent = this.db.getAnalyticsEventsByUserId(userId, { since: sanitized.timestamp - 3000, limit: 10 });
    const isDuplicate = recent.some(
      (r) =>
        r.platform === sanitized.platform &&
        r.problemSlug === sanitized.problemSlug &&
        r.action === sanitized.action &&
        Math.abs(r.timestamp - sanitized.timestamp) < 3000
    );

    if (isDuplicate) {
      return { recorded: false, reason: "DUPLICATE_EVENT" };
    }

    const saved = this.db.insertAnalyticsEvent({
      ...sanitized,
      userId,
    });

    return { recorded: true, id: saved.id };
  }

  /**
   * Retrieves dashboard overview statistics for an authenticated Pro user.
   * @param {string} userId - User ID from session
   * @param {object} options - { range, timezoneOffset }
   * @returns {Promise<object>}
   */
  async getOverview(userId, options = {}) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required");
      err.statusCode = 400;
      throw err;
    }

    const isPro = await this.isProUser(userId);
    if (!isPro) {
      const err = new Error("Pro entitlement required to access personal analytics");
      err.statusCode = 403;
      err.code = "PRO_REQUIRED";
      throw err;
    }

    // Determine query cutoff based on range to optimize query performance
    const range = Fly2GitAnalytics.SUPPORTED_RANGES.includes(options.range)
      ? options.range
      : Fly2GitAnalytics.DEFAULT_RANGE;
    let since = 0;
    const now = Date.now();
    if (range === "7d") since = now - 7 * 86400000;
    else if (range === "30d") since = now - 30 * 86400000;
    else if (range === "90d") since = now - 90 * 86400000;

    const events = this.db.getAnalyticsEventsByUserId(userId, { since, limit: 5000 });
    const overview = Fly2GitAnalytics.computeOverview(events, {
      range,
      timezoneOffset: Number(options.timezoneOffset) || 0,
      now,
    });

    return {
      ok: true,
      isPro: true,
      ...overview,
    };
  }

  /**
   * Retrieves daily activity timeline for chart rendering.
   * @param {string} userId - User ID from session
   * @param {object} options - { range, timezoneOffset }
   * @returns {Promise<object>}
   */
  async getActivityTimeline(userId, options = {}) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required");
      err.statusCode = 400;
      throw err;
    }

    const isPro = await this.isProUser(userId);
    if (!isPro) {
      const err = new Error("Pro entitlement required to access personal analytics");
      err.statusCode = 403;
      err.code = "PRO_REQUIRED";
      throw err;
    }

    const range = Fly2GitAnalytics.SUPPORTED_RANGES.includes(options.range)
      ? options.range
      : Fly2GitAnalytics.DEFAULT_RANGE;
    const events = this.db.getAnalyticsEventsByUserId(userId, { since: 0, limit: 5000 });
    const timeline = Fly2GitAnalytics.computeActivityTimeline(events, {
      range,
      timezoneOffset: Number(options.timezoneOffset) || 0,
    });

    return {
      ok: true,
      isPro: true,
      range,
      timeline,
    };
  }

  /**
   * Exports sanitized analytics metadata as JSON or CSV.
   * Bounded to a maximum of 1,000 recent items.
   * @param {string} userId - User ID from session
   * @param {object} options - { format: "json" | "csv", range }
   * @returns {Promise<object>}
   */
  async exportData(userId, options = {}) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required");
      err.statusCode = 400;
      throw err;
    }

    const isPro = await this.isProUser(userId);
    if (!isPro) {
      const err = new Error("Pro entitlement required to export personal analytics");
      err.statusCode = 403;
      err.code = "PRO_REQUIRED";
      throw err;
    }

    const format = options.format === "csv" ? "csv" : "json";
    // Bound export to at most 1,000 records to prevent memory exhaustion
    const events = this.db.getAnalyticsEventsByUserId(userId, { since: 0, limit: 1000 });

    if (format === "csv") {
      const headers = [
        "date",
        "platform",
        "problemSlug",
        "title",
        "difficulty",
        "language",
        "action",
        "syncStatus",
        "repositoryTarget",
        "isUpdate",
      ];

      const csvRows = [headers.join(",")];
      for (const ev of events) {
        const row = [
          JSON.stringify(new Date(ev.timestamp).toISOString()),
          JSON.stringify(ev.platform || ""),
          JSON.stringify(ev.problemSlug || ""),
          JSON.stringify(ev.title || ""),
          JSON.stringify(ev.difficulty || ""),
          JSON.stringify(ev.language || ""),
          JSON.stringify(ev.action || ""),
          JSON.stringify(ev.syncStatus || ""),
          JSON.stringify(ev.repositoryTarget || ""),
          ev.isUpdate ? "true" : "false",
        ];
        csvRows.push(row.join(","));
      }

      return {
        ok: true,
        format: "csv",
        contentType: "text/csv; charset=utf-8",
        filename: `fly2git_analytics_${Date.now()}.csv`,
        content: csvRows.join("\n"),
        count: events.length,
      };
    }

    // JSON export
    const cleanList = events.map((ev) => ({
      date: new Date(ev.timestamp).toISOString(),
      platform: ev.platform,
      problemSlug: ev.problemSlug,
      title: ev.title,
      difficulty: ev.difficulty,
      language: ev.language,
      action: ev.action,
      syncStatus: ev.syncStatus,
      repositoryTarget: ev.repositoryTarget,
      isUpdate: ev.isUpdate,
      skipReason: ev.skipReason,
      retryCount: ev.retryCount,
    }));

    return {
      ok: true,
      format: "json",
      contentType: "application/json; charset=utf-8",
      filename: `fly2git_analytics_${Date.now()}.json`,
      content: JSON.stringify(cleanList, null, 2),
      count: cleanList.length,
    };
  }

  /**
   * Deletes all personal analytics data for the authenticated user.
   * Does NOT touch GitHub repositories, commits, identities, billing, or credentials.
   * @param {string} userId - User ID from session
   * @returns {Promise<object>}
   */
  async deleteUserData(userId) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required");
      err.statusCode = 400;
      throw err;
    }

    const result = this.db.deleteAnalyticsEventsByUserId(userId);
    this.db.auditEvents.push({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: "analytics_data_deleted",
      userId,
      deletedCount: result.count,
      timestamp: new Date().toISOString(),
    });
    this.db.save();

    return {
      ok: true,
      deleted: true,
      deletedCount: result.count,
    };
  }
}

module.exports = { AnalyticsService };
