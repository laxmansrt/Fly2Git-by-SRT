// Fly2Git Backend — Coding Intelligence Service (Phase 15D)
// Builds a structured representation of the user's coding practice history
// using metadata and normalized topic tags.
//
// Invariants:
// 1. Zero scoring: Never produces skill scores, developer ratings, IQ, employability scores, or user rankings.
// 2. Pure observation: Visualizes activity volume, temporal shifts, and co-occurrences without judgment.
// 3. Grounded data layer: Derives all facts deterministically from existing sync metadata and topic tags.
// 4. Unknown handling: Does not invent unsupported tags; unknown tags remain unknown.
// 5. Entitlement enforcement: Basic receives limited preview; Pro and Pro Grants receive full intelligence.
// 6. Data minimization: No source code, cookies, full problem descriptions, or credentials stored or exposed.

const { PatternNormalizer, CANONICAL_PATTERNS } = require("./pattern-normalizer");
const Fly2GitAnalytics = require("../../analytics");

class CodingIntelligenceService {
  /**
   * @param {object} database - Database instance
   * @param {object} entitlementService - Authoritative entitlement service
   * @param {object} [aiService] - AI Gateway for explanations
   * @param {object} [options]
   */
  constructor(database, entitlementService, aiService, options = {}) {
    this.db = database;
    this.entitlementService = entitlementService;
    this.aiService = aiService;
    this.options = options;
  }

