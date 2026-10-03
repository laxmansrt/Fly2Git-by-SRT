// Fly2Git Backend — Automation Service (Phase 14A)
// Authoritative backend management of Pro Advanced Automation settings.
// Enforces:
// 1. Pro-only customization boundary (Basic users strictly receive 403 PRO_REQUIRED)
// 2. Strict server-side settings validation and schema clamping
// 3. User isolation (users can only access their own settings)
// 4. Audit logging on modification

const {
  validateSettings,
  DEFAULT_AUTOMATION_SETTINGS,
} = require("../../automation-rules");

class AutomationService {
  constructor(database, entitlementService) {
    this.db = database;
    this.entitlementService = entitlementService;
  }

  /**
   * Retrieves automation settings for an authenticated user.
   * Pro users receive their saved custom settings or default settings.
   * Basic users receive default settings with isPro: false.
   * @param {string} userId - Canonical user ID
   * @returns {Promise<object>}
   */
  async getSettings(userId) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required");
      err.statusCode = 400;
      throw err;
    }

    const ent = await this.entitlementService.getAuthoritativeEntitlement(userId);
    const isPro = ent.plan === "pro" && (ent.status === "active" || ent.status === "trial");

    if (!isPro) {
      return {
        isPro: false,
        settings: JSON.parse(JSON.stringify(DEFAULT_AUTOMATION_SETTINGS)),
        updatedAt: null,
      };
    }

    const record = this.db.getAutomationSettings(userId);
    if (!record) {
      return {
        isPro: true,
        settings: JSON.parse(JSON.stringify(DEFAULT_AUTOMATION_SETTINGS)),
        updatedAt: null,
      };
    }

    return {
      isPro: true,
      settings: validateSettings(record.settings),
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Saves automation settings for an authenticated user.
   * Strictly enforces that only Pro users can save custom automation settings.
   * @param {string} userId - Canonical user ID
   * @param {object} rawSettings - Incoming untrusted settings
   * @returns {Promise<object>}
   */
  async saveSettings(userId, rawSettings) {
    if (!userId || typeof userId !== "string") {
      const err = new Error("userId is required");
      err.statusCode = 400;
      throw err;
    }

    const ent = await this.entitlementService.getAuthoritativeEntitlement(userId);
    const isPro = ent.plan === "pro" && (ent.status === "active" || ent.status === "trial");

    if (!isPro) {
      const err = new Error("Advanced Automation is a Pro feature. Please upgrade to Pro to customize automation rules.");
      err.statusCode = 403;
      err.code = "PRO_REQUIRED";
      throw err;
    }

    const validated = validateSettings(rawSettings);

    const record = this.db.upsertAutomationSettings(userId, validated);

    // Audit event
    this.db.recordAuditEvent({
      action: "automation_settings_updated",
      userId,
      preset: validated.preset,
      timestamp: Date.now(),
    });

    return {
      ok: true,
      isPro: true,
      settings: validated,
      updatedAt: record.updatedAt,
    };
  }
}

module.exports = {
  AutomationService,
};
