/* ==========================================================================
   Fly2Git — Liquid motion
   Load AFTER popup.js:  <script src="liquid-motion.js"></script>
   Pure progressive enhancement: no ids/classes of your app are changed.
   1. A water droplet that glides between tabs (stretches, settles, wobbles)
   2. A light that follows the cursor across buttons and cards
   3. Water-ring ripples on click
   ========================================================================== */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var BTN = [
    '.primary-btn', '.upgrade-btn', 'button.secondary', 'button.danger',
    '.secondary-btn', '.danger-btn', '.slot-edit-btn', '.change-repo-btn',
    '.cockpit-action-btn', '.ai-action-btn', '.coach-mode-pill', '.range-pill',
    '.hint-depth-pill', '.cockpit-link-btn', '.mini-feedback-btn',
    'button#connectBtn', 'button#openGithubBtn', 'button#saveRepoBtn'
  ].join(',');
  var CARD = '.glass-card, .bento-tile';

  /* ---------- 1. Tab-bar droplet ---------------------------------------- */
  function initNav(nav) {
    if (nav.dataset.lg) return;
    nav.dataset.lg = '1';

    var drop = document.createElement('span');
    drop.className = 'lg-drop';
    drop.setAttribute('aria-hidden', 'true');
    nav.insertBefore(drop, nav.firstChild);
    nav.classList.add('lg-ready');

    var btns = Array.prototype.slice.call(nav.querySelectorAll('.cockpit-nav-btn'));
    var cur = null, placed = false, hovering = false, timer = 0;

    function activeBtn() {
      return btns.filter(function (b) {
        return b.classList.contains('active') || b.getAttribute('aria-selected') === 'true';
      })[0] || btns[0];
    }
    function box(b) { return { l: b.offsetLeft, w: b.offsetWidth, t: b.offsetTop, h: b.offsetHeight }; }
    function put(o) {
      drop.style.left = o.l + 'px'; drop.style.width = o.w + 'px';
      drop.style.top = o.t + 'px';  drop.style.height = o.h + 'px';
    }
    function mark(b) {
      btns.forEach(function (x) { x.classList.toggle('lg-under', x === b); });
    }

    function moveTo(btn) {
      if (!btn || !btn.offsetWidth) return;
      var to = box(btn);

      if (!placed || reduce) {            // first paint / reduced motion: no travel
        drop.style.transition = 'none';
        put(to);
        void drop.offsetWidth;
        drop.style.transition = '';
        placed = true; cur = btn; mark(btn);
        return;
      }
      if (btn === cur) return;

      var from = box(cur);
      cur = btn; mark(btn);
      clearTimeout(timer);

      // Phase 1 — the drop is pulled across: it stretches to span both tabs
      var l = Math.min(from.l, to.l);
      var r = Math.max(from.l + from.w, to.l + to.w);
      drop.classList.remove('settle');
      drop.style.transition = 'left .15s cubic-bezier(.3,.7,.4,1), width .15s cubic-bezier(.3,.7,.4,1), top .2s ease, height .2s ease';
      drop.style.left = l + 'px';
      drop.style.width = (r - l) + 'px';
      drop.style.top = to.t + 'px';
      drop.style.height = to.h + 'px';

      // Phase 2 — surface tension snaps it into the target, then it wobbles
      timer = setTimeout(function () {
        drop.style.transition = '';       // fall back to the spring in CSS
        put(to);
        void drop.offsetWidth;
        drop.classList.add('settle');
      }, 140);
    }

    btns.forEach(function (b) {
      b.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'touch') return;
        hovering = true; moveTo(b);
      });
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);   // -1 … 1
        drop.style.setProperty('--mag', (dx * 7).toFixed(1) + 'px');      // drop leans toward the cursor
      });
    });
    nav.addEventListener('pointerdown', function () { drop.classList.add('press'); });
    window.addEventListener('pointerup', function () { drop.classList.remove('press'); });
    nav.addEventListener('pointerleave', function () {
      hovering = false;
      drop.style.setProperty('--mag', '0px');
      moveTo(activeBtn());
    });
    drop.addEventListener('animationend', function () { drop.classList.remove('settle'); });

    // Follow tab changes made by popup.js (clicks, keyboard, programmatic)
    new MutationObserver(function () { if (!hovering) moveTo(activeBtn()); })
      .observe(nav, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-selected'] });

    // Nav is hidden until the connected view shows; re-place whenever its size changes
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (!nav.offsetWidth) return;
        placed = false; cur = null; moveTo(activeBtn());
      }).observe(nav);
    }
    moveTo(activeBtn());
  }

  function scanNav() {
    var n = document.getElementById('cockpitNav');
    if (n) initNav(n);
  }

  /* ---------- 2. Cursor light on buttons + cards ------------------------- */
  var raf = 0, last = null;
  document.addEventListener('pointermove', function (e) {
    last = e;
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      [last.target.closest && last.target.closest(BTN), last.target.closest && last.target.closest(CARD)]
        .forEach(function (el) {
          if (!el) return;
          var r = el.getBoundingClientRect();
          el.style.setProperty('--mx', (last.clientX - r.left) + 'px');
          el.style.setProperty('--my', (last.clientY - r.top) + 'px');
        });
    });
  }, { passive: true });

  /* ---------- 3. Water-ring ripple on click ------------------------------ */
  document.addEventListener('pointerdown', function (e) {
    if (reduce || !e.target.closest) return;
    var el = e.target.closest(BTN + ', .cockpit-nav-btn');
    if (!el || el.disabled) return;
    var r = el.getBoundingClientRect();
    var size = Math.max(r.width, r.height) * 2.2;
    var ring = document.createElement('span');
    ring.className = 'lg-ripple';
    ring.style.width = ring.style.height = size + 'px';
    ring.style.left = (e.clientX - r.left - size / 2) + 'px';
    ring.style.top = (e.clientY - r.top - size / 2) + 'px';
    el.appendChild(ring);
    ring.addEventListener('animationend', function () { ring.remove(); });
  }, { passive: true });

  /* ---------- boot ------------------------------------------------------- */
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scanNav);
    } else {
      scanNav();
    }
    new MutationObserver(scanNav).observe(document.body, { childList: true, subtree: true });
  }
})();
