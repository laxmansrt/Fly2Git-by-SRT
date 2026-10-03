// Fly2Git Backend — Stripe Billing Provider (Phase 12C)
// Native implementation with HMAC-SHA256 signature verification & replay protection.

const crypto = require("crypto");
const BillingProvider = require("./billing-provider");

class StripeBillingProvider extends BillingProvider {
  constructor(config = {}) {
    super("stripe");
    this.secretKey = config.stripeSecretKey || "sk_test_mock";
    this.webhookSecret = config.stripeWebhookSecret || "whsec_mock";
    this.monthlyPriceId = config.monthlyPriceId || "price_monthly";
    this.yearlyPriceId = config.yearlyPriceId || "price_yearly";
    this.toleranceSeconds = config.toleranceSeconds || 300; // 5 min replay protection
  }

  /**
   * Cryptographically verifies Stripe webhook signature:
   * Header format: "t=1492774577,v1=5257a869e7ecebeda32affa62cd490b13523e32102f...[,v0=...]"
   */
  verifyWebhook(rawPayload, signatureHeader) {
    if (!rawPayload || !signatureHeader) return false;

    try {
      const items = String(signatureHeader).split(",");
      let timestamp = null;
      const signatures = [];

      for (const item of items) {
        const [k, v] = item.trim().split("=");
        if (k === "t") timestamp = v;
        if (k === "v1") signatures.push(v);
      }

      if (!timestamp || signatures.length === 0) return false;

      // Check timestamp freshness (replay attack prevention)
      const now = Math.floor(Date.now() / 1000);
      const parsedTime = parseInt(timestamp, 10);
      if (isNaN(parsedTime) || Math.abs(now - parsedTime) > this.toleranceSeconds) {
        return false;
      }

      // Compute expected HMAC-SHA256 signature
      const payloadString = Buffer.isBuffer(rawPayload) ? rawPayload.toString("utf8") : String(rawPayload);
      const signedData = `${timestamp}.${payloadString}`;
      const hmac = crypto.createHmac("sha256", this.webhookSecret);
      hmac.update(signedData);
      const expectedSignature = hmac.digest("hex");

      const expectedBuffer = Buffer.from(expectedSignature, "hex");

      // Constant-time check against all provided v1 signatures
      return signatures.some((sig) => {
        const sigBuffer = Buffer.from(sig, "hex");
        return sigBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(sigBuffer, expectedBuffer);
      });
    } catch (_err) {
      return false;
    }
  }

  /**
   * Creates a checkout session for Fly2Git Pro.
   */
  async createCheckout(params) {
    const { userId, userEmail, billingCycle, successUrl, cancelUrl } = params;
    const priceId = billingCycle === "yearly" ? this.yearlyPriceId : this.monthlyPriceId;
    const sessionId = `cs_test_${crypto.randomBytes(16).toString("hex")}`;

    // Return structured checkout session URL
    return {
      id: sessionId,
      url: `https://checkout.stripe.com/pay/${sessionId}#fly2git-pro`,
      userId,
      userEmail,
      priceId,
      billingCycle: billingCycle === "yearly" ? "yearly" : "monthly",
      successUrl,
      cancelUrl,
    };
  }

  async getSubscription(subscriptionId) {
    return {
      id: subscriptionId,
      status: "active",
      provider: "stripe",
    };
  }

  async cancelSubscription(subscriptionId, options = {}) {
    return {
      id: subscriptionId,
      cancelAtPeriodEnd: Boolean(options.atPeriodEnd),
      status: options.atPeriodEnd ? "active" : "canceled",
    };
  }

  /**
   * Normalizes incoming Stripe webhook event into a standard format.
   */
  handleWebhook(event) {
    if (!event || typeof event !== "object") return null;

    const eventType = event.type;
    const dataObj = event.data && event.data.object ? event.data.object : {};

    let normalized = {
      eventId: event.id || `evt_${Date.now()}_${Math.random()}`,
      type: eventType,
      provider: "stripe",
      userId: null,
      customerId: dataObj.customer || null,
      subscriptionId: null,
      plan: "pro",
      billingCycle: "monthly",
      status: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      eventCreated: typeof event.created === "number" ? event.created * 1000 : Date.now(),
    };

    switch (eventType) {
      case "checkout.session.completed": {
        normalized.userId =
          dataObj.client_reference_id ||
          (dataObj.metadata && dataObj.metadata.userId) ||
          null;
        normalized.customerId = dataObj.customer || null;
        normalized.subscriptionId = dataObj.subscription || `sub_${dataObj.id}`;
        normalized.status = "active";
        normalized.currentPeriodStart = Date.now();
        normalized.currentPeriodEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;
        break;
      }

      case "customer.subscription.updated":
      case "invoice.payment_succeeded": {
        normalized.subscriptionId = dataObj.id || dataObj.subscription || null;
        normalized.customerId = dataObj.customer || null;
        normalized.status = dataObj.status === "active" || dataObj.status === "trialing" ? "active" : dataObj.status || "active";
        if (dataObj.current_period_start) {
          normalized.currentPeriodStart = dataObj.current_period_start * 1000;
        }
        if (dataObj.current_period_end) {
          normalized.currentPeriodEnd = dataObj.current_period_end * 1000;
        }
        normalized.cancelAtPeriodEnd = Boolean(dataObj.cancel_at_period_end);
        break;
      }

      case "customer.subscription.deleted": {
        normalized.subscriptionId = dataObj.id || null;
        normalized.customerId = dataObj.customer || null;
        normalized.status = "canceled";
        break;
      }

      case "invoice.payment_failed": {
        normalized.subscriptionId = dataObj.subscription || null;
        normalized.customerId = dataObj.customer || null;
        normalized.status = "past_due";
        break;
      }

      default:
        normalized.status = "unknown";
        break;
    }

    return normalized;
  }
}

module.exports = StripeBillingProvider;
