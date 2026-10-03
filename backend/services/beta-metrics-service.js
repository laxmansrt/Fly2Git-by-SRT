// Fly2Git Backend — Beta Metrics Service (Phase 19)
// Tracks activation, retention, feature adoption, first-session funnel, and friction.
// Uses existing product telemetry infrastructure — does NOT duplicate analytics data.
// NEVER stores source code, tokens, cookies, AI prompts, or AI responses.
// NEVER calculates: skill score, developer quality, employability, interview probability, ranking.

"use strict";

// Allowed telemetry events for Phase 19 (superset of Phase 18)
const BETA_TELEMETRY_EVENTS = Object.freeze([
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

// Feature adoption tracking keys
const TRACKED_FEATURES = Object.freeze([
  "auto_sync",
  "ai_analyze",
  "ai_explain",
  "ai_hint",
  "ai_coach",
  "coding_journey",
  "analytics",
  "automation",
  "multi_repo",
]);

class BetaMetricsService {
  constructor(database, productTelemetryService, betaCohortService, options = {}) {
    this.db = database;
    this.telemetry = productTelemetryService;
    this.cohort = betaCohortService;
  }

  /**
   * Record an onboarding step event.
   *
   * @param {string} userId — server-authenticated userId
   * @param {string} step — one of: onboarding_started, github_connected, platform_selected, onboarding_completed
   * @param {object} [metadata]
   * @returns {{ ok: boolean }}
   */
  recordOnboardingEvent(userId, step, metadata = {}) {
    if (!userId || !step) return { ok: false, error: "Missing userId or step" };

    const allowed = ["onboarding_started", "github_connected", "platform_selected", "onboarding_completed"];
    if (!allowed.includes(step)) return { ok: false, error: "Invalid onboarding step" };

    return this.telemetry.recordEvent(
      {
        event: step,
        platform: metadata.platform || "extension",
        appVersion: metadata.appVersion || "1.1.6",
      },
      { userId }
    );
  }

  /**
   * Record first sync activation event with timing metadata.
   *
   * @param {string} userId
   * @param {object} metadata
   * @param {number} [metadata.installTimestamp]
   * @param {number} [metadata.onboardingCompletedTimestamp]
   * @returns {{ ok: boolean, timeToFirstSync?: number }}
   */
  recordActivation(userId, metadata = {}) {
    if (!userId) return { ok: false, error: "Missing userId" };

    const now = Date.now();
    const installTs = typeof metadata.installTimestamp === "number" ? metadata.installTimestamp : null;
    const onboardingTs = typeof metadata.onboardingCompletedTimestamp === "number"
      ? metadata.onboardingCompletedTimestamp : null;

    const timeToFirstSync = installTs ? now - installTs : null;

    const result = this.telemetry.recordEvent(
      {
        event: "first_sync",
        platform: metadata.platform || "extension",
        appVersion: metadata.appVersion || "1.1.6",
      },
      { userId }
    );

    if (!result.ok) return result;

    return {
      ok: true,
      eventId: result.eventId,
      timeToFirstSync,
      activatedAt: now,
    };
  }

  /**
   * Record a sync event (success or error).
   *
   * @param {string} userId
   * @param {boolean} success
   * @param {object} [metadata]
   * @returns {{ ok: boolean }}
   */
  recordSync(userId, success, metadata = {}) {
    if (!userId) return { ok: false, error: "Missing userId" };

    return this.telemetry.recordEvent(
      {
        event: success ? "sync_success" : "sync_error",
        platform: metadata.platform || "extension",
        appVersion: metadata.appVersion || "1.1.6",
      },
      { userId }
    );
  }

  /**
   * Record feature usage for adoption tracking.
   *
   * @param {string} userId
   * @param {string} feature — one of TRACKED_FEATURES
   * @param {object} [metadata]
   * @returns {{ ok: boolean }}
   */
  recordFeatureUsage(userId, feature, metadata = {}) {
    if (!userId) return { ok: false, error: "Missing userId" };

    // Map feature to a telemetry event
    const featureToEvent = {
      ai_analyze: "ai_used",
      ai_explain: "ai_used",
      ai_hint: "ai_used",
      ai_coach: "coach_used",
      coding_journey: "journey_opened",
      analytics: "analytics_opened",
      auto_sync: "sync_success",
      automation: "settings_opened",
      multi_repo: "settings_opened",
    };

    const eventName = featureToEvent[feature] || "settings_opened";

    return this.telemetry.recordEvent(
      {
        event: eventName,
        platform: metadata.platform || "extension",
        appVersion: metadata.appVersion || "1.1.6",
      },
      { userId }
    );
  }

  /**
   * Get first-session funnel data for the beta cohort.
   * install → onboarding_started → github_connected → platform_selected → first_sync
   *
   * @returns {object} Funnel with counts and conversion rates
   */
  getFirstSessionFunnel() {
    const cohort = this.cohort.listCohort();
    const userIds = cohort.map((m) => m.userId);
    const totalInstalled = userIds.length;

    const funnelCounts = {
      installed: totalInstalled,
      onboarding_started: 0,
      github_connected: 0,
      platform_selected: 0,
      first_sync: 0,
    };

    for (const uid of userIds) {
      const events = this.telemetry.getUserTelemetry(uid, { limit: 5000 });
      const eventNames = new Set(events.map((e) => e.event));
      if (eventNames.has("onboarding_started")) funnelCounts.onboarding_started++;
      if (eventNames.has("github_connected")) funnelCounts.github_connected++;
      if (eventNames.has("platform_selected")) funnelCounts.platform_selected++;
      if (eventNames.has("first_sync")) funnelCounts.first_sync++;
    }

    const conversion = {};
    const steps = ["installed", "onboarding_started", "github_connected", "platform_selected", "first_sync"];
    for (let i = 1; i < steps.length; i++) {
      const prev = funnelCounts[steps[i - 1]];
      const curr = funnelCounts[steps[i]];
      conversion[`${steps[i - 1]}_to_${steps[i]}`] =
        prev > 0 ? Math.round((curr / prev) * 100) : 0;
    }

    // Identify first major drop-off
    let firstDropOff = null;
    for (let i = 1; i < steps.length; i++) {
      const prev = funnelCounts[steps[i - 1]];
      const curr = funnelCounts[steps[i]];
      if (prev > 0 && curr / prev < 0.5) {
        firstDropOff = { from: steps[i - 1], to: steps[i], rate: Math.round((curr / prev) * 100) };
        break;
      }
    }

    return { funnel: funnelCounts, conversion, firstDropOff };
  }

  /**
   * Calculate activation rate and median time to first sync.
   *
   * @returns {object}
   */
  getActivationMetrics() {
    const cohort = this.cohort.listCohort();
    const userIds = cohort.map((m) => m.userId);
    let activated = 0;
    const timesToSync = [];

    for (const uid of userIds) {
      const events = this.telemetry.getUserTelemetry(uid, { limit: 5000 });
      const firstSyncEv = events.find((e) => e.event === "first_sync");
      if (firstSyncEv) {
        activated++;
        const member = cohort.find((m) => m.userId === uid);
        if (member && member.addedAt) {
          timesToSync.push(firstSyncEv.timestamp - member.addedAt);
        }
      }
    }

    timesToSync.sort((a, b) => a - b);
    const medianTimeToSync = timesToSync.length > 0
      ? timesToSync[Math.floor(timesToSync.length / 2)]
      : null;

    return {
      totalUsers: userIds.length,
      activatedUsers: activated,
      activationRate: userIds.length > 0 ? Math.round((activated / userIds.length) * 100) : 0,
      medianTimeToFirstSync: medianTimeToSync,
    };
  }

  /**
   * Calculate retention metrics for the beta cohort.
   *
   * @returns {object}
   */
  getRetentionMetrics() {
    const cohort = this.cohort.listCohort();
    const userIds = cohort.map((m) => m.userId);
    const retention = [];

    for (const uid of userIds) {
      const events = this.telemetry.getUserTelemetry(uid, { limit: 5000 });
      if (events.length === 0) continue;

      // Count unique active days
      const activeDays = new Set(events.map((e) => new Date(e.timestamp).toISOString().slice(0, 10)));
      // Count sync days
      const syncEvents = events.filter((e) => ["first_sync", "sync_success"].includes(e.event));
      const syncDays = new Set(syncEvents.map((e) => new Date(e.timestamp).toISOString().slice(0, 10)));
      // Count AI usage days
      const aiEvents = events.filter((e) => ["ai_used", "coach_used"].includes(e.event));
      const aiDays = new Set(aiEvents.map((e) => new Date(e.timestamp).toISOString().slice(0, 10)));
      // Count journey usage days
      const journeyEvents = events.filter((e) => e.event === "journey_opened");
      const journeyDays = new Set(journeyEvents.map((e) => new Date(e.timestamp).toISOString().slice(0, 10)));

      retention.push({
        userId: uid,
        activeBetaDays: activeDays.size,
        repeatSyncDays: syncDays.size,
        aiUsageDays: aiDays.size,
        journeyUsageDays: journeyDays.size,
        totalEvents: events.length,
      });
    }

    return {
      users: retention,
      summary: {
        totalTracked: retention.length,
        averageActiveDays: retention.length > 0
          ? Math.round(retention.reduce((s, r) => s + r.activeBetaDays, 0) / retention.length * 10) / 10
          : 0,
        usersWithRepeatSync: retention.filter((r) => r.repeatSyncDays >= 2).length,
      },
    };
  }

  /**
   * Calculate feature adoption rates.
   *
   * @returns {object}
   */
  getFeatureAdoption() {
    const cohort = this.cohort.listCohort();
    const userIds = cohort.map((m) => m.userId);
    const total = userIds.length;

    const featureMapping = {
      auto_sync: ["sync_success", "first_sync"],
      ai_analyze: ["ai_used"],
      ai_explain: ["ai_used"],
      ai_hint: ["ai_used"],
      ai_coach: ["coach_used"],
      coding_journey: ["journey_opened"],
      analytics: ["analytics_opened"],
      automation: ["settings_opened"],
      multi_repo: ["settings_opened"],
    };

    const adoption = {};

    for (const feature of TRACKED_FEATURES) {
      let usersWhoUsed = 0;
      const matchEvents = featureMapping[feature] || [];

      for (const uid of userIds) {
        const events = this.telemetry.getUserTelemetry(uid, { limit: 5000 });
        if (events.some((e) => matchEvents.includes(e.event))) {
          usersWhoUsed++;
        }
      }

      adoption[feature] = {
        users: usersWhoUsed,
        percentage: total > 0 ? Math.round((usersWhoUsed / total) * 100) : 0,
      };
    }

    return adoption;
  }

  /**
   * Generate friction detection report.
   *
   * @returns {object}
   */
  getFrictionReport() {
    const cohort = this.cohort.listCohort();
    const userIds = cohort.map((m) => m.userId);

    const friction = {
      observed: {
        repeatedErrors: 0,
        onboardingAbandonment: 0,
        githubConnectionFailures: 0,
        platformSelectionIssues: 0,
        identityMismatchFrequency: 0,
        syncFailures: 0,
        aiFailures: 0,
        notificationIssues: 0,
        settingsConfusion: 0,
      },
      reported: [],
    };

    for (const uid of userIds) {
      const events = this.telemetry.getUserTelemetry(uid, { limit: 5000 });
      const eventNames = events.map((e) => e.event);

      // Sync errors
      const syncErrors = eventNames.filter((e) => e === "sync_error").length;
      friction.observed.syncFailures += syncErrors;
      if (syncErrors > 2) friction.observed.repeatedErrors++;

      // Onboarding abandonment: started but never completed
      if (eventNames.includes("onboarding_started") && !eventNames.includes("onboarding_completed")) {
        friction.observed.onboardingAbandonment++;
      }

      // GitHub connection issues: onboarding started but never github_connected
      if (eventNames.includes("onboarding_started") && !eventNames.includes("github_connected")) {
        friction.observed.githubConnectionFailures++;
      }

      // Platform selection issues: github_connected but never platform_selected
      if (eventNames.includes("github_connected") && !eventNames.includes("platform_selected")) {
        friction.observed.platformSelectionIssues++;
      }
    }

    // Pull user-reported feedback
    for (const uid of userIds) {
      const feedback = this.db.getFeedbackByUserId(uid);
      for (const fb of feedback) {
        if (fb.category === "bug" || fb.category === "confusing") {
          friction.reported.push({
            category: fb.category,
            message: fb.message ? fb.message.slice(0, 200) : "",
            timestamp: fb.timestamp,
          });
        }
      }
    }

    return friction;
  }

  /**
   * Generate admin-only beta dashboard data.
   * NEVER exposes individual developer rankings.
   *
   * @returns {object}
   */
  getDashboard() {
    const cohortSummary = this.cohort.getCohortSummary();
    const activation = this.getActivationMetrics();
    const retention = this.getRetentionMetrics();
    const adoption = this.getFeatureAdoption();
    const funnel = this.getFirstSessionFunnel();
    const friction = this.getFrictionReport();

    // Common error codes
    const cohort = this.cohort.listCohort();
    let totalFeedback = 0;
    for (const m of cohort) {
      const fb = this.db.getFeedbackByUserId(m.userId);
      totalFeedback += fb.length;
    }

    return {
      betaUsers: cohortSummary,
      activationRate: activation.activationRate,
      medianTimeToFirstSync: activation.medianTimeToSync,
      repeatUsage: retention.summary,
      featureAdoption: adoption,
      syncReliability: {
        totalSyncFailures: friction.observed.syncFailures,
      },
      aiUsage: adoption.ai_analyze || { users: 0, percentage: 0 },
      commonErrorCodes: friction.observed,
      feedbackCount: totalFeedback,
      funnel: funnel,
      generatedAt: new Date().toISOString(),
    };
  }
}

module.exports = { BetaMetricsService, BETA_TELEMETRY_EVENTS, TRACKED_FEATURES };
