// Fly2Git Backend — Personal Coding Coach Service (Phase 15C)
// Authoritative orchestration of objective personal coding coaching.
// Invariants:
// 1. Zero scoring: Never produces skill scores, developer ratings, or intelligence ranks.
// 2. Deterministic facts: Observations and context are computed before AI personalization.
// 3. Sync isolation: GitHub sync transmission failures are NEVER interpreted as coding failures.
// 4. Grounded advice: AI is strictly prohibited from inventing user history or evidence.
// 5. Data minimization: Only sanitized metadata used, never source code or full problem text.
// 6. Entitlement authority: Basic/Pro/Pro Grants enforced through authoritative EntitlementService.
// 7. Single usage accounting: Delegates generation to AIService (zero double-counting).

const CodingObservations = require("./coding-observations");
const Fly2GitAnalytics = require("../../analytics");

const SUPPORTED_MODES = ["daily", "weekly", "balance", "portfolio", "reflection"];
const DEFAULT_MODE = "daily";

class CodingCoachService {
  /**
   * @param {object} database - Database instance
   * @param {object} entitlementService - Entitlement authority
   * @param {object} aiService - Centralized AI Gateway
   * @param {object} [options]
   */
  constructor(database, entitlementService, aiService, options = {}) {
    this.db = database;
    this.entitlementService = entitlementService;
    this.aiService = aiService;
    this.options = options;
    // Lightweight audit metadata only: requestId, feature, timestamp, mode (NO code, NO prompt, NO answer)
    this.coachHistory = new Map(); // userId -> Array<{ requestId, feature, timestamp, mode }>
  }

