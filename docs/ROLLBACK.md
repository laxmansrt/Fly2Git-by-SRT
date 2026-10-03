# Fly2Git — Production Rollback Safety Manual
=============================================

> **Scope**: Standard Operating Procedures (SOP) for emergency rollbacks across Chrome Extension, Cloud Run Backend, AI Gateway, and Database layers during Private Beta and Public Production.
> **Critical Policy**: Dangerous automated rollback without engineer verification is strictly prohibited to prevent cascade thrashing, split-brain states, and data corruption.

---

## 1. Principles of Rollback Safety

1. **Failure Isolation**: Component failures (AI, telemetry, diagnostics, billing) must NEVER cascade into GitHub sync failure.
2. **Deterministic Version Compatibility**: The backend enforces `X-Fly2Git-Version` checks with `MIN_SUPPORTED_CLIENT_VERSION = 1.0.0`. Incompatible extensions receive `426 CLIENT_VERSION_UNSUPPORTED` gracefully.
3. **Additive Schema Migrations**: All database models and serialized collections (`productTelemetryEvents`, `feedbackRecords`, `betaAllowlist`) maintain default fallbacks on deserialization.
4. **No Secret Invalidation on Rollback**: Rolling back an application deployment must never revoke user credentials, active sync tokens, or GitHub App keys.

---

## 2. Extension Rollback Procedures

### 2.1 Chrome Web Store Deployment
Because Chrome Web Store review introduces propagation delays, client-side release management follows strict defensive strategies:

- **Canary / Percentage Rollout**: New versions are deployed to 10% → 25% → 100% of beta users.
- **Rollback via Version Increment**: Chrome Web Store does not allow re-uploading an older version number. To rollback from a faulty `v1.1.7`:
  1. Check out the verified stable commit (e.g., `v1.1.6`).
  2. Bump `manifest.json` and `diagnostics.js` version to `1.1.8` (hotfix rollback).
  3. Run full automated regression suite (`npm test`).
  4. Submit `1.1.8` as an emergency update via Chrome Developer Dashboard.
- **Server-Side Kill Switch**: While waiting for extension store propagation:
  - Disable beta flags via `GET /api/beta/status` (or set `beta_enabled: false` on affected users).
  - Disable AI features globally if necessary by setting `AI_ENABLED=false` in backend environment.

---

## 3. Backend (Cloud Run / Node.js) Rollback Procedures

### 3.1 Revision Rollback
Backend services are hosted in stateless containers on Google Cloud Run with immediate revision switching:

1. **Identify Previous Revision**:
   ```bash
   gcloud run revisions list --service=fly2git-backend --region=us-central1
   ```
2. **Execute Immediate Traffic Shift (Zero Downtime)**:
   ```bash
   gcloud run services update-traffic fly2git-backend \
     --region=us-central1 \
     --to-revisions=fly2git-backend-PREVIOUS_STABLE_REV=100
   ```
3. **Verify Health Endpoint**:
   ```bash
   curl -s -f https://api.fly2git.com/api/health | jq .
   ```
   Must return `status: "healthy"` and `keyId: "fly2git-ed25519-v1"`.

4. **Verify Version Compatibility**:
   Ensure `X-API-Version` and `X-App-Version` headers are properly returned.

---

## 4. AI Gateway & Provider Rollback

Fly2Git uses an abstraction layer (`backend/providers/`) decoupling the extension and core logic from third-party AI APIs.

### 4.1 Degrading to Fallback Provider
If the primary provider (e.g. Gemini) experiences elevated error rates, rate limiting, or service disruption:

1. **Option A: Hot Switch to Alternate / Mock Provider**:
   Update Cloud Run environment variable:
   ```bash
   gcloud run services update fly2git-backend \
     --update-env-vars AI_PROVIDER=mock
   ```
