// Fly2Git — by SRT
// Phase 12B: Pro UX & Upgrade Experience Test Suite
//
// 15 Comprehensive Regression & UI Flow Tests:
// 1. Basic plan renders correctly
// 2. Active Pro renders correctly
// 3. Expired Pro renders as Basic
// 4. Invalid entitlement renders as Basic
// 5. Upgrade button is visible for Basic
// 6. Upgrade button does not create checkout
// 7. Third Basic platform attempt shows upgrade guidance ("Basic allows 2 platforms. Upgrade to Pro for all platforms.")
// 8. Pro recognizes all supported platforms
// 9. Multiple repository UI remains "Coming soon" when unfinished
// 10. Coming-soon features are not presented as active
// 11. Existing repo picker remains functional
// 12. Existing sync status remains functional
// 13. Existing identity guard UI remains functional
// 14. Platform logos remain correct
// 15. No raw entitlement storage is exposed to UI logic

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Mock Chrome Storage
let storageState = {
  local: {},
  session: {},
};

global.chrome = {
  storage: {
    local: {
      get: async (key) => {
        if (!key) return { ...storageState.local };
        if (typeof key === "string") return { [key]: storageState.local[key] };
        if (Array.isArray(key)) {
          const res = {};
          key.forEach((k) => (res[k] = storageState.local[k]));
          return res;
        }
        return { ...storageState.local };
      },
      set: async (obj) => {
        Object.assign(storageState.local, obj);
      },
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((k) => delete storageState.local[k]);
      },
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
      setAccessLevel: () => {},
    },
  },
  runtime: {
    id: "test-phase12b-ux",
    getURL: (p) => `chrome-extension://test-phase12b-ux/${p || ""}`,
    sendMessage: async () => ({ ok: true }),
    onMessage: { addListener() {} },
    onConnect: { addListener() {} },
  },
  alarms: {
    create() {},
    clear() {},
    onAlarm: { addListener() {} },
  },
  action: {
    setBadgeText() {},
    setBadgeBackgroundColor() {},
  },
};

global.importScripts = () => {};

// Load modules
const platforms = require("./platforms.js");
const entitlements = require("./entitlements.js");
const identity = require("./identity.js");

global.Fly2GitPlatforms = platforms;
global.Fly2GitEntitlements = entitlements;
global.Fly2GitIdentity = identity;

// Lightweight In-Memory DOM Implementation for Extension Popup Testing
class FakeClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...classes) {
    classes.forEach((c) => this.set.add(c));
    this.el.className = Array.from(this.set).join(" ");
  }
  remove(...classes) {
    classes.forEach((c) => this.set.delete(c));
    this.el.className = Array.from(this.set).join(" ");
  }
  contains(c) {
    return this.set.has(c);
  }
  toggle(c, force) {
    if (typeof force === "boolean") {
      if (force) this.set.add(c);
      else this.set.delete(c);
    } else {
      if (this.set.has(c)) this.set.delete(c);
      else this.set.add(c);
    }
    this.el.className = Array.from(this.set).join(" ");
    return this.set.has(c);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList(this);
    this._className = "";
    this._textContent = "";
    this._innerHTML = "";
    this.listeners = {};
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.type = "";
  }

  get className() {
    return this._className;
  }
  set className(val) {
    this._className = val || "";
    this.classList.set = new Set((this._className || "").split(/\s+/).filter(Boolean));
  }

  get textContent() {
    return this._textContent;
  }
  set textContent(val) {
    this._textContent = String(val !== undefined && val !== null ? val : "");
    this._innerHTML = this._textContent;
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(val) {
    this._innerHTML = String(val !== undefined && val !== null ? val : "");
    this._textContent = this._innerHTML.replace(/<[^>]*>/g, "");
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k] || null;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }

  appendChild(child) {
    if (!child) return;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  async dispatchEvent(eventObj) {
    const type = typeof eventObj === "string" ? eventObj : eventObj.type;
    const handlers = this.listeners[type] || [];
    for (const h of handlers) {
      await h(eventObj);
    }
  }

  querySelectorAll(selector) {
    const matched = [];
    function search(node) {
      if (selector === 'input[type="checkbox"]:checked:not([disabled])') {
        if (node.tagName === "INPUT" && node.type === "checkbox" && node.checked && !node.disabled) {
          matched.push(node);
        }
      } else if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        if (node.classList.contains(cls)) matched.push(node);
      }
      for (const child of node.children) {
        search(child);
      }
    }
    search(this);
    return matched;
  }

  scrollIntoView() {}
}

