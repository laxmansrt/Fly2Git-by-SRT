// Fly2Git — by SRT

const views = {
  connect: document.getElementById("connectView"),
  deviceFlow: document.getElementById("deviceFlowView"),
  repoPicker: document.getElementById("repoPickerView"),
  active: document.getElementById("activeView"),
};

function updateHeaderStatus(statusClass, labelText) {
  const badge = document.getElementById("headerStatusBadge");
  const label = document.getElementById("headerStatusLabel");
  if (badge) {
    badge.className = `header-status-badge ${statusClass}`;
  }
  if (label) {
    label.textContent = labelText;
  }
}

function showView(name) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
  if (name === "active") {
    updateHeaderStatus("connected", "Connected");
  } else if (name === "deviceFlow") {
    updateHeaderStatus("authorizing", "Authorizing");
  } else if (name === "repoPicker") {
    updateHeaderStatus("selecting", "Select Repo");
  } else {
    updateHeaderStatus("disconnected", "Offline");
  }
}

// Long-lived connection to the background worker: while this port is open,
// background.js polls Device Flow at GitHub's requested interval (fast).
// When the popup closes, this disconnects automatically and background.js
// falls back to its chrome.alarms backstop. See background.js for details.
const port = chrome.runtime.connect({ name: "fly2git-popup" });

let statusPollTimer = null;
let authModalMode = "login"; // "login" | "register"

init();

async function init() {
  setupAccountUI();
  await updateAccountBar();

  try {
    const { auth, selectedRepo, deviceFlow } = await chrome.storage.local.get([
      "auth",
      "selectedRepo",
      "deviceFlow",
    ]);

    if (auth?.accessToken && selectedRepo) {
      await showActiveView(selectedRepo);
    } else if (auth?.accessToken) {
      await showRepoPicker();
    } else if (deviceFlow?.status === "pending") {
      renderDeviceFlowState(deviceFlow);
      showView("deviceFlow");
      startStatusPolling();
    } else {
      showView("connect");
    }
  } catch (_) {
    showView("connect");
  }
}

async function updateAccountBar() {
  try {
    const { auth } = await chrome.storage.local.get("auth");
    const loggedOutView = document.getElementById("accountLoggedOutView");
    const loggedInView = document.getElementById("accountLoggedInView");
    const emailEl = document.getElementById("accountUserEmail");

    if (auth && auth.fly2gitToken && auth.fly2gitUser) {
      if (loggedOutView) loggedOutView.classList.add("hidden");
      if (loggedInView) loggedInView.classList.remove("hidden");
      if (emailEl) emailEl.textContent = auth.fly2gitUser.email || "User";
    } else {
      if (loggedOutView) loggedOutView.classList.remove("hidden");
      if (loggedInView) loggedInView.classList.add("hidden");
    }
  } catch (_) {}
}

/**
 * Canonical session retrieval helper for popup contexts.
 * Resolves active authentication session from chrome.storage.local.
 *
 * Checks in order of preference:
 * 1. userSession ({ token, user, ... })
 * 2. auth ({ fly2gitToken, fly2gitUser, ... })
 * 3. fly2git_session ({ token, user, ... })
 *
 * Returns { token: string, user?: object, ... } if an active token exists, or null.
 * Wrapped in fail-safe error handling to guarantee it NEVER throws or crashes the popup.
 *
 * @returns {Promise<{ token: string, user?: object } | null>}
 */
/**
 * Checks whether a token is structurally valid and unexpired (for JWTs).
 *
 * @param {string} token
 * @returns {boolean}
 */
function isTokenValidAndUnexpired(token) {
  if (!token || typeof token !== "string" || token.trim() === "") return false;
  const parts = token.split(".");
  // If not a 3-part JWT (e.g. mock token in tests), it is considered valid if non-empty
  if (parts.length !== 3) return true;
  try {
    const raw = typeof atob !== "undefined"
      ? atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
      : Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(raw);
    if (payload.exp && typeof payload.exp === "number") {
      const expMs = payload.exp > 1e11 ? payload.exp : payload.exp * 1000;
      if (Date.now() > expMs) return false; // Expired
    }
    return true;
  } catch (_) {
    return false; // Malformed payload
  }
}

let activeBackendUrl =
  (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_API_URL) || "https://api.fly2git.com";

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
  try {
    const p = chrome.storage.local.get(["backendUrl", "backendApiUrl"], (res) => {
      if (res && (res.backendUrl || res.backendApiUrl)) {
        activeBackendUrl = res.backendUrl || res.backendApiUrl;
      }
    });
    if (p && typeof p.catch === "function") {
      p.then((res) => {
        if (res && (res.backendUrl || res.backendApiUrl)) {
          activeBackendUrl = res.backendUrl || res.backendApiUrl;
        }
      }).catch(() => {});
    }
    if (chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === "function") {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && (changes.backendUrl || changes.backendApiUrl)) {
          const newVal = (changes.backendUrl || changes.backendApiUrl).newValue;
          if (newVal) activeBackendUrl = newVal;
        }
      });
    }
  } catch (_) {}
}

/**
 * Resolves the backend API URL. Prioritizes runtime config, storage override, then manifest/global config,
 * then canonical production URL https://api.fly2git.com.
 *
 * @returns {string}
 */
function getBackendUrl() {
  if (typeof Fly2GitConfig !== "undefined" && Fly2GitConfig.backendUrl) {
    return Fly2GitConfig.backendUrl.replace(/\/+$/, "");
  }
  if (activeBackendUrl && activeBackendUrl !== "https://api.fly2git.com") {
    return activeBackendUrl.replace(/\/+$/, "");
  }
  if (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_API_URL) {
    return FLY2GIT_CONFIG.BACKEND_API_URL.replace(/\/+$/, "");
  }
  return "https://api.fly2git.com";
}

/**
 * Canonical session retrieval helper for popup contexts.
 * Resolves active authentication session from chrome.storage.local.
 *
 * Checks in order of preference:
 * 1. userSession ({ token, user, ... })
 * 2. auth ({ fly2gitToken, fly2gitUser, ... })
 * 3. fly2git_session ({ token, user, ... })
 *
 * Filters out expired/malformed tokens and auto-migrates fresh tokens across keys.
 * Returns { token: string, user?: object, ... } if an active token exists, or null.
 * Wrapped in fail-safe error handling to guarantee it NEVER throws or crashes the popup.
 *
 * @returns {Promise<{ token: string, user?: object } | null>}
 */
async function getStoredSession() {
  try {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      return null;
    }
    const data = await chrome.storage.local.get(["userSession", "auth", "fly2git_session"]);
    const candidates = [];

    if (data && data.userSession && data.userSession.token) {
      candidates.push({
        token: data.userSession.token,
        user: data.userSession.user || null,
        ...data.userSession,
      });
    }
    if (data && data.auth && data.auth.fly2gitToken) {
      candidates.push({
        token: data.auth.fly2gitToken,
        user: data.auth.fly2gitUser || null,
      });
    }
    if (data && data.fly2git_session && data.fly2git_session.token) {
      candidates.push({
        token: data.fly2git_session.token,
        user: data.fly2git_session.user || null,
        ...data.fly2git_session,
      });
    }

    for (const c of candidates) {
      if (isTokenValidAndUnexpired(c.token)) {
        // Safe transparent migration: ensure userSession is synced
        if (!data.userSession || data.userSession.token !== c.token) {
          chrome.storage.local.set({ userSession: { token: c.token, user: c.user } }).catch(() => {});
        }
        return c;
      }
    }
    return null;
  } catch (err) {
    console.warn("Failed to retrieve stored session:", err);
    return null;
  }
}

function openAuthModal(mode = "login") {
  authModalMode = mode;
  const modal = document.getElementById("authModal");
  const title = document.getElementById("authModalTitle");
  const submitBtn = document.getElementById("authSubmitBtn");
  const promptEl = document.getElementById("authTogglePrompt");
  const toggleBtn = document.getElementById("authToggleBtn");
  const errorEl = document.getElementById("authErrorMsg");

  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  if (mode === "register") {
    if (title) title.textContent = "Create an account";
    if (submitBtn) submitBtn.textContent = "Create account";
    if (promptEl) promptEl.textContent = "Already have an account?";
    if (toggleBtn) toggleBtn.textContent = "Sign in";
  } else {
    if (title) title.textContent = "Sign in to Fly2Git";
    if (submitBtn) submitBtn.textContent = "Sign in";
    if (promptEl) promptEl.textContent = "Don't have an account?";
    if (toggleBtn) toggleBtn.textContent = "Create account";
  }

  if (modal) modal.classList.remove("hidden");
}

function closeAuthModal() {
  const modal = document.getElementById("authModal");
  if (modal) modal.classList.add("hidden");
  const form = document.getElementById("authForm");
  if (form) form.reset();
}

function setupAccountUI() {
  const openSignInBtn = document.getElementById("openSignInBtn");
  const openSignUpBtn = document.getElementById("openSignUpBtn");
  const closeAuthModalBtn = document.getElementById("closeAuthModalBtn");
  const authModalBackdrop = document.getElementById("authModalBackdrop");
  const authToggleBtn = document.getElementById("authToggleBtn");
  const authForm = document.getElementById("authForm");
  const logoutBtn = document.getElementById("accountLogoutBtn");
  const manageBtn = document.getElementById("accountManageBtn");

  if (openSignInBtn) openSignInBtn.addEventListener("click", () => openAuthModal("login"));
  if (openSignUpBtn) openSignUpBtn.addEventListener("click", () => openAuthModal("register"));
  if (closeAuthModalBtn) closeAuthModalBtn.addEventListener("click", closeAuthModal);
  if (authModalBackdrop) authModalBackdrop.addEventListener("click", closeAuthModal);

  if (authToggleBtn) {
    authToggleBtn.addEventListener("click", () => {
      openAuthModal(authModalMode === "login" ? "register" : "login");
    });
  }

  if (authForm) {
    authForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById("authEmail");
      const passInput = document.getElementById("authPassword");
      const errorEl = document.getElementById("authErrorMsg");
      const submitBtn = document.getElementById("authSubmitBtn");

      const email = emailInput ? emailInput.value.trim() : "";
      const password = passInput ? passInput.value : "";

      if (!email || !password) return;

      if (submitBtn) submitBtn.disabled = true;
      if (errorEl) errorEl.classList.add("hidden");

      try {
        const msgType = authModalMode === "register" ? "REGISTER_FLY2GIT_ACCOUNT" : "LOGIN_FLY2GIT_ACCOUNT";
        const resp = await chrome.runtime.sendMessage({
          type: msgType,
          email,
          password,
          backendUrl: getBackendUrl(),
        });
        if (resp && resp.ok) {
          closeAuthModal();
          await updateAccountBar();
          await renderPlanSection();
        } else {
          if (errorEl) {
            errorEl.textContent = resp?.error || "Authentication failed";
            errorEl.classList.remove("hidden");
          }
        }
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err?.message || "Request failed";
          errorEl.classList.remove("hidden");
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "LOGOUT_FLY2GIT_ACCOUNT" });
      await updateAccountBar();
      await renderPlanSection();
    });
  }

  if (manageBtn) {
    manageBtn.addEventListener("click", async () => {
      const resp = await chrome.runtime.sendMessage({ type: "CREATE_PORTAL_SESSION" });
      if (resp && resp.url) {
        chrome.tabs.create({ url: resp.url });
      }
    });
  }
}

// ---------- Connect flow ----------

document.getElementById("connectBtn").addEventListener("click", async () => {
  showView("deviceFlow");
  setText("deviceFlowStatus", "Starting…");
  setText("userCode", "— — — —");
  await chrome.runtime.sendMessage({ type: "START_DEVICE_FLOW" });
  startStatusPolling();
});

function startStatusPolling() {
  clearInterval(statusPollTimer);
  statusPollTimer = setInterval(async () => {
    const { deviceFlow } = await chrome.runtime.sendMessage({ type: "GET_DEVICE_FLOW_STATUS" });
    renderDeviceFlowState(deviceFlow);

    if (deviceFlow.status === "success") {
      clearInterval(statusPollTimer);
      await showRepoPicker();
    } else if (deviceFlow.status === "error" || deviceFlow.status === "expired") {
      clearInterval(statusPollTimer);
    }
  }, 1500);
}

function renderDeviceFlowState(deviceFlow) {
  if (!deviceFlow) return;

  if (deviceFlow.status === "pending") {
    setText("userCode", deviceFlow.userCode || "— — — —");
    setText("deviceFlowStatus", deviceFlow.message || "Waiting for authorization…");
    const openBtn = document.getElementById("openGithubBtn");
    openBtn.onclick = () => chrome.tabs.create({ url: deviceFlow.verificationUri });
  } else if (deviceFlow.status === "error" || deviceFlow.status === "expired") {
    setText("deviceFlowStatus", deviceFlow.message || "Something went wrong.");
  }
}

// ---------- Repo picker ----------

async function showRepoPicker() {
  showView("repoPicker");
  const select = document.getElementById("repoSelect");
  const notice = document.getElementById("repoPickerNotice");
  if (notice) {
    notice.classList.add("hidden");
    notice.textContent = "";
  }
  clearChildren(select);
  select.appendChild(makeOption("", "Loading repositories…"));

  const response = await chrome.runtime.sendMessage({ type: "GET_REPOS" });

  clearChildren(select);

  if (!response?.ok) {
    select.appendChild(makeOption("", `Error: ${response?.error || "unknown"}`));
    if (notice) {
      notice.textContent = response?.error || "Failed to load repositories from GitHub.";
      notice.classList.remove("hidden");
    }
    return;
  }

  const manageUrl =
    response.manageUrl ||
    `https://github.com/apps/${FLY2GIT_CONFIG.GITHUB_APP_SLUG}/installations/new`;
  const installMoreLink = document.getElementById("installMoreLink");
  if (installMoreLink) {
    installMoreLink.href = manageUrl;
  }

  const repos = response.repos || [];

  if (repos.length === 0) {
    select.appendChild(makeOption("", "No repositories authorized yet"));
    if (notice) {
      notice.textContent = "Repository isn't available to Fly2Git yet. Grant access to your repository using the link below.";
      notice.classList.remove("hidden");
    }
    return;
  }

  const placeholder = makeOption("", "Select a repository…");
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  const { selectedRepo } = await chrome.storage.local.get("selectedRepo");
  let matched = false;

  for (const r of repos) {
    const opt = makeOption(r.fullName, `${r.fullName}${r.private ? " 🔒" : ""}`);
    if (selectedRepo && r.fullName === selectedRepo) {
      opt.selected = true;
      placeholder.selected = false;
      matched = true;
    }
    select.appendChild(opt);
  }

  if (selectedRepo && !matched) {
    if (notice) {
      notice.textContent = `Repository "${selectedRepo}" isn't available to Fly2Git yet. Please select another repository or grant access.`;
      notice.classList.remove("hidden");
    }
    placeholder.selected = true;
  }
}

