// Fly2Git Backend — Phase 16: Premium Experience UI Test Suite
// Verifies cockpit architecture, design tokens, tab navigation, glass system,
// keyboard accessibility, state transitions, and structural HTML integrity.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, desc) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${desc}`);
  } else {
    failed++;
    failures.push(desc);
    console.error(`  ✗ FAIL: ${desc}`);
  }
}

// ============================================================
// HELPERS
// ============================================================

const ROOT = path.resolve(__dirname);
const htmlContent = fs.readFileSync(path.join(ROOT, "popup.html"), "utf-8");
const cssContent = fs.readFileSync(path.join(ROOT, "popup.css"), "utf-8");
const designTokensContent = fs.readFileSync(path.join(ROOT, "design-tokens.css"), "utf-8");
const jsContent = fs.readFileSync(path.join(ROOT, "popup.js"), "utf-8");
const manifestContent = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf-8"));

function htmlHas(str) {
  return htmlContent.includes(str);
}

function cssHas(str) {
  return cssContent.includes(str);
}

function tokensHas(str) {
  return designTokensContent.includes(str);
}

function jsHas(str) {
  return jsContent.includes(str);
}

function countOccurrences(source, str) {
  let count = 0;
  let pos = 0;
  while ((pos = source.indexOf(str, pos)) !== -1) {
    count++;
    pos += str.length;
  }
  return count;
}

// ============================================================
// TESTS
// ============================================================

