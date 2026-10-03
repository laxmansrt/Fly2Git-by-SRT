# Fly2Git — Private Beta Specification & Product Validation Guide
================================================================

## 1. Beta Objective

The primary objective of the Fly2Git Private Beta is **product friction discovery**, not vanity metrics or maximum event logging.

We validate:
- **Onboarding Experience**: From Chrome Web Store install to GitHub connection.
- **GitHub Connection**: Device code authorization speed and repo selection.
- **Platform Selection**: Seamless single platform choice (Basic) or multi-platform (Pro).
- **First Sync**: Reliability of initial solution capture and commit push.
- **Repeat Usage**: Frictionless background sync across daily practice sessions.
- **AI Assist Usage**: Clarifications, explanations, and hints without latency degradation.
- **Analytics & Journey**: Exploration of practice history without skill-scoring judgment.
- **Error Recovery**: Transparent guidance when GitHub, AI, or network are unavailable.

---

## 2. Onboarding Workflow (First-Run Experience)

The onboarding flow is strictly focused on immediate developer value:
- **Step 1: Welcome**: Value proposition (automated coding practice portfolio).
- **Step 2: Connect GitHub**: One-time OAuth device flow; minimal scope permissions.
- **Step 3: Choose Platforms**: Select practice platforms (LeetCode, HackerRank, Codeforces).
- **Step 4: Start Coding**: Immediate redirection to solve problems without dashboard clutter.

Advanced features (Personal Analytics, AI Coach, Coding Intelligence, Automation Rules) are introduced naturally after the initial sync.

---

## 3. First Value Moment & Activation

- **First Value Moment (FVM)**: The first successful commit created in the user's GitHub repository from an accepted coding solution.
- **Metric**: `timeToFirstSync` (timestamp of install to timestamp of first sync).
- **Activation Definition**: A successful GitHub sync completed after onboarding.
  - *Non-activations*: Merely opening the popup, switching tabs, or viewing settings does **not** count as product activation.

---

## 4. Product Telemetry Architecture

Product Telemetry is **strictly separated** from Personal Coding Analytics.

### 4.1 Schema
Telemetry events are constrained to:
```json
{
  "eventId": "ptel_...",
  "userId": "usr_...",
  "event": "first_sync",
  "timestamp": 1727800000000,
  "appVersion": "1.1.6",
  "platform": "leetcode"
}
```

### 4.2 Allowed Events (Strict 12-Event Allowlist)
1. `onboarding_started`
2. `onboarding_completed`
3. `github_connected`
4. `platform_selected`
5. `first_sync`
6. `sync_error`
7. `ai_used`
8. `journey_opened`
9. `analytics_opened`
10. `settings_opened`
11. `upgrade_viewed`
12. `feedback_submitted`

### 4.3 Zero Sensitive Data Guarantee
Product telemetry **strictly excludes**:
- Source code or diffs
- Problem statements or descriptions
- AI prompts or generated answers
- GitHub tokens, API keys, or cookies
- Keystrokes or browsing history

---

## 5. Privacy Control & User Opt-Out

- Setting: `productTelemetryEnabled` (Default: `true`).
- User-facing control: *"Help improve Fly2Git"* toggle located in Settings under **Privacy & Telemetry**.
- When disabled:
  - Telemetry recording is immediately halted client-side and server-side.
  - Core synchronization, AI access, personal analytics, and billing remain 100% operational.
  - The preference is never silently re-enabled.

---

## 6. Feedback & Support System

### 6.1 Feedback Endpoint (`POST /api/feedback`)
- Bounded input: Maximum 2,000 characters.
- Categories: `bug`, `confusing`, `feature_request`, `feedback`.
- Secure attribution: Feedback is tied to authenticated user session server-side; client cannot spoof arbitrary user IDs.

### 6.2 Post-Sync Feedback
- Non-blocking, lightweight toast triggered after key sync milestones: *"How was that sync?" (👍 Good / 👎 Issue)*.
- Dismissable, never interrupts problem-solving or coding workflow.

### 6.3 Safe Diagnostics (`diagnostics.js`)
- Generates a scrubbed technical summary for debugging support.
- Automatically strips tokens, keys, and session cookies via regex scrubbing.
- Single-click `[ Copy Diagnostics ]` in extension Settings and popup footer.

---

## 7. Data Retention & Deletion Policy

- **Retention Window**: Configurable via `PRODUCT_TELEMETRY_RETENTION_DAYS` (Default: `90` days).
- **Automated Pruning**: Telemetry older than 90 days is purged by the backend service.
- **User Privacy Deletion**: `DELETE /api/product-telemetry` purges all product telemetry for the authenticated user without affecting repositories, commits, personal analytics, or account state.

---

## 8. Beta Rollout & Access Governance

- **Server-Side Allowlist**: Managed via `beta_enabled`, `beta_user`, and `beta_expires_at`.
- **Feature Flags**: Controlled server-side (`betaTelemetry`, `betaAI`, `betaCoach`, `betaIntelligence`).
- **Entitlement Authority**: Feature flags control rollout availability only. User entitlement (Basic vs Pro) remains strictly authoritative.

---

## 9. Known Limitations (Private Beta)

1. **Platform Breadth**: LeetCode, HackerRank, Codeforces, and CodeChef are primary targets; niche competitive platforms will be evaluated post-beta.
2. **Offline Queuing**: Solutions submitted during extended network outages queue locally in Chrome storage until connectivity resumes.
3. **No Social/Public Leaderboards**: Fly2Git is focused exclusively on personal developer mastery and private repository sync.
