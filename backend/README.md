# Fly2Git Pro Backend — Entitlement Authority & Billing Architecture

Authoritative subscription verification and entitlement service for Fly2Git Pro.

---

## 1. Architectural Overview

```
Extension (Client)
      │
      ├── (1) Checkout Request ────────► Backend API (/api/checkout/create-session)
      │                                       │
      │                                       ▼
      │                               Stripe Provider (Checkout Session)
      │                                       │
      │                                       ▼
      │                               Customer Checkout
      │                                       │
      │   (2) Webhook (HMAC-SHA256)           ▼
      │◄───────────────────────────── Stripe Webhooks (/api/webhooks/payment)
      │                                       │
      │                                       ▼
      │                               Update Subscription & Calculate Entitlement
      │                                       │
      ├── (3) Fetch Verified Entitlement ─────┘
      │       GET /api/entitlement
      │       (Signed with HMAC-SHA256)
      ▼
Client Cache (chrome.storage.local)
      ▼
Fly2GitEntitlements Capabilities
      ▼
Background Enforcement before GitHub Write
```

---

## 2. Security Boundaries & Invariants

1. **Zero Secret Exposure**:
   - The Chrome extension contains **zero** payment secret keys, webhook secrets, database passwords, or server private keys.
   - Payment provider secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) remain 100% server-side.

2. **Server-Authoritative Cryptographic Verification**:
   - Entitlements issued by the server are signed with `ENTITLEMENT_SIGNING_SECRET` using HMAC-SHA256 over canonical fields:
     `${userId}:${plan}:${status}:${billingCycle}:${expiresAt}:${issuedAt}`
   - Any local client tampering with `chrome.storage.local` invalidates the signature and immediately fails closed to the Basic plan.

3. **Webhook Verification & Idempotency**:
   - Webhooks are cryptographically validated against `stripe-signature` timestamp and HMAC-SHA256 digest with 5-minute replay attack tolerance.
   - Processed webhook event IDs (`evt_...`) are persisted; duplicate deliveries are skipped idempotently.

4. **Offline Resilience**:
   - Valid cached entitlements are respected for up to 24 hours.
   - If the backend is unreachable or the cache expires, the extension gracefully defaults to **Basic capabilities**.
   - Core Basic syncing to GitHub **never fails** due to backend downtime.

---

## 3. Data Models

### User
```typescript
interface User {
  id: string; // usr_...
  email: string;
  passwordHash: string; // salt:hash (PBKDF2-SHA512)
  createdAt: string;
  updatedAt: string;
}
```

### Subscription
```typescript
interface Subscription {
  id: string;
  userId: string;
  provider: "stripe";
  providerCustomerId: string;
  providerSubscriptionId: string;
  plan: "pro";
  billingCycle: "monthly" | "yearly";
  status: "active" | "trial" | "past_due" | "canceled" | "expired" | "inactive";
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Entitlement
```typescript
interface Entitlement {
  userId: string;
  version: 1;
  plan: "basic" | "pro";
  status: "active" | "inactive" | "trial" | "expired";
  billingCycle: "monthly" | "yearly" | null;
  expiresAt: number | null;
  features: {
    maxPlatforms: number; // 2 (basic) | Infinity (pro)
    allPlatforms: boolean;
    multipleRepositories: boolean;
    advancedAutomation: boolean;
    analytics: boolean;
    ai: boolean;
  };
  issuedAt: number;
  validUntil: number;
  signature: string; // HMAC-SHA256 hex digest
}
```

### RepositoryTarget (Multi-Repository Architecture Preparation)
```typescript
interface RepositoryTarget {
  id: string;
  userId: string;
  githubOwner: string;
  githubRepo: string;
  platform: string;
  enabled: boolean;
  createdAt: string;
}
```

---

## 4. API Endpoints

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Register new user account with email & password |
| `POST` | `/api/auth/login` | Public | Authenticate user & receive signed Bearer token |
| `GET` | `/api/auth/me` | Bearer | Get authenticated user profile |
| `GET` | `/api/entitlement` | Bearer / Public | Fetch authoritative signed entitlement |
| `POST` | `/api/checkout/create-session` | Bearer | Create payment provider checkout session |
| `POST` | `/api/webhooks/payment` | Signature | Process provider webhook events |
| `POST` | `/api/billing/cancel` | Bearer | Cancel subscription at period end |
| `POST` | `/api/billing/portal` | Bearer | Generate Stripe billing management portal URL |
| `GET` | `/api/repositories/targets` | Bearer | List multi-repository target mappings |
| `POST` | `/api/repositories/targets` | Bearer | Create multi-repository target mapping (Pro only) |
| `GET` | `/api/health` | Public | Service health probe |

---

## 5. Deployment & Environment Variables

Configure the following environment variables in production:

```bash
PORT=3000
NODE_ENV=production
FRONTEND_URL=chrome-extension://amajlnanpmdinabdhieiapdcijgacloh

AUTH_SECRET=hex_encoded_32_byte_secret
ENTITLEMENT_SIGNING_SECRET=hex_encoded_32_byte_secret

PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PAYMENT_PRICE_MONTHLY=price_...
PAYMENT_PRICE_YEARLY=price_...

DATABASE_PATH=/data/fly2git_backend.json
```
