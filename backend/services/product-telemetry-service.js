// Fly2Git Backend — Product Telemetry Service (Phase 18)
// Collects privacy-preserving product usage telemetry strictly separated from Personal Coding Analytics.
// NEVER stores code, prompts, tokens, cookies, or problem statements.

"use strict";

const ALLOWED_EVENTS = Object.freeze([
  "onboarding_started",
  "onboarding_completed",
  "github_connected",
  "platform_selected",
  "first_sync",
  "sync_success",
  "sync_error",
  "ai_used",
  "coach_used",
  "journey_opened",
  "analytics_opened",
  "settings_opened",
  "upgrade_viewed",
  "feedback_submitted",
]);

const FORBIDDEN_KEYS = [
  "code",
  "sourceCode",
  "problem",
  "problemStatement",
  "prompt",
  "prompts",
  "aiResponse",
  "answer",
  "cookie",
  "cookies",
  "token",
  "tokens",
  "accessToken",
  "password",
  "secret",
  "browsingHistory",
  "keystrokes",
];

class ProductTelemetryService {
  constructor(database, options = {}) {
    this.db = database;
    this.retentionDays = options.retentionDays || 90;
  }

  /**
   * Records a product telemetry event with strict schema validation.
   *
   * @param {object} eventData
   * @param {string} [eventData.userId]
   * @param {string} eventData.event
   * @param {string} [eventData.platform]
   * @param {string} [eventData.appVersion]
   * @param {number} [eventData.timestamp]
   * @param {boolean} [eventData.productTelemetryEnabled=true]
   * @returns {{ ok: boolean, eventId?: string, error?: string, skipped?: boolean }}
   */
  recordEvent(eventData = {}, options = {}) {
    if (!eventData || typeof eventData !== "object") {
      return { ok: false, error: "Invalid telemetry payload" };
    }

    // User privacy control: opt-out check
    if (eventData.productTelemetryEnabled === false || options.telemetryEnabled === false) {
      return { ok: true, skipped: true, reason: "Product telemetry disabled by user setting" };
    }

    const eventName = eventData.event;
    if (!eventName || !ALLOWED_EVENTS.includes(eventName)) {
      return { ok: false, error: `Disallowed telemetry event: ${eventName}` };
    }

    // Strict privacy assurance: reject if any forbidden key contains sensitive payloads
    for (const k of FORBIDDEN_KEYS) {
      if (k in eventData && eventData[k] !== undefined && eventData[k] !== null) {
        return { ok: false, error: `Forbidden field in telemetry: ${k}` };
      }
    }

    const userId = (options.userId || eventData.userId || "anonymous").trim();
    const appVersion = typeof eventData.appVersion === "string" ? eventData.appVersion.slice(0, 32) : "1.1.6";
    const platform = typeof eventData.platform === "string" ? eventData.platform.slice(0, 32).toLowerCase() : null;
    const timestamp = typeof eventData.timestamp === "number" && !isNaN(eventData.timestamp)
      ? eventData.timestamp
      : Date.now();

    // Sanitize down strictly to allowed schema: { eventId, userId, event, timestamp, appVersion, platform }
    const record = this.db.insertProductTelemetryEvent({
      userId,
      event: eventName,
      timestamp,
      appVersion,
      platform,
    });

    return { ok: true, eventId: record.eventId };
  }

  /**
   * Retrieves product telemetry events for a specific user with bounded limits.
   *
   * @param {string} userId
   * @param {object} [options]
   * @returns {Array<object>}
   */
  getUserTelemetry(userId, options = {}) {
    if (!userId) return [];
    return this.db.getProductTelemetryEventsByUserId(userId, options);
  }

  /**
   * Deletes all product telemetry records for a user.
   * Does NOT delete GitHub repositories, commits, billing, identity, or coding analytics.
   *
   * @param {string} userId
   * @returns {{ ok: boolean, deleted: boolean, count: number }}
   */
  deleteUserTelemetry(userId) {
    if (!userId) return { ok: false, error: "Missing userId" };
    const res = this.db.deleteProductTelemetryEventsByUserId(userId);
    return { ok: true, deleted: res.deleted, count: res.count };
  }

  /**
   * Prunes telemetry older than the configured retention period.
   *
   * @param {number} [days]
   * @returns {number} Pruned count
   */
  pruneTelemetry(days = this.retentionDays) {
    return this.db.pruneProductTelemetry(days);
  }
}

module.exports = {
  ProductTelemetryService,
  ALLOWED_EVENTS,
  FORBIDDEN_KEYS,
};
