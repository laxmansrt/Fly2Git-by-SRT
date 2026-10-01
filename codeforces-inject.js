// Fly2Git — by SRT
// Codeforces page-context adapter (MAIN world)
//
// Responsibilities:
// 1. Verify hostname === "codeforces.com" and singleton guard.
// 2. Extract solution code from Ace Editor (#editor) with textarea[name="source"] fallback.
// 3. Extract contestId, problemIndex, problem title, and compiler language.
// 4. Map Codeforces programmingLanguage to canonical Fly2Git language (reject unknown).
// 5. Detect logged-in user handle from page header (.lang-chooser a[href^="/profile/"]).
// 6. Capture submission metadata & code at submit time, passing it to
//    codeforces-content.js across the isolated bridge for extension session storage.
//    (ZERO use of window.sessionStorage).
//
// SECURITY:
// - Never reads or logs cookies, tokens, CSRF secrets, passwords, or authorization headers.
// - Never logs complete source code.
// - Zero scraping or inspection of other contestants' code.
// - Zero active polling against Codeforces from MAIN world.

(function (root) {
  "use strict";

  if (typeof window === "undefined" || !window.location) {
    // Unit test environment support
    if (typeof module !== "undefined" && module.exports) {
      exportModule();
    }
    return;
  }

  var hostname = window.location.hostname || "";
  if (hostname !== "codeforces.com" && !hostname.endsWith(".codeforces.com")) {
    return;
  }

  if (window.__FLY2GIT_CODEFORCES_INJECT_INITIALIZED__) return;
  window.__FLY2GIT_CODEFORCES_INJECT_INITIALIZED__ = true;

  var DEBUG = true;
  var MAX_CODE_LENGTH = 200000;

  function debug() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][Codeforces]");
    console.log.apply(console, args);
  }

  debug("MAIN-world adapter initialized on", window.location.pathname);

  /**
   * Extracts the authenticated user's handle from Codeforces page header.
   * Returns handle string or null if not logged in.
   */
  function extractUserHandle() {
    try {
      var profileLink = document.querySelector('.lang-chooser a[href^="/profile/"]') ||
                        document.querySelector('#header a[href^="/profile/"]') ||
                        document.querySelector('a.rated-user[href^="/profile/"]');
      if (profileLink) {
        var text = (profileLink.textContent || "").trim();
        if (text && text.toLowerCase() !== "enter" && text.toLowerCase() !== "register") {
          return text;
        }
      }
      // Alternative: meta tag or Codeforces party object if present
      if (window.Codeforces && typeof window.Codeforces.getParty === "function") {
        var party = window.Codeforces.getParty();
        if (party && party.handle) return String(party.handle).trim();
      }
    } catch (_) {}
    return null;
  }

  /**
   * Parses contestId and problemIndex from URL or page DOM inputs.
   */
  function parseContestAndIndex(urlStr) {
    var path = "";
    try {
      path = new URL(urlStr || window.location.href).pathname;
    } catch (_) {
      path = (window.location && window.location.pathname) || "";
    }

    // Pattern: /contest/{contestId}/problem/{index}
    // Pattern: /problemset/problem/{contestId}/{index}
    // Pattern: /gym/{contestId}/problem/{index}
    var m = path.match(/(?:\/contest|\/gym)\/(\d+)\/(?:problem\/)?([A-Za-z0-9]+)/i) ||
            path.match(/\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/i);
    if (m) {
      return {
        contestId: parseInt(m[1], 10),
        problemIndex: m[2].toUpperCase(),
      };
    }

    // Fallback: check DOM elements in submission form
    try {
      var contestInput = document.querySelector('input[name="contestId"]');
      var idxInput = document.querySelector('input[name="submittedProblemIndex"], select[name="submittedProblemIndex"]');
      var codeInput = document.querySelector('input[name="submittedProblemCode"]');

      var cId = contestInput ? parseInt(contestInput.value, 10) : null;
      var pIdx = idxInput ? String(idxInput.value).trim().toUpperCase() : null;

      if (!cId && codeInput && codeInput.value) {
        var cm = codeInput.value.trim().match(/^(\d+)([A-Za-z0-9]+)$/);
        if (cm) {
          cId = parseInt(cm[1], 10);
          pIdx = cm[2].toUpperCase();
        }
      }

      if (cId && pIdx) {
        return { contestId: cId, problemIndex: pIdx };
      }
    } catch (_) {}

    return { contestId: null, problemIndex: null };
  }

  /**
   * Extracts problem title from DOM (stripping leading index e.g. "A. Watermelon" -> "Watermelon").
   */
  function extractProblemTitle() {
    try {
      var titleEl = document.querySelector('.problem-statement .header .title') ||
                    document.querySelector('.problem-statement .title');
      if (titleEl) {
        var text = (titleEl.textContent || "").trim();
        // Remove leading letter/number index dot e.g. "A. Watermelon" or "B1. Some Problem"
        text = text.replace(/^[A-Za-z0-9]+\.\s*/, "").trim();
        if (text) return text;
      }
      // Fallback: document.title
      if (document.title) {
        var dt = document.title.split("-")[0].trim();
        dt = dt.replace(/^[A-Za-z0-9]+\.\s*/, "").trim();
        if (dt && !dt.toLowerCase().includes("codeforces")) return dt;
      }
    } catch (_) {}
    return "";
  }

  /**
   * Extracts source code from Ace Editor or textarea.
   */
  function extractSourceCode(form) {
    // 1. Check Ace Editor
    if (window.ace && typeof window.ace.edit === "function") {
      try {
        var editor = window.ace.edit("editor");
        if (editor && typeof editor.getValue === "function") {
          var code = editor.getValue();
          if (code && code.trim()) return code;
        }
      } catch (_) {}
    }

    // 2. Check DOM textareas
    try {
      var textarea = (form && form.querySelector('textarea[name="source"]')) ||
                     document.querySelector('textarea[name="source"]') ||
                     document.querySelector('#source');
      if (textarea && textarea.value && textarea.value.trim()) {
        return textarea.value;
      }
    } catch (_) {}

    return "";
  }

  /**
   * Extracts selected programming language text from the compiler dropdown.
   */
  function extractLanguage(form) {
    try {
      var select = (form && form.querySelector('select[name="programTypeId"]')) ||
                   document.querySelector('select[name="programTypeId"]');
      if (select && select.selectedIndex >= 0) {
        var opt = select.options[select.selectedIndex];
        return (opt && opt.text) ? opt.text.trim() : "";
      }
    } catch (_) {}
    return "";
  }

  /**
   * Normalizes Codeforces compiler strings to Fly2Git canonical languages.
   * Unknown languages return null to prevent corrupted syncs.
   */
  function normalizeLanguage(rawLang) {
    if (!rawLang || typeof rawLang !== "string") return null;
    var l = rawLang.trim().toLowerCase();

    // JavaScript / Node (check BEFORE Java to avoid partial match)
    if (l.includes("javascript") || l.includes("node")) return "javascript";

    // C++
    if (l.includes("c++") || l.includes("g++") || l.includes("clang++")) return "cpp";

    // C
    if (l.includes("gnu c") || l === "c" || l.startsWith("c11") || l.startsWith("c99")) return "c";

    // Python / PyPy
    if (l.includes("python") || l.includes("pypy")) return "python";

    // Java
    if (l.includes("java")) return "java";

    // Kotlin
    if (l.includes("kotlin")) return "kotlin";

    // Rust
    if (l.includes("rust")) return "rust";

    // Go
    if (l === "go" || l.startsWith("go ") || l.includes("golang")) return "go";

    // C#
    if (l.includes("c#") || l.includes(".net") || l.includes("mono c#")) return "csharp";

    return null;
  }

  /**
   * Handles submission form submit event.
   */
  function handleSubmitEvent(event) {
    var form = event.target;
    if (!form || !form.tagName || form.tagName.toLowerCase() !== "form") return;

    var isSubmitForm = form.classList.contains("submit-form") ||
                       Boolean(form.querySelector('select[name="programTypeId"]')) ||
                       Boolean(form.querySelector('textarea[name="source"]')) ||
                       (form.action && form.action.includes("submit"));

    if (!isSubmitForm) return;

    var handle = extractUserHandle();
    if (!handle) {
      debug("User is not logged into Codeforces — skipping submission staging");
      return;
    }

    var ci = parseContestAndIndex(window.location.href);
    if (!ci.contestId || !ci.problemIndex) {
      debug("Could not determine contestId or problemIndex — skipping submission staging");
      return;
    }

    var code = extractSourceCode(form);
    if (!code || !code.trim()) {
      debug("Submission code is empty — skipping submission staging");
      return;
    }

    if (code.length > MAX_CODE_LENGTH) {
      debug("Submission code exceeds length limit — skipping submission staging");
      return;
    }

    var rawLang = extractLanguage(form);
    var canonicalLang = normalizeLanguage(rawLang);
    if (!canonicalLang) {
      debug("Unknown language cannot be mapped — skipping submission staging:", rawLang);
      return;
    }

    var title = extractProblemTitle() || ("Problem " + ci.contestId + ci.problemIndex);
    var problemUrl = "https://codeforces.com/contest/" + ci.contestId + "/problem/" + ci.problemIndex;

    var stagingPayload = {
      handle: handle,
      contestId: ci.contestId,
      problemIndex: ci.problemIndex,
      title: title,
      rawLanguage: rawLang,
      language: canonicalLang,
      code: code,
      url: problemUrl,
      timestamp: Date.now(),
    };

    debug("Staging submission for handle:", handle, "contest:", ci.contestId, "index:", ci.problemIndex, "lang:", canonicalLang);

    // Dispatch to ISOLATED-world codeforces-content.js via window.postMessage
    window.postMessage({
      source: "FLY2GIT_CODEFORCES_INJECT",
      type: "STAGE_SUBMISSION",
      payload: stagingPayload,
    }, window.location.origin);
  }

  // Attach submit listener on document in capture phase
  document.addEventListener("submit", handleSubmitEvent, true);

  function exportModule() {
    if (typeof module !== "undefined" && module.exports) {
      module.exports = {
        extractUserHandle: extractUserHandle,
        parseContestAndIndex: parseContestAndIndex,
        extractProblemTitle: extractProblemTitle,
        extractSourceCode: extractSourceCode,
        extractLanguage: extractLanguage,
        normalizeLanguage: normalizeLanguage,
        handleSubmitEvent: handleSubmitEvent,
      };
    }
  }

  exportModule();
})(typeof globalThis !== "undefined" ? globalThis : this);
