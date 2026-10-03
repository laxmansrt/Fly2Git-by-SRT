// Fly2Git Backend — Database Store (Phase 12C + Phase 14 Pro Grants)
// Lightweight, indexed, ACID-safe persistence with zero external dependencies.
// Provides indexing on:
// - userId
// - providerCustomerId
// - providerSubscriptionId
// - subscription status
// - webhook eventId (idempotency)

const fs = require("fs");
const path = require("path");

class Database {
  constructor(options = {}) {
    this.filePath = options.filePath || null;
    this.memoryOnly = options.memoryOnly || false;

    // Collections
    this.users = new Map(); // id -> user
    this.subscriptions = new Map(); // id -> subscription
    this.entitlements = new Map(); // userId -> entitlement
    this.repositoryTargets = new Map(); // id -> repoTarget
    this.webhookEvents = new Map(); // eventId -> eventRecord
    this.proGrants = new Map(); // id -> proGrant
    this.basicPlatformSlots = new Map(); // id -> basicPlatformSlot
    this.automationSettings = new Map(); // userId -> settingsRecord
    this.analyticsEvents = new Map(); // id -> analyticsEvent
    this.aiUsageEvents = new Map(); // id -> aiUsageEvent
    this.productTelemetryEvents = new Map(); // id -> productTelemetryEvent (Phase 18)
    this.feedbackRecords = new Map(); // id -> feedbackRecord (Phase 18)
    this.betaAllowlist = new Map(); // userId -> betaRecord (Phase 18)
    this.topicTags = new Map(); // userId -> Map<tag, { tag, confidence, updatedAt }>
    this.auditEvents = []; // Array of audit event records

    // Secondary Indexes
    this.indexes = {
      userByEmail: new Map(),
      subscriptionByUserId: new Map(),
      subscriptionByCustomerId: new Map(),
      subscriptionByProviderSubId: new Map(),
      subscriptionByStatus: new Map(), // status -> Set<subId>
      repoTargetsByUserId: new Map(), // userId -> Set<targetId>
      proGrantByUserId: new Map(), // userId -> Set<grantId>
      basicPlatformSlotsByUserId: new Map(), // userId -> Map<slotNumber, slotId>
      analyticsByUserId: new Map(), // userId -> Set<eventId>
      aiUsageByUserId: new Map(), // userId -> Set<eventId>
      productTelemetryByUserId: new Map(), // userId -> Set<eventId>
      feedbackByUserId: new Map(), // userId -> Set<feedbackId>
    };

    if (!this.memoryOnly && this.filePath) {
      this.load();
    }
  }

