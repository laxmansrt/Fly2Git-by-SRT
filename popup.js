// Fly2Git — by SRT

const views = {
  connect: document.getElementById("connectView"),
  deviceFlow: document.getElementById("deviceFlowView"),
  repoPicker: document.getElementById("repoPickerView"),
  active: document.getElementById("activeView"),
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
}

// Long-lived connection to the background worker: while this port is open,
// background.js polls Device Flow at GitHub's requested interval (fast).
// When the popup closes, this disconnects automatically and background.js
// falls back to its chrome.alarms backstop. See background.js for details.
const port = chrome.runtime.connect({ name: "fly2git-popup" });

let statusPollTimer = null;

init();

async function init() {
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
  clearChildren(select);
  select.appendChild(makeOption("", "Loading repositories…"));

  const response = await chrome.runtime.sendMessage({ type: "GET_REPOS" });

  clearChildren(select);

  if (!response?.ok) {
    select.appendChild(makeOption("", `Error: ${response?.error || "unknown"}`));
    return;
  }

  if (response.repos.length === 0) {
    select.appendChild(makeOption("", "No repositories authorized yet"));
  } else {
    for (const r of response.repos) {
      select.appendChild(makeOption(r.fullName, `${r.fullName}${r.private ? " 🔒" : ""}`));
    }
  }

  document.getElementById("installMoreLink").href =
    `https://github.com/apps/${FLY2GIT_CONFIG.GITHUB_APP_SLUG}/installations/new`;
}

document.getElementById("saveRepoBtn").addEventListener("click", async () => {
  const select = document.getElementById("repoSelect");
  const repo = select.value;
  if (!repo) return;

  await chrome.storage.local.set({ selectedRepo: repo });
  await showActiveView(repo);
});

// ---------- Active view ----------

async function showActiveView(repo) {
  showView("active");
  setText("activeRepoName", repo);
  await renderLastSyncBanner();
  await renderPlatformsSection();
  await renderSyncLog();
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
  const isPro = entitlement.plan === "pro";

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

    if (p.active) {
      if (isPro) {
        checkbox.checked = true;
        checkbox.disabled = true; // All active platforms unlocked in Pro
      } else {
        checkbox.checked = entitlement.selectedPlatforms.includes(p.id);
        checkbox.disabled = false;

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
            // Revert selection and notify user
            checkbox.checked = false;
            if (platformMessage) {
              platformMessage.textContent =
                "Basic supports any 2 platforms. Upgrade to Pro to use all platforms.";
              platformMessage.classList.remove("hidden");
            }
            return;
          }

          const res = await Fly2GitEntitlements.setSelectedPlatforms(selected);
          if (!res.ok) {
            checkbox.checked = !checkbox.checked;
            if (platformMessage) {
              platformMessage.textContent = res.message || "Failed to update platforms.";
              platformMessage.classList.remove("hidden");
            }
          }
        });
      }
    } else {
      checkbox.checked = false;
      checkbox.disabled = true;
    }

    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.name;

    label.appendChild(checkbox);
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
  return { code: (platform || "??").slice(0, 3).toUpperCase(), className: "default", name: platform || "Unknown" };
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
    empty.textContent = "Nothing synced yet — solve an accepted problem on any connected platform.";
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