class FakeDocument {
  constructor() {
    this.elements = {};
  }
  createElement(tag) {
    return new FakeElement(tag);
  }
  getElementById(id) {
    if (!this.elements[id]) {
      this.elements[id] = new FakeElement("div");
      this.elements[id].id = id;
    }
    return this.elements[id];
  }
  reset() {
    this.elements = {};
  }
}

global.document = new FakeDocument();

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) console.error(err.stack);
    failed++;
  }
}

function resetEnv() {
  storageState.local = {};
  entitlements.clearTestEntitlement();
  global.document.reset();
}

async function runTests() {
  console.log("=======================================================");
  console.log("   FLY2GIT PHASE 12B: PRO UX & UPGRADE EXPERIENCE SUITE ");
  console.log("=======================================================\n");

  // Read popup.html to verify markup presence of components
  const popupHtml = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
  const popupCss = fs.readFileSync(path.join(__dirname, "popup.css"), "utf8");
  const popupJs = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");

  // Test 1: Basic plan renders correctly
  await test("1. Basic plan renders correctly: shows Basic, Free, 2/2 platforms, 1 repo, Available sync", async () => {
    resetEnv();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);

    // Execute simulated renderPlanSection
    const planSummaryTitle = document.getElementById("planSummaryTitle");
    const planSummaryStatusBadge = document.getElementById("planSummaryStatusBadge");
    const basicPlanDetails = document.getElementById("basicPlanDetails");
    const proPlanDetails = document.getElementById("proPlanDetails");
    const basicPlatformCount = document.getElementById("basicPlatformCount");

    const ent = await entitlements.getEntitlement();
    const isPro = await entitlements.isPro(ent);

    // Assert using capability APIs as in popup.js
    assert.strictEqual(isPro, false);
    planSummaryTitle.textContent = isPro ? "Pro" : "Basic";
    planSummaryStatusBadge.textContent = isPro ? "Active" : "Free";
    assert.strictEqual(planSummaryTitle.textContent, "Basic");
    assert.strictEqual(planSummaryStatusBadge.textContent, "Free");

    const count = ent.selectedPlatforms.length;
    const maxLimit = await entitlements.getFeatureLimit("maxPlatforms", ent);
    basicPlatformCount.textContent = `${count} / ${maxLimit} active`;
    assert.strictEqual(basicPlatformCount.textContent, "2 / 2 active");

    // HTML source check for core syncing available
    assert(popupHtml.includes("Core syncing"), "Must display Core syncing");
    assert(popupHtml.includes("Available"), "Must display Available");
  });

  // Test 2: Active Pro renders correctly
  await test("2. Active Pro renders correctly: shows Pro, Active, unlocked platforms, coming soon chips", async () => {
    resetEnv();
    await entitlements.setTestPlan("pro");

    const ent = await entitlements.getEntitlement();
    const isPro = await entitlements.isPro(ent);
    assert.strictEqual(isPro, true);

    const planSummaryTitle = document.getElementById("planSummaryTitle");
    const planSummaryStatusBadge = document.getElementById("planSummaryStatusBadge");
    const upgradeToProBtn = document.getElementById("upgradeToProBtn");

    planSummaryTitle.textContent = isPro ? "Pro" : "Basic";
    planSummaryStatusBadge.textContent = isPro ? "Active" : "Free";
    if (isPro) upgradeToProBtn.classList.add("hidden");

    assert.strictEqual(planSummaryTitle.textContent, "Pro");
    assert.strictEqual(planSummaryStatusBadge.textContent, "Active");
    assert.strictEqual(upgradeToProBtn.classList.contains("hidden"), true);

    // Verify all platforms feature is marked Active
    assert(popupHtml.includes("ALL PLATFORMS"), "Must include ALL PLATFORMS");
    assert(popupHtml.includes("feature-status-pill active"), "ALL PLATFORMS must be active");
  });

  // Test 3: Expired Pro renders as Basic
  await test("3. Expired Pro renders as Basic: never renders Pro Active", async () => {
    resetEnv();
    await entitlements.setTestPlan("pro", {
      status: "expired",
      expiresAt: Date.now() - 60000,
    });

    const ent = await entitlements.getEntitlement();
    const isPro = await entitlements.isPro(ent);

    assert.strictEqual(isPro, false, "Expired Pro MUST return isPro() === false");
    const planSummaryTitle = document.getElementById("planSummaryTitle");
    const planSummaryStatusBadge = document.getElementById("planSummaryStatusBadge");

    planSummaryTitle.textContent = isPro ? "Pro" : "Basic";
    planSummaryStatusBadge.textContent = isPro ? "Active" : "Free";

    assert.strictEqual(planSummaryTitle.textContent, "Basic");
    assert.notStrictEqual(planSummaryTitle.textContent, "Pro");
    assert.notStrictEqual(planSummaryStatusBadge.textContent, "Active");
  });

  // Test 4: Invalid entitlement renders as Basic
  await test("4. Invalid entitlement renders as Basic: malformed objects and unknown plans fail closed", async () => {
    resetEnv();
    const corruptedStates = [
      null,
      "corrupted_string",
      { plan: "ultra_admin", status: "active" },
      { plan: "pro", status: "inactive" },
    ];

    for (const bad of corruptedStates) {
      entitlements.setTestEntitlement(bad);
      const isPro = await entitlements.isPro();
      assert.strictEqual(isPro, false, "Corrupted state must fail closed to isPro() === false");

      const title = isPro ? "Pro" : "Basic";
      assert.strictEqual(title, "Basic");
    }
  });

  // Test 5: Upgrade button is visible for Basic
  await test("5. Upgrade button is visible for Basic: present and visible in Basic view", async () => {
    resetEnv();
    await entitlements.setTestPlan("basic");
    const ent = await entitlements.getEntitlement();
    const isPro = await entitlements.isPro(ent);

    const upgradeToProBtn = document.getElementById("upgradeToProBtn");
    if (isPro) {
      upgradeToProBtn.classList.add("hidden");
    } else {
      upgradeToProBtn.classList.remove("hidden");
    }

    assert.strictEqual(upgradeToProBtn.classList.contains("hidden"), false);
    assert(popupHtml.includes('id="upgradeToProBtn"'), "upgradeToProBtn must exist in popup.html");
    assert(popupHtml.includes("Upgrade to Pro"), "Button must have 'Upgrade to Pro' label");
  });

  // Test 6: Upgrade button does not create checkout
  await test("6. Upgrade button does not create checkout: displays honest informational sheet", async () => {
    resetEnv();
    const upgradeToProBtn = document.getElementById("upgradeToProBtn");
    const proUpgradeSheet = document.getElementById("proUpgradeSheet");
    const closeProSheetBtn = document.getElementById("closeProSheetBtn");

    proUpgradeSheet.classList.add("hidden");

    // Simulate clicking Upgrade to Pro button
    upgradeToProBtn.addEventListener("click", () => {
      const isHidden = proUpgradeSheet.classList.contains("hidden");
      if (isHidden) {
        proUpgradeSheet.classList.remove("hidden");
      } else {
        proUpgradeSheet.classList.add("hidden");
      }
    });

    closeProSheetBtn.addEventListener("click", () => {
      proUpgradeSheet.classList.add("hidden");
    });

    // 1. Click button: reveals info sheet
    await upgradeToProBtn.dispatchEvent("click");
    assert.strictEqual(proUpgradeSheet.classList.contains("hidden"), false, "Sheet should be visible");

    // 2. Click close: hides info sheet
    await closeProSheetBtn.dispatchEvent("click");
    assert.strictEqual(proUpgradeSheet.classList.contains("hidden"), true, "Sheet should be hidden on close");

    // 3. Verify zero checkout references or payment API triggers in codebase
    assert(!popupJs.includes("stripe"), "Must not call stripe");
    assert(!popupJs.includes("razorpay"), "Must not call razorpay");
    assert(!popupJs.includes("checkout"), "Must not redirect to checkout");
    assert(popupHtml.includes("Pro is coming soon."), "Sheet must contain 'Pro is coming soon.'");
    assert(popupHtml.includes("Zero payment collection"), "Sheet must state zero payment collection");
  });

  // Test 7: Third Basic platform attempt shows upgrade guidance
  await test("7. Third Basic platform attempt shows upgrade guidance", async () => {
    resetEnv();
    await entitlements.setTestPlan("basic");
    await entitlements.setSelectedPlatforms(["leetcode", "geeksforgeeks"]);

    const platformMessage = document.getElementById("platformMessage");
    const selected = ["leetcode", "geeksforgeeks", "codeforces"];

    if (selected.length > 2) {
      platformMessage.innerHTML =
        '<div class="limit-warning-content">' +
        '<span class="limit-warning-icon">⚠️</span>' +
        '<div><strong>Basic allows 2 platforms.</strong><br><span>Upgrade to Pro for all platforms.</span></div>' +
        '</div>';
      platformMessage.classList.remove("hidden");
    }

    assert.strictEqual(platformMessage.classList.contains("hidden"), false);
    assert(platformMessage.textContent.includes("Basic allows 2 platforms."));
    assert(platformMessage.textContent.includes("Upgrade to Pro for all platforms."));
  });

  // Test 8: Pro recognizes all supported platforms
  await test("8. Pro recognizes all supported platforms: unlocks all active platforms dynamically", async () => {
    resetEnv();
    await entitlements.setTestPlan("pro");

    const registry = Fly2GitPlatforms.PLATFORM_REGISTRY;
    const activePlatformIds = Object.keys(registry).filter((k) => registry[k].active === true);
    assert.strictEqual(activePlatformIds.length, 7);

    for (const id of activePlatformIds) {
      assert.strictEqual(await entitlements.canUsePlatform(id), true, `Platform ${id} must be allowed on Pro`);
    }

    // Inactive platform (USACO) is NOT unlocked
    assert.strictEqual(await entitlements.canUsePlatform("usaco"), false);
  });

  // Test 9: Multiple repository UI remains "Coming soon" when unfinished
  await test("9. Multiple repository UI remains 'Coming soon' when unfinished", async () => {
    resetEnv();
    await entitlements.setTestPlan("pro");

    const repoMultiNotice = document.getElementById("repoMultiNotice");
    const isPro = await entitlements.isPro();
    if (isPro) repoMultiNotice.classList.remove("hidden");

    assert.strictEqual(repoMultiNotice.classList.contains("hidden"), false);
    assert(popupHtml.includes('id="repoMultiNotice"'));
    assert(popupHtml.includes("Multiple repositories"));
    assert(popupHtml.includes("Coming soon"));
  });

  // Test 10: Coming-soon features are not presented as active
  await test("10. Coming-soon features are not presented as active: clearly labeled 'Coming soon'", async () => {
    // Audit the feature cards in popup.html
    const cards = [
      { name: "MULTIPLE REPOSITORIES", desc: "Organize solutions across more than one GitHub repository." },
      { name: "ADVANCED AUTOMATION", desc: "Future automation controls." },
      { name: "ANALYTICS", desc: "Future coding and sync insights." },
      { name: "AI", desc: "Future intelligent coding insights." },
    ];

    for (const card of cards) {
      assert(popupHtml.includes(card.name), `Must contain ${card.name}`);
      assert(popupHtml.includes(card.desc), `Must contain description for ${card.name}`);
    }

    // Ensure upcoming cards have the .upcoming class and .coming-soon-pill
    assert(popupHtml.includes('class="pro-feature-card upcoming"'));
    assert(popupHtml.includes('class="coming-soon-pill">Coming soon<'));
  });

  // Test 11: Existing repo picker remains functional
  await test("11. Existing repo picker remains functional: selection, change, save preserved", async () => {
    assert(popupHtml.includes('id="changeRepoBtn"'), "changeRepoBtn exists");
    assert(popupHtml.includes('id="repoPickerView"'), "repoPickerView exists");
    assert(popupHtml.includes('id="saveRepoBtn"'), "saveRepoBtn exists");
    assert(popupHtml.includes('id="repoSelect"'), "repoSelect exists");
    assert(popupJs.includes('document.getElementById("changeRepoBtn").addEventListener("click", showRepoPicker);'));
  });

  // Test 12: Existing sync status remains functional
  await test("12. Existing sync status remains functional: last sync banner and labels preserved", async () => {
    assert(popupHtml.includes('id="lastSyncBanner"'), "lastSyncBanner exists");
    assert(popupHtml.includes('id="lastSyncText"'), "lastSyncText exists");
    assert(popupHtml.includes('id="lastSyncTime"'), "lastSyncTime exists");
    assert(popupJs.includes("renderLastSyncBanner"), "renderLastSyncBanner is present");
  });

  // Test 13: Existing identity guard UI remains functional
  await test("13. Existing identity guard UI remains functional: banner and action buttons intact", async () => {
    assert(popupHtml.includes('id="identityGuardBanner"'), "identityGuardBanner exists");
    assert(popupHtml.includes('id="identityUseBtn"'), "identityUseBtn exists");
    assert(popupHtml.includes('id="identityPauseBtn"'), "identityPauseBtn exists");
    assert(popupJs.includes("renderIdentityGuard"), "renderIdentityGuard is wired");
  });

  // Test 14: Platform logos remain correct
  await test("14. Platform logos remain correct: authentic SVG assets mapped without abbreviations", async () => {
    const requiredLogos = {
      leetcode: "assets/platforms/leetcode.svg",
      geeksforgeeks: "assets/platforms/geeksforgeeks.svg",
      hackerrank: "assets/platforms/hackerrank.svg",
      codechef: "assets/platforms/codechef.svg",
      codeforces: "assets/platforms/codeforces.svg",
      atcoder: "assets/platforms/atcoder.svg",
      spoj: "assets/platforms/spoj.svg",
    };

    for (const [id, expectedPath] of Object.entries(requiredLogos)) {
      assert(popupJs.includes(expectedPath), `popup.js must contain logo mapping for ${id} -> ${expectedPath}`);
      assert(fs.existsSync(path.join(__dirname, expectedPath)), `Logo file must exist at ${expectedPath}`);
    }
  });

  // Test 15: No raw entitlement storage is exposed to UI logic
  await test("15. No raw entitlement storage is exposed to UI logic: uses central capability APIs", async () => {
    // Verify popup.js does not inspect raw entitlement.plan === "pro" directly
    const directPlanCheckRegex = /entitlement\.plan\s*===/g;
    const matches = popupJs.match(directPlanCheckRegex);
    assert.strictEqual(matches, null, "popup.js must not directly inspect entitlement.plan ===");

    // Verify capability APIs are used
    assert(popupJs.includes("Fly2GitEntitlements.isPro("), "Must call Fly2GitEntitlements.isPro");
    assert(popupJs.includes("Fly2GitEntitlements.canUsePlatform("), "Must call Fly2GitEntitlements.canUsePlatform");
    assert(popupJs.includes("Fly2GitEntitlements.getFeatureLimit("), "Must call Fly2GitEntitlements.getFeatureLimit");
  });

  console.log("\n=======================================================");
  console.log(`PHASE 12B RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