2. **Option B: Graceful Disable of AI Features**:
   ```bash
   gcloud run services update fly2git-backend \
     --update-env-vars AI_ENABLED=false
   ```
3. **Verification**:
   - The backend will return `503 AI_DISABLED` for AI generation endpoints.
   - Core GitHub synchronization and coding activity tracking continue unimpeded.

---

## 5. Database & State Rollback

### 5.1 Storage Model
Fly2Git database uses atomic file write replacement (`fs.writeFileSync(tmpPath); fs.renameSync(tmpPath, realPath)`):
- All new Phase 18 collections (`productTelemetryEvents`, `feedbackRecords`, `betaAllowlist`) have automated memory initialization:
  ```javascript
  this.productTelemetryEvents = new Map();
  this.feedbackRecords = new Map();
  this.betaAllowlist = new Map();
  ```
- Deserialization gracefully skips unrecognized keys or missing fields without throwing.

### 5.2 Backup and Restoration
1. Automated snapshots are taken before any deployment:
   ```bash
   cp data/fly2git_backend.json data/fly2git_backend.json.snapshot_$(date +%s)
   ```
2. In the event of catastrophic data corruption:
   - Stop backend service.
   - Restore snapshot:
     ```bash
     cp data/fly2git_backend.json.snapshot_VERIFIED data/fly2git_backend.json
     ```
   - Restart service and verify user count and subscription state.

---

## 6. Post-Rollback Verification Checklist

- [ ] `GET /api/health` returns HTTP 200 with valid uptime.
- [ ] User authentication (`/api/auth/login`) succeeds.
- [ ] Entitlement service correctly validates Pro/Basic status.
- [ ] Extension syncing successfully commits to GitHub.
- [ ] Product telemetry gracefully skips or records without unhandled exceptions.
- [ ] Support view diagnostics snapshot generates without exposing secrets.

---

## 7. Configuration Rollback

When a configuration drift or erroneous environment variable deployment causes service disruption:

1. **Environment Variables**:
   - Revert modified environment variables to known-stable values using GCP Secret Manager / Cloud Run revision:
     ```bash
     gcloud run services update fly2git-backend \
       --region=us-central1 \
       --update-env-vars AI_ENABLED=true,AI_PROVIDER=gemini,ENTITLEMENT_KEY_ID=fly2git-ed25519-v1
     ```
2. **Feature Flags & Beta Cohorts**:
   - In the event an experimental flag destabilizes users, disable the flag server-side via admin API or DB update without code deployment.
3. **Billing & Stripe Configuration**:
   - Revert webhook secrets or pricing IDs directly in the environment config; existing active subscriptions remain cached in the database.

---

## 8. Bug Triage & Severity Matrix

During beta operations and release candidate testing, all bugs must be triaged according to the severity matrix below. Every reported bug MUST have documented evidence before escalating or initiating rollback.

| Severity | Definition | Target Resolution | Required Action |
|----------|------------|-------------------|-----------------|
| **P0** | Security vulnerability, data loss, secret leakage, or total sync failure | < 2 hours | Immediate hotfix or service rollback; notify affected users |
| **P1** | Major workflow broken (e.g. GitHub OAuth fails for all users, primary platform broken) | < 8 hours | Fast-track patch release; investigate root cause |
| **P2** | Important functionality impaired (e.g. AI Coach timeout, analytics chart render issue) | < 24 hours | Schedule for next release candidate iteration |
| **P3** | Minor issue (e.g. cosmetic UI alignment, non-blocking typo) | Next release cycle | Triage to standard backlog |

### Required Evidence for Every Triage Ticket:
1. **Scrubbed Diagnostic Report**: Copy Diagnostics output from the user.
2. **Platform & URL**: Specific coding platform (e.g. LeetCode, Codeforces) and problem URL.
3. **Timestamp & Error Code**: Exact UTC timestamp and API error response code.
4. **Reproduction Steps**: Step-by-step reproduction path observed or verified by engineer.

