// Fly2Git Backend — Deterministic Coding Observation Engine (Phase 15C)
// Generates objective, evidence-based observations from Fly2Git sync metadata.
// Invariants:
// 1. Zero scoring: NEVER generates skill scores, developer ratings, or intelligence ranks.
// 2. Fact-based: Every statement links to exact metadata evidence.
// 3. Sync isolation: GitHub sync failures are workflow issues, NEVER coding failures.
// 4. Data minimization: Operates strictly on sanitized metadata, never source code.

class CodingObservations {
  /**
   * Generates deterministic observations from a derived coach context.
   *
   * @param {object} context - Derived coach context object
   * @returns {Array<{ type: string, statement: string, evidence: object }>}
   */
  static generateObservations(context = {}) {
    if (!context || typeof context !== "object") return [];

    const observations = [];
    const totalSynced = typeof context.totalSynced === "number" ? context.totalSynced : 0;
    const streak = typeof context.streak === "number" ? context.streak : 0;
    const activeDays = typeof context.activeDays === "number" ? context.activeDays : 0;
    const platforms = Array.isArray(context.platforms) ? context.platforms : [];
    const difficulties = context.difficulties || {};
    const languages = Array.isArray(context.languages) ? context.languages : [];
    const recentActivity = Array.isArray(context.recentActivity) ? context.recentActivity : [];

    // 1. Practice Consistency & Streak Observation
    if (streak > 0) {
      observations.push({
        type: "practice_consistency",
        statement: `Active coding practice streak is currently ${streak} consecutive day${streak === 1 ? "" : "s"}.`,
        evidence: { streak, activeDays, totalSynced },
      });
    } else if (activeDays > 0) {
      observations.push({
        type: "practice_consistency",
        statement: `Practiced on ${activeDays} distinct day${activeDays === 1 ? "" : "s"} in the selected period.`,
        evidence: { streak: 0, activeDays, totalSynced },
      });
    } else {
      observations.push({
        type: "practice_consistency",
        statement: "No active practice recorded yet in the selected period.",
        evidence: { streak: 0, activeDays: 0, totalSynced: 0 },
      });
    }

    if (totalSynced === 0) {
      return observations;
    }

    // 2. Difficulty Distribution Observation
    const easyCount = difficulties.Easy || 0;
    const medCount = difficulties.Medium || 0;
    const hardCount = difficulties.Hard || 0;
    const unknownCount = difficulties.Unknown || 0;

    let dominantDiff = null;
    let dominantDiffCount = 0;
    const diffEntries = [
      { name: "Easy", count: easyCount },
      { name: "Medium", count: medCount },
      { name: "Hard", count: hardCount },
    ];
    for (const d of diffEntries) {
      if (d.count > dominantDiffCount) {
        dominantDiffCount = d.count;
        dominantDiff = d.name;
      }
    }

    if (dominantDiff && dominantDiffCount > 0) {
      const pct = Math.round((dominantDiffCount / totalSynced) * 100);
      observations.push({
        type: "difficulty_distribution",
        statement: `${dominantDiff} problems represent the largest difficulty group (${pct}% of recent synced practice).`,
        evidence: { dominantDifficulty: dominantDiff, count: dominantDiffCount, percentage: pct, breakdown: difficulties },
      });
    } else if (unknownCount > 0 && unknownCount === totalSynced) {
      observations.push({
        type: "difficulty_distribution",
        statement: "All recent problems have unclassified difficulty tags.",
        evidence: { breakdown: difficulties },
      });
    }

    // 3. Language Distribution Observation
    if (languages.length > 0) {
      const topLang = languages[0];
      const langCount = languages.length;
      if (langCount === 1) {
        observations.push({
          type: "language_distribution",
          statement: `All recent practice is centered in ${topLang.language} (${topLang.count} solutions).`,
          evidence: { topLanguage: topLang.language, count: topLang.count, percentage: topLang.percentage || 100, languageCount: 1 },
        });
      } else {
        observations.push({
          type: "language_distribution",
          statement: `Recent practice spans ${langCount} programming languages, led by ${topLang.language} (${topLang.percentage}%).`,
          evidence: { topLanguage: topLang.language, percentage: topLang.percentage, languageCount: langCount },
        });
      }
    }

    // 4. Platform Distribution Observation
    if (platforms.length > 0) {
      const topPlat = platforms[0];
      const platCount = platforms.length;
      if (platCount === 1) {
        observations.push({
          type: "platform_distribution",
          statement: `${topPlat.platform} represents 100% of your synced activity in this period (${topPlat.count} solutions).`,
          evidence: { topPlatform: topPlat.platform, count: topPlat.count, platformCount: 1 },
        });
      } else {
        observations.push({
          type: "platform_distribution",
          statement: `Synced solutions across ${platCount} platforms, with ${topPlat.platform} representing the primary share (${topPlat.count} solutions).`,
          evidence: { topPlatform: topPlat.platform, count: topPlat.count, platformCount: platCount },
        });
      }
    }

    // 5. Most Recent Activity Observation
    if (recentActivity.length > 0) {
      const latest = recentActivity[0];
      observations.push({
        type: "recent_activity",
        statement: `Most recent synced solution was in ${latest.language || "unknown"} on ${latest.platform || "unknown"}.`,
        evidence: {
          platform: latest.platform,
          language: latest.language,
          difficulty: latest.difficulty,
          timestamp: latest.timestamp,
        },
      });
    }

    // 6. Workflow Reliability Observation (NOT coding failure)
    if (typeof context.syncReliability === "number") {
      observations.push({
        type: "sync_reliability",
        statement: `GitHub synchronization workflow achieved ${context.syncReliability}% transmission reliability.`,
        evidence: {
          syncReliability: context.syncReliability,
          syncedCount: context.totalSynced,
          note: "Workflow reliability measures GitHub sync transmission, not developer problem-solving accuracy.",
        },
      });
    }

    return observations;
  }

