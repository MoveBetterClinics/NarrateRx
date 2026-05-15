/* ============================================================
   NarrateRx — site.js
   No build step, no deps. Shared across all marketing pages.
   ============================================================ */
(function () {
  'use strict';

  /* ---- 1. Year stamps ---------------------------------------- */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---- 2. Mobile nav toggle ---------------------------------- */
  var toggle = document.querySelector('.uhdr-toggle');
  var nav    = document.querySelector('.uhdr-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---- 3. Active nav state from URL -------------------------- */
  (function markActiveNav() {
    var path = (location.pathname || '/').replace(/\/$/, '') || '/';
    document.querySelectorAll('.uhdr-nav a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.charAt(0) === '#') return;
      var hrefPath = href.split('#')[0].replace(/\/$/, '') || '/';
      if (hrefPath === path) a.classList.add('is-active');
    });
  })();

  /* ---- 4. Scroll-reveal (.ureveal) --------------------------- */
  (function initReveal() {
    var els = document.querySelectorAll('.ureveal');
    if (!els.length) return;
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.12 });
      els.forEach(function (el) { io.observe(el); });
    } else {
      els.forEach(function (el) { el.classList.add('is-visible'); });
    }
  })();

  /* ---- 5. Voice compare toggle (.uvoice-toggle) -------------- */
  document.querySelectorAll('[data-voice-compare]').forEach(function (wrap) {
    var btns   = wrap.querySelectorAll('.uvoice-toggle button');
    var panels = wrap.querySelectorAll('.uvoice-panel');
    if (!btns.length) return;

    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key');
        btns.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        panels.forEach(function (p) {
          p.classList.toggle('is-visible', p.getAttribute('data-key') === key);
        });
      });
    });
    // Init first as active
    if (btns[1]) btns[1].click();
  });

  /* ---- 6. FAQ accordion — smooth open (native <details>) ----- */
  // <details> works natively; this just ensures smooth animation via CSS.
  // No JS needed beyond letting the browser handle it.

  /* ---- 7. Number counter animation --------------------------- */
  (function initCounters() {
    var counters = document.querySelectorAll('[data-count]');
    if (!counters.length) return;
    var io = ('IntersectionObserver' in window)
      ? new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              animateCount(e.target);
              io.unobserve(e.target);
            }
          });
        }, { threshold: 0.5 })
      : null;

    counters.forEach(function (el) {
      if (io) io.observe(el); else animateCount(el);
    });

    function animateCount(el) {
      var target = parseFloat(el.getAttribute('data-count'));
      var suffix = el.getAttribute('data-suffix') || '';
      var duration = 900;
      var start = performance.now();
      (function tick(now) {
        var pct = Math.min((now - start) / duration, 1);
        var val = target * ease(pct);
        el.textContent = (Number.isInteger(target) ? Math.round(val) : val.toFixed(1)) + suffix;
        if (pct < 1) requestAnimationFrame(tick);
      })(start);
    }
    function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
  })();

  /* ---- 8. Pipeline step highlight (how-it-works) ------------- */
  (function initPipeline() {
    var steps = document.querySelectorAll('.upipe-step');
    if (!steps.length) return;
    steps.forEach(function (step, i) {
      setTimeout(function () {
        var io2 = new IntersectionObserver(function (entries) {
          if (entries[0].isIntersecting) step.style.opacity = '1';
        }, { threshold: 0.3 });
        io2.observe(step);
      }, i * 60);
    });
  })();

})();