document.getElementById("saveRepoBtn").addEventListener("click", async () => {
  const select = document.getElementById("repoSelect");
  const notice = document.getElementById("repoPickerNotice");
  const repo = select.value;
  if (!repo) {
    if (notice) {
      notice.textContent = "Please select a repository before continuing.";
      notice.classList.remove("hidden");
    }
    return;
  }

  await chrome.storage.local.set({ selectedRepo: repo });
  chrome.runtime.sendMessage({ type: "BACKFILL_PLATFORM_READMES", repo }).catch(() => {});
  await showActiveView(repo);
});

// ---------- Active view & Cockpit Navigation ----------

let cockpitNavInitialized = false;
let currentCockpitTab = "home";

async function setupCockpitNavigation() {
  const { cockpitActiveTab } = await chrome.storage.local.get("cockpitActiveTab");
  if (cockpitActiveTab && ["home", "journey", "sync", "settings"].includes(cockpitActiveTab)) {
    currentCockpitTab = cockpitActiveTab;
  }
  switchCockpitTab(currentCockpitTab, false);

  if (cockpitNavInitialized) return;
  cockpitNavInitialized = true;

  const nav = document.getElementById("cockpitNav");
  if (!nav) return;

  const buttons = Array.from(nav.querySelectorAll(".cockpit-nav-btn"));
  buttons.forEach((btn, idx) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) switchCockpitTab(tab, true);
    });

    btn.addEventListener("keydown", (e) => {
      let targetIdx = -1;
      if (e.key === "ArrowRight") {
        targetIdx = (idx + 1) % buttons.length;
      } else if (e.key === "ArrowLeft") {
        targetIdx = (idx - 1 + buttons.length) % buttons.length;
      } else if (e.key === "Home") {
        targetIdx = 0;
      } else if (e.key === "End") {
        targetIdx = buttons.length - 1;
      }
      if (targetIdx !== -1) {
        e.preventDefault();
        buttons[targetIdx].focus();
        const tab = buttons[targetIdx].getAttribute("data-tab");
        if (tab) switchCockpitTab(tab, true);
      }
    });
  });

  // Wire quick jump buttons
  const manageSyncBtn = document.getElementById("homeManageSyncBtn");
  if (manageSyncBtn) {
    manageSyncBtn.addEventListener("click", () => switchCockpitTab("sync", true));
  }

  const exploreJourneyBtn = document.getElementById("homeExploreJourneyBtn");
  if (exploreJourneyBtn) {
    exploreJourneyBtn.addEventListener("click", () => switchCockpitTab("journey", true));
  }
}

function switchCockpitTab(tabName, persist = true) {
  currentCockpitTab = tabName;
  const nav = document.getElementById("cockpitNav");
  if (nav) {
    const buttons = nav.querySelectorAll(".cockpit-nav-btn");
    buttons.forEach((btn) => {
      const isTarget = btn.getAttribute("data-tab") === tabName;
      btn.classList.toggle("active", isTarget);
      btn.setAttribute("aria-selected", isTarget ? "true" : "false");
      btn.setAttribute("tabindex", isTarget ? "0" : "-1");
    });
  }

  const panels = {
    home: document.getElementById("tabPanelHome"),
    journey: document.getElementById("tabPanelJourney"),
    sync: document.getElementById("tabPanelSync"),
    settings: document.getElementById("tabPanelSettings"),
  };

  Object.entries(panels).forEach(([name, panel]) => {
    if (!panel) return;
    if (name === tabName) {
      panel.classList.remove("hidden");
      panel.classList.add("active");
    } else {
      panel.classList.add("hidden");
      panel.classList.remove("active");
    }
  });

  if (persist && chrome?.storage?.local?.set) {
    chrome.storage.local.set({ cockpitActiveTab: tabName }).catch(() => {});
  }
}

async function showActiveView(repo) {
  showView("active");
  setText("activeRepoName", repo);
  setText("homeSyncRepoName", repo || "Not selected");
  chrome.runtime.sendMessage({ type: "BACKFILL_PLATFORM_READMES", repo }).catch(() => {});
  await setupCockpitNavigation();
  await renderIdentityGuard();
  await renderLastSyncBanner();
  await renderPlanSection();
  await renderPlatformsSection();
  await renderAutomationSection();
  await renderAnalyticsSection();
  await renderAISection();
  await renderAICoachSection();
  await renderCodingIntelligenceSection();
  await renderSyncLog();
}

const PLATFORM_LOGOS = Object.freeze({
  leetcode: "assets/platforms/leetcode.svg",
  geeksforgeeks: "assets/platforms/geeksforgeeks.svg",
  hackerrank: "assets/platforms/hackerrank.svg",
  codechef: "assets/platforms/codechef.svg",
  codeforces: "assets/platforms/codeforces.svg",
  atcoder: "assets/platforms/atcoder.svg",
  spoj: "assets/platforms/spoj.svg",
});
const DEFAULT_PLATFORM_LOGO = "assets/platforms/default.svg";

function getPlatformLogoSrc(platformId) {
  const key = (platformId || "").toLowerCase();
  return PLATFORM_LOGOS[key] || DEFAULT_PLATFORM_LOGO;
}

async function renderPlanSection(cachedEntitlement) {
  const planSummaryTitle = document.getElementById("planSummaryTitle");
  const planSummaryStatusBadge = document.getElementById("planSummaryStatusBadge");
  const upgradeToProBtn = document.getElementById("upgradeToProBtn");
  const basicPlanDetails = document.getElementById("basicPlanDetails");
  const proPlanDetails = document.getElementById("proPlanDetails");
  const basicPlatformCount = document.getElementById("basicPlatformCount");
  const repoMultiNotice = document.getElementById("repoMultiNotice");
  const proUpgradeSheet = document.getElementById("proUpgradeSheet");

  const ent = cachedEntitlement || (await Fly2GitEntitlements.getEntitlement());
  const isPro = await Fly2GitEntitlements.isPro(ent);

  if (planSummaryTitle) {
    planSummaryTitle.textContent = isPro ? "Pro" : "Basic";
  }
  if (planSummaryStatusBadge) {
    planSummaryStatusBadge.textContent = isPro ? "Active" : "Free";
    planSummaryStatusBadge.className = isPro ? "plan-status-badge pro" : "plan-status-badge";
  }
  if (upgradeToProBtn) {
    if (isPro) {
      upgradeToProBtn.classList.add("hidden");
    } else {
      upgradeToProBtn.classList.remove("hidden");
    }
  }
  if (repoMultiNotice) {
    if (isPro) {
      repoMultiNotice.classList.remove("hidden");
    } else {
      repoMultiNotice.classList.add("hidden");
    }
  }
  if (isPro && proUpgradeSheet) {
    proUpgradeSheet.classList.add("hidden");
  }
  if (basicPlanDetails && proPlanDetails) {
    if (isPro) {
      basicPlanDetails.classList.add("hidden");
      proPlanDetails.classList.remove("hidden");

      const proSubStatus = document.getElementById("proSubStatus");
      const proSubCycle = document.getElementById("proSubCycle");
      const proSubRenewal = document.getElementById("proSubRenewal");

      if (proSubStatus) {
        const rawStatus = ent.status || "active";
        const cap = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);
        proSubStatus.textContent = `Pro · ${cap}`;
      }
      if (proSubCycle) {
        const cycle = ent.billingCycle ? (ent.billingCycle.charAt(0).toUpperCase() + ent.billingCycle.slice(1)) : "Active";
        proSubCycle.textContent = cycle;
      }
      if (proSubRenewal) {
        if (ent.expiresAt && typeof ent.expiresAt === "number") {
          const d = new Date(ent.expiresAt);
          proSubRenewal.textContent = `Renews: ${d.toLocaleDateString()}`;
          proSubRenewal.classList.remove("hidden");
        } else {
          proSubRenewal.textContent = "";
          proSubRenewal.classList.add("hidden");
        }
      }
    } else {
      basicPlanDetails.classList.remove("hidden");
      proPlanDetails.classList.add("hidden");
      if (basicPlatformCount) {
        const count = Array.isArray(ent.selectedPlatforms) ? ent.selectedPlatforms.length : 2;
        const maxLimit = (await Fly2GitEntitlements.getFeatureLimit("maxPlatforms", ent)) || 2;
        basicPlatformCount.textContent = `${count} / ${maxLimit} active`;
      }
    }
  }
  await renderAutomationSection(ent);
  await renderAnalyticsSection(ent);
}