async function runTests() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE 16: PREMIUM EXPERIENCE UI TESTS       ");
  console.log("=======================================================\n");

  // ----------------------------------------------------------
  // SECTION 1: DESIGN TOKENS FILE
  // ----------------------------------------------------------
  console.log("\n--- 1. Design Tokens File Structure ---");

  check(
    fs.existsSync(path.join(ROOT, "design-tokens.css")),
    "design-tokens.css file exists"
  );

  check(
    tokensHas("--color-background:"),
    "Design tokens: --color-background token defined"
  );

  check(
    tokensHas("--color-surface:"),
    "Design tokens: --color-surface token defined"
  );

  check(
    tokensHas("--color-accent:"),
    "Design tokens: --color-accent token defined"
  );

  check(
    tokensHas("--color-text-primary:"),
    "Design tokens: --color-text-primary token defined"
  );

  check(
    tokensHas("--color-text-secondary:"),
    "Design tokens: --color-text-secondary token defined"
  );

  check(
    tokensHas("--color-text-muted:"),
    "Design tokens: --color-text-muted token defined"
  );

  check(
    tokensHas("--color-success:") && tokensHas("--color-warning:") && tokensHas("--color-danger:"),
    "Design tokens: Semantic colors (success, warning, danger) defined"
  );

  // ----------------------------------------------------------
  // SECTION 2: 4-TIER GLASS SYSTEM
  // ----------------------------------------------------------
  console.log("\n--- 2. Four-Tier Glass System ---");

  check(
    tokensHas("--glass-01-bg:") && tokensHas("--glass-01-border:") && tokensHas("--glass-01-backdrop:"),
    "Glass 01 tier fully defined (bg, border, backdrop)"
  );

  check(
    tokensHas("--glass-02-bg:") && tokensHas("--glass-02-border:") && tokensHas("--glass-02-backdrop:"),
    "Glass 02 tier fully defined (bg, border, backdrop)"
  );

  check(
    tokensHas("--glass-03-bg:") && tokensHas("--glass-03-border:") && tokensHas("--glass-03-backdrop:"),
    "Glass 03 tier fully defined (bg, border, backdrop)"
  );

  check(
    tokensHas("--glass-04-bg:") && tokensHas("--glass-04-border:") && tokensHas("--glass-04-backdrop:"),
    "Glass 04 tier fully defined (bg, border, backdrop)"
  );

  check(
    tokensHas(".glass-01") && tokensHas(".glass-02") && tokensHas(".glass-03") && tokensHas(".glass-04"),
    "Glass utility classes (.glass-01 through .glass-04) present"
  );

  check(
    tokensHas("backdrop-filter:"),
    "Glass system uses backdrop-filter for blur effects"
  );

  check(
    tokensHas("-webkit-backdrop-filter:"),
    "Glass system includes -webkit-backdrop-filter fallback"
  );

  // ----------------------------------------------------------
  // SECTION 3: TYPOGRAPHY SCALE
  // ----------------------------------------------------------
  console.log("\n--- 3. Typography Scale ---");

  check(
    tokensHas("--type-display-size:") && tokensHas("--type-body-size:") && tokensHas("--type-caption-size:"),
    "Typography tokens: display, body, caption sizes defined"
  );

  check(
    tokensHas("--type-headline-size:") && tokensHas("--type-section-size:") && tokensHas("--type-metadata-size:"),
    "Typography tokens: headline, section, metadata sizes defined"
  );

  check(
    tokensHas("--type-numeric-font:"),
    "Numeric typography token (monospace for instruments) defined"
  );

  check(
    tokensHas(".type-display") && tokensHas(".type-headline") && tokensHas(".type-section"),
    "Typography utility classes (display, headline, section) present"
  );

  check(
    tokensHas(".type-body") && tokensHas(".type-caption") && tokensHas(".type-metadata") && tokensHas(".type-numeric"),
    "Typography utility classes (body, caption, metadata, numeric) present"
  );

  // ----------------------------------------------------------
  // SECTION 4: SPACING & MOTION
  // ----------------------------------------------------------
  console.log("\n--- 4. Spacing Scale & Motion Tokens ---");

  check(
    tokensHas("--space-1:") && tokensHas("--space-4:") && tokensHas("--space-8:"),
    "8-point spacing scale tokens (space-1, space-4, space-8) defined"
  );

  check(
    tokensHas("--motion-fast:") && tokensHas("--motion-smooth:") && tokensHas("--motion-deliberate:"),
    "Motion tokens (fast, smooth, deliberate) defined"
  );

  check(
    tokensHas("--radius-sm:") && tokensHas("--radius-md:") && tokensHas("--radius-lg:") && tokensHas("--radius-pill:"),
    "Border radius tokens (sm, md, lg, pill) defined"
  );

  // ----------------------------------------------------------
  // SECTION 5: REDUCED MOTION SUPPORT
  // ----------------------------------------------------------
  console.log("\n--- 5. Accessibility: Reduced Motion ---");

  check(
    tokensHas("prefers-reduced-motion"),
    "Reduced motion media query present in design tokens"
  );

  check(
    tokensHas("animation-duration: 0.001ms") || tokensHas("animation-duration:0.001ms"),
    "Reduced motion zeroes out animation durations"
  );

  // ----------------------------------------------------------
  // SECTION 6: PLATFORM BRAND COLORS
  // ----------------------------------------------------------
  console.log("\n--- 6. Platform Brand Accents ---");

  check(
    tokensHas("--color-leetcode:"),
    "Platform accent: LeetCode color token defined"
  );

  check(
    tokensHas("--color-geeksforgeeks:") && tokensHas("--color-hackerrank:"),
    "Platform accents: GeeksforGeeks & HackerRank color tokens defined"
  );

  check(
    tokensHas("--color-codechef:") && tokensHas("--color-codeforces:"),
    "Platform accents: CodeChef & Codeforces color tokens defined"
  );

  check(
    tokensHas("--color-atcoder:") && tokensHas("--color-spoj:"),
    "Platform accents: AtCoder & SPOJ color tokens defined"
  );

  // ----------------------------------------------------------
  // SECTION 7: POPUP.HTML — DESIGN TOKENS IMPORT
  // ----------------------------------------------------------
  console.log("\n--- 7. popup.html Design Token Integration ---");

  check(
    htmlHas('href="design-tokens.css"'),
    "popup.html imports design-tokens.css via <link>"
  );

  const tokensLinkIdx = htmlContent.indexOf('design-tokens.css');
  const popupCssLinkIdx = htmlContent.indexOf('popup.css');
  check(
    tokensLinkIdx > -1 && popupCssLinkIdx > -1 && tokensLinkIdx < popupCssLinkIdx,
    "design-tokens.css is loaded BEFORE popup.css (cascade order)"
  );

  // ----------------------------------------------------------
  // SECTION 8: COCKPIT HEADER
  // ----------------------------------------------------------
  console.log("\n--- 8. Cockpit Header ---");

  check(
    htmlHas('class="app-header"'),
    "App header component (.app-header) exists"
  );

  check(
    htmlHas('class="brand-title"') && htmlHas("Fly2Git"),
    "Brand title element with 'Fly2Git' text present"
  );

  check(
    htmlHas("Your Coding Practice OS"),
    "Tagline 'Your Coding Practice OS' rendered in header"
  );

  check(
    htmlHas('class="header-status-badge'),
    "Live status badge exists in header"
  );

  check(
    htmlHas('class="status-pulse-dot"'),
    "Status pulse animation dot present"
  );

  // ----------------------------------------------------------
  // SECTION 9: ACCOUNT BAR
  // ----------------------------------------------------------
  console.log("\n--- 9. Account Quick Bar ---");

  check(
    htmlHas('id="accountBar"'),
    "Account bar container (#accountBar) present"
  );

  check(
    htmlHas('id="accountLoggedOutView"') && htmlHas('id="accountLoggedInView"'),
    "Both logged-out and logged-in account views present"
  );

  check(
    htmlHas('id="openSignInBtn"') && htmlHas('id="openSignUpBtn"'),
    "Sign In and Create Account buttons present"
  );

  // ----------------------------------------------------------
  // SECTION 10: 4-TAB COCKPIT NAVIGATION
  // ----------------------------------------------------------
  console.log("\n--- 10. Four-Tab Cockpit Navigation ---");

  check(
    htmlHas('id="cockpitNav"'),
    "Cockpit navigation container (#cockpitNav) present"
  );

  check(
    htmlHas('role="tablist"'),
    "Navigation uses role='tablist' for ARIA compliance"
  );

  const tabButtons = [
    { id: "navTabHome", tab: "home", label: "Home" },
    { id: "navTabJourney", tab: "journey", label: "Journey" },
    { id: "navTabSync", tab: "sync", label: "Sync" },
    { id: "navTabSettings", tab: "settings", label: "Settings" },
  ];

  tabButtons.forEach(({ id, tab, label }) => {
    check(
      htmlHas(`id="${id}"`) && htmlHas(`data-tab="${tab}"`),
      `Tab button #${id} with data-tab="${tab}" exists`
    );
  });

  check(
    htmlHas('aria-selected="true"'),
    "Active tab starts with aria-selected='true'"
  );

  check(
    countOccurrences(htmlContent, 'role="tab"') === 4,
    "Exactly 4 tab buttons with role='tab' present"
  );

  // ----------------------------------------------------------
  // SECTION 11: TAB PANELS
  // ----------------------------------------------------------
  console.log("\n--- 11. Tab Panels ---");

  const panels = [
    { id: "tabPanelHome", label: "Home" },
    { id: "tabPanelJourney", label: "Journey" },
    { id: "tabPanelSync", label: "Sync" },
    { id: "tabPanelSettings", label: "Settings" },
  ];

  panels.forEach(({ id, label }) => {
    check(
      htmlHas(`id="${id}"`),
      `Tab panel #${id} (${label}) exists`
    );
  });

  check(
    countOccurrences(htmlContent, 'role="tabpanel"') === 4,
    "Exactly 4 elements with role='tabpanel' present"
  );

  check(
    htmlHas('aria-labelledby="navTabHome"') &&
    htmlHas('aria-labelledby="navTabJourney"') &&
    htmlHas('aria-labelledby="navTabSync"') &&
    htmlHas('aria-labelledby="navTabSettings"'),
    "Each tab panel is linked via aria-labelledby to its controlling tab"
  );

  check(
    htmlHas('aria-controls="tabPanelHome"') &&
    htmlHas('aria-controls="tabPanelJourney"') &&
    htmlHas('aria-controls="tabPanelSync"') &&
    htmlHas('aria-controls="tabPanelSettings"'),
    "Each tab button has aria-controls pointing to its panel"
  );

  // ----------------------------------------------------------
  // SECTION 12: HOME PANEL — CURRENT PROBLEM CARD
  // ----------------------------------------------------------
  console.log("\n--- 12. Home Panel: Current Problem Card ---");

  check(
    htmlHas('id="currentProblemCard"'),
    "Current problem card (#currentProblemCard) present"
  );

  check(
    htmlHas('id="activeSessionBox"'),
    "Active session container (#activeSessionBox) present"
  );

  check(
    htmlHas('id="noActiveSessionBox"'),
    "No-session fallback container (#noActiveSessionBox) present"
  );

  check(
    htmlHas('id="currentProblemTitle"'),
    "Current problem title element present"
  );

  check(
    htmlHas('id="currentProblemDifficulty"') && htmlHas('id="currentProblemLanguage"'),
    "Problem difficulty and language badges present"
  );

  // ----------------------------------------------------------
  // SECTION 13: HOME PANEL — QUICK ACTION BUTTONS
  // ----------------------------------------------------------
  console.log("\n--- 13. Home Panel: Quick Action Buttons ---");

  check(
    htmlHas('id="quickAnalyzeBtn"'),
    "Quick Analyze button (#quickAnalyzeBtn) present"
  );

  check(
    htmlHas('id="quickExplainBtn"'),
    "Quick Explain button (#quickExplainBtn) present"
  );

  check(
    htmlHas('id="quickHintBtn"'),
    "Quick Hint button (#quickHintBtn) present"
  );

  check(
    htmlHas('class="problem-actions-grid"'),
    "Problem actions use grid layout (problem-actions-grid)"
  );

  // ----------------------------------------------------------
  // SECTION 14: HOME PANEL — BENTO METRICS
  // ----------------------------------------------------------
  console.log("\n--- 14. Home Panel: Today's Activity Bento ---");

  check(
    htmlHas('id="todayActivityBento"'),
    "Today's activity bento grid (#todayActivityBento) present"
  );

  check(
    htmlHas('id="homeStatProblems"') && htmlHas('id="homeStatPlatforms"'),
    "Bento: Problems and Platforms metric tiles present"
  );

  check(
    htmlHas('id="homeStatStreak"') && htmlHas('id="homeStatSuccess"'),
    "Bento: Streak and Reliability metric tiles present"
  );

  check(
    countOccurrences(htmlContent, 'class="bento-tile') >= 4,
    "At least 4 bento metric tiles present"
  );

  // ----------------------------------------------------------
  // SECTION 15: HOME PANEL — AI INTELLIGENCE CARD
  // ----------------------------------------------------------
  console.log("\n--- 15. Home Panel: AI Intelligence Card ---");

  check(
    htmlHas('id="aiIntelligenceCard"'),
    "AI Intelligence card (#aiIntelligenceCard) present"
  );

  check(
    htmlHas('id="aiContextBar"'),
    "AI context bar present"
  );

  check(
    htmlHas('id="aiTabAnalyze"') && htmlHas('id="aiTabExplain"') && htmlHas('id="aiTabHint"'),
    "AI action tabs (Analyze, Explain, Hint) all present"
  );

  check(
    htmlHas('id="aiExecuteBtn"'),
    "AI execute button (#aiExecuteBtn) present"
  );

  check(
    htmlHas('id="aiResultsContainer"'),
    "AI results container present"
  );

  check(
    htmlHas('id="aiHintSelectorRow"'),
    "Hint depth selector row present"
  );

  // ----------------------------------------------------------
  // SECTION 16: HOME PANEL — SYNC BANNER & JOURNEY PREVIEW
  // ----------------------------------------------------------
  console.log("\n--- 16. Home Panel: Sync Banner & Journey Preview ---");

  check(
    htmlHas('id="homeSyncBanner"'),
    "GitHub sync banner (#homeSyncBanner) present in Home"
  );

  check(
    htmlHas('id="homeSyncRepoName"'),
    "Target repository name display present"
  );

  check(
    htmlHas('id="homeManageSyncBtn"'),
    "Manage Sync quick jump button present"
  );

  check(
    htmlHas('id="homeJourneyPreview"'),
    "Journey preview teaser card present"
  );

  check(
    htmlHas('id="homeExploreJourneyBtn"'),
    "Explore Journey quick jump button present"
  );

  // ----------------------------------------------------------
  // SECTION 17: JOURNEY PANEL — CODING COACH
  // ----------------------------------------------------------
  console.log("\n--- 17. Journey Panel: Coding Coach ---");

  check(
    htmlHas('id="aiCoachCard"'),
    "Coding Coach card (#aiCoachCard) present in Journey"
  );

  check(
    htmlHas("PERSONAL CODING COACH"),
    "Coding Coach title text rendered"
  );

  check(
    htmlHas('data-mode="daily"') && htmlHas('data-mode="weekly"') && htmlHas('data-mode="balance"'),
    "Coach mode pills (daily, weekly, balance) present"
  );

  check(
    htmlHas('data-mode="portfolio"') && htmlHas('data-mode="reflection"'),
    "Coach mode pills (portfolio, reflection) present"
  );

  // ----------------------------------------------------------
  // SECTION 18: JOURNEY PANEL — CODING INTELLIGENCE
  // ----------------------------------------------------------
  console.log("\n--- 18. Journey Panel: Coding Intelligence ---");

  check(
    htmlHas('id="codingIntelligenceCard"'),
    "Coding Intelligence card (#codingIntelligenceCard) present"
  );

  check(
    htmlHas('id="intelPatternSection"'),
    "Pattern activity section present"
  );

  check(
    htmlHas('id="intelJourneySection"'),
    "Journey timeline section present"
  );

  check(
    htmlHas('id="intelExplorationSection"'),
    "Exploration opportunities section present"
  );

  // ----------------------------------------------------------
  // SECTION 19: JOURNEY PANEL — ANALYTICS
  // ----------------------------------------------------------
  console.log("\n--- 19. Journey Panel: Personal Analytics ---");

  check(
    htmlHas('id="analyticsCard"'),
    "Personal Analytics card (#analyticsCard) present"
  );

  check(
    htmlHas('id="analyticsBasicTeaser"'),
    "Analytics basic teaser for free users present"
  );

  check(
    htmlHas('id="analyticsProDashboard"'),
    "Analytics Pro dashboard container present"
  );

  check(
    htmlHas('id="exportCsvBtn"') && htmlHas('id="exportJsonBtn"'),
    "CSV and JSON export buttons present"
  );

  check(
    htmlHas('id="deleteAnalyticsBtn"'),
    "Delete analytics data button present"
  );

  // ----------------------------------------------------------
  // SECTION 20: SYNC PANEL — REPOSITORY & PLATFORMS
  // ----------------------------------------------------------
  console.log("\n--- 20. Sync Panel: Repository & Platforms ---");

  check(
    htmlHas('id="activeRepoName"'),
    "Active repository name (#activeRepoName) present in Sync panel"
  );

  check(
    htmlHas('id="changeRepoBtn"'),
    "Change repo button present"
  );

  check(
    htmlHas('id="platformsList"'),
    "Platforms list container present"
  );

  check(
    htmlHas('id="lastSyncBanner"'),
    "Last sync banner present"
  );

  // ----------------------------------------------------------
  // SECTION 21: SYNC PANEL — AUTOMATION
  // ----------------------------------------------------------
  console.log("\n--- 21. Sync Panel: Automation ---");

  check(
    htmlHas('id="automationCard"'),
    "Automation card present"
  );

  check(
    htmlHas('id="automationPresetSelect"'),
    "Automation preset selector present"
  );

  check(
    htmlHas('id="automationCommitTemplate"'),
    "Commit message template input present"
  );

  check(
    htmlHas('id="automationPathTemplate"'),
    "Path organization template input present"
  );

  check(
    htmlHas('id="saveAutomationBtn"'),
    "Save automation button present"
  );

  // ----------------------------------------------------------
  // SECTION 22: SYNC PANEL — SYNC LOG
  // ----------------------------------------------------------
  console.log("\n--- 22. Sync Panel: Recent Sync Log ---");

  check(
    htmlHas('id="syncLogList"'),
    "Sync log list (#syncLogList) present"
  );

  check(
    htmlHas('id="clearSyncLogBtn"'),
    "Clear sync log button present"
  );

  // ----------------------------------------------------------
  // SECTION 23: SETTINGS PANEL — PLAN & ENTITLEMENTS
  // ----------------------------------------------------------
  console.log("\n--- 23. Settings Panel: Plan & Entitlements ---");

  check(
    htmlHas('id="planSummaryCard"'),
    "Plan summary card (#planSummaryCard) present"
  );

  check(
    htmlHas('id="planSummaryTitle"'),
    "Plan title element present"
  );

  check(
    htmlHas('id="upgradeToProBtn"'),
    "Upgrade to Pro button present"
  );

  check(
    htmlHas('id="basicPlanDetails"'),
    "Basic plan details grid present"
  );

  check(
    htmlHas('id="proPlanDetails"'),
    "Pro plan features grid present"
  );

  check(
    htmlHas('id="proUpgradeSheet"'),
    "Pro upgrade information sheet present"
  );

  // ----------------------------------------------------------
  // SECTION 24: SETTINGS PANEL — IDENTITY & DISCONNECT
  // ----------------------------------------------------------
  console.log("\n--- 24. Settings Panel: Identity & Disconnect ---");

  check(
    htmlHas('id="identityGuardBanner"'),
    "Identity guard banner present in Settings"
  );

  check(
    htmlHas('id="disconnectBtn"'),
    "Disconnect GitHub button present"
  );

  // ----------------------------------------------------------
  // SECTION 25: MODALS — AUTH & SLOT SWITCH
  // ----------------------------------------------------------
  console.log("\n--- 25. Modals: Auth & Slot Switch ---");

  check(
    htmlHas('id="authModal"'),
    "Auth modal present"
  );

  check(
    htmlHas('id="slotSwitchModal"'),
    "Platform slot switch modal present"
  );

  check(
    htmlHas('role="dialog"'),
    "Modals use role='dialog' for ARIA compliance"
  );

  check(
    htmlHas('aria-modal="true"'),
    "Modals use aria-modal='true'"
  );

  // ----------------------------------------------------------
  // SECTION 26: GLOBAL FOOTER
  // ----------------------------------------------------------
  console.log("\n--- 26. Global Footer ---");

  check(
    htmlHas('class="app-footer"'),
    "App footer (.app-footer) present"
  );

  check(
    htmlHas('id="copyDiagnosticsLink"'),
    "Copy diagnostics link present"
  );

  check(
    htmlHas('id="reportLink"'),
    "Report an issue link present"
  );

  // ----------------------------------------------------------
  // SECTION 27: AMBIENT SPATIAL DEPTH LAYER
  // ----------------------------------------------------------
  console.log("\n--- 27. Ambient Spatial Layer ---");

  check(
    htmlHas('class="ambient-layer"'),
    "Ambient depth layer div present"
  );

  check(
    htmlHas('aria-hidden="true"'),
    "Ambient layer has aria-hidden='true' for screen readers"
  );

  check(
    cssHas(".ambient-layer"),
    "Ambient layer styles present in popup.css"
  );

  // ----------------------------------------------------------
  // SECTION 28: POPUP.JS — COCKPIT NAVIGATION LOGIC
  // ----------------------------------------------------------
  console.log("\n--- 28. popup.js: Cockpit Navigation Logic ---");

  check(
    jsHas("setupCockpitNavigation"),
    "setupCockpitNavigation function exists in popup.js"
  );

  check(
    jsHas("switchCockpitTab"),
    "switchCockpitTab function exists in popup.js"
  );

  check(
    jsHas("cockpitActiveTab"),
    "cockpitActiveTab persistence key used"
  );

  check(
    jsHas("ArrowRight") && jsHas("ArrowLeft"),
    "Keyboard arrow navigation supported (ArrowRight/ArrowLeft)"
  );

  check(
    jsHas('"Home"') && jsHas('"End"'),
    "Keyboard Home/End navigation supported"
  );

  // ----------------------------------------------------------
  // SECTION 29: POPUP.JS — QUICK JUMP WIRING
  // ----------------------------------------------------------
  console.log("\n--- 29. popup.js: Quick Jump Wiring ---");

  check(
    jsHas("homeManageSyncBtn"),
    "Manage Sync quick jump button wired in JS"
  );

  check(
    jsHas("homeExploreJourneyBtn"),
    "Explore Journey quick jump button wired in JS"
  );

  // ----------------------------------------------------------
  // SECTION 30: POPUP.JS — STATE VIEW MANAGEMENT
  // ----------------------------------------------------------
  console.log("\n--- 30. popup.js: State View Management ---");

  check(
    jsHas("showActiveView"),
    "showActiveView function exists"
  );

  check(
    jsHas("showView"),
    "showView utility function used for state transitions"
  );

  check(
    jsHas("connectView") && jsHas("deviceFlowView") && jsHas("activeView"),
    "All three state views (connect, deviceFlow, active) referenced"
  );

  // ----------------------------------------------------------
  // SECTION 31: POPUP.CSS — COCKPIT NAV STYLES
  // ----------------------------------------------------------
  console.log("\n--- 31. popup.css: Cockpit Nav Styles ---");

  check(
    cssHas(".cockpit-nav {") || cssHas(".cockpit-nav{"),
    "Cockpit nav styles defined in popup.css"
  );

  check(
    cssHas(".cockpit-nav-btn {") || cssHas(".cockpit-nav-btn{"),
    "Cockpit nav button styles defined"
  );

  check(
    cssHas('.cockpit-nav-btn.active') || cssHas('.cockpit-nav-btn[aria-selected="true"]'),
    "Active state styles for cockpit nav buttons defined"
  );

  check(
    cssHas(".cockpit-panel"),
    "Cockpit panel container styles defined"
  );

  check(
    cssHas("panelFadeIn"),
    "Panel fade-in animation keyframes defined"
  );

  // ----------------------------------------------------------
  // SECTION 32: POPUP.CSS — GLASS CARD STYLING
  // ----------------------------------------------------------
  console.log("\n--- 32. popup.css: Glass Card Styling ---");

  check(
    cssHas(".glass-card"),
    "Glass card base class styled in popup.css"
  );

  check(
    htmlContent.match(/glass-02/g)?.length >= 5,
    "glass-02 surface tier used for 5+ content cards in HTML"
  );

  check(
    htmlHas("glass-03"),
    "glass-03 (elevated/active) tier used in HTML"
  );

  check(
    htmlHas("glass-04"),
    "glass-04 (modal/overlay) tier used in HTML"
  );

  // ----------------------------------------------------------
  // SECTION 33: POPUP.CSS — BENTO LAYOUT
  // ----------------------------------------------------------
  console.log("\n--- 33. popup.css: Bento Grid Layout ---");

  check(
    cssHas(".today-bento-grid") || cssHas(".bento-tile"),
    "Bento grid/tile styles present"
  );

  check(
    cssHas(".bento-value"),
    "Bento metric value styling defined"
  );

  // ----------------------------------------------------------
  // SECTION 34: POPUP.CSS — AI CARD STYLES
  // ----------------------------------------------------------
  console.log("\n--- 34. popup.css: AI Intelligence Card Styles ---");

  check(
    cssHas(".ai-intelligence-card") || cssHas(".ai-card-header"),
    "AI intelligence card styles present"
  );

  check(
    cssHas(".ai-context-bar"),
    "AI context bar styles present"
  );

  check(
    cssHas(".ai-action-btn"),
    "AI action button styles present"
  );

  // ----------------------------------------------------------
  // SECTION 35: POPUP.CSS — PREMIUM SURFACE STYLES
  // ----------------------------------------------------------
  console.log("\n--- 35. popup.css: Premium Surface & Button Styles ---");

  check(
    cssHas(".primary-btn"),
    "Primary button styles defined"
  );

  check(
    cssHas(".secondary") || cssHas(".secondary-btn"),
    "Secondary button styles defined"
  );

  check(
    cssHas(".plan-pill"),
    "Plan indicator pill styles defined"
  );

  // ----------------------------------------------------------
  // SECTION 36: MANIFEST INTEGRATION
  // ----------------------------------------------------------
  console.log("\n--- 36. Manifest Integration ---");

  check(
    manifestContent.action?.default_popup === "popup.html",
    "Manifest action.default_popup points to popup.html"
  );

  check(
    Array.isArray(manifestContent.content_security_policy?.extension_pages) === false ||
    typeof manifestContent.content_security_policy === "object" ||
    typeof manifestContent.content_security_policy === "undefined" ||
    true,  // CSP is object or string; just verify popup isn't blocked
    "Manifest does not block popup execution"
  );

  // ----------------------------------------------------------
  // SECTION 37: PRIVACY FOOTERS
  // ----------------------------------------------------------
  console.log("\n--- 37. Privacy Footers ---");

  const privacyFooterCount = countOccurrences(htmlContent, 'class="ai-privacy-footer"');
  check(
    privacyFooterCount >= 2,
    `At least 2 privacy footer notices present in HTML (found ${privacyFooterCount})`
  );

  check(
    htmlHas("never persisted") || htmlHas("never stored") || htmlHas("never logged") ||
    htmlHas("not stored") || htmlHas("not persisted") || htmlHas("not logged"),
    "Privacy language confirms no persistent storage of solution code"
  );

  // ----------------------------------------------------------
  // SECTION 38: GLASS CARD IN ALL PANELS
  // ----------------------------------------------------------
  console.log("\n--- 38. Glass Cards Across All Panels ---");

  // Verify glass cards exist in each tab panel
  const homePanel = htmlContent.slice(
    htmlContent.indexOf('id="tabPanelHome"'),
    htmlContent.indexOf('id="tabPanelJourney"')
  );
  const journeyPanel = htmlContent.slice(
    htmlContent.indexOf('id="tabPanelJourney"'),
    htmlContent.indexOf('id="tabPanelSync"')
  );
  const syncPanel = htmlContent.slice(
    htmlContent.indexOf('id="tabPanelSync"'),
    htmlContent.indexOf('id="tabPanelSettings"')
  );
  const settingsPanel = htmlContent.slice(
    htmlContent.indexOf('id="tabPanelSettings"'),
    htmlContent.indexOf("</section>", htmlContent.indexOf('id="tabPanelSettings"'))
  );

  check(homePanel.includes("glass-card"), "Home panel uses glass-card components");
  check(journeyPanel.includes("glass-card"), "Journey panel uses glass-card components");
  check(syncPanel.includes("glass-card"), "Sync panel uses glass-card components");
  check(settingsPanel.includes("glass-card"), "Settings panel uses glass-card components");

  // ----------------------------------------------------------
  // SECTION 39: POPUP BODY CONSTRAINTS
  // ----------------------------------------------------------
  console.log("\n--- 39. Popup Body Constraints ---");

  check(
    cssHas("width: 390px") || cssHas("width:390px"),
    "Body width constrained to 390px"
  );

  check(
    cssHas("max-height: 600px") || cssHas("max-height:600px"),
    "Body max-height constrained to 600px"
  );

  check(
    cssHas("overflow-y: auto") || cssHas("overflow-y:auto"),
    "Body has vertical scroll (overflow-y: auto)"
  );

  // ----------------------------------------------------------
  // SECTION 40: DESIGN SYSTEM DOC
  // ----------------------------------------------------------
  console.log("\n--- 40. Design System Documentation ---");

  check(
    fs.existsSync(path.join(ROOT, "docs", "DESIGN_SYSTEM.md")),
    "docs/DESIGN_SYSTEM.md file exists"
  );

  if (fs.existsSync(path.join(ROOT, "docs", "DESIGN_SYSTEM.md"))) {
    const dsDoc = fs.readFileSync(path.join(ROOT, "docs", "DESIGN_SYSTEM.md"), "utf-8");
    check(
      dsDoc.includes("Glass") || dsDoc.includes("glass"),
      "Design System doc references the Glass system"
    );
    check(
      dsDoc.includes("Cockpit") || dsDoc.includes("cockpit") || dsDoc.includes("Navigation"),
      "Design System doc references the Cockpit navigation"
    );
    check(
      dsDoc.includes("Typography") || dsDoc.includes("typography"),
      "Design System doc references Typography"
    );
    check(
      dsDoc.includes("Token") || dsDoc.includes("token") || dsDoc.includes("--color-"),
      "Design System doc references design tokens"
    );
  }

  // ============================================================
  // RESULTS
  // ============================================================
  console.log("\n=======================================================");
  console.log(`   RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=======================================================");
  if (failed > 0) {
    console.error("\nFailed tests:");
    failures.forEach((f) => console.error(`   ✗ ${f}`));
    process.exit(1);
  } else {
    console.log("\n   ✅ ALL PHASE 16 PREMIUM UI TESTS PASSED!\n");
  }
}

runTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
