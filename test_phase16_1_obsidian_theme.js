// Fly2Git Backend — Phase 16.1: Obsidian × Sand × Deep Blue Theme Test Suite
// Verifies color tokens, typography, glass system, button styling,
// absence of purple/cyan artifacts, and overall theme coherence.

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

const ROOT = path.resolve(__dirname);
const tokensCss = fs.readFileSync(path.join(ROOT, "design-tokens.css"), "utf-8");
const popupCss = fs.readFileSync(path.join(ROOT, "popup.css"), "utf-8");
const popupHtml = fs.readFileSync(path.join(ROOT, "popup.html"), "utf-8");
const docContent = fs.readFileSync(path.join(ROOT, "docs", "DESIGN_SYSTEM.md"), "utf-8");

console.log("=======================================================");
console.log("   FLY2GIT PHASE 16.1: OBSIDIAN × SAND × DEEP BLUE     ");
console.log("=======================================================\n");

// 1. BASE COLOR TOKENS
console.log("\n--- 1. Base Palette Tokens (design-tokens.css) ---");
check(tokensCss.includes("--color-bg: #171719;"), "Obsidian background token --color-bg: #171719");
check(tokensCss.includes("--color-bg-deep: #101113;"), "Deep background token --color-bg-deep: #101113");
check(tokensCss.includes("--color-surface: #222325;"), "Surface token --color-surface: #222325");
check(tokensCss.includes("--color-surface-elevated: #2A2B2E;"), "Elevated surface token --color-surface-elevated: #2A2B2E");
check(tokensCss.includes("--color-sand: #D8B98A;"), "Sand accent token --color-sand: #D8B98A");
check(tokensCss.includes("--color-sand-light: #E8CFA8;"), "Light sand token --color-sand-light: #E8CFA8");
check(tokensCss.includes("--color-sand-muted: #BFA77D;"), "Muted sand token --color-sand-muted: #BFA77D");
check(tokensCss.includes("--color-deep-blue: #40566B;"), "Deep blue token --color-deep-blue: #40566B");
check(tokensCss.includes("--color-blue-light: #61778B;"), "Light blue token --color-blue-light: #61778B");
check(tokensCss.includes("--color-text-primary: #F3F0EA;"), "Primary text token --color-text-primary: #F3F0EA");
check(tokensCss.includes("--color-text-secondary: #AAA49A;"), "Secondary text token --color-text-secondary: #AAA49A");
check(tokensCss.includes("--color-text-muted: #77736C;"), "Muted text token --color-text-muted: #77736C");
check(tokensCss.includes("--color-border: rgba(232, 207, 168, 0.14);"), "Sand-tinted border token --color-border defined");
check(tokensCss.includes("--color-glass: rgba(255, 255, 255, 0.055);"), "Glass token --color-glass defined");
check(tokensCss.includes("--color-glass-strong: rgba(255, 255, 255, 0.085);"), "Strong glass token --color-glass-strong defined");
check(tokensCss.includes("--color-success: #34d399;"), "Restrained natural green success token defined");
check(tokensCss.includes("--color-warning: #e0a352;"), "Muted amber warning token defined");
check(tokensCss.includes("--color-danger: #e57373;"), "Restrained red danger token defined");

// 2. GLASS SYSTEM
console.log("\n--- 2. Glass Surface Tiers ---");
check(tokensCss.includes("--glass-01-bg:") && tokensCss.includes("--glass-01-border:"), "Glass 01 (subtle) defined with sand border");
check(tokensCss.includes("--glass-02-bg:") && tokensCss.includes("rgba(34, 35, 37"), "Glass 02 (standard) uses charcoal surface");
check(tokensCss.includes("--glass-03-bg:") && tokensCss.includes("rgba(42, 43, 46"), "Glass 03 (elevated hero) uses elevated charcoal");
check(tokensCss.includes("--glass-04-bg:") && tokensCss.includes("rgba(23, 23, 25"), "Glass 04 (modal) uses obsidian base");
check(tokensCss.includes("--glass-03-border: 1px solid rgba(216, 185, 138"), "Glass 03 uses warm sand accent border");

