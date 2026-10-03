// Fly2Git Backend — Basic Platform Slot Service (Phase 13A)
// Authoritative backend management of Basic 2-platform slots and 30-day cooldown governance.
// NEVER trust client-supplied timestamps, cooldowns, or plan states.

const ACTIVE_PLATFORMS = Object.freeze([
  "leetcode",
  "geeksforgeeks",
  "hackerrank",
  "codechef",
  "atcoder",
  "codeforces",
  "spoj",
]);

const INACTIVE_PLATFORMS = Object.freeze(["usaco"]);

const VALID_SLOTS = Object.freeze([1, 2]);

const SLOT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

class PlatformSlotService {
  constructor(database) {
    this.db = database;
  }

  /**
   * Retrieves the authoritative platform slots for a user.
   * If the user does not have slots initialized, creates the initial 2 slots immediately.
   * @param {string} userId - Canonical user ID
   * @param {string} currentPlan - Current authoritative plan ("basic" | "pro")
   * @returns {Array} Array of 2 slot objects
   */
  getSlots(userId, currentPlan = "basic") {
    if (!userId || typeof userId !== "string") {
      return [];
    }

    let slots = this.db.getBasicPlatformSlotsByUserId(userId);

    // Initial setup if user has no slots
    if (slots.length === 0) {
      slots = this.initializeDefaultSlots(userId);
    } else if (slots.length === 1) {
      // Repair if somehow only 1 slot exists
      const existing = slots[0];
      const otherSlotNum = existing.slot === 1 ? 2 : 1;
      const defaultOtherPlatform = existing.platform === "leetcode" ? "geeksforgeeks" : "leetcode";
      const now = Date.now();
      this.db.insertBasicPlatformSlot({
        userId,
        slot: otherSlotNum,
        platform: defaultOtherPlatform,
        activatedAt: now,
        nextChangeAt: now + SLOT_COOLDOWN_MS,
      });
      slots = this.db.getBasicPlatformSlotsByUserId(userId);
    }

    return slots.map((s) => ({
      slot: s.slot,
      platform: s.platform,
      activatedAt: s.activatedAt,
      nextChangeAt: s.nextChangeAt,
    }));
  }

  /**
   * Initializes default slots for a new Basic user.
   * Initial selection is immediately usable and starts the 30-day cooldown.
   * @param {string} userId
   * @param {Array<string>} [initialPlatforms]
   * @param {object} [options]
   * @returns {Array}
   */
  initializeDefaultSlots(userId, initialPlatforms = ["leetcode", "geeksforgeeks"], options = {}) {
    const now = typeof options.activatedAt === "number" ? options.activatedAt : Date.now();
    const cooldownMs = typeof options.cooldownMs === "number" ? options.cooldownMs : SLOT_COOLDOWN_MS;
    const nextChangeAt = typeof options.nextChangeAt === "number" ? options.nextChangeAt : now + cooldownMs;

    const p1 = (initialPlatforms[0] && ACTIVE_PLATFORMS.includes(initialPlatforms[0]))
      ? initialPlatforms[0]
      : "leetcode";
    let p2 = (initialPlatforms[1] && ACTIVE_PLATFORMS.includes(initialPlatforms[1]))
      ? initialPlatforms[1]
      : "geeksforgeeks";

    if (p1 === p2) {
      p2 = p1 === "leetcode" ? "geeksforgeeks" : "leetcode";
    }

    const slot1 = this.db.insertBasicPlatformSlot({
      userId,
      slot: 1,
      platform: p1,
      activatedAt: now,
      nextChangeAt,
    });

    const slot2 = this.db.insertBasicPlatformSlot({
      userId,
      slot: 2,
      platform: p2,
      activatedAt: now,
      nextChangeAt,
    });

    return [slot1, slot2];
  }

  /**
   * Migrates legacy Basic users with selectedPlatforms array to the 2-slot model.
   * MIGRATION POLICY:
   * Existing platforms are preserved. Since legacy users already had their platforms active,
   * their slots are marked with activatedAt = (now - 30 days) and nextChangeAt = now so they
   * are immediately editable and not unfairly locked for 30 days upon migration.
   * @param {string} userId
   * @param {Array<string>} selectedPlatforms
   * @returns {Array} Migrated slots
   */
  migrateLegacyUser(userId, selectedPlatforms = []) {
    const existing = this.db.getBasicPlatformSlotsByUserId(userId);
    if (existing.length >= 2) {
      return existing;
    }

    const sanitized = [];
    if (Array.isArray(selectedPlatforms)) {
      for (const p of selectedPlatforms) {
        if (typeof p === "string" && ACTIVE_PLATFORMS.includes(p.toLowerCase()) && !sanitized.includes(p.toLowerCase())) {
          sanitized.push(p.toLowerCase());
          if (sanitized.length === 2) break;
        }
      }
    }

    const p1 = sanitized[0] || "leetcode";
    const p2 = sanitized[1] || (p1 === "leetcode" ? "geeksforgeeks" : "leetcode");

    const now = Date.now();
    // Grant immediate editability to legacy users upon migration
    const legacyActivatedAt = now - SLOT_COOLDOWN_MS;
    const legacyNextChangeAt = now;

    return this.initializeDefaultSlots(userId, [p1, p2], {
      activatedAt: legacyActivatedAt,
      nextChangeAt: legacyNextChangeAt,
    });
  }

