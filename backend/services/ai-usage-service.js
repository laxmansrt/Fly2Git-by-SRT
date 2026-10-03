// Fly2Git Backend — AI Usage Governance Service (Phase 15A)
// Tracks metadata only — NEVER stores source code, problem statements, or prompts.
// Enforces server-side monthly quotas for Basic and Pro tiers.

class AIUsageService {
  constructor(database) {
    this.db = database;
  }

  /**
   * Records metadata for an AI request into the database.
   *
   * @param {object} event
   * @param {string} event.userId
   * @param {string} event.feature
   * @param {string} event.requestId
   * @param {number} [event.inputTokens]
   * @param {number} [event.outputTokens]
   * @param {number} [event.totalTokens]
   * @param {string} event.status - "success" | "error" | "rate_limited"
   * @returns {object} Recorded event
   */
  recordUsage(event) {
    if (!event || !event.userId) return null;

    const inputTokens = typeof event.inputTokens === "number" ? Math.max(0, event.inputTokens) : 0;
    const outputTokens = typeof event.outputTokens === "number" ? Math.max(0, event.outputTokens) : 0;
    const totalTokens =
      typeof event.totalTokens === "number"
        ? Math.max(0, event.totalTokens)
        : inputTokens + outputTokens;

    return this.db.insertAIUsageEvent({
      userId: event.userId,
      feature: event.feature,
      requestId: event.requestId,
      inputTokens,
      outputTokens,
      totalTokens,
      status: event.status || "success",
    });
  }

  /**
   * Calculates total usage for a user in the current or specified month.
   *
   * @param {string} userId
   * @param {string} [monthKey] - Format: "YYYY-MM" (default: current UTC month)
   * @returns {{ count: number, totalTokens: number, monthKey: string }}
   */
  getMonthlyUsage(userId, monthKey) {
    const key = monthKey || new Date().toISOString().slice(0, 7);
    const events = this.db.getAIUsageEventsByUserId(userId, { monthKey: key, limit: 5000 });

    let count = 0;
    let totalTokens = 0;

    for (const ev of events) {
      if (ev.status === "success") {
        count++;
        totalTokens += ev.totalTokens || 0;
      }
    }

    return {
      count,
      totalTokens,
      monthKey: key,
    };
  }

  /**
   * Enforces server-side usage limits based on user plan.
   *
   * @param {string} userId - User ID
   * @param {string} plan - "basic" | "pro"
   * @param {object} configAi - AI configuration containing limits
   * @returns {{ allowed: boolean, current: number, limit: number, reason?: string }}
   */
  checkQuota(userId, plan, configAi = {}) {
    const isPro = plan === "pro";
    const limit = isPro
      ? configAi.monthlyProLimit || 200
      : configAi.monthlyBasicLimit || 5;

    const usage = this.getMonthlyUsage(userId);

    if (usage.count >= limit) {
      return {
        allowed: false,
        current: usage.count,
        limit,
        monthKey: usage.monthKey,
        reason: isPro
          ? "Monthly Pro AI quota reached. Resets at start of next billing period."
          : "Monthly Basic AI quota reached. Upgrade to Pro for high-capacity AI access.",
      };
    }

    return {
      allowed: true,
      current: usage.count,
      limit,
      monthKey: usage.monthKey,
    };
  }
}

module.exports = AIUsageService;
