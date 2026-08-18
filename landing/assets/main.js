/* RunAhead landing page.
   Three small behaviours: theme toggle, install tabs, copy buttons.
   No framework, no dependencies, no analytics. */

(function () {
  "use strict";

  /* ── theme toggle ──────────────────────────────────────────────
     The initial theme is resolved by the inline script in <head> so
     there is no flash. This only handles switching afterwards.
     A stored choice wins over the OS preference, but if the visitor
     has never chosen, the page keeps following the OS. */
  var root = document.documentElement;
  var toggle = document.getElementById("theme-toggle");
  var toggleLabel = document.getElementById("theme-toggle-label");

  function labelFor(theme) {
    return theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  }

  function applyTheme(theme, remember) {
    root.setAttribute("data-theme", theme);
    if (toggleLabel) toggleLabel.textContent = labelFor(theme);
    if (toggle) toggle.setAttribute("title", labelFor(theme));
    if (remember) {
      try {
        localStorage.setItem("theme", theme);
      } catch (e) {
        /* storage unavailable: the choice just won't persist */
      }
    }
  }

  if (toggle) {
    applyTheme(root.getAttribute("data-theme") || "dark", false);
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      applyTheme(next, true);
    });
  }

  var media = window.matchMedia("(prefers-color-scheme: light)");
  var onSchemeChange = function (e) {
    var chosen = null;
    try {
      chosen = localStorage.getItem("theme");
    } catch (err) {
      /* ignore */
    }
    if (!chosen) applyTheme(e.matches ? "light" : "dark", false);
  };
  if (media.addEventListener) media.addEventListener("change", onSchemeChange);
  else if (media.addListener) media.addListener(onSchemeChange);

  /* ── install tabs ──────────────────────────────────────────────
     WAI-ARIA tabs pattern: roving tabindex, arrow/Home/End keys. */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));

  function selectTab(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute("aria-controls"));
      if (panel) panel.hidden = !on;
    });
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () {
      selectTab(tab);
    });
    tab.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        selectTab(next);
        next.focus();
      }
    });
  });

  /* ── copy buttons ──────────────────────────────────────────────
     Falls back to a hidden textarea where the async clipboard API is
     unavailable (non-secure origin, older browser), so the button is
     never a control that silently does nothing. */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject();
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    var timer;
    btn.addEventListener("click", function () {
      var source = btn.closest(".cmd").querySelector("[data-copy-text]");
      var label = btn.querySelector("[data-copy-label]");
      if (!source || !label) return;

      copyText(source.textContent.trim()).then(
        function () {
          label.textContent = "Copied";
          btn.setAttribute("data-copied", "true");
          clearTimeout(timer);
          timer = setTimeout(function () {
            label.textContent = "Copy";
            btn.removeAttribute("data-copied");
          }, 1800);
        },
        function () {
          label.textContent = "Press Ctrl+C";
          clearTimeout(timer);
          timer = setTimeout(function () {
            label.textContent = "Copy";
          }, 2400);
        }
      );
    });
  });
})();