  load() {
    if (!this.filePath) return;
    const backupPath = `${this.filePath}.bak`;
    let loaded = false;

    // 1. Try reading primary file
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const data = JSON.parse(raw);
        this.populateFromData(data);
        loaded = true;
      } catch (err) {
        console.warn("[Fly2Git][DB] Primary database file corrupted, attempting recovery from backup:", err.message);
      }
    }

    // 2. Fallback to backup file if primary corrupted
    if (!loaded && fs.existsSync(backupPath)) {
      try {
        const raw = fs.readFileSync(backupPath, "utf8");
        const data = JSON.parse(raw);
        this.populateFromData(data);
        console.log("[Fly2Git][DB] Successfully recovered database from backup file");
        loaded = true;
      } catch (err) {
        console.error("[Fly2Git][DB] Backup file also corrupted, starting clean:", err.message);
      }
    }
  }

  populateFromData(data) {
    if (!data || typeof data !== "object") return;
    if (Array.isArray(data.users)) data.users.forEach((u) => this.insertUser(u));
    if (Array.isArray(data.subscriptions)) data.subscriptions.forEach((s) => this.insertSubscription(s));
    if (Array.isArray(data.entitlements)) data.entitlements.forEach((e) => this.setEntitlement(e));
    if (Array.isArray(data.repositoryTargets)) data.repositoryTargets.forEach((t) => this.insertRepositoryTarget(t));
    if (Array.isArray(data.webhookEvents)) data.webhookEvents.forEach((w) => this.recordWebhookEvent(w.eventId, w));
    if (Array.isArray(data.proGrants)) data.proGrants.forEach((g) => this.insertProGrant(g));
    if (Array.isArray(data.basicPlatformSlots)) data.basicPlatformSlots.forEach((s) => this.insertBasicPlatformSlot(s));
    if (Array.isArray(data.automationSettings)) data.automationSettings.forEach((a) => this.upsertAutomationSettings(a.userId, a.settings));
    if (Array.isArray(data.analyticsEvents)) data.analyticsEvents.forEach((ev) => this.insertAnalyticsEvent(ev));
    if (Array.isArray(data.aiUsageEvents)) data.aiUsageEvents.forEach((ev) => this.insertAIUsageEvent(ev));
    if (Array.isArray(data.productTelemetryEvents)) data.productTelemetryEvents.forEach((ev) => this.insertProductTelemetryEvent(ev));
    if (Array.isArray(data.feedbackRecords)) data.feedbackRecords.forEach((f) => this.insertFeedback(f));
    if (Array.isArray(data.betaAllowlist)) data.betaAllowlist.forEach((b) => this.setBetaStatus(b.userId, b));
    if (Array.isArray(data.auditEvents)) this.auditEvents = data.auditEvents.slice();
  }

  save() {
    if (this.memoryOnly || !this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const payload = {
        users: Array.from(this.users.values()),
        subscriptions: Array.from(this.subscriptions.values()),
        entitlements: Array.from(this.entitlements.values()),
        repositoryTargets: Array.from(this.repositoryTargets.values()),
        webhookEvents: Array.from(this.webhookEvents.values()),
        proGrants: Array.from(this.proGrants.values()),
        basicPlatformSlots: Array.from(this.basicPlatformSlots.values()),
        automationSettings: Array.from(this.automationSettings.values()),
        analyticsEvents: Array.from(this.analyticsEvents.values()),
        aiUsageEvents: Array.from(this.aiUsageEvents.values()),
        productTelemetryEvents: Array.from(this.productTelemetryEvents.values()),
        feedbackRecords: Array.from(this.feedbackRecords.values()),
        betaAllowlist: Array.from(this.betaAllowlist.values()),
        auditEvents: this.auditEvents.slice(),
      };

      const jsonString = JSON.stringify(payload, null, 2);
      const tmpPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      const backupPath = `${this.filePath}.bak`;

      // Atomic write pattern: write to temp file then rename
      fs.writeFileSync(tmpPath, jsonString, "utf8");
      fs.renameSync(tmpPath, this.filePath);

      // Create backup copy for crash recovery
      try {
        fs.writeFileSync(backupPath, jsonString, "utf8");
      } catch (_bErr) {
        // Non-blocking backup copy
      }
    } catch (err) {
      console.error("[Fly2Git][DB] Failed to save database file atomically:", err.message);
    }
  }

  // --- Users ---
  insertUser(user) {
    const record = {
      id: user.id,
      email: (user.email || "").trim().toLowerCase(),
      passwordHash: user.passwordHash || null,
      createdAt: user.createdAt || new Date().toISOString(),
      updatedAt: user.updatedAt || new Date().toISOString(),
    };
    this.users.set(record.id, record);
    this.indexes.userByEmail.set(record.email, record.id);
    this.save();
    return { ...record };
  }

  getUserById(id) {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  getUserByEmail(email) {
    const normalized = (email || "").trim().toLowerCase();
    const id = this.indexes.userByEmail.get(normalized);
    return id ? this.getUserById(id) : null;
  }

  // --- Subscriptions ---
  insertSubscription(sub) {
    const record = {
      id: sub.id || `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: sub.userId,
      provider: sub.provider || "stripe",
      providerCustomerId: sub.providerCustomerId || null,
      providerSubscriptionId: sub.providerSubscriptionId || null,
      plan: sub.plan || "pro",
      billingCycle: sub.billingCycle || "monthly",
      status: sub.status || "active",
      currentPeriodStart: sub.currentPeriodStart || Date.now(),
      currentPeriodEnd: sub.currentPeriodEnd || Date.now() + 30 * 24 * 60 * 60 * 1000,
      cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
      lastEventTimestamp: sub.lastEventTimestamp || Date.now(),
      createdAt: sub.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.subscriptions.set(record.id, record);

    // Update indexes
    if (record.userId) this.indexes.subscriptionByUserId.set(record.userId, record.id);
    if (record.providerCustomerId) this.indexes.subscriptionByCustomerId.set(record.providerCustomerId, record.id);
    if (record.providerSubscriptionId)
      this.indexes.subscriptionByProviderSubId.set(record.providerSubscriptionId, record.id);

    if (!this.indexes.subscriptionByStatus.has(record.status)) {
      this.indexes.subscriptionByStatus.set(record.status, new Set());
    }
    this.indexes.subscriptionByStatus.get(record.status).add(record.id);

    this.save();
    return { ...record };
  }

  updateSubscription(id, patch) {
    const current = this.subscriptions.get(id);
    if (!current) return null;

    // Remove old status index if status changes
    if (patch.status && patch.status !== current.status) {
      const oldSet = this.indexes.subscriptionByStatus.get(current.status);
      if (oldSet) oldSet.delete(id);
      if (!this.indexes.subscriptionByStatus.has(patch.status)) {
        this.indexes.subscriptionByStatus.set(patch.status, new Set());
      }
      this.indexes.subscriptionByStatus.get(patch.status).add(id);
    }

    const updated = {
      ...current,
      ...patch,
      id: current.id,
      userId: current.userId,
      updatedAt: new Date().toISOString(),
    };
    this.subscriptions.set(id, updated);
    this.save();
    return { ...updated };
  }

  getSubscriptionById(id) {
    const s = this.subscriptions.get(id);
    return s ? { ...s } : null;
  }

  getSubscriptionByUserId(userId) {
    const id = this.indexes.subscriptionByUserId.get(userId);
    return id ? this.getSubscriptionById(id) : null;
  }

  getSubscriptionByCustomerId(customerId) {
    const id = this.indexes.subscriptionByCustomerId.get(customerId);
    return id ? this.getSubscriptionById(id) : null;
  }

  getSubscriptionByProviderSubId(providerSubId) {
    const id = this.indexes.subscriptionByProviderSubId.get(providerSubId);
    return id ? this.getSubscriptionById(id) : null;
  }

  // --- Entitlements ---
  setEntitlement(ent) {
    const record = {
      userId: ent.userId,
      version: 1,
      plan: ent.plan || "basic",
      status: ent.status || "active",
      billingCycle: ent.billingCycle || null,
      expiresAt: ent.expiresAt || null,
      features: ent.features || {
        maxPlatforms: 2,
        allPlatforms: false,
        multipleRepositories: false,
        advancedAutomation: false,
        analytics: false,
        ai: false,
      },
      updatedAt: new Date().toISOString(),
    };
    this.entitlements.set(record.userId, record);
    this.save();
    return { ...record };
  }

  getEntitlementByUserId(userId) {
    const e = this.entitlements.get(userId);
    return e ? { ...e } : null;
  }

  // --- Repository Targets (Multi-Repo Preparation) ---
  insertRepositoryTarget(target) {
    const record = {
      id: target.id || `${target.userId}_${target.githubOwner}_${target.githubRepo}`,
      userId: target.userId,
      githubOwner: target.githubOwner,
      githubRepo: target.githubRepo,
      platform: target.platform || "all",
      enabled: typeof target.enabled === "boolean" ? target.enabled : true,
      createdAt: target.createdAt || new Date().toISOString(),
    };
    this.repositoryTargets.set(record.id, record);

    if (!this.indexes.repoTargetsByUserId.has(record.userId)) {
      this.indexes.repoTargetsByUserId.set(record.userId, new Set());
    }
    this.indexes.repoTargetsByUserId.get(record.userId).add(record.id);

    this.save();
    return { ...record };
  }

  getRepositoryTargetsByUserId(userId) {
    const ids = this.indexes.repoTargetsByUserId.get(userId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.repositoryTargets.get(id))
      .filter(Boolean)
      .map((t) => ({ ...t }));
  }

  // --- Webhook Events (Idempotency) ---
  hasWebhookEvent(eventId) {
    return this.webhookEvents.has(eventId);
  }

  recordWebhookEvent(eventId, details = {}) {
    const record = {
      eventId,
      provider: details.provider || "stripe",
      type: details.type || "unknown",
      processedAt: new Date().toISOString(),
    };
    this.webhookEvents.set(eventId, record);
    this.save();
    return record;
  }

  // --- Pro Grants (Phase 14) ---
  insertProGrant(grant) {
    const record = {
      id: grant.id,
      userId: grant.userId,
      type: grant.type || "promotional",
      status: grant.status || "active",
      grantedAt: grant.grantedAt || Date.now(),
      expiresAt: grant.expiresAt !== undefined ? grant.expiresAt : null,
      grantedBy: grant.grantedBy || "system",
      note: grant.note || "",
      updatedAt: grant.updatedAt || Date.now(),
    };
    this.proGrants.set(record.id, record);

    // Update userId index
    if (!this.indexes.proGrantByUserId.has(record.userId)) {
      this.indexes.proGrantByUserId.set(record.userId, new Set());
    }
    this.indexes.proGrantByUserId.get(record.userId).add(record.id);

    this.save();
    return { ...record };
  }

  updateProGrant(grantId, patch) {
    const current = this.proGrants.get(grantId);
    if (!current) return null;

    const updated = {
      ...current,
      ...patch,
      id: current.id, // Immutable
      userId: current.userId, // Immutable
      grantedAt: current.grantedAt, // Immutable
      grantedBy: current.grantedBy, // Immutable
      updatedAt: patch.updatedAt || Date.now(),
    };
    this.proGrants.set(grantId, updated);
    this.save();
    return { ...updated };
  }

  getProGrantById(grantId) {
    const g = this.proGrants.get(grantId);
    return g ? { ...g } : null;
  }

  getProGrantsByUserId(userId) {
    const ids = this.indexes.proGrantByUserId.get(userId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.proGrants.get(id))
      .filter(Boolean)
      .map((g) => ({ ...g }));
  }

  getAllProGrants() {
    return Array.from(this.proGrants.values()).map((g) => ({ ...g }));
  }

  deleteProGrant(grantId) {
    const grant = this.proGrants.get(grantId);
    if (!grant) return false;

    this.proGrants.delete(grantId);
    const userSet = this.indexes.proGrantByUserId.get(grant.userId);
    if (userSet) {
      userSet.delete(grantId);
      if (userSet.size === 0) this.indexes.proGrantByUserId.delete(grant.userId);
    }
    this.save();
    return true;
  }

  // --- Audit Events (Phase 14) ---
  recordAuditEvent(event) {
    const record = {
      ...event,
      timestamp: event.timestamp || Date.now(),
      recordedAt: new Date().toISOString(),
    };
    this.auditEvents.push(record);
    this.save();
    return record;
  }

  getAuditEvents(filters = {}) {
    let events = this.auditEvents.slice();
    if (filters.grantId) {
      events = events.filter((e) => e.grantId === filters.grantId);
    }
    if (filters.userId) {
      events = events.filter((e) => e.userId === filters.userId);
    }
    if (filters.action) {
      events = events.filter((e) => e.action === filters.action);
    }
    return events;
  }

  // --- Basic Platform Slots (Phase 13A) ---
  insertBasicPlatformSlot(slot) {
    const record = {
      id: slot.id || `slot_${slot.userId}_${slot.slot}`,
      userId: slot.userId,
      slot: Number(slot.slot),
      platform: slot.platform,
      activatedAt: typeof slot.activatedAt === "number" ? slot.activatedAt : Date.now(),
      nextChangeAt:
        typeof slot.nextChangeAt === "number"
          ? slot.nextChangeAt
          : (typeof slot.activatedAt === "number" ? slot.activatedAt : Date.now()) + 30 * 24 * 60 * 60 * 1000,
      updatedAt: slot.updatedAt || Date.now(),
    };
    this.basicPlatformSlots.set(record.id, record);

    if (!this.indexes.basicPlatformSlotsByUserId.has(record.userId)) {
      this.indexes.basicPlatformSlotsByUserId.set(record.userId, new Map());
    }
    this.indexes.basicPlatformSlotsByUserId.get(record.userId).set(record.slot, record.id);

    this.save();
    return { ...record };
  }

  updateBasicPlatformSlot(slotId, patch) {
    const current = this.basicPlatformSlots.get(slotId);
    if (!current) return null;
    const updated = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this.basicPlatformSlots.set(slotId, updated);
    this.save();
    return { ...updated };
  }

  getBasicPlatformSlotsByUserId(userId) {
    if (!userId) return [];
    const slotMap = this.indexes.basicPlatformSlotsByUserId.get(userId);
    if (!slotMap) return [];
    const list = [];
    for (const slotId of slotMap.values()) {
      const s = this.basicPlatformSlots.get(slotId);
      if (s) list.push({ ...s });
    }
    return list.sort((a, b) => a.slot - b.slot);
  }

  getBasicPlatformSlot(userId, slot) {
    if (!userId) return null;
    const slotMap = this.indexes.basicPlatformSlotsByUserId.get(userId);
    if (!slotMap) return null;
    const slotId = slotMap.get(Number(slot));
    if (!slotId) return null;
    const s = this.basicPlatformSlots.get(slotId);
    return s ? { ...s } : null;
  }

  deleteBasicPlatformSlot(slotId) {
    const slot = this.basicPlatformSlots.get(slotId);
    if (!slot) return false;
    this.basicPlatformSlots.delete(slotId);
    const slotMap = this.indexes.basicPlatformSlotsByUserId.get(slot.userId);
    if (slotMap) {
      slotMap.delete(slot.slot);
      if (slotMap.size === 0) this.indexes.basicPlatformSlotsByUserId.delete(slot.userId);
    }
    this.save();
    return true;
  }

  // ===================================================================
  // User Automation Settings Methods (Phase 14A)
  // ===================================================================

  getAutomationSettings(userId) {
    if (!userId) return null;
    const record = this.automationSettings.get(userId);
    return record ? { ...record } : null;
  }

  upsertAutomationSettings(userId, settings) {
    if (!userId) return null;
    const record = {
      userId,
      settings: JSON.parse(JSON.stringify(settings)),
      updatedAt: Date.now(),
    };
    this.automationSettings.set(userId, record);
    this.save();
    return { ...record };
  }

  deleteAutomationSettings(userId) {
    if (!userId) return false;
    const existed = this.automationSettings.delete(userId);
    if (existed) this.save();
    return existed;
  }

  // --- Personal Coding Analytics (Phase 14B) ---
  // Pure metadata events — NEVER stores source code, cookies, passwords, tokens, or raw HTML.
  insertAnalyticsEvent(event) {
    if (!event || typeof event !== "object" || !event.userId) return null;
    const userId = event.userId;
    const id = event.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Sanitize metadata to enforce strict data minimization
    const record = {
      id,
      userId,
      platform: typeof event.platform === "string" ? event.platform.slice(0, 50).toLowerCase() : "unknown",
      problemSlug: typeof event.problemSlug === "string" ? event.problemSlug.slice(0, 200) : "unknown",
      title: typeof event.title === "string" ? event.title.slice(0, 300) : "Untitled",
      difficulty: typeof event.difficulty === "string" ? event.difficulty.slice(0, 50) : "Unknown",
      language: typeof event.language === "string" ? event.language.slice(0, 50).toLowerCase() : "unknown",
      timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
      action: ["synced", "skipped", "failed"].includes(event.action) ? event.action : "synced",
      syncStatus: typeof event.syncStatus === "string" ? event.syncStatus.slice(0, 50) : "added",
      isUpdate: Boolean(event.isUpdate),
      repositoryTarget: typeof event.repositoryTarget === "string" ? event.repositoryTarget.slice(0, 200) : "",
      skipReason: typeof event.skipReason === "string" ? event.skipReason.slice(0, 300) : null,
      retryCount: typeof event.retryCount === "number" ? Math.max(0, event.retryCount) : 0,
      topics: Array.isArray(event.topics)
        ? event.topics.slice(0, 20).map((t) => String(t).slice(0, 50))
        : typeof event.topics === "string"
        ? [event.topics.slice(0, 50)]
        : [],
    };

    // Strict User-Level Retention Cap: maximum 5,000 events per user to bound disk usage
    if (!this.indexes.analyticsByUserId.has(userId)) {
      this.indexes.analyticsByUserId.set(userId, new Set());
    }
    const userEventIds = this.indexes.analyticsByUserId.get(userId);
    if (userEventIds.size >= 5000) {
      // Find and prune the oldest 500 events for this user
      const sortedEvents = Array.from(userEventIds)
        .map((eid) => this.analyticsEvents.get(eid))
        .filter(Boolean)
        .sort((a, b) => a.timestamp - b.timestamp);
      const toPrune = sortedEvents.slice(0, 500);
      for (const p of toPrune) {
        this.analyticsEvents.delete(p.id);
        userEventIds.delete(p.id);
      }
    }

    this.analyticsEvents.set(id, record);
    userEventIds.add(id);
    this.save();
    return { ...record };
  }

  getAnalyticsEventsByUserId(userId, options = {}) {
    if (!userId) return [];
    const eventIds = this.indexes.analyticsByUserId.get(userId);
    if (!eventIds || eventIds.size === 0) return [];

    const since = typeof options.since === "number" ? options.since : 0;
    const limit = Math.min(Math.max(1, typeof options.limit === "number" ? options.limit : 1000), 5000);

    const results = [];
    for (const eid of eventIds) {
      const ev = this.analyticsEvents.get(eid);
      if (ev && ev.timestamp >= since) {
        results.push({ ...ev });
      }
    }

    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, limit);
  }

  deleteAnalyticsEventsByUserId(userId) {
    if (!userId) return { deleted: false, count: 0 };
    const eventIds = this.indexes.analyticsByUserId.get(userId);
    let count = 0;
    if (eventIds && eventIds.size > 0) {
      for (const eid of eventIds) {
        this.analyticsEvents.delete(eid);
        count++;
      }
      this.indexes.analyticsByUserId.delete(userId);
    }
    // Phase 15C: Also clean up any derived coaching metadata/topic tags
    this.deleteTopicTagsByUserId(userId);
    this.save();
    return { deleted: true, count };
  }

  // --- Derived Coaching Topic Tags (Phase 15C) ---
  // Optional, non-blocking metadata layer with confidence bounds.
  // NEVER stores problem statements, solutions, or source code.
  upsertTopicTag(userId, topic) {
    if (!userId || !topic || typeof topic !== "object") return null;
    const tag = typeof topic.tag === "string" ? topic.tag.toLowerCase().trim().slice(0, 50) : "";
    if (!tag) return null;

    const validConfidences = ["high", "medium", "low"];
    const confidence = validConfidences.includes(topic.confidence) ? topic.confidence : "medium";

    if (!this.topicTags.has(userId)) {
      this.topicTags.set(userId, new Map());
    }
    const userTags = this.topicTags.get(userId);
    const record = {
      tag,
      confidence,
      updatedAt: Date.now(),
    };
    userTags.set(tag, record);
    this.save();
    return { ...record };
  }

  getTopicTagsByUserId(userId, options = {}) {
    if (!userId || !this.topicTags.has(userId)) return [];
    const userTags = this.topicTags.get(userId);
    const tags = Array.from(userTags.values());
    if (options.minConfidence === "high") {
      return tags.filter((t) => t.confidence === "high");
    }
    return tags;
  }

  deleteTopicTagsByUserId(userId) {
    if (!userId || !this.topicTags.has(userId)) return false;
    const existed = this.topicTags.delete(userId);
    if (existed) this.save();
    return existed;
  }

  // --- AI Usage Governance (Phase 15A) ---
  // Tracks metadata only — NEVER stores source code, problem statements, or raw prompts.
  insertAIUsageEvent(event) {
    if (!event || typeof event !== "object" || !event.userId) return null;
    const userId = event.userId;
    const id = event.id || `ai_use_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.now();
    const monthKey = event.monthKey || new Date(timestamp).toISOString().slice(0, 7); // YYYY-MM

    const record = {
      id,
      userId,
      feature: typeof event.feature === "string" ? event.feature.slice(0, 50) : "unknown",
      requestId: typeof event.requestId === "string" ? event.requestId.slice(0, 50) : `ai_${Date.now()}`,
      timestamp,
      monthKey,
      inputTokens: typeof event.inputTokens === "number" ? Math.max(0, event.inputTokens) : 0,
      outputTokens: typeof event.outputTokens === "number" ? Math.max(0, event.outputTokens) : 0,
      totalTokens: typeof event.totalTokens === "number" ? Math.max(0, event.totalTokens) : 0,
      status: ["success", "error", "rate_limited"].includes(event.status) ? event.status : "success",
    };

    if (!this.indexes.aiUsageByUserId.has(userId)) {
      this.indexes.aiUsageByUserId.set(userId, new Set());
    }
    const userUsageIds = this.indexes.aiUsageByUserId.get(userId);
    if (userUsageIds.size >= 5000) {
      const sortedEvents = Array.from(userUsageIds)
        .map((eid) => this.aiUsageEvents.get(eid))
        .filter(Boolean)
        .sort((a, b) => a.timestamp - b.timestamp);
      const toPrune = sortedEvents.slice(0, 500);
      for (const p of toPrune) {
        this.aiUsageEvents.delete(p.id);
        userUsageIds.delete(p.id);
      }
    }

    this.aiUsageEvents.set(id, record);
    userUsageIds.add(id);
    this.save();
    return { ...record };
  }

  getAIUsageEventsByUserId(userId, options = {}) {
    if (!userId) return [];
    const usageIds = this.indexes.aiUsageByUserId.get(userId);
    if (!usageIds || usageIds.size === 0) return [];

    const monthKey = options.monthKey || null;
    const since = typeof options.since === "number" ? options.since : 0;
    const limit = Math.min(Math.max(1, typeof options.limit === "number" ? options.limit : 1000), 5000);

    const results = [];
    for (const eid of usageIds) {
      const ev = this.aiUsageEvents.get(eid);
      if (ev && ev.timestamp >= since) {
        if (!monthKey || ev.monthKey === monthKey) {
          results.push({ ...ev });
        }
      }
    }

    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, limit);
  }

  reset() {
    this.users.clear();
    this.subscriptions.clear();
    this.entitlements.clear();
    this.repositoryTargets.clear();
    this.webhookEvents.clear();
    this.proGrants.clear();
    this.basicPlatformSlots.clear();
    this.automationSettings.clear();
    this.analyticsEvents.clear();
    this.aiUsageEvents.clear();
    this.productTelemetryEvents.clear();
    this.feedbackRecords.clear();
    this.betaAllowlist.clear();
    this.topicTags.clear();
    this.auditEvents = [];
    this.indexes.userByEmail.clear();
    this.indexes.subscriptionByUserId.clear();
    this.indexes.subscriptionByCustomerId.clear();
    this.indexes.subscriptionByProviderSubId.clear();
    this.indexes.subscriptionByStatus.clear();
    this.indexes.repoTargetsByUserId.clear();
    this.indexes.proGrantByUserId.clear();
    this.indexes.basicPlatformSlotsByUserId.clear();
    this.indexes.analyticsByUserId.clear();
    this.indexes.aiUsageByUserId.clear();
    this.indexes.productTelemetryByUserId.clear();
    this.indexes.feedbackByUserId.clear();
  }

  // --- Product Telemetry (Phase 18) ---
  insertProductTelemetryEvent(event) {
    const id = event.eventId || event.id || `ptel_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const userId = event.userId || "anonymous";
    const record = {
      eventId: id,
      userId,
      event: event.event,
      timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
      appVersion: event.appVersion || "1.1.6",
      platform: event.platform || null,
    };

    if (!this.indexes.productTelemetryByUserId.has(userId)) {
      this.indexes.productTelemetryByUserId.set(userId, new Set());
    }
    this.productTelemetryEvents.set(id, record);
    this.indexes.productTelemetryByUserId.get(userId).add(id);
    this.save();
    return { ...record };
  }

  getProductTelemetryEventsByUserId(userId, options = {}) {
    if (!userId) return [];
    const eventIds = this.indexes.productTelemetryByUserId.get(userId);
    if (!eventIds || eventIds.size === 0) return [];
    const since = typeof options.since === "number" ? options.since : 0;
    const limit = Math.min(Math.max(1, typeof options.limit === "number" ? options.limit : 1000), 5000);
    const results = [];
    for (const eid of eventIds) {
      const ev = this.productTelemetryEvents.get(eid);
      if (ev && ev.timestamp >= since) {
        results.push({ ...ev });
      }
    }
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, limit);
  }

  deleteProductTelemetryEventsByUserId(userId) {
    if (!userId) return { deleted: false, count: 0 };
    const eventIds = this.indexes.productTelemetryByUserId.get(userId);
    let count = 0;
    if (eventIds) {
      for (const eid of eventIds) {
        this.productTelemetryEvents.delete(eid);
        count++;
      }
      this.indexes.productTelemetryByUserId.delete(userId);
    }
    this.save();
    return { deleted: true, count };
  }

  pruneProductTelemetry(retentionDays = 90) {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let prunedCount = 0;
    for (const [id, ev] of this.productTelemetryEvents.entries()) {
      if (ev.timestamp < cutoff) {
        this.productTelemetryEvents.delete(id);
        const userSet = this.indexes.productTelemetryByUserId.get(ev.userId);
        if (userSet) userSet.delete(id);
        prunedCount++;
      }
    }
    if (prunedCount > 0) this.save();
    return prunedCount;
  }

  // --- Feedback (Phase 18) ---
  insertFeedback(feedback) {
    const id = feedback.id || `fb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const userId = feedback.userId || "anonymous";
    const record = {
      id,
      userId,
      category: feedback.category || "feedback",
      message: (feedback.message || "").trim(),
      appVersion: feedback.appVersion || "1.1.6",
      platform: feedback.platform || null,
      context: feedback.context || {},
      timestamp: typeof feedback.timestamp === "number" ? feedback.timestamp : Date.now(),
    };
    if (!this.indexes.feedbackByUserId.has(userId)) {
      this.indexes.feedbackByUserId.set(userId, new Set());
    }
    this.feedbackRecords.set(id, record);
    this.indexes.feedbackByUserId.get(userId).add(id);
    this.save();
    return { ...record };
  }

  getFeedbackByUserId(userId) {
    if (!userId) return [];
    const ids = this.indexes.feedbackByUserId.get(userId);
    if (!ids) return [];
    return Array.from(ids).map((id) => ({ ...this.feedbackRecords.get(id) })).filter(Boolean);
  }

  // --- Beta Allowlist (Phase 18 + Phase 19 Revocation) ---
  setBetaStatus(userId, status = {}) {
    if (!userId) return null;
    const existing = this.betaAllowlist.get(userId) || {};
    const record = {
      userId,
      beta_enabled: Boolean(status.beta_enabled),
      beta_revoked: Boolean(status.beta_revoked),
      beta_expires_at: status.beta_expires_at || existing.beta_expires_at || null,
      addedAt: existing.addedAt || status.addedAt || Date.now(),
      revokedAt: status.revokedAt || existing.revokedAt || null,
      updatedAt: new Date().toISOString(),
    };
    this.betaAllowlist.set(userId, record);
    this.save();
    return { ...record };
  }

  getBetaStatus(userId) {
    if (!userId) return { beta_enabled: false, beta_user: false };
    const rec = this.betaAllowlist.get(userId);
    if (!rec) return { beta_enabled: false, beta_user: false };
    // Phase 19: Check revocation
    if (rec.beta_revoked) {
      return { beta_enabled: false, beta_user: true, revoked: true };
    }
    if (rec.beta_expires_at && Date.now() > rec.beta_expires_at) {
      return { beta_enabled: false, beta_user: false, expired: true };
    }
    return {
      beta_enabled: rec.beta_enabled,
      beta_user: true,
      beta_expires_at: rec.beta_expires_at,
    };
  }
}

module.exports = Database;
