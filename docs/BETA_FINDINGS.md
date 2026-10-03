# Fly2Git — Beta Findings
=========================

## Document Purpose

This document records findings from the Fly2Git private beta pilot.
Observations, reports, and decisions are separated to prevent mixing data with opinions.

---

## OBSERVED

_What was actually observed from system checks, telemetry, and environment verification._

| # | Observation | Source | Date |
|---|------------|--------|------|
| 1 | Production backend host `api.fly2git.com` cannot be resolved via DNS (`curl (6) Could not resolve host`). | Network Diagnostics | 2026-10-03 |
| 2 | `GEMINI_API_KEY` is not present in local environment variables or runtime configuration. | Environment Audit | 2026-10-03 |
| 3 | Automated baseline across 31 test suites is operational with 1,711 passing tests and 0 failures. | Test Runner | 2026-10-03 |
| 4 | No external developer accounts or telemetry logs have connected to the backend database. | Database Audit | 2026-10-03 |
| 5 | Single-repository routing is operational; multi-repository UI is accurately badged "Coming Soon". | Popup UI Audit | 2026-10-03 |

> [!NOTE]
> This section is strictly updated with verified data from environment diagnostics, test runners, or admin dashboard telemetry.

---

## REPORTED

_What users explicitly told us._

| # | Report | Category | Date |
|---|--------|----------|------|
| 1 | _No real user reports received yet — private beta cohort distribution is pending backend deployment._ | — | — |

> [!NOTE]
> This section is strictly updated with direct feedback submitted by real human beta participants. No feedback is fabricated.

---

## INFERRED

_Reasonable interpretation of observed/reported evidence._

| # | Inference | Supporting Evidence |
|---|-----------|-------------------|
| 1 | AI-assisted workflows (Analyze, Explain, Hint, Coach) are currently blocked from live testing until backend Cloud Run deployment and Secret Manager API key configuration are complete. | Observed #1 and Observed #2 (DNS unresolvable, empty key). |
| 2 | Local extension packaging and local Git sync workflows are sound, but human usability (OAuth comfort, notification obstruction, first-sync clarity) requires real cohort deployment. | 31 automated suites passing vs. pending manual checklist. |

> [!WARNING]
> Inferences must be clearly linked to specific observations or reports. Unsupported speculation must be listed under UNKNOWN.

---

## UNKNOWN

_Things we do not have enough evidence to conclude._

- Whether onboarding completion rate exceeds 70% in real developer environments.
- Whether median time to first sync is under 5 minutes from install.
- Whether AI features genuinely improve retention or problem-solving speed.
- Whether users prefer the timeline-based Coding Journey or the aggregate Personal Analytics charts.
- Whether automation rules are discoverable and utilized without explicit tutorials.
- Whether multi-repository support is an immediate requirement for the initial user cohort.

---

## DECISIONS

_Changes selected for the next phase._

| # | Decision | Based On | Priority |
|---|----------|----------|----------|
| 1 | Keep all 17 manual beta scenarios honestly classified (`16 NOT TESTED`, `1 BLOCKED`); do not convert to PASS without real user sessions. | Phase 21 Core Rule: Real human validation cannot be fabricated. | P0 |
| 2 | Deploy Cloud Run backend service and configure Secret Manager for `GEMINI_API_KEY` to unblock Scenario I (AI validation). | Observed #1 & #2 (Unresolvable host, missing key). | P1 |
| 3 | Keep multi-repository UI labeled "Coming Soon" to prevent user confusion during single-repo beta testing. | Observed #5 (Product honesty guarantee). | P2 |

---

## REJECTED IDEAS

_Ideas intentionally not pursued yet._

| # | Idea | Reason |
|---|------|--------|
| 1 | Fabricating user metrics, quotes, or test results | Violates Phase 21 truthfulness and product integrity principles |
| 2 | Adding additional coding platforms before 7-platform beta validation | Prevents scope creep and maintains release focus |
| 3 | Social features, leaderboards, or public profiles | Out of alignment with privacy-first individual practice philosophy |
| 4 | Silent un-gating of multi-repository routing | Features must be genuinely tested before product language changes |
| 5 | Third-party analytics SDKs (Mixpanel, Google Analytics) | Violates zero-sensitive-data and privacy guarantees |
| 6 | Storing raw prompts, AI outputs, or source code in telemetry | Strictly forbidden by telemetry architecture |

---

## SEVERITY DEFINITIONS

| Level | Description |
|-------|-------------|
| P0 | Critical security, data loss, or service failure |
| P1 | Major user workflow broken |
| P2 | Important usability/functionality issue |
| P3 | Minor cosmetic issue |

> [!IMPORTANT]
> Severity must be assigned based on documented evidence, not developer intuition.