  /**
   * Authoritatively changes a platform slot for a user.
   * Enforces:
   * 1. Valid slot (1 or 2)
   * 2. Valid active platform
   * 3. Same platform -> no-op (does not reset cooldown)
   * 4. Duplicate platform across slots -> PLATFORM_ALREADY_SELECTED (does not reset cooldown)
   * 5. Cooldown check: if now < nextChangeAt and not Pro -> PLATFORM_CHANGE_COOLDOWN
   * 6. Pro users bypass cooldown completely
   * @param {object} params
   * @param {string} params.userId - Authenticated user ID
   * @param {number} params.slot - Slot number (1 or 2)
   * @param {string} params.platform - Target platform identifier
   * @param {number} [params.now] - Server time override (for testing)
   * @param {boolean} [params.isPro] - Authoritative Pro status
   * @returns {object} Result with updated slot and full platformSlots
   */
  changeSlot({ userId, slot, platform, now = Date.now(), isPro = false }) {
    // ---- 1. Input Validation ----
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required");
      err.statusCode = 400;
      throw err;
    }

    const slotNum = Number(slot);
    if (!VALID_SLOTS.includes(slotNum)) {
      const err = new Error(`Invalid slot '${slot}'. Basic plan has exactly 2 slots (1 or 2).`);
      err.statusCode = 400;
      throw err;
    }

    if (!platform || typeof platform !== "string") {
      const err = new Error("platform is required and must be a string");
      err.statusCode = 400;
      throw err;
    }

    const normalizedPlatform = platform.trim().toLowerCase();

    // Check for inactive platforms (e.g. USACO)
    if (INACTIVE_PLATFORMS.includes(normalizedPlatform)) {
      const err = new Error(`Platform '${normalizedPlatform}' is inactive and cannot be selected.`);
      err.statusCode = 400;
      throw err;
    }

    // Check for supported active platforms
    if (!ACTIVE_PLATFORMS.includes(normalizedPlatform)) {
      const err = new Error(
        `Invalid platform '${normalizedPlatform}'. Must be one of: ${ACTIVE_PLATFORMS.join(", ")}`
      );
      err.statusCode = 400;
      throw err;
    }

    // Ensure slots are initialized
    this.getSlots(userId);

    const currentSlot = this.db.getBasicPlatformSlot(userId, slotNum);
    if (!currentSlot) {
      const err = new Error(`Slot ${slotNum} not found for user`);
      err.statusCode = 404;
      throw err;
    }

    const otherSlotNum = slotNum === 1 ? 2 : 1;
    const otherSlot = this.db.getBasicPlatformSlot(userId, otherSlotNum);

    // ---- Rule 8: Same Platform (No-op) ----
    if (currentSlot.platform === normalizedPlatform) {
      return {
        ok: true,
        noop: true,
        slot: {
          slot: currentSlot.slot,
          platform: currentSlot.platform,
          activatedAt: currentSlot.activatedAt,
          nextChangeAt: currentSlot.nextChangeAt,
        },
        platformSlots: this.getSlots(userId),
      };
    }

    // ---- Rule 7: Duplicate Platform Protection ----
    if (otherSlot && otherSlot.platform === normalizedPlatform) {
      const err = new Error(
        `Platform '${normalizedPlatform}' is already assigned to Slot ${otherSlotNum}. Each slot must have a distinct platform.`
      );
      err.statusCode = 400;
      err.code = "PLATFORM_ALREADY_SELECTED";
      throw err;
    }

    // ---- Rule 6: Switching & Cooldown Enforcement ----
    const currentTime = typeof now === "number" ? now : Date.now();

    if (!isPro && currentTime < currentSlot.nextChangeAt) {
      const err = new Error("Platform change is on cooldown");
      err.statusCode = 429;
      err.code = "PLATFORM_CHANGE_COOLDOWN";
      err.slot = slotNum;
      err.currentPlatform = currentSlot.platform;
      err.requestedPlatform = normalizedPlatform;
      err.nextChangeAt = currentSlot.nextChangeAt;
      throw err;
    }

    // ---- Permitted Change ----
    const activatedAt = currentTime;
    const nextChangeAt = currentTime + SLOT_COOLDOWN_MS;

    const updated = this.db.updateBasicPlatformSlot(currentSlot.id, {
      platform: normalizedPlatform,
      activatedAt,
      nextChangeAt,
    });

    // Record audit event
    this.db.recordAuditEvent({
      action: "platform_slot_changed",
      userId,
      slot: slotNum,
      previousPlatform: currentSlot.platform,
      newPlatform: normalizedPlatform,
      activatedAt,
      nextChangeAt,
      isPro: Boolean(isPro),
      timestamp: currentTime,
    });

    const fullSlots = this.getSlots(userId);

    return {
      ok: true,
      slot: {
        slot: updated.slot,
        platform: updated.platform,
        activatedAt: updated.activatedAt,
        nextChangeAt: updated.nextChangeAt,
      },
      platformSlots: fullSlots,
    };
  }
}

module.exports = {
  PlatformSlotService,
  ACTIVE_PLATFORMS,
  INACTIVE_PLATFORMS,
  VALID_SLOTS,
  SLOT_COOLDOWN_MS,
};