async function renderPlatformsSection() {
  const planBadge = document.getElementById("planBadge");
  const platformsList = document.getElementById("platformsList");
  const platformMessage = document.getElementById("platformMessage");
  const limitHint = document.getElementById("platformsLimitHint");

  if (!platformsList) return;

  clearChildren(platformsList);
  if (platformMessage) {
    platformMessage.classList.add("hidden");
    platformMessage.textContent = "";
  }

  const entitlement = await Fly2GitEntitlements.getEntitlement();
  const isPro = await Fly2GitEntitlements.isPro(entitlement);
  await renderPlanSection(entitlement);

  // Pre-selection UX Disclosure (Phase 13A)
  const platformDisclosure = document.getElementById("platformDisclosure");
  const disclosureTitle = document.getElementById("disclosureTitle");
  const disclosureSubtitle = document.getElementById("disclosureSubtitle");
  if (disclosureTitle && disclosureSubtitle) {
    if (isPro) {
      disclosureTitle.textContent = "All platforms included. Switch anytime.";
      disclosureSubtitle.textContent =
        "Pro subscribers enjoy unrestricted access to all active coding platforms with zero cooldowns.";
      if (platformDisclosure) platformDisclosure.classList.add("pro");
    } else {
      disclosureTitle.textContent = "Choose up to 2 platforms";
      disclosureSubtitle.textContent =
        "You can edit your selections later. Basic platform slots can be changed once every 30 days.";
      if (platformDisclosure) platformDisclosure.classList.remove("pro");
    }
  }

  // Downgrade Banner: Prompt for explicit selection if downgraded from Pro (Phase 13A)
  const downgradeBanner = document.getElementById("downgradeBanner");
  if (downgradeBanner) {
    const rawStored = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local
      ? await chrome.storage.local.get("fly2git_entitlement")
      : null;
    const storedEnt = rawStored ? rawStored.fly2git_entitlement : null;
    if (!isPro && storedEnt && storedEnt._downgradedRequiresSelection) {
      downgradeBanner.classList.remove("hidden");
    } else {
      downgradeBanner.classList.add("hidden");
    }
  }

  // Visual Basic Slot Presentation (Phase 13A)
  const basicSlotsContainer = document.getElementById("basicSlotsContainer");
  if (basicSlotsContainer) {
    clearChildren(basicSlotsContainer);
    if (isPro) {
      basicSlotsContainer.classList.add("hidden");
    } else {
      basicSlotsContainer.classList.remove("hidden");
      const slots = await Fly2GitEntitlements.getPlatformSlots(entitlement);
      for (const slot of slots) {
        const card = document.createElement("div");
        card.className = "slot-card";

        const header = document.createElement("div");
        header.className = "slot-header";

        const label = document.createElement("span");
        label.className = "slot-label";
        label.textContent = `SLOT ${slot.slot}`;

        const cooldownText = Fly2GitEntitlements.formatCooldownText(slot.nextChangeAt);
        const badge = document.createElement("span");
        badge.className = "slot-status-badge " + (cooldownText === "Can change now" ? "can-change" : "cooldown");
        badge.textContent = cooldownText;

        header.appendChild(label);
        header.appendChild(badge);

        const body = document.createElement("div");
        body.className = "slot-body";

        const logo = document.createElement("img");
        logo.className = "slot-platform-logo";
        logo.src = getPlatformLogoSrc(slot.platform);
        logo.alt = slot.name || slot.platform;
        logo.onerror = function () {
          this.src = DEFAULT_PLATFORM_LOGO;
        };

        const name = document.createElement("strong");
        name.className = "slot-platform-name";
        name.textContent = slot.name || slot.platform;

        body.appendChild(logo);
        body.appendChild(name);

        const footer = document.createElement("div");
        footer.className = "slot-footer";

        const editBtn = document.createElement("button");
        editBtn.className = "slot-edit-btn";
        editBtn.textContent = "Edit";
        editBtn.setAttribute("data-slot", slot.slot);
        editBtn.addEventListener("click", () => openSlotSwitchModal(slot, slots));

        footer.appendChild(editBtn);

        card.appendChild(header);
        card.appendChild(body);
        card.appendChild(footer);

        basicSlotsContainer.appendChild(card);
      }
    }
  }

  if (planBadge) {
    planBadge.textContent = isPro ? "PRO · ALL PLATFORMS" : "Basic — Free";
    planBadge.className = isPro ? "plan-badge pro" : "plan-badge";
  }

  if (limitHint) {
    limitHint.textContent = isPro ? "(All Active Included)" : "(Choose any 2)";
  }

  const registry = Fly2GitPlatforms.PLATFORM_REGISTRY;
  const platformIds = Object.keys(registry);

  for (const id of platformIds) {
    const p = registry[id];
    const row = document.createElement("div");
    row.className = "platform-row" + (p.active ? "" : " disabled");

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.platformId = p.id;
    checkbox.setAttribute("aria-label", p.name);

    // Compact Glass Logo Container
    const logoContainer = document.createElement("div");
    logoContainer.className = "platform-logo-container";
    logoContainer.setAttribute("aria-hidden", "true");

    const logoImg = document.createElement("img");
    logoImg.className = "platform-logo";
    logoImg.src = getPlatformLogoSrc(p.id);
    logoImg.alt = p.name;
    logoImg.width = 24;
    logoImg.height = 24;
    logoImg.onerror = function () {
      this.onerror = null;
      this.src = DEFAULT_PLATFORM_LOGO;
    };
    logoContainer.appendChild(logoImg);

    if (p.active) {
      if (isPro) {
        checkbox.checked = true;
        checkbox.disabled = true; // All active platforms unlocked in Pro
        row.classList.add("selected");
      } else {
        const isAllowed = await Fly2GitEntitlements.canUsePlatform(p.id, entitlement);
        checkbox.checked = isAllowed;
        checkbox.disabled = false;
        if (checkbox.checked) row.classList.add("selected");

        checkbox.addEventListener("change", async () => {
          if (platformMessage) {
            platformMessage.classList.add("hidden");
            platformMessage.textContent = "";
          }

          const checkedBoxes = platformsList.querySelectorAll(
            'input[type="checkbox"]:checked:not([disabled])'
          );
          const selected = Array.from(checkedBoxes).map((cb) => cb.dataset.platformId);

          if (selected.length > 2) {
            // Revert selection and notify user with polished limit guidance
            checkbox.checked = false;
            row.classList.remove("selected");
            if (platformMessage) {
              platformMessage.innerHTML =
                '<div class="limit-warning-content">' +
                '<span class="limit-warning-icon">⚠️</span>' +
                '<div><strong>Basic allows 2 platforms.</strong><br><span>Upgrade to Pro for all platforms.</span></div>' +
                '</div>';
              platformMessage.classList.remove("hidden");
              platformMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
            return;
          }

          if (checkbox.checked) {
            row.classList.add("selected");
          } else {
            row.classList.remove("selected");
          }

          const res = await Fly2GitEntitlements.setSelectedPlatforms(selected);
          if (!res.ok) {
            checkbox.checked = !checkbox.checked;
            row.classList.toggle("selected", checkbox.checked);
            if (platformMessage) {
              platformMessage.textContent = res.message || "Failed to update platforms.";
              platformMessage.classList.remove("hidden");
            }
          } else {
            await renderPlanSection(res.entitlement);
            await renderPlatformsSection();
          }
        });
      }
    } else {
      checkbox.checked = false;
      checkbox.disabled = true;
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "platform-chip-name";
    nameSpan.textContent = p.name;

    label.appendChild(checkbox);
    label.appendChild(logoContainer);
    label.appendChild(nameSpan);
    row.appendChild(label);

    if (!p.active) {
      const badge = document.createElement("span");
      badge.className = "coming-soon-badge";
      badge.textContent = "Coming Soon";
      row.appendChild(badge);
    }

    platformsList.appendChild(row);
  }
}

// ==============================================================================
// Platform Slot Switch Modal Handlers (Phase 13A)
// ==============================================================================
let currentEditingSlot = null;

function openSlotSwitchModal(slot, allSlots) {
  currentEditingSlot = slot;
  const modal = document.getElementById("slotSwitchModal");
  const title = document.getElementById("slotSwitchTitle");
  const currentName = document.getElementById("slotSwitchCurrentName");
  const select = document.getElementById("slotSwitchSelect");
  const guidance = document.getElementById("slotSwitchGuidance");
  const errorMsg = document.getElementById("slotSwitchError");
  const confirmBtn = document.getElementById("confirmSlotSwitchBtn");
  const lockedExtra = document.getElementById("slotSwitchLockedExtra");

  if (!modal || !select) return;

  if (title) title.textContent = `Edit Platform Slot ${slot.slot}`;
  const reg = Fly2GitPlatforms.PLATFORM_REGISTRY;
  const currPlatformObj = reg[slot.platform] || { name: slot.platform };
  if (currentName) currentName.textContent = currPlatformObj.name || slot.platform;

  if (errorMsg) {
    errorMsg.classList.add("hidden");
    errorMsg.textContent = "";
  }

  // Populate select options with all active platforms
  clearChildren(select);
  const otherSlot = allSlots.find((s) => s.slot !== slot.slot);
  const otherPlatform = otherSlot ? otherSlot.platform : null;

  for (const id of Object.keys(reg)) {
    const p = reg[id];
    if (!p.active) continue;
    const opt = document.createElement("option");
    opt.value = p.id;
    if (p.id === slot.platform) {
      opt.textContent = `${p.name} (Current)`;
      opt.selected = true;
    } else if (p.id === otherPlatform) {
      opt.textContent = `${p.name} (In Slot ${otherSlot.slot})`;
      opt.disabled = true;
    } else {
      opt.textContent = p.name;
    }
    select.appendChild(opt);
  }

  // Cooldown status check
  const now = Date.now();
  const isLocked = slot.nextChangeAt && typeof slot.nextChangeAt === "number" && now < slot.nextChangeAt;
  const cooldownText = Fly2GitEntitlements.formatCooldownText(slot.nextChangeAt, now);

  if (isLocked) {
    if (guidance) {
      guidance.textContent = `Platform change ${cooldownText.toLowerCase()}.`;
      guidance.className = "slot-switch-guidance cooldown";
    }
    if (lockedExtra) lockedExtra.classList.remove("hidden");
    if (confirmBtn) confirmBtn.disabled = true;
  } else {
    if (guidance) {
      guidance.textContent = "You can change this slot now.";
      guidance.className = "slot-switch-guidance";
    }
    if (lockedExtra) lockedExtra.classList.add("hidden");
    if (confirmBtn) confirmBtn.disabled = false;
  }

  modal.classList.remove("hidden");
}

function closeSlotSwitchModal() {
  const modal = document.getElementById("slotSwitchModal");
  if (modal) modal.classList.add("hidden");
  currentEditingSlot = null;
}

const closeSlotSwitchBtn = document.getElementById("closeSlotSwitchBtn");
const cancelSlotSwitchBtn = document.getElementById("cancelSlotSwitchBtn");
const slotSwitchBackdrop = document.getElementById("slotSwitchBackdrop");
const confirmSlotSwitchBtn = document.getElementById("confirmSlotSwitchBtn");
const slotUpgradeLink = document.getElementById("slotUpgradeLink");

if (closeSlotSwitchBtn) closeSlotSwitchBtn.addEventListener("click", closeSlotSwitchModal);
if (cancelSlotSwitchBtn) cancelSlotSwitchBtn.addEventListener("click", closeSlotSwitchModal);
if (slotSwitchBackdrop) slotSwitchBackdrop.addEventListener("click", closeSlotSwitchModal);

if (slotUpgradeLink) {
  slotUpgradeLink.addEventListener("click", (e) => {
    e.preventDefault();
    closeSlotSwitchModal();
    const upgradeBtn = document.getElementById("upgradeToProBtn");
    if (upgradeBtn) upgradeBtn.click();
  });
}

if (confirmSlotSwitchBtn) {
  confirmSlotSwitchBtn.addEventListener("click", async () => {
    if (!currentEditingSlot) return;
    const select = document.getElementById("slotSwitchSelect");
    const errorMsg = document.getElementById("slotSwitchError");
    if (!select) return;

    const selectedPlatform = select.value;
    if (selectedPlatform === currentEditingSlot.platform) {
      closeSlotSwitchModal();
      return;
    }

    confirmSlotSwitchBtn.disabled = true;
    confirmSlotSwitchBtn.textContent = "Switching…";

    try {
      const stored = await chrome.storage.local.get("fly2git_session");
      const token = stored && stored.fly2git_session ? stored.fly2git_session.token : null;
      const res = await Fly2GitEntitlements.changePlatformSlot(currentEditingSlot.slot, selectedPlatform, token);

      if (res.ok) {
        closeSlotSwitchModal();
        const platformMessage = document.getElementById("platformMessage");
        if (platformMessage) {
          const reg = Fly2GitPlatforms.PLATFORM_REGISTRY;
          const pName = reg[selectedPlatform] ? reg[selectedPlatform].name : selectedPlatform;
          platformMessage.innerHTML = `<strong>Slot ${currentEditingSlot.slot} changed to ${pName}.</strong><br><span>Next change available in 30 days.</span>`;
          platformMessage.classList.remove("hidden");
        }
        await renderPlatformsSection();
      } else {
        if (errorMsg) {
          errorMsg.textContent = res.error || res.message || "Failed to change platform slot.";
          errorMsg.classList.remove("hidden");
        }
      }
    } catch (err) {
      if (errorMsg) {
        errorMsg.textContent = err.message || "Failed to switch platform.";
        errorMsg.classList.remove("hidden");
      }
    } finally {
      confirmSlotSwitchBtn.disabled = false;
      confirmSlotSwitchBtn.textContent = "Confirm Switch";
    }
  });
}

const upgradeToProBtn = document.getElementById("upgradeToProBtn");
const proUpgradeSheet = document.getElementById("proUpgradeSheet");
const closeProSheetBtn = document.getElementById("closeProSheetBtn");

if (upgradeToProBtn && proUpgradeSheet) {
  upgradeToProBtn.addEventListener("click", () => {
    const isHidden = proUpgradeSheet.classList.contains("hidden");
    if (isHidden) {
      proUpgradeSheet.classList.remove("hidden");
      proUpgradeSheet.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      proUpgradeSheet.classList.add("hidden");
    }
  });
}

if (closeProSheetBtn && proUpgradeSheet) {
  closeProSheetBtn.addEventListener("click", () => {
    proUpgradeSheet.classList.add("hidden");
  });
}

// ==============================================================================
// Advanced Automation Section Handlers (Phase 14A)
// ==============================================================================

async function renderAutomationSection(cachedEntitlement) {
  const automationBasicTeaser = document.getElementById("automationBasicTeaser");
  const automationProControls = document.getElementById("automationProControls");
  const automationProBadge = document.getElementById("automationProBadge");
  const presetSelect = document.getElementById("automationPresetSelect");
  const commitInput = document.getElementById("automationCommitTemplate");
  const pathInput = document.getElementById("automationPathTemplate");
  const filterEasy = document.getElementById("filterExcludeEasy");
  const filterMedium = document.getElementById("filterExcludeMedium");
  const filterHard = document.getElementById("filterExcludeHard");

  if (!automationBasicTeaser || !automationProControls) return;

  const ent = cachedEntitlement || (await Fly2GitEntitlements.getEntitlement());
  const isPro = await Fly2GitEntitlements.isPro(ent);

  if (!isPro) {
    automationBasicTeaser.classList.remove("hidden");
    automationProControls.classList.add("hidden");
    if (automationProBadge) automationProBadge.classList.add("hidden");
    return;
  }

  automationBasicTeaser.classList.add("hidden");
  automationProControls.classList.remove("hidden");
  if (automationProBadge) automationProBadge.classList.remove("hidden");

  let settings;
  if (typeof Fly2GitAutomation !== "undefined") {
    settings = await Fly2GitAutomation.getStoredAutomationSettings();
  } else {
    settings = {
      preset: "balanced",
      commitMessage: { template: "{action}: {problemTitle} ({difficulty})" },
      pathOrganization: { template: "{platform}/{difficulty}/{slug}" },
      filters: { excludedDifficulties: [] },
    };
  }

  if (presetSelect) presetSelect.value = settings.preset || "balanced";
  updateAutomationPresetHint(settings.preset || "balanced");

  if (commitInput) {
    commitInput.value = (settings.commitMessage && settings.commitMessage.template) || "";
  }
  if (pathInput) {
    pathInput.value = (settings.pathOrganization && settings.pathOrganization.template) || "";
  }

  const excluded = (settings.filters && settings.filters.excludedDifficulties) || [];
  if (filterEasy) filterEasy.checked = excluded.includes("Easy");
  if (filterMedium) filterMedium.checked = excluded.includes("Medium");
  if (filterHard) filterHard.checked = excluded.includes("Hard");
}

function updateAutomationPresetHint(presetId) {
  const hintEl = document.getElementById("automationPresetHint");
  if (!hintEl) return;
  if (typeof Fly2GitAutomation !== "undefined" && Fly2GitAutomation.PRESETS[presetId]) {
    hintEl.textContent = Fly2GitAutomation.PRESETS[presetId].description;
  } else if (presetId === "custom") {
    hintEl.textContent = "Customized automation rules.";
  } else {
    hintEl.textContent = "";
  }
}

// Preset change listener
const presetSelect = document.getElementById("automationPresetSelect");
if (presetSelect) {
  presetSelect.addEventListener("change", () => {
    const val = presetSelect.value;
    updateAutomationPresetHint(val);
    if (typeof Fly2GitAutomation !== "undefined" && Fly2GitAutomation.PRESETS[val]) {
      const p = Fly2GitAutomation.PRESETS[val];
      const commitInput = document.getElementById("automationCommitTemplate");
      const pathInput = document.getElementById("automationPathTemplate");
      const filterEasy = document.getElementById("filterExcludeEasy");
      const filterMedium = document.getElementById("filterExcludeMedium");
      const filterHard = document.getElementById("filterExcludeHard");

      if (commitInput) commitInput.value = p.commitTemplate;
      if (pathInput) pathInput.value = p.pathTemplate;
      if (filterEasy) filterEasy.checked = p.excludedDifficulties.includes("Easy");
      if (filterMedium) filterMedium.checked = p.excludedDifficulties.includes("Medium");
      if (filterHard) filterHard.checked = p.excludedDifficulties.includes("Hard");
    }
  });
}

// Placeholder pill insertion
document.querySelectorAll(".pill-chip[data-target]").forEach((chip) => {
  chip.addEventListener("click", () => {
    const targetId = chip.getAttribute("data-target");
    const insertText = chip.getAttribute("data-insert");
    const input = document.getElementById(targetId);
    if (input && insertText) {
      input.value = input.value ? `${input.value} ${insertText}` : insertText;
      const presetSel = document.getElementById("automationPresetSelect");
      if (presetSel) {
        presetSel.value = "custom";
        updateAutomationPresetHint("custom");
      }
    }
  });
});

// Save automation settings button
const saveAutoBtn = document.getElementById("saveAutomationBtn");
if (saveAutoBtn) {
  saveAutoBtn.addEventListener("click", async () => {
    const presetSel = document.getElementById("automationPresetSelect");
    const commitInput = document.getElementById("automationCommitTemplate");
    const pathInput = document.getElementById("automationPathTemplate");
    const filterEasy = document.getElementById("filterExcludeEasy");
    const filterMedium = document.getElementById("filterExcludeMedium");
    const filterHard = document.getElementById("filterExcludeHard");
    const notice = document.getElementById("automationNotice");

    const excluded = [];
    if (filterEasy && filterEasy.checked) excluded.push("Easy");
    if (filterMedium && filterMedium.checked) excluded.push("Medium");
    if (filterHard && filterHard.checked) excluded.push("Hard");

    const toSave = {
      enabled: true,
      preset: presetSel ? presetSel.value : "custom",
      commitMessage: {
        template: commitInput ? commitInput.value : "",
      },
      pathOrganization: {
        template: pathInput ? pathInput.value : "",
      },
      filters: {
        excludedDifficulties: excluded,
        languageMode: "all",
        languages: [],
      },
      perPlatform: {},
      retryPolicy: {
        maxRetries: 1,
      },
    };

    if (typeof Fly2GitAutomation !== "undefined") {
      const valid = Fly2GitAutomation.validateSettings(toSave);
      await Fly2GitAutomation.saveStoredAutomationSettings(valid);

      // Attempt server sync if authenticated
      if (typeof getStoredAuth === "function") {
        try {
          const auth = await getStoredAuth();
          if (auth && auth.token) {
            const baseUrl = (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_API_URL) || "https://api.fly2git.com";
            await fetch(`${baseUrl}/api/automation/settings`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${auth.token}`,
              },
              body: JSON.stringify(valid),
            });
          }
        } catch (_) {}
      }
    }

    if (notice) {
      notice.classList.remove("hidden");
      notice.textContent = "Saved!";
      setTimeout(() => notice.classList.add("hidden"), 2000);
    }
  });
}

// ==============================================================================
// Personal Coding Analytics UI (Phase 14B)
// ==============================================================================

let currentAnalyticsRange = "30d";

async function renderAnalyticsSection(cachedEntitlement) {
  const analyticsBasicTeaser = document.getElementById("analyticsBasicTeaser");
  const analyticsProDashboard = document.getElementById("analyticsProDashboard");
  const analyticsBadge = document.getElementById("analyticsBadge");
  const analyticsRangePills = document.getElementById("analyticsRangePills");

  if (!analyticsBasicTeaser || !analyticsProDashboard) return;

  const ent = cachedEntitlement || (await Fly2GitEntitlements.getEntitlement());
  const isPro = await Fly2GitEntitlements.isPro(ent);

  if (!isPro) {
    analyticsBasicTeaser.classList.remove("hidden");
    analyticsProDashboard.classList.add("hidden");
    if (analyticsBadge) analyticsBadge.classList.add("hidden");
    if (analyticsRangePills) analyticsRangePills.classList.add("hidden");
    return;
  }

  analyticsBasicTeaser.classList.add("hidden");
  analyticsProDashboard.classList.remove("hidden");
  if (analyticsBadge) analyticsBadge.classList.remove("hidden");
  if (analyticsRangePills) analyticsRangePills.classList.remove("hidden");

  try {
    const tz = new Date().getTimezoneOffset();
    const overviewRes = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "GET_ANALYTICS_OVERVIEW", range: currentAnalyticsRange, tz },
        (res) => resolve(res || { ok: false })
      );
    });

    if (overviewRes && overviewRes.ok) {
      updateAnalyticsDashboard(overviewRes);
    }

    const timelineRes = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "GET_ANALYTICS_ACTIVITY", range: currentAnalyticsRange, tz },
        (res) => resolve(res || { ok: false })
      );
    });

    if (timelineRes && timelineRes.ok && Array.isArray(timelineRes.timeline)) {
      renderActivityChart(timelineRes.timeline);
    }
  } catch (err) {
    console.debug("[Fly2Git][Analytics] Render error:", err.message);
  }
}

function updateAnalyticsDashboard(data) {
  setText("statTotalProblems", data.totalProblems || 0);
  setText("statStreak", (data.streak || 0) + "d");
  setText("statSuccessRate", (data.syncSuccessRate !== undefined ? data.syncSuccessRate : 100) + "%");
  setText("statPlatforms", data.platformCount || 0);
  setText("statLanguages", data.languageCount || 0);
  setText("statSkipped", data.skippedCount || 0);

  // Home Developer Cockpit Bento Metrics
  setText("homeStatProblems", data.totalProblems || 0);
  setText("homeStatPlatforms", data.platformCount || 0);
  setText("homeStatStreak", data.streak || 0);
  setText("homeStatSuccess", (data.syncSuccessRate !== undefined ? data.syncSuccessRate : 100) + "%");

  const rangeLabels = { "7d": "Last 7 Days", "30d": "Last 30 Days", "90d": "Last 90 Days", "all": "All Time" };
  setText("chartRangeLabel", rangeLabels[currentAnalyticsRange] || "Last 30 Days");

  // Platforms Breakdown
  const platList = document.getElementById("platformBreakdownList");
  if (platList) {
    platList.innerHTML = "";
    if (Array.isArray(data.platformBreakdown) && data.platformBreakdown.length > 0) {
      data.platformBreakdown.forEach((p) => {
        const row = document.createElement("div");
        row.className = "breakdown-row";
        const capPlat = p.platform.charAt(0).toUpperCase() + p.platform.slice(1);
        row.innerHTML = `<span>${capPlat}</span><span class="breakdown-count">${p.count}</span>`;
        platList.appendChild(row);
      });
    } else {
      platList.innerHTML = `<span style="font-size:10.5px;color:rgba(255,255,255,0.4)">No platform activity recorded</span>`;
    }
  }

  // Difficulty Chips
  const diffList = document.getElementById("difficultyBreakdownList");
  if (diffList) {
    diffList.innerHTML = "";
    const diffs = data.difficultyBreakdown || { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 };
    Object.entries(diffs).forEach(([name, count]) => {
      const chip = document.createElement("span");
      chip.className = `diff-chip ${name.toLowerCase()}`;
      chip.textContent = `${name}: ${count}`;
      diffList.appendChild(chip);
    });
  }

  // Language Breakdown
  const langList = document.getElementById("languageBreakdownList");
  if (langList) {
    langList.innerHTML = "";
    if (Array.isArray(data.languageBreakdown) && data.languageBreakdown.length > 0) {
      data.languageBreakdown.slice(0, 5).forEach((l) => {
        const row = document.createElement("div");
        row.className = "lang-row";
        row.innerHTML = `
          <div class="lang-header">
            <span>${l.language}</span>
            <span>${l.percentage}% (${l.count})</span>
          </div>
          <div class="lang-track">
            <div class="lang-fill" style="width: ${Math.min(100, Math.max(2, l.percentage))}%"></div>
          </div>
        `;
        langList.appendChild(row);
      });
    } else {
      langList.innerHTML = `<span style="font-size:10.5px;color:rgba(255,255,255,0.4)">No language activity recorded</span>`;
    }
  }

  // Multi-repository Breakdown
  const repoGroup = document.getElementById("repoBreakdownGroup");
  const repoList = document.getElementById("repoBreakdownList");
  if (repoGroup && repoList) {
    if (Array.isArray(data.repositoryBreakdown) && data.repositoryBreakdown.length > 1) {
      repoGroup.classList.remove("hidden");
      repoList.innerHTML = "";
      data.repositoryBreakdown.forEach((r) => {
        const row = document.createElement("div");
        row.className = "breakdown-row";
        row.innerHTML = `<span>${r.repository}</span><span class="breakdown-count">${r.count}</span>`;
        repoList.appendChild(row);
      });
    } else {
      repoGroup.classList.add("hidden");
    }
  }

  // Automation Insights
  const insightsText = document.getElementById("automationInsightsText");
  if (insightsText && data.automationInsights) {
    const ai = data.automationInsights;
    insightsText.textContent = `Automation: ${ai.skippedByFilters || 0} filtered • ${ai.duplicateSkips || 0} duplicates skipped • ${ai.retryRecoveries || 0} retries recovered`;
  }
}

function renderActivityChart(timeline) {
  const container = document.getElementById("activityChartBars");
  if (!container || !Array.isArray(timeline)) return;
  container.innerHTML = "";

  const maxVal = Math.max(1, ...timeline.map((t) => t.synced || 0));
  timeline.forEach((item) => {
    const col = document.createElement("div");
    col.className = "chart-bar-col";
    col.title = `${item.date}: ${item.synced} synced, ${item.skipped} skipped`;

    const fill = document.createElement("div");
    fill.className = item.synced > 0 ? "chart-bar-fill" : "chart-bar-fill zero";
    const heightPct = item.synced > 0 ? Math.max(15, Math.round((item.synced / maxVal) * 100)) : 6;
    fill.style.height = `${heightPct}%`;

    col.appendChild(fill);
    container.appendChild(col);
  });
}

// Range pill clicks
document.querySelectorAll(".analytics-range-pills .range-pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll(".analytics-range-pills .range-pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    currentAnalyticsRange = pill.getAttribute("data-range") || "30d";
    renderAnalyticsSection();
  });
});

// Upgrade button in analytics teaser
const upgradeForAnalyticsBtn = document.getElementById("upgradeForAnalyticsBtn");
if (upgradeForAnalyticsBtn) {
  upgradeForAnalyticsBtn.addEventListener("click", () => {
    if (typeof openCheckout === "function") openCheckout("monthly");
  });
}

// Export CSV / JSON buttons
const exportCsvBtn = document.getElementById("exportCsvBtn");
if (exportCsvBtn) {
  exportCsvBtn.addEventListener("click", async () => {
    const { userSession, cachedAnalyticsEvents } = await chrome.storage.local.get(["userSession", "cachedAnalyticsEvents"]);
    if (userSession && userSession.token) {
      const backendBase = (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_URL) || "https://api.fly2git.com";
      const url = `${backendBase}/api/analytics/export?format=csv`;
      chrome.tabs.create({ url });
    } else {
      // Local fallback export
      const events = Array.isArray(cachedAnalyticsEvents) ? cachedAnalyticsEvents : [];
      const headers = ["date", "platform", "problemSlug", "difficulty", "language", "action", "status"];
      const rows = [headers.join(",")];
      events.forEach((e) => {
        rows.push([
          JSON.stringify(new Date(e.timestamp || Date.now()).toISOString()),
          JSON.stringify(e.platform || ""),
          JSON.stringify(e.problemSlug || ""),
          JSON.stringify(e.difficulty || ""),
          JSON.stringify(e.language || ""),
          JSON.stringify(e.action || ""),
          JSON.stringify(e.syncStatus || ""),
        ].join(","));
      });
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = `fly2git_analytics_${Date.now()}.csv`;
      a.click();
    }
  });
}

const exportJsonBtn = document.getElementById("exportJsonBtn");
if (exportJsonBtn) {
  exportJsonBtn.addEventListener("click", async () => {
    const { userSession, cachedAnalyticsEvents } = await chrome.storage.local.get(["userSession", "cachedAnalyticsEvents"]);
    if (userSession && userSession.token) {
      const backendBase = (typeof FLY2GIT_CONFIG !== "undefined" && FLY2GIT_CONFIG.BACKEND_URL) || "https://api.fly2git.com";
      const url = `${backendBase}/api/analytics/export?format=json`;
      chrome.tabs.create({ url });
    } else {
      const events = Array.isArray(cachedAnalyticsEvents) ? cachedAnalyticsEvents : [];
      const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = `fly2git_analytics_${Date.now()}.json`;
      a.click();
    }
  });
}

// Delete Analytics Data button
const deleteAnalyticsBtn = document.getElementById("deleteAnalyticsBtn");
if (deleteAnalyticsBtn) {
  deleteAnalyticsBtn.addEventListener("click", async () => {
    if (!confirm("Delete your personal coding analytics data? This cannot be undone, but will not affect your GitHub repositories.")) {
      return;
    }
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "DELETE_ANALYTICS_DATA" }, resolve);
    });
    await renderAnalyticsSection();
  });
}

document.getElementById("changeRepoBtn").addEventListener("click", showRepoPicker);

document.getElementById("disconnectBtn").addEventListener("click", async () => {
  if (!confirm("Disconnect Fly2Git from GitHub? You'll need to reconnect to sync again.")) return;
  await chrome.runtime.sendMessage({ type: "DISCONNECT" });
  showView("connect");
});

const STATUS_LABELS = {
  added: { icon: "＋", label: "Added" },
  updated: { icon: "↻", label: "Updated" },
  skipped: { icon: "⊘", label: "Already synced" },
  failed: { icon: "✗", label: "Failed" },
  retrying: { icon: "↻", label: "Retrying…" },
};

const ERROR_GUIDANCE = {
  AUTH_EXPIRED: "GitHub authorization expired. Please reconnect.",
  PERMISSION: "Write permission missing for this repository. Grant access in GitHub.",
  NOT_FOUND: "Repository not found or access was revoked.",
  RATE_LIMIT: "GitHub API rate limit reached. Please wait a few minutes.",
  VALIDATION: "Submission rejected by validation checks.",
  ENTITLEMENT: "Platform not active in current plan.",
  CONFIG: "No repository selected. Select a repository.",
  NETWORK: "Network unavailable. Check your connection.",
  UNKNOWN: "Sync failed. Check repository settings.",
  IDENTITY_BINDING_REQUIRED: "New coding account detected. Confirm in popup to enable sync.",
  ACCOUNT_MISMATCH: "Different coding account detected. Automatic sync paused.",
  ACCOUNT_IDENTITY_UNKNOWN: "Account identity unknown. Sync paused for safety.",
};

function formatRelativeTime(ts) {
  if (!ts) return "";
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 45) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

function getPlatformBadge(platform) {
  const p = (platform || "").toLowerCase();
  if (p.includes("leetcode")) return { code: "LC", className: "leetcode", name: "LeetCode" };
  if (p.includes("geeksforgeeks") || p.includes("gfg")) return { code: "GFG", className: "geeksforgeeks", name: "GeeksforGeeks" };
  if (p.includes("hackerrank")) return { code: "HR", className: "hackerrank", name: "HackerRank" };
  if (p.includes("codechef")) return { code: "CC", className: "codechef", name: "CodeChef" };
  if (p.includes("codeforces") || p.includes("cf")) return { code: "CF", className: "codeforces", name: "Codeforces" };
  if (p.includes("atcoder")) return { code: "AC", className: "atcoder", name: "AtCoder" };
  if (p.includes("spoj")) return { code: "SPO", className: "spoj", name: "SPOJ" };
  return { code: (platform || "??").slice(0, 3).toUpperCase(), className: "default", name: platform || "Unknown" };
}

const dismissedPlatforms = new Set();

async function renderIdentityGuard() {
  const banner = document.getElementById("identityGuardBanner");
  const titleEl = document.getElementById("identityGuardTitle");
  const subEl = document.getElementById("identityGuardSubtitle");
  const detailsEl = document.getElementById("identityGuardDetails");
  const useBtn = document.getElementById("identityUseBtn");
  const pauseBtn = document.getElementById("identityPauseBtn");

  if (!banner || !titleEl || !detailsEl || !useBtn || !pauseBtn) return;

  const res = await chrome.runtime.sendMessage({ type: "GET_PLATFORM_IDENTITIES" });
  const allIdentities = (res && res.ok && res.identities) || {};

  const platforms = Object.keys(allIdentities);
  let pendingPlatform = null;
  let pendingData = null;

  for (const p of platforms) {
    if (dismissedPlatforms.has(p)) continue;
    const entry = allIdentities[p];
    if (entry && (entry.status === "IDENTITY_BINDING_REQUIRED" || entry.status === "ACCOUNT_MISMATCH")) {
      pendingPlatform = p;
      pendingData = entry;
      break;
    }
  }

  if (!pendingPlatform || !pendingData) {
    banner.classList.add("hidden");
    return;
  }

  const reg = typeof Fly2GitPlatforms !== "undefined" && Fly2GitPlatforms.PLATFORM_REGISTRY && Fly2GitPlatforms.PLATFORM_REGISTRY[pendingPlatform];
  const platformName = reg ? reg.name : pendingPlatform;

  clearChildren(detailsEl);

  if (pendingData.status === "IDENTITY_BINDING_REQUIRED") {
    titleEl.textContent = "New coding account detected";
    if (subEl) subEl.textContent = "Verify this account to allow automatic GitHub sync:";

    const cur = pendingData.current || {};
    const username = cur.username || cur.platformUserId || "Unknown";

    const pRow = document.createElement("div");
    pRow.className = "identity-row";
    pRow.innerHTML = `<span class="label">Platform:</span><span class="value">${platformName}</span>`;

    const uRow = document.createElement("div");
    uRow.className = "identity-row";
    uRow.innerHTML = `<span class="label">Username:</span><span class="value">${username}</span>`;

    detailsEl.appendChild(pRow);
    detailsEl.appendChild(uRow);
  } else if (pendingData.status === "ACCOUNT_MISMATCH") {
    titleEl.textContent = "Different coding account detected";
    if (subEl) subEl.textContent = "Automatic sync paused. Account differs from bound account:";

    const cur = pendingData.current || {};
    const bound = pendingData.bound || {};

    const curUser = cur.username || cur.platformUserId || "Unknown";
    const boundUser = bound.username || bound.platformUserId || "Unknown";

    const pRow = document.createElement("div");
    pRow.className = "identity-row";
    pRow.innerHTML = `<span class="label">Platform:</span><span class="value">${platformName}</span>`;

    const cRow = document.createElement("div");
    cRow.className = "identity-row";
    cRow.innerHTML = `<span class="label">Current account:</span><span class="value">${curUser}</span>`;

    const bRow = document.createElement("div");
    bRow.className = "identity-row";
    bRow.innerHTML = `<span class="label">Bound account:</span><span class="value">${boundUser}</span>`;

    detailsEl.appendChild(pRow);
    detailsEl.appendChild(cRow);
    detailsEl.appendChild(bRow);
  }

  banner.classList.remove("hidden");

  useBtn.onclick = async () => {
    useBtn.disabled = true;
    useBtn.textContent = "Binding…";
    try {
      await chrome.runtime.sendMessage({
        type: "BIND_PLATFORM_IDENTITY",
        platform: pendingPlatform,
        identity: pendingData.current,
      });
      dismissedPlatforms.delete(pendingPlatform);
      await renderIdentityGuard();
      await renderSyncLog();
    } catch (e) {
      console.error("Binding failed:", e);
    } finally {
      useBtn.disabled = false;
      useBtn.textContent = "Use this account";
    }
  };

  pauseBtn.onclick = () => {
    dismissedPlatforms.add(pendingPlatform);
    banner.classList.add("hidden");
  };
}

async function renderLastSyncBanner() {
  const banner = document.getElementById("lastSyncBanner");
  if (!banner) return;
  const { lastSync } = await chrome.storage.local.get("lastSync");
  if (!lastSync || !lastSync.text || Date.now() - (lastSync.time || 0) > 86400000) {
    banner.classList.add("hidden");
    return;
  }
  banner.className = "last-sync-banner " + (lastSync.ok ? "success" : "error");
  document.getElementById("lastSyncIcon").textContent = lastSync.ok ? "✓" : "✗";
  document.getElementById("lastSyncText").textContent = lastSync.text;
  document.getElementById("lastSyncTime").textContent = formatRelativeTime(lastSync.time);
  banner.classList.remove("hidden");
}

async function renderSyncLog() {
  const { syncLog = [] } = await chrome.storage.local.get("syncLog");
  const list = document.getElementById("syncLogList");
  const clearBtn = document.getElementById("clearSyncLogBtn");
  if (!list) return;
  clearChildren(list);

  if (clearBtn) {
    if (syncLog.length > 0) {
      clearBtn.classList.remove("hidden");
    } else {
      clearBtn.classList.add("hidden");
    }
  }

  if (syncLog.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    const wrap = document.createElement("div");
    wrap.className = "empty-state-wrap";
    wrap.innerHTML = `
      <span class="empty-state-icon">⚡</span>
      <span class="empty-state-title">No solutions synced yet</span>
      <span class="empty-state-desc">Solve an accepted problem on any enabled platform to sync automatically.</span>
    `;
    empty.appendChild(wrap);
    list.appendChild(empty);
    return;
  }

  for (const entry of syncLog.slice(0, 15)) {
    const li = document.createElement("li");
    li.dataset.status = entry.status;
    const meta = STATUS_LABELS[entry.status] || { icon: "•", label: entry.status };
    const pBadge = getPlatformBadge(entry.platform);

    // Main row: icon, platform badge, title, status + time
    const mainRow = document.createElement("div");
    mainRow.className = "log-main-row";

    const iconSpan = document.createElement("span");
    iconSpan.className = "log-icon";
    iconSpan.textContent = meta.icon;

    const platBadgeSpan = document.createElement("span");
    platBadgeSpan.className = "platform-tag " + pBadge.className;
    platBadgeSpan.textContent = pBadge.code;
    platBadgeSpan.title = pBadge.name;

    const titleSpan = document.createElement("span");
    titleSpan.className = "log-title";
    if (entry.githubUrl) {
      const link = document.createElement("a");
      link.href = entry.githubUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = entry.title || "Untitled Solution";
      titleSpan.appendChild(link);
    } else {
      titleSpan.textContent = entry.title || "Untitled Solution";
    }

    const metaSpan = document.createElement("span");
    metaSpan.className = "log-meta";
    metaSpan.textContent = `${meta.label} · ${formatRelativeTime(entry.time)}`;

    mainRow.append(iconSpan, platBadgeSpan, titleSpan, metaSpan);
    li.appendChild(mainRow);

    // Sub-row: language and difficulty badges
    if (entry.lang || (entry.difficulty && entry.difficulty !== "Unknown")) {
      const subRow = document.createElement("div");
      subRow.className = "log-sub-row";

      if (entry.lang) {
        const langSpan = document.createElement("span");
        langSpan.className = "badge-tag";
        langSpan.textContent = entry.lang;
        subRow.appendChild(langSpan);
      }

      if (entry.difficulty && entry.difficulty !== "Unknown") {
        const diffSpan = document.createElement("span");
        const diffKey = entry.difficulty.toLowerCase();
        diffSpan.className = "badge-tag diff-" + diffKey;
        diffSpan.textContent = entry.difficulty;
        subRow.appendChild(diffSpan);
      }

      li.appendChild(subRow);
    }

    // Actionable error UX: show clear, guided reason on failure
    if (entry.status === "failed") {
      const errorDiv = document.createElement("div");
      errorDiv.className = "log-error-detail";
      const guidedText = (entry.code && ERROR_GUIDANCE[entry.code]) || entry.reason || "Sync failed. Check repository settings.";
      errorDiv.textContent = guidedText;
      li.appendChild(errorDiv);
    }

    list.appendChild(li);
  }
}

const clearBtn = document.getElementById("clearSyncLogBtn");
if (clearBtn) {
  clearBtn.addEventListener("click", async () => {
    if (!confirm("Clear recent sync history?")) return;
    await chrome.runtime.sendMessage({ type: "CLEAR_SYNC_LOG" });
    await renderSyncLog();
  });
}

// ==========================================================================
// AI Coding Intelligence UI (Phase 15B)
// ==========================================================================

let currentAIFeature = "analyze";
let currentHintLevel = 1;
let currentProblemContext = null;
let aiUIInitialized = false;

let problemQuickActionsBound = false;

function setupProblemQuickActions() {
  if (problemQuickActionsBound) return;
  const qAnalyze = document.getElementById("quickAnalyzeBtn");
  const qExplain = document.getElementById("quickExplainBtn");
  const qHint = document.getElementById("quickHintBtn");

  if (qAnalyze) {
    qAnalyze.addEventListener("click", () => {
      const tabAnalyze = document.getElementById("aiTabAnalyze");
      if (tabAnalyze) tabAnalyze.click();
      const executeBtn = document.getElementById("aiExecuteBtn");
      if (executeBtn) executeBtn.click();
    });
  }
  if (qExplain) {
    qExplain.addEventListener("click", () => {
      const tabExplain = document.getElementById("aiTabExplain");
      if (tabExplain) tabExplain.click();
      const executeBtn = document.getElementById("aiExecuteBtn");
      if (executeBtn) executeBtn.click();
    });
  }
  if (qHint) {
    qHint.addEventListener("click", () => {
      const tabHint = document.getElementById("aiTabHint");
      if (tabHint) tabHint.click();
      const executeBtn = document.getElementById("aiExecuteBtn");
      if (executeBtn) executeBtn.click();
    });
  }
  problemQuickActionsBound = true;
}

// ==========================================================================
// Phase 16.4: Post-Acceptance Complexity Intelligence
// ==========================================================================

let complexityActionsBound = false;

function setupComplexityActions() {
  if (complexityActionsBound) return;
  const analyzeBtn = document.getElementById("analyzeComplexityBtn");
  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", () => {
      setComplexityLoading(true);
      const qAnalyze = document.getElementById("quickAnalyzeBtn");
      if (qAnalyze) {
        qAnalyze.click();
      }
    });
  }
  complexityActionsBound = true;
}

function setComplexityLoading(loadingState = true) {
  const overlay = document.getElementById("complexityLoadingOverlay");
  const timeVal = document.getElementById("complexityTimeValue");
  const spaceVal = document.getElementById("complexitySpaceValue");
  if (loadingState) {
    if (overlay) overlay.classList.remove("hidden");
    if (timeVal) timeVal.textContent = "—";
    if (spaceVal) spaceVal.textContent = "—";
  } else {
    if (overlay) overlay.classList.add("hidden");
  }
}

function setComplexityUnavailable(reason) {
  const grid = document.getElementById("complexityGrid");
  const measuredSec = document.getElementById("complexityMeasuredSection");
  const whySec = document.getElementById("complexityWhySection");
  const empty = document.getElementById("complexityEmptyBox");
  const emptyMsg = document.getElementById("complexityEmptyMsg");

  if (grid) grid.classList.add("hidden");
  if (measuredSec) measuredSec.classList.add("hidden");
  if (whySec) whySec.classList.add("hidden");
  if (empty) empty.classList.remove("hidden");
  if (emptyMsg) emptyMsg.textContent = reason || "Time / Space analysis unavailable.";
}

function renderComplexityCard(input, options = {}) {
  const section = document.getElementById("problemComplexitySection");
  if (!section) return null;

  const timeVal = document.getElementById("complexityTimeValue");
  const timeHum = document.getElementById("complexityTimeHuman");
  const timeSrc = document.getElementById("complexityTimeSource");

  const spaceVal = document.getElementById("complexitySpaceValue");
  const spaceHum = document.getElementById("complexitySpaceHuman");
  const spaceSrc = document.getElementById("complexitySpaceSource");

  const confDot = document.getElementById("complexityConfidenceDot");
  const confText = document.getElementById("complexityConfidenceText");

  const measuredSec = document.getElementById("complexityMeasuredSection");
  const measuredSrc = document.getElementById("complexityMeasuredSource");
  const measuredGrid = document.getElementById("complexityMeasuredMetrics");
  const measuredUnavail = document.getElementById("complexityMeasuredUnavailable");
  const runtimeVal = document.getElementById("complexityRuntimeVal");
  const memoryVal = document.getElementById("complexityMemoryVal");

  const whyText = document.getElementById("complexityWhyText");
  const histAnchor = document.getElementById("complexityHistoryAnchor");
  const histText = document.getElementById("complexityHistoryText");

  const grid = document.getElementById("complexityGrid");
  const loading = document.getElementById("complexityLoadingOverlay");
  const empty = document.getElementById("complexityEmptyBox");

  const complexityMod = typeof Fly2GitComplexity !== "undefined"
    ? Fly2GitComplexity
    : (typeof require === "function" ? require("./complexity-service") : null);

  const model = complexityMod ? complexityMod.normalizeComplexity(input, options) : input;

  if (loading) loading.classList.add("hidden");
  if (empty) empty.classList.add("hidden");
  if (grid) grid.classList.remove("hidden");
  if (measuredSec) measuredSec.classList.remove("hidden");

  // Time Big-O
  if (timeVal) timeVal.textContent = model.time?.value || "O(n)";
  if (timeSrc) timeSrc.textContent = model.time?.source || "AI ANALYSIS";
  if (timeHum) {
    if (model.time?.label && model.time?.confidence !== "low") {
      timeHum.textContent = model.time.label;
      timeHum.classList.remove("hidden");
    } else {
      timeHum.classList.add("hidden");
    }
  }

  // Space Big-O
  if (spaceVal) spaceVal.textContent = model.space?.value || "O(1)";
  if (spaceSrc) spaceSrc.textContent = model.space?.source || "AI ANALYSIS";
  if (spaceHum) {
    if (model.space?.label && model.space?.confidence !== "low") {
      spaceHum.textContent = model.space.label;
      spaceHum.classList.remove("hidden");
    } else {
      spaceHum.classList.add("hidden");
    }
  }

  // Confidence
  const conf = model.time?.confidence || "medium";
  if (confDot) {
    confDot.className = `confidence-indicator-dot ${conf}`;
  }
  if (confText) {
    if (conf === "low") {
      confText.textContent = "LOW CONFIDENCE";
    } else if (conf === "high") {
      confText.textContent = "HIGH CONFIDENCE";
    } else {
      confText.textContent = "MEDIUM CONFIDENCE";
    }
  }

  // Measured Platform Metrics (Runtime / Memory)
  const runtimeOk = Boolean(model.measured?.runtime?.available && model.measured?.runtime?.value);
  const memoryOk = Boolean(model.measured?.memory?.available && model.measured?.memory?.value);

  if (runtimeOk || memoryOk) {
    if (measuredGrid) measuredGrid.classList.remove("hidden");
    if (measuredUnavail) measuredUnavail.classList.add("hidden");
    if (runtimeVal) runtimeVal.textContent = runtimeOk ? model.measured.runtime.value : "—";
    if (memoryVal) memoryVal.textContent = memoryOk ? model.measured.memory.value : "—";
    if (measuredSrc) measuredSrc.textContent = (runtimeOk ? model.measured.runtime.source : model.measured.memory.source) || "PLATFORM";
  } else {
    if (measuredGrid) measuredGrid.classList.add("hidden");
    if (measuredUnavail) measuredUnavail.classList.remove("hidden");
    if (measuredSrc) measuredSrc.textContent = "PLATFORM";
  }

  // Why section
  if (whyText) {
    if (model.confidenceMessage && conf === "low") {
      whyText.textContent = `${model.confidenceMessage} ${model.why || ""}`.trim();
    } else {
      whyText.textContent = model.why || "Complexity is determined by solution iteration bounds and data structure allocations.";
    }
  }

  // History comparison
  if (histAnchor && histText) {
    if (model.userHistory?.relevant && model.userHistory?.text) {
      histText.textContent = model.userHistory.text;
      histAnchor.classList.remove("hidden");
    } else {
      histAnchor.classList.add("hidden");
    }
  }

  // Record metadata-only complexity_viewed event (no source code)
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: "complexity_viewed",
        payload: {
          platform: options.platform || "unknown",
          timestamp: Date.now(),
        },
      }).catch(() => {});
    }
  } catch (_) {}

  setupComplexityActions();
  return model;
}

async function loadProblemComplexity(platform, slug) {
  try {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      return renderComplexityCard({}, { platform });
    }
    const data = await chrome.storage.local.get(["latestProblemComplexity"]);
    const saved = data && data.latestProblemComplexity;

    if (saved && (saved.problemSlug === slug || !slug || saved.platform === platform)) {
      renderComplexityCard(saved, { platform });
    } else {
      renderComplexityCard({
        platform: platform || "Platform",
        time: "O(n)",
        space: "O(1)",
        source: "AI ANALYSIS",
        confidence: "medium",
        measured: {
          runtime: (saved && saved.measured && saved.measured.runtime) || null,
          memory: (saved && saved.measured && saved.measured.memory) || null,
        },
      }, { platform });
    }
  } catch (err) {
    // Non-blocking failure isolation
    console.warn("[Fly2Git] Complexity load error (safe fallback):", err);
  }
}

async function detectCurrentProblemContext() {
  const platformEl = document.getElementById("aiContextPlatform");
  const titleEl = document.getElementById("aiContextTitle");
  const activeBox = document.getElementById("activeSessionBox");
  const noActiveBox = document.getElementById("noActiveSessionBox");
  const platLogo = document.getElementById("currentProblemPlatformLogo");
  const platName = document.getElementById("currentProblemPlatformName");
  const probTitle = document.getElementById("currentProblemTitle");
  const diffBadge = document.getElementById("currentProblemDifficulty");
  const langBadge = document.getElementById("currentProblemLanguage");
  const syncStatus = document.getElementById("currentProblemSyncStatus");
  const contextRelRow = document.getElementById("currentProblemContextRelation");

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.url) {
      if (platformEl) platformEl.textContent = "Offline";
      if (titleEl) titleEl.textContent = "No active problem tab detected";
      if (activeBox) activeBox.classList.add("hidden");
      if (noActiveBox) noActiveBox.classList.remove("hidden");
      if (contextRelRow) contextRelRow.classList.add("hidden");
      currentProblemContext = null;
      return null;
    }

    const url = tab.url;
    let platform = null;
    let slug = null;

    if (url.includes("leetcode.com/problems/")) {
      platform = "leetcode";
      const match = url.match(/leetcode\.com\/problems\/([^/?#]+)/);
      slug = match ? match[1] : null;
    } else if (url.includes("geeksforgeeks.org/problems/")) {
      platform = "geeksforgeeks";
      const match = url.match(/geeksforgeeks\.org\/problems\/([^/?#]+)/);
      slug = match ? match[1] : null;
    } else if (url.includes("hackerrank.com/challenges/")) {
      platform = "hackerrank";
      const match = url.match(/hackerrank\.com\/challenges\/([^/?#]+)/);
      slug = match ? match[1] : null;
    } else if (url.includes("codechef.com/problems/")) {
      platform = "codechef";
      const match = url.match(/codechef\.com\/problems\/([^/?#]+)/);
      slug = match ? match[1] : null;
    } else if (url.includes("codeforces.com/problemset/problem/")) {
      platform = "codeforces";
      const match = url.match(/codeforces\.com\/problemset\/problem\/([^/?#]+)/);
      slug = match ? match[1] : null;
    } else if (url.includes("atcoder.jp/contests/") && url.includes("/tasks/")) {
      platform = "atcoder";
      const match = url.match(/\/tasks\/([^/?#]+)/);
      slug = match ? match[1] : null;
    } else if (url.includes("spoj.com/problems/")) {
      platform = "spoj";
      const match = url.match(/spoj\.com\/problems\/([^/?#]+)/);
      slug = match ? match[1] : null;
    }

    if (platform && slug) {
      const cleanTitle = (tab.title || slug)
        .replace(/ - LeetCode.*$/i, "")
        .replace(/ - GeeksforGeeks.*$/i, "")
        .replace(/ \| HackerRank.*$/i, "")
        .replace(/ \| CodeChef.*$/i, "")
        .replace(/ - Codeforces.*$/i, "")
        .replace(/ - AtCoder.*$/i, "")
        .replace(/ - SPOJ.*$/i, "")
        .trim();

      currentProblemContext = {
        platform,
        slug,
        problemSlug: slug,
        title: cleanTitle || slug,
        url,
      };

      if (platformEl) platformEl.textContent = platform;
      if (titleEl) titleEl.textContent = cleanTitle || slug;

      if (activeBox) activeBox.classList.remove("hidden");
      if (noActiveBox) noActiveBox.classList.add("hidden");
      if (platLogo) platLogo.src = getPlatformLogoSrc(platform);
      if (platName) {
        const reg = typeof Fly2GitPlatforms !== "undefined" ? Fly2GitPlatforms.PLATFORM_REGISTRY : null;
        platName.textContent = (reg && reg[platform]?.name) || platform.toUpperCase();
      }
      if (probTitle) probTitle.textContent = cleanTitle || slug;
      if (diffBadge) {
        diffBadge.textContent = "Medium";
        diffBadge.className = "diff-badge medium";
      }
      if (langBadge) {
        langBadge.textContent = "Detected";
      }
      if (syncStatus) {
        syncStatus.textContent = "Sync ready";
      }

      setupProblemQuickActions();
      loadProblemComplexity(platform, slug);
      return currentProblemContext;
    }

    // Fallback if not on a recognized problem page
    if (platformEl) platformEl.textContent = "Ready";
    if (titleEl) titleEl.textContent = "Open LeetCode/GFG to analyze current problem";
    if (activeBox) activeBox.classList.add("hidden");
    if (noActiveBox) noActiveBox.classList.remove("hidden");
    if (contextRelRow) contextRelRow.classList.add("hidden");
    currentProblemContext = {
      platform: "unknown",
      slug: "current-problem",
      problemSlug: "current-problem",
      title: "Current Problem",
      url: "",
    };
    return currentProblemContext;
  } catch (err) {
    if (platformEl) platformEl.textContent = "Ready";
    if (titleEl) titleEl.textContent = "Ready for coding intelligence";
    if (activeBox) activeBox.classList.add("hidden");
    if (noActiveBox) noActiveBox.classList.remove("hidden");
    if (contextRelRow) contextRelRow.classList.add("hidden");
    return null;
  }
}

async function renderAISection() {
  const card = document.getElementById("aiIntelligenceCard");
  if (!card) return;

  // 1. Entitlement check
  let isPro = false;
  try {
    const ent = await Fly2GitEntitlements.getEntitlement();
    isPro = await Fly2GitEntitlements.isPro(ent);
  } catch (_) {}

  const badge = document.getElementById("aiPlanBadge");
  if (badge) {
    badge.textContent = isPro ? "PRO" : "BASIC";
    badge.className = isPro ? "plan-pill pro" : "plan-pill basic";
  }

  // 2. Problem context detection
  await detectCurrentProblemContext();

  // 3. Event listeners (setup once)
  if (aiUIInitialized) return;
  aiUIInitialized = true;

  const tabAnalyze = document.getElementById("aiTabAnalyze");
  const tabExplain = document.getElementById("aiTabExplain");
  const tabHint = document.getElementById("aiTabHint");
  const hintSelectorRow = document.getElementById("aiHintSelectorRow");
  const executeBtn = document.getElementById("aiExecuteBtn");
  const executeBtnText = document.getElementById("aiExecuteBtnText");
  const refreshBtn = document.getElementById("aiRefreshContextBtn");
  const toggleErrorBtn = document.getElementById("aiToggleErrorBtn");
  const errorBox = document.getElementById("aiErrorBox");

  function setFeature(feature) {
    currentAIFeature = feature;
    [tabAnalyze, tabExplain, tabHint].forEach((btn) => {
      if (btn) btn.classList.toggle("active", btn.getAttribute("data-feature") === feature);
    });

    if (hintSelectorRow) {
      hintSelectorRow.classList.toggle("hidden", feature !== "hint");
    }

    if (executeBtnText) {
      if (feature === "analyze") executeBtnText.textContent = "Run AI Analyze";
      else if (feature === "explain") executeBtnText.textContent = "Explain Solution";
      else if (feature === "hint") executeBtnText.textContent = `Get Level ${currentHintLevel} Hint`;
    }
  }

  if (tabAnalyze) tabAnalyze.addEventListener("click", () => setFeature("analyze"));
  if (tabExplain) tabExplain.addEventListener("click", () => setFeature("explain"));
  if (tabHint) tabHint.addEventListener("click", () => setFeature("hint"));

  // Hint Depth Selector
  const hintPills = document.querySelectorAll(".hint-depth-pill");
  hintPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      hintPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      currentHintLevel = parseInt(pill.getAttribute("data-level"), 10) || 1;
      if (executeBtnText && currentAIFeature === "hint") {
        executeBtnText.textContent = `Get Level ${currentHintLevel} Hint`;
      }
    });
  });

  // Toggle Error Input
  if (toggleErrorBtn && errorBox) {
    toggleErrorBtn.addEventListener("click", () => {
      errorBox.classList.toggle("hidden");
    });
  }

  // Refresh context
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.textContent = "…";
      await detectCurrentProblemContext();
      refreshBtn.textContent = "↻";
    });
  }

  // Execute Button
  if (executeBtn) {
    executeBtn.addEventListener("click", async () => {
      await runAIOperation();
    });
  }
}

async function runAIOperation() {
  const loadingBox = document.getElementById("aiLoadingBox");
  const errorBoxNotice = document.getElementById("aiErrorBoxNotice");
  const resultsContainer = document.getElementById("aiResultsContainer");
  const executeBtn = document.getElementById("aiExecuteBtn");
  const errorInput = document.getElementById("aiErrorInput");

  if (loadingBox) loadingBox.classList.remove("hidden");
  if (errorBoxNotice) errorBoxNotice.classList.add("hidden");
  if (resultsContainer) resultsContainer.classList.add("hidden");
  if (executeBtn) executeBtn.disabled = true;

  const problem = currentProblemContext || {
    platform: "leetcode",
    slug: "current-problem",
    title: "Current Problem",
    url: "",
  };

  const errorText = errorInput && errorInput.value ? errorInput.value.trim() : "";

  const payload = {
    feature: currentAIFeature,
    platform: problem.platform || "leetcode",
    problem: {
      slug: problem.slug || "unknown",
      title: problem.title || "Current Problem",
      difficulty: "Medium",
      url: problem.url || "",
    },
    code: "// Active solution from editor",
    language: "python3",
    errorContext: errorText || undefined,
    userQuestion: currentAIFeature === "hint" ? `Provide Level ${currentHintLevel} hint` : undefined,
    metadata: {
      hintLevel: currentHintLevel,
    },
  };

  try {
    const client = typeof Fly2GitAIClient !== "undefined" ? Fly2GitAIClient : require("./ai-client");
    const result = await client.generate(payload);

    if (loadingBox) loadingBox.classList.add("hidden");
    if (executeBtn) executeBtn.disabled = false;

    if (result.status === "error") {
      showAINotice("AI Request Failed", result.errorMessage || "Unable to complete AI operation.");
      return;
    }

    renderAIResult(result.answer, currentAIFeature);
  } catch (err) {
    if (loadingBox) loadingBox.classList.add("hidden");
    if (executeBtn) executeBtn.disabled = false;
    showAINotice("AI Request Failed", err.message || "Network error. Please try again.");
  }
}

function showAINotice(title, text) {
  const errorBoxNotice = document.getElementById("aiErrorBoxNotice");
  const noticeTitle = document.getElementById("aiNoticeTitle");
  const noticeText = document.getElementById("aiNoticeText");
  if (noticeTitle) noticeTitle.textContent = title;
  if (noticeText) noticeText.textContent = text;
  if (errorBoxNotice) errorBoxNotice.classList.remove("hidden");
}

function renderAIResult(answer, feature) {
  const resultsContainer = document.getElementById("aiResultsContainer");
  if (!resultsContainer) return;
  resultsContainer.innerHTML = "";
  resultsContainer.classList.remove("hidden");

  if (!answer || typeof answer !== "object") {
    resultsContainer.textContent = String(answer || "No response received");
    return;
  }

  if (feature === "analyze") {
    // Header with Confidence badge
    const header = document.createElement("div");
    header.className = "ai-res-header";
    const titleSpan = document.createElement("strong");
    titleSpan.textContent = answer.approach || "Approach Analysis";
    const badgeSpan = document.createElement("span");
    const conf = (answer.confidence || "high").toLowerCase();
    badgeSpan.className = `ai-res-badge ${conf}`;
    badgeSpan.textContent = `${conf} confidence`;
    header.appendChild(titleSpan);
    header.appendChild(badgeSpan);
    resultsContainer.appendChild(header);

    // Summary
    const summaryP = document.createElement("p");
    summaryP.style.margin = "0 0 6px";
    summaryP.textContent = answer.summary || "";
    resultsContainer.appendChild(summaryP);

    // Complexity
    if (answer.complexity) {
      const compBar = document.createElement("div");
      compBar.className = "ai-complexity-bar";
      compBar.innerHTML = `<span class="ai-complexity-pill">Time: ${escapeHTML(answer.complexity.time || "O(N)")}</span><span class="ai-complexity-pill">Space: ${escapeHTML(answer.complexity.space || "O(1)")}</span>`;
      resultsContainer.appendChild(compBar);
      try {
        renderComplexityCard({
          time: answer.complexity.time,
          space: answer.complexity.space,
          explanation: answer.complexity.explanation || answer.summary,
          confidence: answer.confidence || "high",
          source: "AI ANALYSIS",
        }, { platform: currentProblemContext?.platform });
      } catch (_) {}
    }

    // Strengths
    if (Array.isArray(answer.strengths) && answer.strengths.length > 0) {
      appendSection(resultsContainer, "Strengths", answer.strengths);
    }

    // Concerns
    if (Array.isArray(answer.concerns) && answer.concerns.length > 0) {
      appendSection(resultsContainer, "Areas for Attention", answer.concerns);
    }

    // Improvements
    if (Array.isArray(answer.improvements) && answer.improvements.length > 0) {
      appendSection(resultsContainer, "Suggested Improvements", answer.improvements);
    }

    // Edge Cases
    if (Array.isArray(answer.edgeCases) && answer.edgeCases.length > 0) {
      appendSection(resultsContainer, "Edge Cases to Verify", answer.edgeCases);
    }
  } else if (feature === "explain") {
    // Summary
    const summaryP = document.createElement("p");
    summaryP.style.margin = "0 0 8px";
    summaryP.style.fontWeight = "500";
    summaryP.textContent = answer.summary || "";
    resultsContainer.appendChild(summaryP);

    // Step-by-step
    if (Array.isArray(answer.stepByStep) && answer.stepByStep.length > 0) {
      const title = document.createElement("div");
      title.className = "ai-res-section-title";
      title.textContent = "Step-by-Step Walkthrough";
      resultsContainer.appendChild(title);

      answer.stepByStep.forEach((step) => {
        const item = document.createElement("div");
        item.className = "ai-step-item";
        item.textContent = step;
        resultsContainer.appendChild(item);
      });
    }

    // Takeaway
    if (answer.takeaway) {
      const takeawayBox = document.createElement("div");
      takeawayBox.className = "ai-hint-card";
      takeawayBox.innerHTML = `<strong>Key Takeaway:</strong> ${escapeHTML(answer.takeaway)}`;
      resultsContainer.appendChild(takeawayBox);
    }
  } else if (feature === "hint") {
    const hintCard = document.createElement("div");
    hintCard.className = "ai-hint-card";
    const levelLabel = `Level ${answer.hintLevel || currentHintLevel} Hint`;
    hintCard.innerHTML = `<div style="font-size:9.5px;font-weight:700;color:#facc15;margin-bottom:4px;">${escapeHTML(levelLabel)}</div><p>${escapeHTML(answer.hint || "")}</p>`;
    resultsContainer.appendChild(hintCard);

    if (answer.nextQuestion) {
      const qPrompt = document.createElement("div");
      qPrompt.className = "ai-question-prompt";
      qPrompt.textContent = `💡 Question to consider: ${answer.nextQuestion}`;
      resultsContainer.appendChild(qPrompt);
    }
  }
}

function appendSection(container, titleText, items) {
  const title = document.createElement("div");
  title.className = "ai-res-section-title";
  title.textContent = titleText;
  container.appendChild(title);

  const ul = document.createElement("ul");
  ul.className = "ai-res-list";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

// ==========================================================================
// AI Personal Coding Coach (Phase 15C)
// ==========================================================================
let coachInitialized = false;
let currentCoachMode = "daily";

async function renderAICoachSection() {
  const coachCard = document.getElementById("aiCoachCard");
  if (!coachCard) return;

  const streakCount = document.getElementById("coachStreakCount");
  const diffBadge = document.getElementById("coachDifficultyBadge");
  const langBadge = document.getElementById("coachLanguagesBadge");
  const platBadge = document.getElementById("coachPlatformsBadge");

  // Populate metadata from coach context endpoint
  try {
    const session = await getStoredSession();
    if (session && session.token) {
      const backendUrl = getBackendUrl();
      const resp = await fetch(`${backendUrl}/api/coach/context`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        const ctx = data.context || {};
        if (streakCount) streakCount.textContent = ctx.streak || 0;
        if (diffBadge) {
          const med = (ctx.difficulties && ctx.difficulties.Medium) || 0;
          const pct = ctx.totalSynced > 0 ? Math.round((med / ctx.totalSynced) * 100) : 0;
          diffBadge.textContent = `${pct}% Medium`;
        }
        if (langBadge) {
          const lCount = (ctx.languages && ctx.languages.length) || 0;
          langBadge.textContent = `${lCount} language${lCount === 1 ? "" : "s"}`;
        }
        if (platBadge) {
          const pCount = (ctx.platforms && ctx.platforms.length) || 0;
          platBadge.textContent = `${pCount} platform${pCount === 1 ? "" : "s"}`;
        }
      }
    }
  } catch (_) {}

  if (coachInitialized) return;
  coachInitialized = true;

  const modePills = document.querySelectorAll(".coach-mode-pill");
  modePills.forEach((pill) => {
    pill.addEventListener("click", async () => {
      modePills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      currentCoachMode = pill.getAttribute("data-mode") || "daily";
      await runCoachOperation(currentCoachMode);
    });
  });

  const refreshBtn = document.getElementById("coachRefreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      await runCoachOperation(currentCoachMode);
    });
  }

  const startPracticeBtn = document.getElementById("coachStartPracticeBtn");
  if (startPracticeBtn) {
    startPracticeBtn.addEventListener("click", () => {
      const url = currentProblemContext && currentProblemContext.url ? currentProblemContext.url : "https://leetcode.com/problemset/";
      chrome.tabs.create({ url });
    });
  }
}

async function runCoachOperation(mode = "daily") {
  const observedText = document.getElementById("coachObservedText");
  const directionText = document.getElementById("coachDirectionText");
  const directionLabel = document.getElementById("coachDirectionLabel");
  const reflectText = document.getElementById("coachReflectText");
  const balanceGrid = document.getElementById("coachBalanceGrid");
  const startPracticeBtn = document.getElementById("coachStartPracticeBtn");

  if (directionText) directionText.textContent = "Analyzing practice cadence...";
  if (observedText) observedText.textContent = "Evaluating recent problem metrics...";

  if (directionLabel) {
    if (mode === "daily") directionLabel.textContent = "TODAY'S DIRECTION";
    else if (mode === "weekly") directionLabel.textContent = "WEEKLY PRACTICE FOCUS";
    else if (mode === "balance") directionLabel.textContent = "BALANCE GUIDANCE";
    else if (mode === "portfolio") directionLabel.textContent = "PORTFOLIO GUIDANCE";
    else if (mode === "reflection") directionLabel.textContent = "PRACTICE REFLECTION";
  }

  try {
    const client = typeof Fly2GitAIClient !== "undefined" ? Fly2GitAIClient : require("./ai-client");
    const result = await client.coach(mode);

    if (result.status === "error") {
      if (observedText) observedText.textContent = "Coaching insights unavailable.";
      if (directionText) directionText.textContent = result.errorMessage || "Unable to retrieve personal coaching advice.";
      return;
    }

    if (observedText) {
      if (result.observations && result.observations.length > 0) {
        observedText.textContent = result.observations[0];
      } else {
        observedText.textContent = result.summary || "No recent activity recorded.";
      }
      const homeObs = document.getElementById("homeJourneyObservation");
      if (homeObs && observedText.textContent) {
        homeObs.textContent = `"${observedText.textContent}"`;
      }
    }

    if (directionText) {
      directionText.textContent = result.suggestedDirection || "Practice consistently at your current comfort level.";
    }

    if (reflectText) {
      reflectText.textContent = result.reflectionQuestion || "What felt hardest in your recent practice?";
    }

    if (startPracticeBtn) {
      startPracticeBtn.classList.remove("hidden");
    }

    if (balanceGrid) {
      const isBalanceMode = mode === "balance" || mode === "portfolio";
      balanceGrid.classList.toggle("hidden", !isBalanceMode);
      if (isBalanceMode && result.balance) {
        const diffDesc = document.getElementById("balanceDifficultyText");
        const langDesc = document.getElementById("balanceLanguageText");
        const platDesc = document.getElementById("balancePlatformText");
        const consDesc = document.getElementById("balanceConsistencyText");

        if (diffDesc) diffDesc.textContent = result.balance.difficulty?.summary || "--";
        if (langDesc) langDesc.textContent = result.balance.language?.summary || "--";
        if (platDesc) platDesc.textContent = result.balance.platform?.summary || "--";
        if (consDesc) consDesc.textContent = result.balance.consistency?.summary || "--";
      }
    }
  } catch (err) {
    if (directionText) directionText.textContent = "Failed to connect to coaching service.";
  }
}

// ==========================================================================
// Coding Intelligence (Phase 15D)
// ==========================================================================
let intelInitialized = false;

async function renderCodingIntelligenceSection() {
  const intelCard = document.getElementById("codingIntelligenceCard");
  if (!intelCard) return;

  if (!intelInitialized) {
    intelInitialized = true;
    const refreshBtn = document.getElementById("intelRefreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        await renderCodingIntelligenceSection();
      });
    }
  }

  let session = null;
  try {
    session = await getStoredSession();
  } catch (err) {
    console.warn("Failed to retrieve session for coding intelligence:", err);
    session = null;
  }
  if (!session || !session.token) return;

  const backendUrl = getBackendUrl();

  // 1. Current problem context
  if (currentProblemContext && currentProblemContext.problemSlug) {
    const titleEl = document.getElementById("intelProblemTitle");
    const statsRow = document.getElementById("intelProblemStats");
    const observedBadge = document.getElementById("intelObservedCountBadge");
    const samePlatBadge = document.getElementById("intelSamePlatBadge");
    const relatedList = document.getElementById("intelRelatedPillList");

    if (titleEl) {
      titleEl.textContent = `${currentProblemContext.title || "Problem"} (${currentProblemContext.platform || "Platform"})`;
    }

    try {
      const resp = await fetch(`${backendUrl}/api/intelligence/problem-context`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          platform: currentProblemContext.platform,
          problemSlug: currentProblemContext.problemSlug,
          title: currentProblemContext.title,
          difficulty: currentProblemContext.difficulty,
          topics: currentProblemContext.topics || [],
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (statsRow) statsRow.classList.remove("hidden");
        if (observedBadge) {
          const totalMatches = (data.observedHistory && data.observedHistory.totalProblemMatches) || 0;
          observedBadge.textContent = `${totalMatches} related solved`;

          const contextRelRow = document.getElementById("currentProblemContextRelation");
          const contextRelText = document.getElementById("contextRelationText");
          if (contextRelRow && totalMatches > 0) {
            contextRelRow.classList.remove("hidden");
            if (contextRelText) {
              contextRelText.textContent = `${totalMatches} related problem${totalMatches === 1 ? "" : "s"} in your history`;
            }
          }
        }
        if (samePlatBadge) {
          const samePlat = (data.platformHistory && data.platformHistory.currentPlatformCount) || 0;
          samePlatBadge.textContent = `${samePlat} on this platform`;
        }
        if (relatedList && Array.isArray(data.relatedPatterns) && data.relatedPatterns.length > 0) {
          relatedList.classList.remove("hidden");
          clearChildren(relatedList);
          data.relatedPatterns.slice(0, 4).forEach((r) => {
            const pill = document.createElement("span");
            pill.className = "intel-tag-pill";
            pill.textContent = `${r.pattern} (${r.coOccurrenceCount})`;
            relatedList.appendChild(pill);
          });
        }
      }
    } catch (_) {}
  }

  // 2. Pattern Activity
  try {
    const patternResp = await fetch(`${backendUrl}/api/intelligence/patterns?range=30d`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (patternResp.ok) {
      const data = await patternResp.json();
      const listEl = document.getElementById("intelPatternList");
      if (listEl && Array.isArray(data.patterns) && data.patterns.length > 0) {
        clearChildren(listEl);
        data.patterns.slice(0, 5).forEach((p) => {
          const row = document.createElement("div");
          row.className = "intel-item-row";
          const title = document.createElement("span");
          title.className = "intel-item-title";
          title.textContent = p.pattern;
          const meta = document.createElement("span");
          meta.className = "intel-item-meta";
          meta.textContent = `${p.count} solved · ${(p.platforms || []).join(", ") || "various"}`;
          row.appendChild(title);
          row.appendChild(meta);
          listEl.appendChild(row);
        });
      }
    }
  } catch (_) {}

  // 3. Coding Journey
  try {
    const journeyResp = await fetch(`${backendUrl}/api/intelligence/journey?range=all`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (journeyResp.ok) {
      const data = await journeyResp.json();
      const journeyListEl = document.getElementById("intelJourneyList");
      if (journeyListEl && Array.isArray(data.journey) && data.journey.length > 0) {
        clearChildren(journeyListEl);
        data.journey.slice(-4).forEach((j) => {
          const row = document.createElement("div");
          row.className = "intel-item-row";
          const title = document.createElement("span");
          title.className = "intel-item-title";
          title.textContent = j.period;
          const meta = document.createElement("span");
          meta.className = "intel-item-meta";
          const domText = (j.dominantPatterns || []).join(", ") || "general";
          meta.textContent = `${j.count} solved · ${domText}`;
          row.appendChild(title);
          row.appendChild(meta);
          journeyListEl.appendChild(row);
        });
      }
    }
  } catch (_) {}

  // 4. Exploration Opportunities
  try {
    const expResp = await fetch(`${backendUrl}/api/intelligence/exploration`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (expResp.ok) {
      const data = await expResp.json();
      const expListEl = document.getElementById("intelExplorationList");
      if (expListEl && Array.isArray(data.explorationCandidates) && data.explorationCandidates.length > 0) {
        clearChildren(expListEl);
        data.explorationCandidates.slice(0, 3).forEach((c) => {
          const row = document.createElement("div");
          row.className = "intel-item-row";
          const title = document.createElement("span");
          title.className = "intel-item-title";
          title.textContent = c.pattern;
          const meta = document.createElement("span");
          meta.className = "intel-item-meta";
          meta.textContent = c.reason;
          row.appendChild(title);
          row.appendChild(meta);
          expListEl.appendChild(row);
        });
      }
    }
  } catch (_) {}
}

function escapeHTML(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[&<>'"]/g, (tag) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[tag] || tag));
}

// ---------- Small DOM helpers ----------

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function makeOption(value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  return opt;
}

document.getElementById("reportLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: `https://github.com/apps/${FLY2GIT_CONFIG.GITHUB_APP_SLUG}` });
});

const copyDiagLink = document.getElementById("copyDiagnosticsLink");
if (copyDiagLink) {
  copyDiagLink.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_DIAGNOSTICS" });
      const snap = response && response.snapshot;
      if (!snap) throw new Error("Could not retrieve diagnostics");

      const platformNames = snap.connectedPlatforms.map((id) => {
        const reg = typeof Fly2GitPlatforms !== "undefined" && Fly2GitPlatforms.PLATFORM_REGISTRY && Fly2GitPlatforms.PLATFORM_REGISTRY[id];
        return reg ? reg.name : id;
      });

      const lines = [
        "Fly2Git Diagnostics",
        "====================",
        `Extension: ${snap.extension} (v${snap.version})`,
        `GitHub: ${snap.github.connected ? `Connected (${snap.github.repository || "No repo selected"})` : "Disconnected"}`,
        `Plan: ${snap.plan}`,
        "Connected Platforms:",
        ...(platformNames.length > 0 ? platformNames.map((p) => `  - ${p}`) : ["  - None selected"]),
        `Sync Engine: ${snap.syncEngine}`,
        `Queue: ${snap.queue}`,
        `Last Sync: ${snap.lastSync ? `${snap.lastSync.ok ? "Success" : "Failed"} · ${snap.lastSync.text || ""}` : "None"}`,
        `Recent Syncs: ${snap.recentSyncCount} recorded`,
        `Timestamp: ${snap.timestamp}`,
      ];

      const text = lines.join("\n");
      await navigator.clipboard.writeText(text);

      const origText = copyDiagLink.textContent;
      copyDiagLink.textContent = "Copied!";
      setTimeout(() => {
        copyDiagLink.textContent = origText;
      }, 2000);
    } catch (err) {
      console.error("Failed to copy diagnostics:", err);
      copyDiagLink.textContent = "Error copying";
      setTimeout(() => {
        copyDiagLink.textContent = "Copy Diagnostics";
      }, 2000);
    }
  });
}

// ==========================================================================
// Phase 18: Support View, Safe Diagnostics, Privacy Control & Feedback
// ==========================================================================

function initPhase18SupportAndFeedback() {
  // 1. Privacy Control: Help improve Fly2Git
  const telToggle = document.getElementById("productTelemetryToggle");
  if (telToggle && typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const result = chrome.storage.local.get({ productTelemetryEnabled: true }, (res) => {
        telToggle.checked = res.productTelemetryEnabled !== false;
      });
      // Handle Promise-based storage API (Manifest V3)
      if (result && typeof result.then === "function") {
        result.catch(() => {});
      }
    } catch (_) {
      // Storage unavailable — leave toggle at default
    }

    telToggle.addEventListener("change", () => {
      const isEnabled = telToggle.checked;
      chrome.storage.local.set({ productTelemetryEnabled: isEnabled }, () => {
        if (isEnabled) {
          fetch(`${getBackendUrl()}/api/telemetry/product`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "settings_opened",
              platform: "extension",
              productTelemetryEnabled: true,
            }),
          }).catch(() => {});
        }
      });
    });
  }

  // 2. Support View: Report a Problem Button & Modal
  const reportBtn = document.getElementById("reportProblemBtn");
  const feedbackModal = document.getElementById("feedbackModal");
  const closeFeedbackBtn = document.getElementById("closeFeedbackModalBtn");
  const cancelFeedbackBtn = document.getElementById("cancelFeedbackBtn");
  const feedbackForm = document.getElementById("feedbackForm");
  const feedbackCategory = document.getElementById("feedbackCategory");
  const feedbackMessage = document.getElementById("feedbackMessage");
  const feedbackStatusMsg = document.getElementById("feedbackStatusMsg");
  const submitFeedbackBtn = document.getElementById("submitFeedbackBtn");

  function openFeedbackModal() {
    if (!feedbackModal) return;
    feedbackModal.classList.remove("hidden");
    if (feedbackMessage) feedbackMessage.value = "";
    if (feedbackStatusMsg) feedbackStatusMsg.classList.add("hidden");
  }

  function closeFeedbackModal() {
    if (!feedbackModal) return;
    feedbackModal.classList.add("hidden");
  }

  if (reportBtn) reportBtn.addEventListener("click", openFeedbackModal);
  if (closeFeedbackBtn) closeFeedbackBtn.addEventListener("click", closeFeedbackModal);
  if (cancelFeedbackBtn) cancelFeedbackBtn.addEventListener("click", closeFeedbackModal);

  if (submitFeedbackBtn && feedbackForm) {
    submitFeedbackBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const message = (feedbackMessage?.value || "").trim();
      const category = feedbackCategory?.value || "feedback";

      if (!message) {
        if (feedbackStatusMsg) {
          feedbackStatusMsg.textContent = "Please enter a message.";
          feedbackStatusMsg.className = "platform-message warning";
          feedbackStatusMsg.classList.remove("hidden");
        }
        return;
      }

      if (message.length > 2000) {
        if (feedbackStatusMsg) {
          feedbackStatusMsg.textContent = "Message exceeds 2000 characters.";
          feedbackStatusMsg.className = "platform-message warning";
          feedbackStatusMsg.classList.remove("hidden");
        }
        return;
      }

      submitFeedbackBtn.disabled = true;
      submitFeedbackBtn.textContent = "Sending…";

      try {
        const session = await getStoredSession().catch(() => null);
        const headers = { "Content-Type": "application/json" };
        if (session && session.token) {
          headers["Authorization"] = `Bearer ${session.token}`;
        }

        const resp = await fetch(`${getBackendUrl()}/api/feedback`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            category,
            message,
            appVersion: "1.1.6",
            platform: "extension",
          }),
        });

        if (resp.ok) {
          if (feedbackStatusMsg) {
            feedbackStatusMsg.textContent = "Thank you! Your feedback has been received.";
            feedbackStatusMsg.className = "platform-message success";
            feedbackStatusMsg.classList.remove("hidden");
          }
          setTimeout(() => {
            closeFeedbackModal();
            submitFeedbackBtn.disabled = false;
            submitFeedbackBtn.textContent = "Send Feedback";
          }, 1500);
        } else {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to submit feedback");
        }
      } catch (err) {
        if (feedbackStatusMsg) {
          feedbackStatusMsg.textContent = err.message || "Failed to submit feedback";
          feedbackStatusMsg.className = "platform-message warning";
          feedbackStatusMsg.classList.remove("hidden");
        }
        submitFeedbackBtn.disabled = false;
        submitFeedbackBtn.textContent = "Send Feedback";
      }
    });
  }

  // 3. Support View: Copy Diagnostics Button
  const copyDiagBtn = document.getElementById("copyDiagnosticsBtn");
  const supportFeedback = document.getElementById("supportActionFeedback");
  if (copyDiagBtn) {
    copyDiagBtn.addEventListener("click", async () => {
      try {
        let text = "";
        if (typeof Fly2GitDiagnostics !== "undefined" && typeof Fly2GitDiagnostics.generateSafeDiagnostics === "function") {
          const stateResp = await chrome.runtime.sendMessage({ type: "GET_DIAGNOSTICS" }).catch(() => null);
          const snap = stateResp?.snapshot || {};
          const diag = Fly2GitDiagnostics.generateSafeDiagnostics(snap);
          text = Fly2GitDiagnostics.formatDiagnosticsText(diag);
        } else {
          text = "Fly2Git v1.1.6 Diagnostic Snapshot\n================================\nReady";
        }

        await navigator.clipboard.writeText(text);
        if (supportFeedback) {
          supportFeedback.textContent = "Safe diagnostics copied to clipboard!";
          supportFeedback.className = "platform-message success";
          supportFeedback.classList.remove("hidden");
          setTimeout(() => supportFeedback.classList.add("hidden"), 3000);
        }
      } catch (err) {
        if (supportFeedback) {
          supportFeedback.textContent = "Unable to copy diagnostics to clipboard.";
          supportFeedback.className = "platform-message warning";
          supportFeedback.classList.remove("hidden");
          setTimeout(() => supportFeedback.classList.add("hidden"), 3000);
        }
      }
    });
  }

  // 4. Support View: Privacy Information Button
  const viewPrivacyBtn = document.getElementById("viewPrivacyBtn");
  if (viewPrivacyBtn) {
    viewPrivacyBtn.addEventListener("click", () => {
      const privacyCard = document.querySelector(".settings-privacy-card");
      if (privacyCard) {
        privacyCard.scrollIntoView({ behavior: "smooth" });
        privacyCard.style.outline = "1px solid var(--color-sand, #D8B98A)";
        setTimeout(() => {
          privacyCard.style.outline = "none";
        }, 2000);
      }
    });
  }

  // 5. Post-Sync Feedback Toast (Lightweight, non-intrusive)
  const postSyncToast = document.getElementById("postSyncFeedbackToast");
  const goodBtn = document.getElementById("postSyncFeedbackGoodBtn");
  const issueBtn = document.getElementById("postSyncFeedbackIssueBtn");
  const closeToastBtn = document.getElementById("closePostSyncFeedbackBtn");

  function dismissPostSyncToast() {
    if (postSyncToast) postSyncToast.classList.add("hidden");
  }

  if (closeToastBtn) closeToastBtn.addEventListener("click", dismissPostSyncToast);
  if (goodBtn) {
    goodBtn.addEventListener("click", () => {
      dismissPostSyncToast();
      fetch(`${getBackendUrl()}/api/telemetry/product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "feedback_submitted",
          platform: "extension",
          appVersion: "1.1.6",
        }),
      }).catch(() => {});
    });
  }
  if (issueBtn) {
    issueBtn.addEventListener("click", () => {
      dismissPostSyncToast();
      openFeedbackModal();
    });
  }
}

// Call on popup initialization
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPhase18SupportAndFeedback);
  } else {
    initPhase18SupportAndFeedback();
  }
}

if (typeof window !== "undefined") {
  window.getStoredSession = getStoredSession;
  window.initPhase18SupportAndFeedback = initPhase18SupportAndFeedback;
  window.renderComplexityCard = renderComplexityCard;
  window.setComplexityLoading = setComplexityLoading;
  window.setComplexityUnavailable = setComplexityUnavailable;
  window.setupComplexityActions = setupComplexityActions;
  window.loadProblemComplexity = loadProblemComplexity;
}
if (typeof globalThis !== "undefined") {
  globalThis.getStoredSession = getStoredSession;
  globalThis.initPhase18SupportAndFeedback = initPhase18SupportAndFeedback;
  globalThis.renderComplexityCard = renderComplexityCard;
  globalThis.setComplexityLoading = setComplexityLoading;
  globalThis.setComplexityUnavailable = setComplexityUnavailable;
  globalThis.setupComplexityActions = setupComplexityActions;
  globalThis.loadProblemComplexity = loadProblemComplexity;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStoredSession,
    renderCodingIntelligenceSection,
    renderAICoachSection,
    initPhase18SupportAndFeedback,
    renderComplexityCard,
    setComplexityLoading,
    setComplexityUnavailable,
    setupComplexityActions,
    loadProblemComplexity,
  };
}
