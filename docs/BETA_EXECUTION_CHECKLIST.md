# Fly2Git — Beta Execution Checklist
====================================

Release Candidate: `FLY2GIT_BETA_VERSION = 1.1.6-rc.1`
Extension: `1.1.6`
Backend API: `1.1.0`
AI Config: `1.5.0`
Automated Baseline: `31 suites / 1,711 passed / 0 failed`

> [!IMPORTANT]
> Real user validation has NOT yet occurred.
> Scenarios requiring real developers or live external infrastructure are marked `NOT TESTED` or `BLOCKED`.
> Do NOT fabricate test results, metrics, or user quotes.

---

### Scenario A: New user onboarding
- **Tester ID**: Pending Cohort Assignment (Cohort Target: 5–20 real developers)
- **Date**: 2026-10-03
- **Expected**: User installs extension unpacked/from store, sees Midnight Titanium welcome screen, connects GitHub via OAuth, selects platforms without errors, and lands on clean initial dashboard.
- **Actual**: Package v1.1.6-rc.1 is packaged and ready for installation. Live cohort onboarding session with real developers has not yet taken place.
- **Status**: NOT TESTED
- **Evidence**: `manifest.json` and release bundle prepared; awaiting cohort distribution.
- **Notes**: Must be tested on fresh Chrome browser profile without pre-existing extension storage.

---

### Scenario B: Existing user upgrade
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: Existing user upgrades from v1.0.x / v1.1.x to v1.1.6-rc.1; stored credentials, platform selections, and repository mappings are preserved without migration failure or state loss.
- **Actual**: Automated storage schema backward compatibility passes unit tests (`test_phase12d_security_hardening.js`), but physical upgrade across a populated user profile has not been executed by a human user.
- **Status**: NOT TESTED
- **Evidence**: Schema normalization functions present; live profile migration pending.
- **Notes**: Requires testing on a profile populated with v1.1.0 data.

---

### Scenario C: GitHub connection success
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: User completes GitHub OAuth authorization, token is securely vaulted in background storage, user avatar/handle appears in popup header with repository picker enabled.
- **Actual**: GitHub App client configuration (`Iv23livkIwLTCTML4cDN`) in `config.js` is verified, but live human OAuth sign-in loop not executed in this environment.
- **Status**: NOT TESTED
- **Evidence**: Device flow URL and polling mechanisms verified in `test_repo_picker.js`; live interactive OAuth pending.
- **Notes**: Requires real GitHub user authorizing the Fly2Git GitHub App.

---

### Scenario D: GitHub connection failure
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: On network drop, canceled OAuth dialog, or invalid token exchange, extension gracefully renders inline error message, preserves local settings, and enables "Retry Connection" without crashing.
- **Actual**: Error state handlers in `background.js` and `popup.js` are validated by unit tests, but real-world browser cancellation during device polling has not been manually tested.
- **Status**: NOT TESTED
- **Evidence**: Error fallback UI verified in code inspection; live interruption pending.
- **Notes**: Test by clicking "Cancel" in GitHub OAuth page.

---

### Scenario E: First sync (First Value Moment)
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: User solves their first problem on a supported platform (e.g. LeetCode Two Sum); solution is detected upon Accepted verdict, committed to GitHub repository within 3 seconds, and displays liquid glass success toast.
- **Actual**: Automated submission detection passes across all 7 platform suites, but live human submission on leetcode.com with a live repository has not occurred.
- **Status**: NOT TESTED
- **Evidence**: Platform content scripts active; live platform submission pending.
- **Notes**: First Value Moment is strictly defined as the first successful GitHub commit.

---

### Scenario F: Duplicate sync prevention
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: Submitting identical solution code for an already synced problem does not create redundant Git commits; notification reports solution already up-to-date.
- **Actual**: Deduplication queue verified in `test_phase16_3_notifications.js` and `test_phase16_4_complexity.js`; live duplicate submission on Codeforces/HackerRank pending.
- **Status**: NOT TESTED
- **Evidence**: Deduplication unit tests pass; live submission pending.
- **Notes**: Verify duplicate notification uses `duplicate` type and does not push a new commit.

---

### Scenario G: Updated solution sync
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: Submitting a faster or improved solution for a previously solved problem creates a clean update commit with updated complexity/runtime stats in commit message.
- **Actual**: Commit message updater and runtime stats update tested via mocks, but live human re-submission on platform pending.
- **Status**: NOT TESTED
- **Evidence**: Commit message builder tests pass; live platform submission pending.
- **Notes**: Check commit diff on GitHub to ensure previous file is updated in-place.

---

### Scenario H: Identity mismatch protection
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: If logged-in platform username does not match configured Fly2Git profile identity, Identity Guard prevents accidental commit and prompts user to confirm account switch.
- **Actual**: All 20 tests in `test_identity_guard.js` pass, but live multi-account switching in browser has not been manually validated.
- **Status**: NOT TESTED
- **Evidence**: `identity-guard.js` validated in isolation; live account switch pending.
- **Notes**: Test by logging into CodeChef with a secondary handle.

---

