/* Global App helpers: header counters + global search */
(function () {
  function qsa(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }

  const ANALYTICS_KEY = "analyticsData";
  const CONSENT_KEY = "analyticsConsent";

  function readAnalytics() {
    try {
      const raw = localStorage.getItem(ANALYTICS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      totals: {
        pageViews: 0,
        searches: 0,
        productClicks: 0,
        addToCart: 0,
        addToFav: 0,
        navClicks: 0,
        totalTimeSec: 0
      },
      pages: {},
      products: {},
      filters: {},
      nav: {},
      searches: {}
    };
  }

  function writeAnalytics(data) {
    try {
      localStorage.setItem(ANALYTICS_KEY, JSON.stringify(data));
    } catch {}
  }

  const Analytics = {
    isEnabled: false,
    init() {
      const consent = localStorage.getItem(CONSENT_KEY);
      this.isEnabled = consent === "granted";
      if (this.isEnabled) {
        this.trackPageView();
        this.startTimer();
        this.bindClickTracking();
      }
    },
    startTimer() {
      if (this._timerStarted) return;
      this._timerStarted = true;
      this._pageStart = performance.now();
      const flushTime = () => {
        if (!this.isEnabled || this._pageStart == null) return;
        const delta = Math.max(0, Math.round((performance.now() - this._pageStart) / 1000));
        if (!delta) return;
        const data = readAnalytics();
        data.totals.totalTimeSec += delta;
        const path = location.pathname || "/";
        data.pages[path] = data.pages[path] || { views: 0, timeSec: 0 };
        data.pages[path].timeSec += delta;
        writeAnalytics(data);
        this._pageStart = performance.now();
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushTime();
      });
      window.addEventListener("pagehide", flushTime);
    },
    trackPageView() {
      if (!this.isEnabled) return;
      const data = readAnalytics();
      data.totals.pageViews += 1;
      const path = location.pathname || "/";
      data.pages[path] = data.pages[path] || { views: 0, timeSec: 0 };
      data.pages[path].views += 1;
      writeAnalytics(data);
    },
    trackSearch(query) {
      if (!this.isEnabled) return;
      const q = (query || "").toLowerCase();
      const data = readAnalytics();
      data.totals.searches += 1;
      if (q) data.searches[q] = (data.searches[q] || 0) + 1;
      writeAnalytics(data);
    },
    trackFilter(key, value) {
      if (!this.isEnabled) return;
      const data = readAnalytics();
      const label = `${key}:${value}`;
      data.filters[label] = (data.filters[label] || 0) + 1;
      writeAnalytics(data);
    },
    trackProductClick(id) {
      if (!this.isEnabled) return;
      const data = readAnalytics();
      data.totals.productClicks += 1;
      if (id) {
        data.products[id] = data.products[id] || { views: 0, addToCart: 0, addToFav: 0 };
        data.products[id].views += 1;
      }
      writeAnalytics(data);
    },
    trackAddToCart(id) {
      if (!this.isEnabled) return;
      const data = readAnalytics();
      data.totals.addToCart += 1;
      if (id) {
        data.products[id] = data.products[id] || { views: 0, addToCart: 0, addToFav: 0 };
        data.products[id].addToCart += 1;
      }
      writeAnalytics(data);
    },
    trackAddToFav(id) {
      if (!this.isEnabled) return;
      const data = readAnalytics();
      data.totals.addToFav += 1;
      if (id) {
        data.products[id] = data.products[id] || { views: 0, addToCart: 0, addToFav: 0 };
        data.products[id].addToFav += 1;
      }
      writeAnalytics(data);
    },
    trackNav(href) {
      if (!this.isEnabled) return;
      const data = readAnalytics();
      data.totals.navClicks += 1;
      if (href) data.nav[href] = (data.nav[href] || 0) + 1;
      writeAnalytics(data);
    },
    bindClickTracking() {
      if (this._clickBound) return;
      this._clickBound = true;
      document.addEventListener("click", (e) => {
        const link = e.target.closest("a");
        if (link && link.href) {
          const url = new URL(link.href, location.href);
          if (url.pathname.includes("product.html")) {
            const pid = url.searchParams.get("id") || "";
            this.trackProductClick(pid);
          }
          if (link.closest(".nav") || link.classList.contains("chip") || link.classList.contains("navlink")) {
            this.trackNav(url.pathname);
          }
        }
      });
    }
  };

  function mountConsentBanner() {
    if (localStorage.getItem(CONSENT_KEY)) return;
    if (document.querySelector(".consent-banner")) return;
    const banner = document.createElement("div");
    banner.className = "consent-banner";
    banner.innerHTML = `
      <div class="consent-inner">
        <div class="consent-text">
          Ми використовуємо локальну аналітику (час на сайті, перегляди, кліки, пошук).
          Дані зберігаються лише у браузері. Детальніше у
          <a class="link" href="./privacy.html">Політиці конфіденційності</a>.
        </div>
        <div class="consent-actions">
          <button class="btn" data-consent="deny">Відхилити</button>
          <button class="btn primary" data-consent="accept">Прийняти</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);
    banner.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-consent]");
      if (!btn) return;
      const choice = btn.getAttribute("data-consent");
      if (choice === "accept") {
        localStorage.setItem(CONSENT_KEY, "granted");
        Analytics.isEnabled = true;
        Analytics.init();
      } else {
        localStorage.setItem(CONSENT_KEY, "denied");
        localStorage.removeItem(ANALYTICS_KEY); // Очищаем данные
        Analytics.isEnabled = false;
      }
      banner.remove();
    });
  }

  function mountPrivacyFab() {
    if (document.querySelector(".privacy-fab")) return;
    const fab = document.createElement("button");
    fab.className = "privacy-fab";
    fab.type = "button";
    fab.title = "Політика конфіденційності";
    fab.setAttribute("aria-label", "Політика конфіденційності");
    fab.textContent = "🔒";

    const modal = document.createElement("div");
    modal.className = "privacy-modal";
    modal.innerHTML = `
      <div class="privacy-dialog" role="dialog" aria-modal="true">
        <h3>Політика конфіденційності</h3>
        <p>Ми використовуємо cookies та локальну аналітику для покращення сервісу.
        Дані збираються лише після вашої згоди.</p>
        <p>Детальніше у <a class="link" href="./privacy.html">Політиці конфіденційності</a>.</p>
        <p id="privacyStatus" class="muted"></p>
        <div class="privacy-actions">
          <button class="btn" data-privacy="deny">Відхилити</button>
          <button class="btn primary" data-privacy="accept">Прийняти</button>
          <button class="btn" data-privacy="close">Закрити</button>
        </div>
      </div>
    `;

    function updateStatus() {
      const statusEl = modal.querySelector("#privacyStatus");
      if (!statusEl) return;
      const consent = localStorage.getItem(CONSENT_KEY);
      if (consent === "granted") statusEl.textContent = "Статус: згода надана";
      else if (consent === "denied") statusEl.textContent = "Статус: згоду відхилено";
      else statusEl.textContent = "Статус: не вибрано";
    }

    fab.addEventListener("click", () => {
      updateStatus();
      modal.classList.add("active");
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("active");
      const btn = e.target.closest("[data-privacy]");
      if (!btn) return;
      const action = btn.getAttribute("data-privacy");
      if (action === "close") {
        modal.classList.remove("active");
        return;
      }
      if (action === "accept") {
        localStorage.setItem(CONSENT_KEY, "granted");
        Analytics.isEnabled = true;
        Analytics.init();
      }
      if (action === "deny") {
        localStorage.setItem(CONSENT_KEY, "denied");
        localStorage.removeItem(ANALYTICS_KEY); // Очищаем собранные данные
        Analytics.isEnabled = false;
      }
      updateStatus();
    });

    document.body.appendChild(fab);
    document.body.appendChild(modal);
  }

  function mountHeader() {
    const cart = (window.Store && window.Store.cartCount) ? window.Store.cartCount() : 0;
    const fav  = (window.Store && window.Store.favCount) ? window.Store.favCount() : 0;

    qsa("[data-cart-count]").forEach(el => el.textContent = String(cart));
    qsa("[data-fav-count]").forEach(el => el.textContent = String(fav));
  }

  // по submit — переносим на каталог с параметром q
  function wireSearch() {
    const forms = qsa("[data-search-form], #searchForm");
    forms.forEach(form => {
      if (form.__wired) return;
      form.__wired = true;

      const input = form.querySelector("[data-search-input], #searchInput");
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = (input ? input.value : "").trim();
        Analytics.trackSearch(q);
        const url = new URL("./catalog.html", location.href);
        if (q) url.searchParams.set("q", q);
        location.href = url.toString();
      });
    });
  }

  // если на странице есть input поиска — подставим q из URL
  function setSearchValueFromURL() {
    const url = new URL(location.href);
    const q = url.searchParams.get("q") || "";
    const input = document.querySelector("[data-search-input], #searchInput");
    if (input && !input.value) input.value = q;
  }

  // Theme management
  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
    setupThemeButton();
    // Retry setup after a short delay to ensure DOM is ready
    setTimeout(setupThemeButton, 100);
  }

  function setupThemeButton() {
    document.querySelectorAll('#themeToggle').forEach(themeBtn => {
      if (!themeBtn) return;
      
      // Remove existing listeners to avoid duplicates
      const clone = themeBtn.cloneNode(true);
      themeBtn.parentNode.replaceChild(clone, themeBtn);
      
      const btn = document.getElementById('themeToggle');
      if (btn) {
        // Direct click handler
        btn.addEventListener('click', handleThemeToggle, false);
        // Make button tabbable
        btn.setAttribute('tabindex', '0');
        // Add keyboard support (Enter and Space)
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleThemeToggle(e);
          }
        });
      }
    });
  }
  
  function handleThemeToggle(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    toggleTheme();
  }

  function applyTheme(theme) {
    const html = document.documentElement;
    // Apply theme to html element
    if (theme === 'light') {
      html.setAttribute('data-theme', 'light');
      html.classList.add('light-theme');
      html.classList.remove('dark-theme');
    } else {
      html.removeAttribute('data-theme');
      html.classList.add('dark-theme');
      html.classList.remove('light-theme');
    }
    
    // Update all theme toggle buttons
    document.querySelectorAll('#themeToggle').forEach(btn => {
      btn.textContent = theme === 'light' ? '🌙' : '☀️';
      btn.setAttribute('title', theme === 'light' ? 'Темна тема' : 'Світла тема');
    });
    
    // Save to localStorage
    localStorage.setItem('theme', theme);
    console.log('Theme applied:', theme);
  }

  function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
  }

  // expose
  window.App = { mountHeader, wireSearch, setSearchValueFromURL, initTheme, applyTheme, toggleTheme };
  window.mountHeader = mountHeader;
  window.wireSearch = wireSearch;
  window.setSearchValueFromURL = setSearchValueFromURL;
  window.initTheme = initTheme;
  window.Analytics = Analytics;

  // run
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    mountHeader();
    wireSearch();
    setSearchValueFromURL();
    
    // Инициализируем аналитику только если есть согласие
    const consent = localStorage.getItem(CONSENT_KEY);
    if (consent === "granted") {
      Analytics.init();
    }
    
    mountConsentBanner();
    mountPrivacyFab();
  });

  // Initialize theme immediately if DOM is already ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  window.addEventListener("store:change", mountHeader);
  window.addEventListener("storage", mountHeader);
})();
