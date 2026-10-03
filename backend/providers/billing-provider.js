// Fly2Git Backend — Billing Provider Abstraction (Phase 12C)
// Decouples billing operations from specific payment vendors.

class BillingProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Creates a checkout session URL for purchasing a plan.
   * @param {Object} params - { userId, userEmail, plan, billingCycle, successUrl, cancelUrl }
   * @returns {Promise<{ sessionId: string, url: string }>}
   */
  async createCheckout(_params) {
    throw new Error("createCheckout must be implemented by billing provider");
  }

  /**
   * Retrieves current subscription details from provider.
   * @param {string} _subscriptionId
   */
  async getSubscription(_subscriptionId) {
    throw new Error("getSubscription must be implemented by billing provider");
  }

  /**
   * Cancels a subscription at provider.
   * @param {string} _subscriptionId
   * @param {Object} _options - { atPeriodEnd: boolean }
   */
  async cancelSubscription(_subscriptionId, _options = {}) {
    throw new Error("cancelSubscription must be implemented by billing provider");
  }

  /**
   * Verifies the authenticity of an incoming webhook payload using provider signatures.
   * @param {string|Buffer} _rawPayload
   * @param {string} _signatureHeader
   * @returns {boolean}
   */
  verifyWebhook(_rawPayload, _signatureHeader) {
    throw new Error("verifyWebhook must be implemented by billing provider");
  }

  /**
   * Parses and normalizes incoming provider webhook events.
   * @param {Object} _event
   * @returns {Object} normalized event
   */
  handleWebhook(_event) {
    throw new Error("handleWebhook must be implemented by billing provider");
  }
}

module.exports = BillingProvider;
