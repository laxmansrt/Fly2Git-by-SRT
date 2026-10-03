// Fly2Git Backend — Billing Service (Phase 12C)
// Coordinates billing operations, checkout, webhooks, and entitlement synchronization.

class BillingService {
  constructor(database, billingProvider, entitlementService) {
    this.db = database;
    this.provider = billingProvider;
    this.entitlementService = entitlementService;
  }

  /**
   * Creates a checkout session for an authenticated user.
   */
  async createCheckoutSession(userId, options = {}) {
    const user = this.db.getUserById(userId);
    if (!user) throw new Error("User not found");

    const session = await this.provider.createCheckout({
      userId: user.id,
      userEmail: user.email,
      billingCycle: options.billingCycle || "monthly",
      successUrl: options.successUrl || "https://fly2git.com/checkout/success",
      cancelUrl: options.cancelUrl || "https://fly2git.com/checkout/cancel",
    });

    console.log(`[Fly2Git][Billing] Checkout session created for user ${user.id} (${options.billingCycle || "monthly"})`);
    return session;
  }

  /**
   * Processes an incoming payment provider webhook with signature verification and idempotency.
   */
  async processWebhook(rawPayload, signatureHeader) {
    // 1. Verify cryptographic signature
    const isValid = this.provider.verifyWebhook(rawPayload, signatureHeader);
    if (!isValid) {
      console.warn("[Fly2Git][Billing] Webhook signature verification failed");
      const err = new Error("Invalid webhook signature");
      err.statusCode = 400;
      throw err;
    }

    // 2. Parse event payload
    let event = null;
    try {
      event = typeof rawPayload === "string" ? JSON.parse(rawPayload) : JSON.parse(rawPayload.toString("utf8"));
    } catch (_err) {
      const err = new Error("Malformed webhook JSON");
      err.statusCode = 400;
      throw err;
    }

    const normalized = this.provider.handleWebhook(event);
    if (!normalized || normalized.status === "unknown") {
      console.log(`[Fly2Git][Billing] Webhook event ${event.type || "unknown"} safely ignored`);
      return { ok: true, ignored: true };
    }

    // 3. Webhook idempotency check
    if (this.db.hasWebhookEvent(normalized.eventId)) {
      console.log(`[Fly2Git][Billing] Webhook ${normalized.eventId} already processed (idempotent skip)`);
      return { ok: true, duplicate: true };
    }

    // Record event to guarantee idempotency
    this.db.recordWebhookEvent(normalized.eventId, {
      provider: normalized.provider,
      type: normalized.type,
    });

    // 4. Update subscription state based on normalized event
    let targetUserId = normalized.userId;

    if (!targetUserId && normalized.customerId) {
      const existingSub = this.db.getSubscriptionByCustomerId(normalized.customerId);
      if (existingSub) targetUserId = existingSub.userId;
    }

    if (!targetUserId && normalized.subscriptionId) {
      const existingSub = this.db.getSubscriptionByProviderSubId(normalized.subscriptionId);
      if (existingSub) targetUserId = existingSub.userId;
    }

    if (targetUserId) {
      let existingSub = this.db.getSubscriptionByUserId(targetUserId);

      // Out-of-order webhook guard: reject older events that arrive after newer ones
      if (existingSub && existingSub.lastEventTimestamp && normalized.eventCreated) {
        if (normalized.eventCreated < existingSub.lastEventTimestamp) {
          console.warn(
            `[Fly2Git][Billing] Out-of-order webhook ignored: eventCreated ${normalized.eventCreated} < existing ${existingSub.lastEventTimestamp}`
          );
          return { ok: true, ignored: true, outOfOrder: true, eventId: normalized.eventId };
        }
      }

      const eventTime = normalized.eventCreated || Date.now();

      if (!existingSub) {
        existingSub = this.db.insertSubscription({
          id: `sub_${normalized.subscriptionId || Date.now()}`,
          userId: targetUserId,
          provider: normalized.provider,
          providerCustomerId: normalized.customerId,
          providerSubscriptionId: normalized.subscriptionId,
          plan: normalized.plan,
          billingCycle: normalized.billingCycle,
          status: normalized.status,
          currentPeriodStart: normalized.currentPeriodStart,
          currentPeriodEnd: normalized.currentPeriodEnd,
          cancelAtPeriodEnd: normalized.cancelAtPeriodEnd,
          lastEventTimestamp: eventTime,
        });
      } else {
        this.db.updateSubscription(existingSub.id, {
          providerSubscriptionId: normalized.subscriptionId || existingSub.providerSubscriptionId,
          plan: normalized.plan || existingSub.plan,
          billingCycle: normalized.billingCycle || existingSub.billingCycle,
          status: normalized.status,
          currentPeriodStart: normalized.currentPeriodStart || existingSub.currentPeriodStart,
          currentPeriodEnd: normalized.currentPeriodEnd || existingSub.currentPeriodEnd,
          cancelAtPeriodEnd:
            typeof normalized.cancelAtPeriodEnd === "boolean"
              ? normalized.cancelAtPeriodEnd
              : existingSub.cancelAtPeriodEnd,
          lastEventTimestamp: Math.max(existingSub.lastEventTimestamp || 0, eventTime),
        });
      }

      // 5. Update and sign user's authoritative entitlement
      await this.entitlementService.getAuthoritativeEntitlement(targetUserId);
      console.log(`[Fly2Git][Billing] Updated entitlement for user ${targetUserId} to status: ${normalized.status}`);
    }

    return { ok: true, processed: true, eventId: normalized.eventId };
  }

  /**
   * Requests subscription cancellation at period end.
   */
  async cancelSubscription(userId) {
    const sub = this.db.getSubscriptionByUserId(userId);
    if (!sub) throw new Error("No active subscription found");

    await this.provider.cancelSubscription(sub.providerSubscriptionId, { atPeriodEnd: true });
    this.db.updateSubscription(sub.id, { cancelAtPeriodEnd: true });

    // Refresh entitlement
    return this.entitlementService.getAuthoritativeEntitlement(userId);
  }

  /**
   * Generates a customer billing management portal URL.
   */
  async createCustomerPortalSession(userId) {
    const sub = this.db.getSubscriptionByUserId(userId);
    const customerId = sub ? sub.providerCustomerId : "cus_mock";
    return {
      url: `https://billing.stripe.com/p/session/portal_${customerId}`,
    };
  }
}

module.exports = BillingService;