  /**
   * Computes multidimensional balance summaries without generating an overall score.
   *
   * @param {object} context
   * @returns {object} { difficulty, language, platform, consistency }
   */
  static computeBalance(context = {}) {
    const totalSynced = typeof context.totalSynced === "number" ? context.totalSynced : 0;
    const difficulties = context.difficulties || {};
    const languages = Array.isArray(context.languages) ? context.languages : [];
    const platforms = Array.isArray(context.platforms) ? context.platforms : [];
    const streak = typeof context.streak === "number" ? context.streak : 0;
    const activeDays = typeof context.activeDays === "number" ? context.activeDays : 0;

    // 1. Difficulty balance
    const easyCount = difficulties.Easy || 0;
    const medCount = difficulties.Medium || 0;
    const hardCount = difficulties.Hard || 0;
    const diffActiveTypes = [easyCount, medCount, hardCount].filter((c) => c > 0).length;
    const diffSummary =
      totalSynced === 0
        ? "No difficulty data recorded."
        : diffActiveTypes >= 2
        ? "Practice spans multiple difficulty tiers."
        : `Practice is concentrated in a single difficulty level.`;

    // 2. Language balance
    const langCount = languages.length;
    const topLangPct = languages.length > 0 ? languages[0].percentage || 0 : 0;
    const langSummary =
      totalSynced === 0
        ? "No language data recorded."
        : langCount >= 2 && topLangPct < 80
        ? "Practice is distributed across multiple languages."
        : langCount === 1
        ? "Focused deeply on a single programming language."
        : `Primarily focused on ${languages[0].language} with occasional alternatives.`;

    // 3. Platform balance
    const platCount = platforms.length;
    const topPlatCount = platforms.length > 0 ? platforms[0].count || 0 : 0;
    const topPlatPct = totalSynced > 0 ? Math.round((topPlatCount / totalSynced) * 100) : 0;
    const platSummary =
      totalSynced === 0
        ? "No platform data recorded."
        : platCount >= 3
        ? "Broad multi-platform practice ecosystem."
        : platCount === 2
        ? "Dual-platform practice activity."
        : "Single platform focus.";

    // 4. Consistency balance
    const consistencySummary =
      streak >= 7
        ? "High daily practice cadence (7+ day streak)."
        : streak >= 3
        ? "Building steady daily momentum (3+ day streak)."
        : activeDays >= 5
        ? "Regular weekly activity with rest days."
        : "Periodic practice sessions.";

    return {
      difficulty: {
        distribution: { ...difficulties },
        activeTiers: diffActiveTypes,
        summary: diffSummary,
      },
      language: {
        count: langCount,
        topLanguage: languages[0]?.language || "none",
        topPercentage: topLangPct,
        summary: langSummary,
      },
      platform: {
        count: platCount,
        topPlatform: platforms[0]?.platform || "none",
        topPercentage: topPlatPct,
        summary: platSummary,
      },
      consistency: {
        streak,
        activeDays,
        totalSynced,
        summary: consistencySummary,
      },
    };
  }
}

module.exports = CodingObservations;