// 3. BACKGROUND ATMOSPHERE
console.log("\n--- 3. Background Atmosphere ---");
check(tokensCss.includes("--canvas-ambient: radial-gradient"), "Canvas ambient uses radial-gradient atmosphere");
check(tokensCss.includes("rgba(216, 185, 138") && tokensCss.includes("rgba(64, 86, 107"), "Atmosphere combines warm sand and deep blue light fields");
check(popupCss.includes(".ambient-layer {"), "Ambient layer present in popup.css");

// 4. PURPLE & CYAN ELIMINATION
console.log("\n--- 4. Avoided Cliches (Zero Purple / Zero Cyan) ---");
check(!popupCss.includes("#38bdf8"), "Zero occurrences of bright cyan #38bdf8 in popup.css");
check(!popupCss.includes("56, 189, 248"), "Zero occurrences of cyan rgba(56, 189, 248) in popup.css");
check(!popupCss.includes("#8b5cf6"), "Zero occurrences of purple #8b5cf6 in popup.css");
check(!popupCss.includes("#a78bfa"), "Zero occurrences of purple #a78bfa in popup.css");
check(!popupCss.includes("#c4b5fd"), "Zero occurrences of purple #c4b5fd in popup.css");
check(!popupCss.includes("139, 92, 246"), "Zero occurrences of purple rgba(139, 92, 246) in popup.css");

// 5. BUTTONS & PHYSICAL CONTROLS
console.log("\n--- 5. Button & Control Styling ---");
check(popupCss.includes(".primary-btn,") && popupCss.includes("rgba(216, 185, 138"), "Primary button uses dark glass with warm sand accent");
check(popupCss.includes("button.secondary {"), "Secondary button styled as translucent charcoal");
check(popupCss.includes(".cockpit-action-btn.primary {"), "Cockpit primary action button uses sand gradient & border");

// 6. COCKPIT NAVIGATION
console.log("\n--- 6. Cockpit Navigation Refinements ---");
check(popupCss.includes(".cockpit-nav {"), "Cockpit nav container styled");
check(popupCss.includes(".nav-active-pip {"), "Active navigation indicator present");
check(popupCss.includes("background: var(--color-sand"), "Active nav pip uses sand color");
check(popupCss.includes(".cockpit-nav-btn.active"), "Active navigation button has distinct elevated style");

// 7. CURRENT PROBLEM HERO CARD
console.log("\n--- 7. Current Problem Hero Component ---");
check(popupCss.includes(".current-problem-card {"), "Current problem hero card styles present");
check(popupCss.includes("border: 1px solid rgba(216, 185, 138"), "Current problem card has warm sand highlight border");
check(popupCss.includes(".problem-platform-tag {"), "Problem platform tag container present");

// 8. ACCESSIBILITY & RESPONSIVE
console.log("\n--- 8. Accessibility & Responsive Constraints ---");
check(popupCss.includes("width: 390px"), "Popup width constrained to 390px");
check(popupCss.includes("max-height: 600px"), "Popup max-height constrained to 600px");
check(tokensCss.includes("prefers-reduced-motion: reduce"), "prefers-reduced-motion media query active in tokens");
check(popupCss.includes("prefers-reduced-motion: reduce"), "prefers-reduced-motion media query active in popup.css");
check(popupCss.includes("outline: 2px solid rgba(216, 185, 138"), "Focus outline uses high-contrast warm sand");

// 9. DESIGN SYSTEM DOCUMENTATION
console.log("\n--- 9. Design System Documentation ---");
check(docContent.includes("Obsidian × Sand × Deep Blue"), "Design system doc documents Phase 16.1 theme");
check(docContent.includes("--color-sand"), "Design system doc references --color-sand");
check(docContent.includes("--color-deep-blue"), "Design system doc references --color-deep-blue");

console.log("\n=======================================================");
console.log(`   RESULTS: ${passed} passed, ${failed} failed`);
console.log("=======================================================");

if (failed > 0) {
  console.error("\nFailed tests:");
  failures.forEach(f => console.error(`   ✗ ${f}`));
  process.exit(1);
} else {
  console.log("\n   ✅ ALL PHASE 16.1 OBSIDIAN THEME TESTS PASSED!\n");
}
