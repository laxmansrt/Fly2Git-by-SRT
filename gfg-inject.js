// Fly2Git — by SRT
// GeeksforGeeks page-context adapter (MAIN world)
//
// Runs in MAIN world so it can access window.ace.
// Listens for FLY2GIT_GFG_REQUEST custom events (dispatched by gfg-content.js),
// extracts submission data from the page, and responds via FLY2GIT_GFG_RESPONSE.
//
// SECURITY:
// - Never reads cookies, CSRF tokens, or session data.
// - Never logs source code.
// - Only fires on explicit request from gfg-content.js (after acceptance is confirmed).
(function () {
  "use strict";

  if (!window.location.hostname.endsWith("geeksforgeeks.org")) return;
  if (window.__FLY2GIT_GFG_INJECT_INITIALIZED__) return;
  window.__FLY2GIT_GFG_INJECT_INITIALIZED__ = true;

  console.log("[Fly2Git] v1.1.6 GFG page-context adapter loaded");

  // ---------------------------------------------------------------
  // Language normalizer
  // Maps verified live GFG language labels to Fly2Git canonical ids.
  //
  // Verified GFG labels (2024):
  //   "C (gcc 5.4)"         -> "c"
  //   "C++ (17)"            -> "cpp"
  //   "Java (21)"           -> "java"
  //   "Python3"             -> "python"
  //   "C#"                  -> "csharp"
  //   "Javascript (Node v22)" -> "javascript"
  //
  // Returns null for unrecognized languages so the validator rejects
  // them explicitly rather than forwarding garbage strings.
  // ---------------------------------------------------------------
  var GFG_LANG_MAP = {
    // Core keys after stripping parens and version suffixes
    "c":          "c",
    "c++":        "cpp",
    "c++14":      "cpp",
    "c++17":      "cpp",
    "java":       "java",
    "python":     "python",
    // GFG uses "Python3" (no space, no parens) — must map to "python"
    "python3":    "python",
    "javascript": "javascript",
    "c#":         "csharp",
    "go":         "golang",
    "golang":     "golang",
    "swift":      "swift",
    "kotlin":     "kotlin",
    "php":        "php",
    "scala":      "scala",
    "perl":       "perl",
    "r":          "r",
  };

  function normalizeGfgLanguage(rawLabel) {
    if (!rawLabel || typeof rawLabel !== "string") return null;
    // Take only the first line — defends against innerText with newlines
    // e.g. a button that renders "C++ (17)\n▾" -> "C++ (17)"
    var firstLine = rawLabel.split("\n")[0].trim();
    if (!firstLine) return null;
    // Strip content inside parentheses: "C (gcc 5.4)" -> "C"
    var stripped = firstLine.replace(/\s*\(.*?\)\s*/g, "").trim();
    // Strip trailing standalone version numbers: "C++ 14" -> "C++"
    stripped = stripped.replace(/\s+\d+(\.\d+)*\s*$/, "").trim();
    var key = stripped.toLowerCase();
    return GFG_LANG_MAP[key] || null;
  }

  // ---------------------------------------------------------------
  // Code extraction via window.ace (primary path)
  // ---------------------------------------------------------------
  function extractCodeFromAce() {
    try {
      if (typeof window.ace === "undefined" || typeof window.ace.edit !== "function") {
        return null;
      }
      var editorEl = document.querySelector(".ace_editor");
      if (!editorEl) return null;
      var editor = window.ace.edit(editorEl);
      var code = editor.getSession().getValue();
      if (typeof code === "string" && code.length > 0) {
        return code;
      }
      return null;
    } catch (e) {
      console.warn("[Fly2Git][GFG] ace extraction failed:", e.message);
      return null;
    }
  }

  // ---------------------------------------------------------------
  // Code extraction via editor env (secondary path)
  // Some Ace versions expose .env.editor on the DOM element itself.
  // ---------------------------------------------------------------
  function extractCodeFromEditorEnv() {
    try {
      var editorEl = document.querySelector(".ace_editor");
      if (!editorEl) return null;
      if (editorEl.env && editorEl.env.editor) {
        var code = editorEl.env.editor.getValue();
        if (typeof code === "string" && code.length > 0) return code;
      }
      return null;
    } catch (e) {
      console.warn("[Fly2Git][GFG] ace env extraction failed:", e.message);
      return null;
    }
  }

  // ---------------------------------------------------------------
  // Code extraction via CodeMirror (fallback for possible future UI)
  // ---------------------------------------------------------------
  function extractCodeFromCodeMirror() {
    try {
      var cmEl = document.querySelector(".CodeMirror");
      if (!cmEl || !cmEl.CodeMirror) return null;
      var code = cmEl.CodeMirror.getValue();
      return typeof code === "string" && code.length > 0 ? code : null;
    } catch (e) {
      return null;
    }
  }

  function extractCode() {
    return extractCodeFromAce()
      || extractCodeFromEditorEnv()
      || extractCodeFromCodeMirror()
      || null;
  }

  // ---------------------------------------------------------------
  // Language extraction
  //
  // GFG's language selector (Semantic UI / custom React dropdown) marks
  // the active selection with role="option" and classes that include
  // "active" and "selected". This is the verified live DOM pattern.
  //
  // Strategy:
  //   1. Primary:  role="option" element whose className contains "active"
  //   2. Secondary: role="option" elements (first one or scan all)
  //   3. Fallback:  scan buttons for language pattern text
  // ---------------------------------------------------------------
  function extractLanguage() {
    // Primary: the selected item in a Semantic UI / custom dropdown
    var activeOption = null;

    // Try class-based active selection first
    var options = document.querySelectorAll('[role="option"]');
    for (var i = 0; i < options.length; i++) {
      var cls = options[i].className || "";
      if (cls.indexOf("active") !== -1 && cls.indexOf("selected") !== -1) {
        activeOption = options[i];
        break;
      }
    }

    // Also try the visible trigger/text of a custom dropdown
    // (some GFG builds show selected language in a div.text, not role=option)
    if (!activeOption) {
      activeOption = document.querySelector(
        '[role="listbox"] [role="option"].active, ' +
        '[role="listbox"] [role="option"][aria-selected="true"]'
      );
    }

    if (activeOption) {
      var raw = (activeOption.innerText || activeOption.textContent || "").trim();
      var normalized = normalizeGfgLanguage(raw);
      if (normalized) return normalized;
    }

    // Fallback: scan buttons whose text looks like a language label
    var LANG_PATTERN = /^(C\+\+|Java|Python3?|JavaScript|Javascript|C#|Go|Swift|Kotlin|PHP|Scala|Perl|C) *(\(|\d|$)/;
    var buttons = document.querySelectorAll("button");
    for (var j = 0; j < buttons.length; j++) {
      var text = (buttons[j].innerText || "").split("\n")[0].trim();
      if (text && LANG_PATTERN.test(text)) {
        var normalized = normalizeGfgLanguage(text);
        if (normalized) return normalized;
      }
    }

    return null;
  }

  // ---------------------------------------------------------------
  // Slug extraction — from the URL pathname
  // Formats observed:
  //   /problems/reverse-a-linked-list/1
  //   /problems/two-sum--150280/1
  //   /problems/largest-element-in-array4009/1
  // Strategy: extract segment between /problems/ and the trailing /N
  // ---------------------------------------------------------------
  function extractSlug() {
    var match = window.location.pathname.match(/\/problems\/([^\/]+)/);
    if (!match) return null;
    var raw = match[1];
    // Strip trailing numeric ID that is directly appended (no separator):
    // "largest-element-in-array4009" -> "largest-element-in-array"
    // BUT preserve slugs like "two-sum--150280" where -- is the separator
    // Use the full raw slug as the folder name for repository consistency.
    return raw || null;
  }

  // ---------------------------------------------------------------
  // Title extraction — from document.title or H1
  // document.title format: "Problem Title | Practice | GeeksforGeeks"
  // ---------------------------------------------------------------
  function extractTitle() {
    // Prefer document.title (most reliable, always present)
    var title = document.title || "";
    var pipeIdx = title.indexOf("|");
    if (pipeIdx > 0) {
      title = title.slice(0, pipeIdx).trim();
    }
    if (title) return title;
    // Fallback: first H1
    var h1 = document.querySelector("h1");
    return h1 ? (h1.innerText || "").trim() : "Unknown";
  }

  // ---------------------------------------------------------------
  // Difficulty extraction — scans the stats bar for difficulty text
  // The stats bar renders: "Difficulty: Easy  Accuracy: ..."
  // "Easy", "Medium", "Hard", "Basic", "School" are the known values.
  // ---------------------------------------------------------------
  var DIFFICULTIES = ["School", "Basic", "Easy", "Medium", "Hard"];

  function extractDifficulty() {
    // Scan leaf elements for exact difficulty text
    var allEls = document.querySelectorAll("*");
    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      if (el.childElementCount === 0) {
        var text = (el.innerText || "").trim();
        if (DIFFICULTIES.indexOf(text) !== -1) {
          return text;
        }
      }
    }
    // Fallback: regex scan of body text near "Difficulty:"
    var bodyText = document.body ? (document.body.innerText || "") : "";
    var diffMatch = bodyText.match(/Difficulty\s*:\s*(School|Basic|Easy|Medium|Hard)/i);
    if (diffMatch) return diffMatch[1];
    return "Unknown";
  }

  // ---------------------------------------------------------------
  // Submission ID — GFG does not expose a submission ID in the DOM.
  // Generate a stable synthetic ID from slug + normalized language +
  // code content hash to satisfy the normalized contract and ensure
  // repeated extractions for the same accepted submission produce the
  // identical ID, while changing language or code yields a new ID.
  // ---------------------------------------------------------------
  function generateSubmissionId(slug, language, code) {
    var safeSlug = (slug || "unknown").slice(0, 40);
    var safeLang = (language || "unknown").slice(0, 15);
    var str = safeSlug + ":" + safeLang + ":" + (code || "");
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    var hexHash = (hash >>> 0).toString(16);
    return "gfg-" + safeSlug + "-" + safeLang + "-" + hexHash;
  }

  // ---------------------------------------------------------------
  // Request handler — assembles and responds with the full payload
  // ---------------------------------------------------------------
  window.addEventListener("FLY2GIT_GFG_REQUEST", function () {
    var code = extractCode();
    var slug = extractSlug();
    var title = extractTitle();
    var difficulty = extractDifficulty();
    var language = extractLanguage();
    var submissionId = generateSubmissionId(slug, language, code);
    var url = window.location.href;

    var payload = {
      ok: true,
      code: code,
      slug: slug,
      title: title,
      difficulty: difficulty,
      language: language,
      submissionId: submissionId,
      url: url,
      codeExtracted: code !== null,
    };

    window.dispatchEvent(
      new CustomEvent("FLY2GIT_GFG_RESPONSE", { detail: payload })
    );
  });

})();
