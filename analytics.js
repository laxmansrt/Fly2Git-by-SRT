// Fly2Git — Personal Coding Analytics Engine (Phase 14B)
// Universal module for Node.js (backend) and Browser (extension popup & background).
// Enforces data minimization: computes metrics strictly on Fly2Git sync metadata.
// NEVER processes or expects solution source code, tokens, or raw HTML.

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.Fly2GitAnalytics = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SUPPORTED_RANGES = ["7d", "30d", "90d", "all"];
  const DEFAULT_RANGE = "30d";

  /**
   * Helper to format a timestamp into YYYY-MM-DD in the given timezone offset (in minutes).
   * @param {number} timestamp - Epoch ms
   * @param {number} timezoneOffset - Minutes (e.g. -330 for IST +5:30)
   * @returns {string} YYYY-MM-DD
   */
  function toDateString(timestamp, timezoneOffset = 0) {
    const adjusted = new Date(timestamp - timezoneOffset * 60000);
    return adjusted.toISOString().slice(0, 10);
  }

  /**
   * Calculates active coding streak based on strictly successful sync activities.
   * A day counts as active when at least one successful sync occurred on that calendar day.
   * Does NOT count failed syncs, skipped submissions, or ignored duplicates.
   *
   * @param {Array<number>} syncedTimestamps - Epoch ms timestamps of successful syncs
   * @param {object} options - { timezoneOffset, now }
   * @returns {number} Current consecutive active days
   */
  function calculateStreak(syncedTimestamps, options = {}) {
    if (!Array.isArray(syncedTimestamps) || syncedTimestamps.length === 0) {
      return 0;
    }

    const timezoneOffset = typeof options.timezoneOffset === "number" ? options.timezoneOffset : 0;
    const now = typeof options.now === "number" ? options.now : Date.now();

    const activeDays = new Set();
    for (const ts of syncedTimestamps) {
      if (typeof ts === "number" && !isNaN(ts)) {
        activeDays.add(toDateString(ts, timezoneOffset));
      }
    }

    if (activeDays.size === 0) return 0;

    const todayStr = toDateString(now, timezoneOffset);
    const yesterdayStr = toDateString(now - 86400000, timezoneOffset);

    let streak = 0;
    let checkDate;

    if (activeDays.has(todayStr)) {
      // Active today: streak starts today
      checkDate = new Date(now - timezoneOffset * 60000);
    } else if (activeDays.has(yesterdayStr)) {
      // Not active today yet, but active yesterday: streak is still intact
      checkDate = new Date(now - 86400000 - timezoneOffset * 60000);
    } else {
      // Inactive both today and yesterday: streak is broken
      return 0;
    }

    // Traverse backwards day by day
    while (true) {
      const dateStr = checkDate.toISOString().slice(0, 10);
      if (activeDays.has(dateStr)) {
        streak++;
        // Move back 1 calendar day (86,400,000 ms)
        checkDate = new Date(checkDate.getTime() - 86400000);
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Computes high-level overview metrics for a list of analytics events.
   * @param {Array<object>} events - Normalized CodingActivityEvents
   * @param {object} options - { range, timezoneOffset, now }
   * @returns {object} Aggregated dashboard statistics
   */
  function computeOverview(events, options = {}) {
    const list = Array.isArray(events) ? events : [];
    const range = SUPPORTED_RANGES.includes(options.range) ? options.range : DEFAULT_RANGE;
    const timezoneOffset = typeof options.timezoneOffset === "number" ? options.timezoneOffset : 0;
    const now = typeof options.now === "number" ? options.now : Date.now();

    let cutoff = 0;
    if (range === "7d") cutoff = now - 7 * 86400000;
    else if (range === "30d") cutoff = now - 30 * 86400000;
    else if (range === "90d") cutoff = now - 90 * 86400000;

    const filtered = list.filter((e) => {
      const ts = typeof e.timestamp === "number" ? e.timestamp : 0;
      return ts >= cutoff && ts <= now;
    });

    let syncedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let newSolutionsCount = 0;
    let updatedSolutionsCount = 0;

    const platformMap = new Map(); // platform -> { count, lastActivity }
    const languageMap = new Map(); // language -> count
    const difficultyMap = { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 };
    const repoMap = new Map(); // repo -> count
    const syncedTimestamps = [];

    let skippedByFilters = 0;
    let duplicateSkips = 0;
    let retryRecoveries = 0;

    for (const ev of filtered) {
      const action = ev.action || "synced";
      const ts = ev.timestamp || now;

      if (action === "synced") {
        syncedCount++;
        syncedTimestamps.push(ts);

        if (ev.isUpdate) updatedSolutionsCount++;
        else newSolutionsCount++;

        // Platform breakdown
        const plat = (ev.platform || "unknown").toLowerCase();
        const existingPlat = platformMap.get(plat) || { count: 0, lastActivity: 0 };
        platformMap.set(plat, {
          count: existingPlat.count + 1,
          lastActivity: Math.max(existingPlat.lastActivity, ts),
        });

        // Language breakdown
        const lang = (ev.language || "unknown").toLowerCase();
        languageMap.set(lang, (languageMap.get(lang) || 0) + 1);

        // Difficulty breakdown (preserve native or map to Easy/Medium/Hard/Unknown)
        let diff = (ev.difficulty || "Unknown").trim();
        const diffLower = diff.toLowerCase();
        if (diffLower === "easy") diff = "Easy";
        else if (diffLower === "medium" || diffLower === "med") diff = "Medium";
        else if (diffLower === "hard") diff = "Hard";
        else if (!diff || diffLower === "unknown") diff = "Unknown";

        difficultyMap[diff] = (difficultyMap[diff] || 0) + 1;

        // Repository target breakdown
        if (ev.repositoryTarget) {
          const repo = ev.repositoryTarget.trim();
          repoMap.set(repo, (repoMap.get(repo) || 0) + 1);
        }

        if (typeof ev.retryCount === "number" && ev.retryCount > 0) {
          retryRecoveries += ev.retryCount;
        }
      } else if (action === "failed") {
        failedCount++;
      } else if (action === "skipped") {
        skippedCount++;
        const reason = (ev.skipReason || "").toLowerCase();
        if (reason.includes("filter")) {
          skippedByFilters++;
        } else if (reason.includes("duplicate") || reason.includes("already synced") || reason.includes("no changes")) {
          duplicateSkips++;
        }
      }
    }

    // Sync Success Rate (Skips are NOT counted as failures)
    const attempts = syncedCount + failedCount;
    const successRate = attempts === 0 ? 100.0 : Math.round((syncedCount / attempts) * 1000) / 10;

    // Platform breakdown array
    const platformBreakdown = Array.from(platformMap.entries())
      .map(([platform, data]) => ({
        platform,
        count: data.count,
        lastActivity: data.lastActivity,
      }))
      .sort((a, b) => b.count - a.count);

    // Language breakdown array with rounded percentages
    const languageBreakdown = Array.from(languageMap.entries())
      .map(([language, count]) => ({
        language,
        count,
        percentage: syncedCount === 0 ? 0 : Math.round((count / syncedCount) * 1000) / 10,
      }))
      .sort((a, b) => b.count - a.count);

    // Repository breakdown array
    const repositoryBreakdown = Array.from(repoMap.entries())
      .map(([repository, count]) => ({
        repository,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // Streak calculation
    const streak = calculateStreak(syncedTimestamps, { timezoneOffset, now });

    return {
      range,
      totalProblems: syncedCount,
      newSolutions: newSolutionsCount,
      updatedSolutions: updatedSolutionsCount,
      platformCount: platformMap.size,
      languageCount: languageMap.size,
      streak,
      syncSuccessRate: successRate,
      syncedCount,
      failedCount,
      skippedCount,
      platformBreakdown,
      difficultyBreakdown: difficultyMap,
      languageBreakdown,
      repositoryBreakdown,
      automationInsights: {
        skippedByFilters,
        duplicateSkips,
        retryRecoveries,
        totalSkipped: skippedCount,
      },
    };
  }

  /**
   * Generates a daily activity timeline for chart visualization.
   * @param {Array<object>} events - Normalized CodingActivityEvents
   * @param {object} options - { range, timezoneOffset, now }
   * @returns {Array<object>} Daily timeline items [{ date, synced, skipped, failed }]
   */
  function computeActivityTimeline(events, options = {}) {
    const list = Array.isArray(events) ? events : [];
    const range = SUPPORTED_RANGES.includes(options.range) ? options.range : DEFAULT_RANGE;
    const timezoneOffset = typeof options.timezoneOffset === "number" ? options.timezoneOffset : 0;
    const now = typeof options.now === "number" ? options.now : Date.now();

    let daysCount = 30;
    if (range === "7d") daysCount = 7;
    else if (range === "30d") daysCount = 30;
    else if (range === "90d") daysCount = 90;
    else if (range === "all") {
      // Find oldest event or default to 30 days
      let earliest = now;
      for (const ev of list) {
        if (typeof ev.timestamp === "number" && ev.timestamp < earliest) {
          earliest = ev.timestamp;
        }
      }
      const diffDays = Math.ceil((now - earliest) / 86400000);
      daysCount = Math.max(14, Math.min(diffDays + 1, 365));
    }

    // Build chronological date map
    const dateMap = new Map();
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = toDateString(now - i * 86400000, timezoneOffset);
      dateMap.set(d, { date: d, synced: 0, skipped: 0, failed: 0 });
    }

    // Fill with real event data
    for (const ev of list) {
      if (!ev.timestamp) continue;
      const d = toDateString(ev.timestamp, timezoneOffset);
      if (dateMap.has(d)) {
        const item = dateMap.get(d);
        const action = ev.action || "synced";
        if (action === "synced") item.synced++;
        else if (action === "skipped") item.skipped++;
        else if (action === "failed") item.failed++;
      }
    }

    return Array.from(dateMap.values());
  }

  /**
   * Sanitizes an analytics event before transport or storage.
   * Strips source code, tokens, raw HTML, and sensitive headers.
   * @param {object} raw - Unsanitized event payload
   * @returns {object} Strictly sanitized metadata event
   */
  function sanitizeEvent(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      platform: typeof raw.platform === "string" ? raw.platform.slice(0, 50).toLowerCase() : "unknown",
      problemSlug: typeof raw.problemSlug === "string" ? raw.problemSlug.slice(0, 200) : "unknown",
      title: typeof raw.title === "string" ? raw.title.slice(0, 300) : "Untitled",
      difficulty: typeof raw.difficulty === "string" ? raw.difficulty.slice(0, 50) : "Unknown",
      language: typeof raw.language === "string" ? raw.language.slice(0, 50).toLowerCase() : "unknown",
      timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
      action: ["synced", "skipped", "failed"].includes(raw.action) ? raw.action : "synced",
      syncStatus: typeof raw.syncStatus === "string" ? raw.syncStatus.slice(0, 50) : "added",
      isUpdate: Boolean(raw.isUpdate),
      repositoryTarget: typeof raw.repositoryTarget === "string" ? raw.repositoryTarget.slice(0, 200) : "",
      skipReason: typeof raw.skipReason === "string" ? raw.skipReason.slice(0, 300) : null,
      retryCount: typeof raw.retryCount === "number" ? Math.max(0, raw.retryCount) : 0,
      topics: Array.isArray(raw.topics)
        ? raw.topics.slice(0, 20).map((t) => String(t).slice(0, 50))
        : typeof raw.topics === "string"
        ? [raw.topics.slice(0, 50)]
        : [],
    };
  }

  return {
    SUPPORTED_RANGES,
    DEFAULT_RANGE,
    toDateString,
    calculateStreak,
    computeOverview,
    computeActivityTimeline,
    sanitizeEvent,
  };
});