  /**
   * Builds the derived metadata coach context for a given user.
   *
   * @param {string} userId - User identifier
   * @param {object} [options] - { range, timezoneOffset, now }
   * @returns {object} Derived coach context object
   */
  buildContext(userId, options = {}) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required to build coach context");
      err.statusCode = 400;
      throw err;
    }

    const range = Fly2GitAnalytics.SUPPORTED_RANGES.includes(options.range)
      ? options.range
      : Fly2GitAnalytics.DEFAULT_RANGE;
    const timezoneOffset = Number(options.timezoneOffset) || 0;
    const now = typeof options.now === "number" ? options.now : Date.now();

    let cutoff = 0;
    if (range === "7d") cutoff = now - 7 * 86400000;
    else if (range === "30d") cutoff = now - 30 * 86400000;
    else if (range === "90d") cutoff = now - 90 * 86400000;

    const rawEvents = this.db.getAnalyticsEventsByUserId(userId, { since: cutoff, limit: 5000 });
    const events = rawEvents.filter((e) => {
      const ts = typeof e.timestamp === "number" ? e.timestamp : 0;
      return ts >= cutoff && ts <= now;
    });

    let syncedCount = 0;
    let failedCount = 0;
    let newSolutionsCount = 0;
    let updatedSolutionsCount = 0;

    const platformMap = new Map(); // platform -> { count, lastActivity }
    const languageMap = new Map(); // language -> count
    const difficultyMap = { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 };
    const syncedTimestamps = [];
    const activeDates = new Set();
    const recentActivity = [];

    for (const ev of events) {
      const action = ev.action || "synced";
      const ts = ev.timestamp || now;

      if (action === "synced") {
        syncedCount++;
        syncedTimestamps.push(ts);
        activeDates.add(Fly2GitAnalytics.toDateString(ts, timezoneOffset));

        if (ev.isUpdate) updatedSolutionsCount++;
        else newSolutionsCount++;

        const plat = (ev.platform || "unknown").toLowerCase();
        const existingPlat = platformMap.get(plat) || { count: 0, lastActivity: 0 };
        platformMap.set(plat, {
          count: existingPlat.count + 1,
          lastActivity: Math.max(existingPlat.lastActivity, ts),
        });

        const lang = (ev.language || "unknown").toLowerCase();
        languageMap.set(lang, (languageMap.get(lang) || 0) + 1);

        let diff = (ev.difficulty || "Unknown").trim();
        const diffLower = diff.toLowerCase();
        if (diffLower === "easy") diff = "Easy";
        else if (diffLower === "medium" || diffLower === "med") diff = "Medium";
        else if (diffLower === "hard") diff = "Hard";
        else if (!diff || diffLower === "unknown") diff = "Unknown";
        difficultyMap[diff] = (difficultyMap[diff] || 0) + 1;

        if (recentActivity.length < 10) {
          recentActivity.push({
            platform: plat,
            problemSlug: ev.problemSlug || "unknown",
            difficulty: diff,
            language: lang,
            timestamp: ts,
            isUpdate: Boolean(ev.isUpdate),
          });
        }
      } else if (action === "failed") {
        failedCount++;
      }
    }

    // Platforms breakdown
    const platforms = Array.from(platformMap.entries())
      .map(([platform, data]) => ({
        platform,
        count: data.count,
        percentage: syncedCount === 0 ? 0 : Math.round((data.count / syncedCount) * 1000) / 10,
        lastActivity: data.lastActivity,
      }))
      .sort((a, b) => b.count - a.count);

    // Languages breakdown
    const languages = Array.from(languageMap.entries())
      .map(([language, count]) => ({
        language,
        count,
        percentage: syncedCount === 0 ? 0 : Math.round((count / syncedCount) * 1000) / 10,
      }))
      .sort((a, b) => b.count - a.count);

    // Streak
    const streak = Fly2GitAnalytics.calculateStreak(syncedTimestamps, { timezoneOffset, now });

    // Sync Reliability (workflow transmission, NOT developer competence)
    const attempts = syncedCount + failedCount;
    const syncReliability = attempts === 0 ? 100.0 : Math.round((syncedCount / attempts) * 1000) / 10;

    // Platform & Language Concentration
    const topPlatPct = platforms.length > 0 ? platforms[0].percentage : 0;
    const platformConcentration =
      platforms.length === 0
        ? "none"
        : platforms.length === 1
        ? "single_platform"
        : topPlatPct >= 75
        ? "concentrated"
        : "diversified";

    const topLangPct = languages.length > 0 ? languages[0].percentage : 0;
    const languageConcentration =
      languages.length === 0
        ? "none"
        : languages.length === 1
        ? "single_language"
        : topLangPct >= 75
        ? "concentrated"
        : "diversified";

    // Activity trend: compare first half of time range with second half
    let activityTrend = "none";
    if (syncedCount > 0) {
      const midPoint = cutoff + (now - cutoff) / 2;
      const firstHalf = syncedTimestamps.filter((t) => t < midPoint).length;
      const secondHalf = syncedTimestamps.filter((t) => t >= midPoint).length;
      if (secondHalf > firstHalf * 1.3) activityTrend = "increasing";
      else if (firstHalf > secondHalf * 1.3) activityTrend = "decreasing";
      else activityTrend = "steady";
    }

    // Optional topic tags
    const topicTags = this.db.getTopicTagsByUserId ? this.db.getTopicTagsByUserId(userId, { minConfidence: "medium" }) : [];

    return {
      range,
      totalSynced: syncedCount,
      streak,
      activeDays: activeDates.size,
      platforms,
      difficulties: difficultyMap,
      languages,
      newSolutions: newSolutionsCount,
      updatedSolutions: updatedSolutionsCount,
      syncReliability,
      recentActivity,
      activityTrend,
      platformConcentration,
      languageConcentration,
      topicTags: topicTags.map((t) => ({ tag: t.tag, confidence: t.confidence })),
    };
  }

  /**
   * Generates personal coaching response for an authenticated user.
   *
   * @param {string} userId - Authenticated user identifier
   * @param {object} [request] - { mode, range, timezoneOffset, userQuestion }
   * @returns {Promise<object>} Structured coaching response
   */
  async generateCoaching(userId, request = {}) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required for coding coach");
      err.statusCode = 400;
      throw err;
    }

    // 1. Authoritative Entitlement Check (Fail Closed)
    const ent = await this.entitlementService.getAuthoritativeEntitlement(userId);
    const now = Date.now();
    if (!ent || ent.status === "expired" || (typeof ent.expiresAt === "number" && now > ent.expiresAt)) {
      const err = new Error("User entitlement has expired. Pro subscription required for AI Coach.");
      err.code = "AI_FORBIDDEN";
      err.statusCode = 403;
      throw err;
    }

    // 2. Validate Mode
    const rawMode = typeof request.mode === "string" ? request.mode.toLowerCase().trim() : DEFAULT_MODE;
    if (!SUPPORTED_MODES.includes(rawMode)) {
      const err = new Error(
        `Unknown coach mode '${rawMode}'. Supported modes: ${SUPPORTED_MODES.join(", ")}`
      );
      err.code = "COACH_INVALID_MODE";
      err.statusCode = 400;
      throw err;
    }
    const mode = rawMode;

    // 3. Build Coach Context
    const range = mode === "weekly" ? (request.range || "7d") : (request.range || "30d");
    const context = this.buildContext(userId, { range, timezoneOffset: request.timezoneOffset });

    // 4. Compute Deterministic Facts
    const observations = CodingObservations.generateObservations(context);
    const balance = CodingObservations.computeBalance(context);

    // 5. Empty History Cold-Start Guard (Safe, Non-Hallucinating Response)
    if (context.totalSynced === 0) {
      return {
        ok: true,
        success: true,
        mode,
        summary: "No synced coding activity found yet in the selected period. Sync your first accepted problem to unlock personalized practice insights.",
        observations: ["No recent practice sessions recorded in the selected period."],
        suggestedDirection: "Start by solving and syncing an Easy or Medium problem on your preferred platform.",
        suggestedActions: [
          "Solve a problem on LeetCode, HackerRank, or any supported platform.",
          "Ensure Fly2Git is connected to your repository to automatically sync your accepted solutions.",
        ],
        reflectionQuestion: "Which programming language or platform would you like to build momentum in first?",
        evidence: {
          streak: 0,
          totalSynced: 0,
          activeDays: 0,
          dominantPlatform: "none",
          dominantLanguage: "none",
        },
        confidence: "high",
        context,
        observationsData: observations,
        balance,
      };
    }

    // 6. Invoke Centralized AI Gateway (Feature = "coach")
    // Note: AIService authoritatively validates quotas, checks token limits, sanitizes requests,
    // calls the provider, validates output with CoachValidator, and records metadata usage once.
    const aiResult = await this.aiService.generate(userId, {
      feature: "coach",
      mode,
      coachContext: context,
      observations,
      balance,
      userQuestion: request.userQuestion,
    });

    // 7. Track Lightweight History (Metadata only: no code, no prompt, no answer)
    if (!this.coachHistory.has(userId)) {
      this.coachHistory.set(userId, []);
    }
    const historyList = this.coachHistory.get(userId);
    historyList.push({
      requestId: aiResult.requestId,
      feature: "coach",
      timestamp: Date.now(),
      mode,
    });
    if (historyList.length > 50) historyList.shift();

    const coachAnswer = aiResult.answer || {};

    return {
      ok: true,
      success: true,
      mode,
      summary: coachAnswer.summary,
      observations: coachAnswer.observations || observations.map((o) => o.statement),
      suggestedDirection: coachAnswer.suggestedDirection,
      suggestedActions: coachAnswer.suggestedActions || [],
      reflectionQuestion: coachAnswer.reflectionQuestion,
      evidence: coachAnswer.evidence || {
        streak: context.streak,
        totalSynced: context.totalSynced,
        dominantPlatform: context.platforms[0]?.platform || "none",
        dominantLanguage: context.languages[0]?.language || "none",
      },
      confidence: coachAnswer.confidence || "high",
      context,
      balance,
      requestId: aiResult.requestId,
      usage: aiResult.usage,
    };
  }

  /**
   * Deletes all derived coaching metadata and topic tags for a user.
   *
   * @param {string} userId - User identifier
   * @returns {object} Deletion outcome
   */
  deleteUserData(userId) {
    if (!userId) return { ok: false, deleted: false };
    if (this.db.deleteTopicTagsByUserId) {
      this.db.deleteTopicTagsByUserId(userId);
    }
    this.coachHistory.delete(userId);
    return { ok: true, deleted: true };
  }
}

module.exports = {
  CodingCoachService,
  SUPPORTED_MODES,
  DEFAULT_MODE,
};