### Scenario I: AI assistance success (Analyze / Explain / Hint / Coach)
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: Pro or quota-eligible user clicks AI Analyze / Hint / Explain; backend contacts Gemini provider securely, validates response schema, and renders Obsidian-styled markdown panel within popup.
- **Actual**: Production backend `https://api.fly2git.com` is unresolvable via DNS and `GEMINI_API_KEY` is not configured in local environment. Real Gemini API calls are blocked.
- **Status**: BLOCKED
- **Evidence**: DNS lookup for `api.fly2git.com` failed (`curl: (6) Could not resolve host`); `process.env.GEMINI_API_KEY` is empty.
- **Notes**: Requires backend Cloud Run deployment and Secret Manager configuration.

---

### Scenario J: AI provider failure / quota exceeded
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: When AI service is offline, model quota is exhausted, or network fails, extension displays friendly fallback banner ("AI currently unavailable"), while core GitHub sync remains 100% operational.
- **Actual**: Fallback banner and strict failure isolation verified in `test_phase15a_ai_architecture.js` and `test_phase16_4_complexity.js`; live 429 quota exhaustion simulation with deployed backend pending.
- **Status**: NOT TESTED
- **Evidence**: UI fallback banner verified in automated test suite.
- **Notes**: Verify sync proceeds uninterrupted even when AI times out.

---

### Scenario K: Personal Analytics dashboard
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: User opens Personal Analytics; dashboard displays platform breakdown, language distribution, and solve trends computed strictly client-side from local sync history.
- **Actual**: SVG rendering and statistics aggregation validated in `test_phase14b_analytics.js` (81 passed); human usability evaluation on real accumulated history pending.
- **Status**: NOT TESTED
- **Evidence**: `analytics.js` unit tests pass; manual visual review pending.
- **Notes**: Verify zero source code or personal identifiers in analytics output.

---

### Scenario L: Coding Journey view
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: User navigates to Coding Journey; timeline displays historical milestones, streaks, and platform diversity chronologically without data corruption.
- **Actual**: Journey milestone logic and DOM structure validated in `test_phase16_premium_ui.js`; human review of multi-day timeline pending.
- **Status**: NOT TESTED
- **Evidence**: Journey view tests pass; live human evaluation pending.
- **Notes**: Ensure milestones do not rank or assign skill levels.

---

### Scenario M: Liquid Glass sync notifications
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: In-page sync overlay renders smoothly on problem submission, shows progress spinner, morphs to success checkmark with commit link, and auto-dismisses after 4 seconds without obstructing editor.
- **Actual**: Liquid Glass styling and lifecycle validated in `test_phase16_3_notifications.js` (76 passed); visual obstruction and click-through on live platform editors pending.
- **Status**: NOT TESTED
- **Evidence**: Notification component automated tests pass; live platform DOM inspection pending.
- **Notes**: Test across both light and dark themes on LeetCode and Codeforces.

---

### Scenario N: Logout and Login cycle
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: Logging out revokes local session, clears sensitive cache, resets UI to disconnected state; subsequent login cleanly restores user repo configurations.
- **Actual**: Session cleanup verified in `test_popup_session_fix.js` (15 passed); manual logout/re-login cycle with human credentials pending.
- **Status**: NOT TESTED
- **Evidence**: Storage clearance unit tests pass; interactive verification pending.
- **Notes**: Ensure no orphaned tokens remain in `chrome.storage.local`.

---

### Scenario O: Offline to Online sync queue
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: Submissions made while offline are queued in storage; upon reconnection, alarm/event listener triggers background retry and syncs queued items without data loss.
- **Actual**: Queue storage serialization verified in `test_phase14a_automation.js` (88 passed); manual network toggle and alarm flush pending.
- **Status**: NOT TESTED
- **Evidence**: Queue handlers tested in automation suite; real network toggle pending.
- **Notes**: Test by disabling WiFi, submitting code, re-enabling WiFi.

---

### Scenario P: Basic tier user constraints
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: Basic user is strictly restricted to 2 active platform slots, cannot access AI Coach, and sees unobtrusive Pro upgrade prompts without aggressive popups.
- **Actual**: Slot enforcement and tier gates verified in `test_phase12a_entitlements.js` and `test_phase13a_platform_slots.js` (108 passed); user friction feedback on 2-slot limit pending.
- **Status**: NOT TESTED
- **Evidence**: Entitlement tests pass; human friction study pending.
- **Notes**: Ensure third platform selection prompts upgrade sheet gracefully.

---

### Scenario Q: Pro tier user capabilities
- **Tester ID**: Pending Cohort Assignment
- **Date**: 2026-10-03
- **Expected**: Pro user (or Pro Grant recipient) enjoys all 7 platforms concurrently, multi-repository routing, AI Coach, and priority sync features.
- **Actual**: Pro entitlement verification and grant signature validation pass in `test_phase14_pro_grants.js` (149 passed); human feedback on Pro features pending.
- **Status**: NOT TESTED
- **Evidence**: Cryptographic grant verification tests pass; human tester session pending.
- **Notes**: Verify multi-repo routing UI displays "Coming Soon" badge per Phase 20 specifications.