  /**
   * Builds the comprehensive deterministic intelligence profile for a user.
   *
   * @param {string} userId - Authenticated user identifier
   * @param {object} [options] - { range, timezoneOffset, now, windowDays }
   * @returns {object} Derived intelligence data
   */
  buildIntelligence(userId, options = {}) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required to build coding intelligence");
      err.statusCode = 400;
      throw err;
    }

    const timezoneOffset = Number(options.timezoneOffset) || 0;
    const now = typeof options.now === "number" ? options.now : Date.now();
    const range = options.range || "all";
    const windowDays = Number(options.windowDays) || 30;
    const windowMs = windowDays * 86400000;

    let cutoff = 0;
    if (range === "7d") cutoff = now - 7 * 86400000;
    else if (range === "30d") cutoff = now - 30 * 86400000;
    else if (range === "90d") cutoff = now - 90 * 86400000;
    else if (range === "1y") cutoff = now - 365 * 86400000;

    // 1. Fetch raw analytics events (sanitized sync metadata)
    const rawEvents = this.db.getAnalyticsEventsByUserId
      ? this.db.getAnalyticsEventsByUserId(userId, { since: cutoff, limit: 10000 })
      : [];

    const events = rawEvents.filter((e) => {
      const ts = typeof e.timestamp === "number" ? e.timestamp : 0;
      return (e.action || "synced") === "synced" && ts >= cutoff && ts <= now;
    });

    // 2. Fetch optional topic tags from database to augment problems
    const storedTags = this.db.getTopicTagsByUserId
      ? this.db.getTopicTagsByUserId(userId, { minConfidence: "medium" })
      : [];
    const storedTagSlugs = PatternNormalizer.normalizeList(storedTags.map((t) => t.tag));

    // Data structures for aggregations
    // pattern -> { pattern, count, firstSeen, lastSeen, platforms: Map<plat, count>, languages: Map<lang, count>, difficulties: { Easy, Medium, Hard, Unknown } }
    const patternAgg = new Map();
    // co-occurrence: `${pA}::${pB}` -> count
    const coOccurrenceMap = new Map();
    // language -> { [pattern]: count }
    const languageMatrix = {};
    // platform -> { [pattern]: count }
    const platformMatrix = {};
    // period YYYY-MM -> { period, count, patterns: Map<pattern, count>, platforms: Set, languages: Set }
    const journeyPeriods = new Map();

    // Recent shift windows
    const recentWindowStart = now - windowMs;
    const previousWindowStart = now - 2 * windowMs;
    const recentCounts = new Map();
    const previousCounts = new Map();

    const allUserPlatforms = new Set();
    const allUserLanguages = new Set();
    let totalProblemsWithPatterns = 0;

    for (const ev of events) {
      const ts = typeof ev.timestamp === "number" ? ev.timestamp : now;
      const plat = (ev.platform || "unknown").toLowerCase().trim();
      const lang = (ev.language || "unknown").toLowerCase().trim();
      allUserPlatforms.add(plat);
      allUserLanguages.add(lang);

      let diff = (ev.difficulty || "Unknown").trim();
      const diffLower = diff.toLowerCase();
      if (diffLower === "easy") diff = "Easy";
      else if (diffLower === "medium" || diffLower === "med") diff = "Medium";
      else if (diffLower === "hard") diff = "Hard";
      else diff = "Unknown";

      // Extract raw topics
      let rawTopics = [];
      if (Array.isArray(ev.topics)) {
        rawTopics = ev.topics;
      } else if (typeof ev.topics === "string") {
        rawTopics = [ev.topics];
      } else if (ev.metadata && Array.isArray(ev.metadata.topics)) {
        rawTopics = ev.metadata.topics;
      } else if (ev.topic) {
        rawTopics = [ev.topic];
      }

      // If event has no topics, see if there are stored tags that apply globally
      // (only if event had none, but do NOT invent unsupported tags)
      const normalizedPatterns = PatternNormalizer.normalizeList(rawTopics);

      if (normalizedPatterns.length > 0) {
        totalProblemsWithPatterns++;
      }

      // Aggregate pattern activity
      for (const pat of normalizedPatterns) {
        if (!patternAgg.has(pat)) {
          patternAgg.set(pat, {
            pattern: pat,
            count: 0,
            firstSeen: ts,
            lastSeen: ts,
            platforms: new Map(),
            languages: new Map(),
            difficulties: { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 },
          });
        }
        const pData = patternAgg.get(pat);
        pData.count++;
        pData.firstSeen = Math.min(pData.firstSeen, ts);
        pData.lastSeen = Math.max(pData.lastSeen, ts);
        pData.platforms.set(plat, (pData.platforms.get(plat) || 0) + 1);
        pData.languages.set(lang, (pData.languages.get(lang) || 0) + 1);
        pData.difficulties[diff] = (pData.difficulties[diff] || 0) + 1;

        // Matrices
        if (!languageMatrix[lang]) languageMatrix[lang] = {};
        languageMatrix[lang][pat] = (languageMatrix[lang][pat] || 0) + 1;

        if (!platformMatrix[plat]) platformMatrix[plat] = {};
        platformMatrix[plat][pat] = (platformMatrix[plat][pat] || 0) + 1;

        // Shift windows
        if (ts >= recentWindowStart && ts <= now) {
          recentCounts.set(pat, (recentCounts.get(pat) || 0) + 1);
        } else if (ts >= previousWindowStart && ts < recentWindowStart) {
          previousCounts.set(pat, (previousCounts.get(pat) || 0) + 1);
        }
      }

      // Pairwise Co-occurrence for problems with >= 2 patterns
      if (normalizedPatterns.length >= 2) {
        for (let i = 0; i < normalizedPatterns.length; i++) {
          for (let j = i + 1; j < normalizedPatterns.length; j++) {
            const pA = normalizedPatterns[i] < normalizedPatterns[j] ? normalizedPatterns[i] : normalizedPatterns[j];
            const pB = normalizedPatterns[i] < normalizedPatterns[j] ? normalizedPatterns[j] : normalizedPatterns[i];
            const key = `${pA}::${pB}`;
            coOccurrenceMap.set(key, (coOccurrenceMap.get(key) || 0) + 1);
          }
        }
      }

      // Journey Timeline Period (Monthly YYYY-MM)
      const periodKey = Fly2GitAnalytics.toDateString(ts, timezoneOffset).slice(0, 7);
      if (!journeyPeriods.has(periodKey)) {
        journeyPeriods.set(periodKey, {
          period: periodKey,
          count: 0,
          patternCounts: new Map(),
          platforms: new Set(),
          languages: new Set(),
        });
      }
      const periodData = journeyPeriods.get(periodKey);
      periodData.count++;
      periodData.platforms.add(plat);
      periodData.languages.add(lang);
      for (const pat of normalizedPatterns) {
        periodData.patternCounts.set(pat, (periodData.patternCounts.get(pat) || 0) + 1);
      }
    }

    // Format Pattern Activity array
    const patterns = Array.from(patternAgg.values())
      .map((p) => ({
        pattern: p.pattern,
        count: p.count,
        firstSeen: p.firstSeen,
        lastSeen: p.lastSeen,
        platforms: Array.from(p.platforms.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name]) => name),
        languages: Array.from(p.languages.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name]) => name),
        difficulties: p.difficulties,
      }))
      .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));

    // Format Journey Timeline (chronological ascending)
    const journey = Array.from(journeyPeriods.values())
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((jp) => {
        const topPatterns = Array.from(jp.patternCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([p]) => p);
        return {
          period: jp.period,
          dominantPatterns: topPatterns,
          platforms: Array.from(jp.platforms),
          languages: Array.from(jp.languages),
          count: jp.count,
        };
      });

    // Format Relationships (co-occurrences)
    const relationships = Array.from(coOccurrenceMap.entries())
      .map(([key, count]) => {
        const [patternA, patternB] = key.split("::");
        return {
          patternA,
          patternB,
          coOccurrenceCount: count,
        };
      })
      .sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount || a.patternA.localeCompare(b.patternA));

    // Format Coverage Model across all canonical patterns
    const coverage = CANONICAL_PATTERNS.map((canonical) => {
      const active = patternAgg.get(canonical);
      return {
        pattern: canonical,
        observedCount: active ? active.count : 0,
        recentCount: recentCounts.get(canonical) || 0,
        platformsUsed: active ? Array.from(active.platforms.keys()) : [],
        languagesUsed: active ? Array.from(active.languages.keys()) : [],
        difficultyDistribution: active
          ? active.difficulties
          : { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 },
      };
    });

    // Difficulty × Pattern Matrix
    const difficultyMatrix = {};
    for (const [pat, data] of patternAgg.entries()) {
      difficultyMatrix[pat] = { ...data.difficulties };
    }

    // Recent Pattern Shifts
    const shiftPatterns = new Set([...recentCounts.keys(), ...previousCounts.keys()]);
    const recentShifts = Array.from(shiftPatterns)
      .map((pat) => {
        const recent = recentCounts.get(pat) || 0;
        const prev = previousCounts.get(pat) || 0;
        let direction = "stable";
        if (recent > 0 && prev === 0) direction = "new";
        else if (recent === 0 && prev > 0) direction = "inactive";
        else if (recent > prev) direction = "increased";
        else if (recent < prev) direction = "decreased";
        else direction = "stable";

        return {
          pattern: pat,
          recentCount: recent,
          previousCount: prev,
          direction,
        };
      })
      .sort((a, b) => b.recentCount - a.recentCount || a.pattern.localeCompare(b.pattern));

    // Deterministic Exploration Candidates
    const explorationCandidates = [];

    // 1. Low recent activity: historically practiced (>= 2) but 0 recently
    for (const p of patterns) {
      if (p.count >= 2 && (recentCounts.get(p.pattern) || 0) === 0) {
        explorationCandidates.push({
          type: "low_recent_activity",
          pattern: p.pattern,
          evidence: `Observed ${p.count} times historically, but 0 in the recent ${windowDays}-day period.`,
          reason: "Opportunity to revisit this pattern if desired.",
        });
      }
    }

    // 2. Newly observed pattern
    for (const s of recentShifts) {
      if (s.direction === "new" && s.recentCount > 0) {
        explorationCandidates.push({
          type: "new_pattern",
          pattern: s.pattern,
          evidence: `First observed ${s.recentCount} times in the recent period with no prior activity.`,
          reason: "Recently introduced pattern in practice history.",
        });
      }
    }

    // 3. Cross-platform variation: practiced on 1 platform while user has multiple platforms
    if (allUserPlatforms.size > 1) {
      for (const p of patterns) {
        if (p.count >= 3 && p.platforms.length === 1) {
          explorationCandidates.push({
            type: "cross_platform_variation",
            pattern: p.pattern,
            evidence: `Observed ${p.count} times on ${p.platforms[0]} only.`,
            reason: "Pattern observed predominantly on a single platform.",
          });
        }
      }
    }

    // 4. Language variation: practiced in 1 language while user has multiple languages
    if (allUserLanguages.size > 1) {
      for (const p of patterns) {
        if (p.count >= 3 && p.languages.length === 1) {
          explorationCandidates.push({
            type: "language_variation",
            pattern: p.pattern,
            evidence: `Practiced ${p.count} times exclusively in ${p.languages[0]}.`,
            reason: "Pattern practiced in a single language.",
          });
        }
      }
    }

    // 5. Difficulty variation: only Easy solved (>= 2)
    for (const p of patterns) {
      if (p.count >= 2 && p.difficulties.Easy === p.count && p.difficulties.Medium === 0 && p.difficulties.Hard === 0) {
        explorationCandidates.push({
          type: "difficulty_variation",
          pattern: p.pattern,
          evidence: `All ${p.count} observed problems were Easy difficulty.`,
          reason: "Consider exploring Medium problems for this pattern.",
        });
      }
    }

    // 6. Related pattern candidate: co-occurs with top pattern but low individual count
    if (patterns.length > 0 && relationships.length > 0) {
      const topPat = patterns[0].pattern;
      for (const rel of relationships) {
        if (rel.patternA === topPat || rel.patternB === topPat) {
          const other = rel.patternA === topPat ? rel.patternB : rel.patternA;
          const otherData = patternAgg.get(other);
          const otherCount = otherData ? otherData.count : 0;
          if (otherCount < 3) {
            explorationCandidates.push({
              type: "related_pattern",
              pattern: other,
              evidence: `Co-occurs with ${topPat} (${rel.coOccurrenceCount} times) but has only ${otherCount} observed problems.`,
              reason: "Complementary concept frequently appearing alongside familiar patterns.",
            });
            break;
          }
        }
      }
    }

    return {
      userId,
      period: range,
      totalObserved: totalProblemsWithPatterns,
      patterns,
      journey,
      coverage,
      relationships,
      languageMatrix,
      platformMatrix,
      difficultyMatrix,
      recentShifts,
      explorationCandidates: explorationCandidates.slice(0, 10),
      rawEventCount: events.length,
    };
  }

  /**
   * Retrieves pattern activity aggregation.
   *
   * @param {string} userId
   * @param {object} [options]
   * @returns {Array<object>}
   */
  getPatternActivity(userId, options = {}) {
    const intel = this.buildIntelligence(userId, options);
    return intel.patterns;
  }

  /**
   * Retrieves chronological Coding Journey timeline.
   *
   * @param {string} userId
   * @param {object} [options]
   * @returns {Array<object>}
   */
  getCodingJourney(userId, options = {}) {
    const intel = this.buildIntelligence(userId, options);
    return intel.journey;
  }

  /**
   * Retrieves full Pattern Coverage model.
   *
   * @param {string} userId
   * @param {object} [options]
   * @returns {Array<object>}
   */
  getPatternCoverage(userId, options = {}) {
    const intel = this.buildIntelligence(userId, options);
    return intel.coverage;
  }

  /**
   * Retrieves pattern co-occurrence relationships.
   *
   * @param {string} userId
   * @param {object} [options]
   * @returns {Array<object>}
   */
  getPatternRelationships(userId, options = {}) {
    const intel = this.buildIntelligence(userId, options);
    return intel.relationships;
  }

  /**
   * Retrieves language × pattern cross-tabulation matrix.
   *
   * @param {string} userId
   * @param {object} [options]
   * @returns {object}
   */
  getLanguagePatternMatrix(userId, options = {}) {
    const intel = this.buildIntelligence(userId, options);
    return intel.languageMatrix;
  }

  /**
   * Retrieves platform × pattern cross-tabulation matrix.
   *
   * @param {string} userId
   * @param {object} [options]
   * @returns {object}
   */
  getPlatformPatternMatrix(userId, options = {}) {
    const intel = this.buildIntelligence(userId, options);
    return intel.platformMatrix;
  }

  /**
   * Retrieves difficulty distribution per pattern.
   *
   * @param {string} userId
   * @param {object} [options]
   * @returns {object}
   */
  getDifficultyPatternMatrix(userId, options = {}) {
    const intel = this.buildIntelligence(userId, options);
    return intel.difficultyMatrix;
  }

  /**
   * Retrieves recent pattern shifts compared to previous equivalent window.
   *
   * @param {string} userId
   * @param {object} [options]
   * @returns {Array<object>}
   */
  getRecentPatternShifts(userId, options = {}) {
    const intel = this.buildIntelligence(userId, options);
    return intel.recentShifts;
  }

  /**
   * Retrieves deterministic exploration candidates.
   *
   * @param {string} userId
   * @param {object} [options]
   * @returns {Array<object>}
   */
  getExplorationCandidates(userId, options = {}) {
    const intel = this.buildIntelligence(userId, options);
    return intel.explorationCandidates;
  }

  /**
   * Computes relevant contextual history for a specific problem being viewed.
   *
   * @param {string} userId - User identifier
   * @param {object} problemInput - { platform, problemSlug, title, difficulty, topics }
   * @returns {object} Contextual history (NOT a recommendation score)
   */
  getCurrentProblemContext(userId, problemInput = {}) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required for problem context");
      err.statusCode = 400;
      throw err;
    }

    const plat = (problemInput.platform || "unknown").toLowerCase().trim();
    const rawTopics = Array.isArray(problemInput.topics)
      ? problemInput.topics
      : typeof problemInput.topics === "string"
      ? [problemInput.topics]
      : [];
    const normalizedPatterns = PatternNormalizer.normalizeList(rawTopics);

    const intel = this.buildIntelligence(userId, { range: "all" });

    // Pattern matches in user history
    const matchedPatterns = [];
    for (const pat of normalizedPatterns) {
      const found = intel.patterns.find((p) => p.pattern === pat);
      matchedPatterns.push({
        pattern: pat,
        observedCount: found ? found.count : 0,
      });
    }

    // Filter events that contain any of these normalized patterns
    const rawEvents = this.db.getAnalyticsEventsByUserId
      ? this.db.getAnalyticsEventsByUserId(userId, { limit: 10000 })
      : [];
    const matchingEvents = rawEvents.filter((ev) => {
      if ((ev.action || "synced") !== "synced") return false;
      const evTopics = ev.topics || (ev.metadata && ev.metadata.topics) || (ev.topic ? [ev.topic] : []) || [];
      const evPats = PatternNormalizer.normalizeList(evTopics);
      return evPats.some((p) => normalizedPatterns.includes(p));
    });

    let currentPlatformCount = 0;
    let otherPlatformsCount = 0;
    const platformsSet = new Set();
    const languageCounts = {};

    for (const ev of matchingEvents) {
      const evPlat = (ev.platform || "unknown").toLowerCase().trim();
      const evLang = (ev.language || "unknown").toLowerCase().trim();
      platformsSet.add(evPlat);

      if (evPlat === plat) currentPlatformCount++;
      else otherPlatformsCount++;

      languageCounts[evLang] = (languageCounts[evLang] || 0) + 1;
    }

    // Related patterns: find co-occurring patterns in history that are NOT in current problem
    const relatedMap = new Map();
    for (const rel of intel.relationships) {
      if (normalizedPatterns.includes(rel.patternA) && !normalizedPatterns.includes(rel.patternB)) {
        relatedMap.set(rel.patternB, (relatedMap.get(rel.patternB) || 0) + rel.coOccurrenceCount);
      } else if (normalizedPatterns.includes(rel.patternB) && !normalizedPatterns.includes(rel.patternA)) {
        relatedMap.set(rel.patternA, (relatedMap.get(rel.patternA) || 0) + rel.coOccurrenceCount);
      }
    }

    const relatedPatterns = Array.from(relatedMap.entries())
      .map(([pattern, coOccurrenceCount]) => ({ pattern, coOccurrenceCount }))
      .sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount)
      .slice(0, 5);

    return {
      currentProblem: {
        platform: plat,
        problemSlug: problemInput.problemSlug || "unknown",
        title: problemInput.title || "Untitled",
        difficulty: problemInput.difficulty || "Unknown",
        patterns: normalizedPatterns,
      },
      observedHistory: {
        patterns: matchedPatterns,
        totalProblemMatches: matchingEvents.length,
      },
      relatedPatterns,
      platformHistory: {
        currentPlatformCount,
        otherPlatformsCount,
        platforms: Array.from(platformsSet),
      },
      languageHistory: languageCounts,
    };
  }

  /**
   * Explains observed coding patterns using AI grounding.
   * AI receives ONLY minimized derived context.
   *
   * @param {string} userId - User identifier
   * @param {object} [request] - { range, userQuestion, problem }
   * @returns {Promise<object>} Structured intelligence explanation
   */
  async explainIntelligence(userId, request = {}) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required for coding intelligence explanation");
      err.statusCode = 400;
      throw err;
    }

    // 1. Authoritative Entitlement Check (Fail Closed)
    const ent = await this.entitlementService.getAuthoritativeEntitlement(userId);
    const now = Date.now();
    if (!ent || ent.status === "expired" || (typeof ent.expiresAt === "number" && now > ent.expiresAt)) {
      const err = new Error("User entitlement has expired. Pro subscription required for AI Intelligence.");
      err.code = "AI_FORBIDDEN";
      err.statusCode = 403;
      throw err;
    }

    // 2. Build Minimized Derived Context
    const intel = this.buildIntelligence(userId, { range: request.range || "all" });

    // Handle empty history cold start gracefully
    if (intel.totalObserved === 0 && intel.rawEventCount === 0) {
      return {
        ok: true,
        success: true,
        summary: "No synced coding activity with recognized patterns has been recorded yet.",
        observations: ["No practice sessions recorded in the selected period."],
        relatedPatterns: [],
        recentChanges: ["No historical shifts available."],
        suggestedExploration: [
          "Start by solving and syncing an introductory problem on any supported platform.",
        ],
        confidence: "high",
        totalObserved: 0,
        patterns: [],
      };
    }

    const derivedContext = {
      totalObserved: intel.totalObserved,
      period: intel.period,
      topPatterns: intel.patterns.slice(0, 8),
      recentShifts: intel.recentShifts.slice(0, 6),
      relationships: intel.relationships.slice(0, 6),
      languageMatrix: intel.languageMatrix,
      platformMatrix: intel.platformMatrix,
    };

    // 3. Invoke Centralized AI Gateway (Feature = "coding_intelligence")
    const aiResult = await this.aiService.generate(userId, {
      feature: "coding_intelligence",
      derivedContext,
      currentProblem: request.problem ? {
        title: request.problem.title,
        platform: request.problem.platform,
        difficulty: request.problem.difficulty,
        patterns: PatternNormalizer.normalizeList(request.problem.topics),
      } : undefined,
      userQuestion: request.userQuestion,
    });

    const aiAnswer = aiResult.answer || {};

    return {
      ok: true,
      success: true,
      summary: aiAnswer.summary,
      observations: aiAnswer.observations || [],
      relatedPatterns: aiAnswer.relatedPatterns || [],
      recentChanges: aiAnswer.recentChanges || [],
      suggestedExploration: aiAnswer.suggestedExploration || [],
      confidence: aiAnswer.confidence || "high",
      totalObserved: intel.totalObserved,
      patterns: intel.patterns,
      requestId: aiResult.requestId,
      usage: aiResult.usage,
    };
  }

  /**
   * Deletes all derived intelligence caches and user topic tags.
   *
   * @param {string} userId - User identifier
   * @returns {object} Deletion outcome
   */
  deleteUserData(userId) {
    if (!userId) return { ok: false, deleted: false };
    if (this.db.deleteTopicTagsByUserId) {
      this.db.deleteTopicTagsByUserId(userId);
    }
    return { ok: true, deleted: true };
  }
}

module.exports = {
  CodingIntelligenceService,
};
