(async function () {
  // ---------- helpers ----------
  async function loadJSON(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + path);
    return await r.json();
  }
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  // Проверка обновлений от админа
  let lastCatalogTimestamp = localStorage.getItem('catalogTimestamp') || '0';
  
  function checkForUpdates() {
    const currentTimestamp = localStorage.getItem('catalogTimestamp') || '0';
    if (currentTimestamp !== lastCatalogTimestamp && currentTimestamp !== '0') {
      console.log('🔔 Обнаружены обновления каталога!');
      showUpdateButton();
    }
  }
  
  function showUpdateButton() {
    const btn = qs('#refreshCatalog');
    if (btn) {
      btn.style.display = 'inline-flex';
      btn.classList.add('pulse');
    }
  }
  
  function hideUpdateButton() {
    const btn = qs('#refreshCatalog');
    if (btn) {
      btn.style.display = 'none';
      btn.classList.remove('pulse');
    }
  }

  function fmtUAH(n) {
    const v = Number(n || 0);
    // если 0 — показываем "Ціну уточнюйте"
    if (!Number.isFinite(v) || v <= 0) return "Ціну уточнюйте";
    return v.toLocaleString("uk-UA") + " ₴";
  }
  function stockLabel(v) {
    if (v === "in_stock") return "В наявності";
    if (v === "on_order") return "Під замовлення";
    return "Немає";
  }
  function getPrimaryImage(images) {
    if (!Array.isArray(images)) return "";
    const clean = images
      .filter(Boolean)
      // вырезаем лого-картинку (если вдруг попадается)
      .filter((u) => !String(u).includes("tov-bis-7"))
      .filter((u) => !String(u).includes("w350_h100"));
    return clean[0] || images[0] || "";
  }
  function getParam(name) {
    const u = new URL(location.href);
    return u.searchParams.get(name) || "";
  }
  function setParam(name, value) {
    const u = new URL(location.href);
    if (value && String(value).length) u.searchParams.set(name, value);
    else u.searchParams.delete(name);
    history.replaceState(null, "", u.toString());
  }
  // ---------- Store / App ----------
  const Store = window.Store; // должен быть из store.js
  const App = window.App;     // должен быть из app.js

  // ---------- state ----------
  const STATE = {
    catalog: [],
    categories: [],
    categoryTree: [],  // Hierarchical categories
    featured: new Set(),
    query: "",
    activeCat: "",
    objectType: "",  // apartment, house, office, shop
    onlyInStock: false,
    hidePriceZero: true,
    priceFrom: 0,
    priceTo: Infinity,
    sort: "recommended",
    page: 1,
    pageSize: 25,
    filtered: []
  };
  
  // Маппинг типов помещений на ключевые слова
  const OBJECT_TYPE_KEYWORDS = {
    apartment: ['побутов', 'квартир', 'кімнат', 'компакт', 'настінн', 'малопотужн', 'домашн', '2-3 кВт', '3-5 кВт', 'до 50', 'до 60', 'до 70', 'до 80'],
    house: ['домашн', 'приватн', 'котел', 'автономн', 'опален', 'теплов', 'водопостачан', '5-7 кВт', '7-9 кВт', 'до 100', 'до 150', 'до 200'],
    office: ['офіс', 'комерц', 'касет', 'канальн', 'мульти', 'VRF', 'центральн', '7-12 кВт', '10-15 кВт', 'до 150', 'до 200'],
    shop: ['промисл', 'склад', 'цех', 'виробництв', 'потужн', 'напольн', 'прецизійн', 'великопотужн', '15-20 кВт', '20+ кВт', 'від 200']
  };
  
  function matchesObjectType(product, type) {
    if (!type) return true;
    const keywords = OBJECT_TYPE_KEYWORDS[type];
    if (!keywords) return true;
    
    const text = [
      product.title || '',
      product.description || '',
      product.category || '',
      ...(product.breadcrumbs || [])
    ].join(' ').toLowerCase();
    
    // Проверяем наличие хотя бы одного ключевого слова
    return keywords.some(keyword => text.includes(keyword.toLowerCase()));
  }
  
  // ---------- helpers for categories ----------
  function buildCategoryTree(items){
    const mainCats = new Map();
    
    items.forEach(p=>{
      const breadcrumbs = p.breadcrumbs || [];
      if(!breadcrumbs.length) return;
      
      const main = breadcrumbs[0];
      const sub = breadcrumbs[1] || null;
      
      if(!mainCats.has(main)){
        mainCats.set(main, {name: main, count: 0, subcats: new Map()});
      }
      
      const cat = mainCats.get(main);
      cat.count++;
      
      if(sub){
        if(!cat.subcats.has(sub)){
          cat.subcats.set(sub, {name: sub, count: 0});
        }
        cat.subcats.get(sub).count++;
      }
    });
    
    return Array.from(mainCats.values())
      .sort((a,b)=>b.count-a.count)
      .map(cat=>({
        name: cat.name,
        count: cat.count,
        subcats: Array.from(cat.subcats.values()).sort((a,b)=>b.count-a.count)
      }));
  }
  // ---------- DOM ----------
  const grid = qs("#grid");
  const catsBar = qs("#categoriesBar");
  const pageInfo = qs("#pageInfo");
  const prevBtn = qs("#prevBtn");
  const nextBtn = qs("#nextBtn");

  const searchForm = qs("#searchForm") || qs("[data-search-form]");
  const searchInput = qs("#searchInput");

  const sortSelect = qs("#sortSelect");
  const psSelect = qs("#pageSizeSelect");

  // optional sidebar controls (если есть в catalog.html)
  const catSearch = qs("#catSearch");
  const onlyInStockChk = qs("#onlyInStock");
  const priceFromInp = qs("#priceFrom");
  const priceToInp = qs("#priceTo");
  const hideZeroChk = qs("#hideZeroPrice");
  const resetFiltersBtn = qs("#resetFilters");

  const activeInfo = qs("#activeInfo");

  if (!grid || !catsBar || !pageInfo || !prevBtn || !nextBtn || !searchForm || !searchInput || !sortSelect || !psSelect) {
    console.error("catalog.html is missing required IDs. Need: grid, categoriesBar, pageInfo, prevBtn, nextBtn, searchForm, searchInput, sortSelect, pageSizeSelect.");
    return;
  }

  // ---------- rendering ----------
  function cardHTML(p) {
    const img = getPrimaryImage(p.images);
    const inFav = Store?.inFav ? Store.inFav(p.id) : false;
    return `
      <article class="card">
        <a class="img" href="./product.html?id=${encodeURIComponent(p.id)}" aria-label="${esc(p.title)}">
          ${img ? `<img loading="lazy" src="${esc(img)}" alt="${esc(p.title)}">` : `<div class="img-ph"></div>`}
        </a>

        <div class="card-body">
          <a class="title" href="./product.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a>

          <div class="meta">
            <div class="price">${esc(fmtUAH(p.price_uah))}</div>
            <div class="stock">${esc(stockLabel(p.stock))}</div>
          </div>

          <div class="actions-row">
            <button class="btn small" data-add="${esc(p.id)}">В кошик</button>
            <button class="btn ghost small" data-fav="${esc(p.id)}" aria-label="Favorite">Обране</button>
          </div>
        </div>
      </article>
    `;
  }

  function applyFilters() {
    let items = STATE.catalog.slice();
    
    // object type filter
    if (STATE.objectType) {
      items = items.filter((p) => matchesObjectType(p, STATE.objectType));
    }
    
    // category - check both main and subcategories
    const cat = (STATE.activeCat || "").trim();
    if (cat) {
      items = items.filter((p) => {
        const breadcrumbs = Array.isArray(p.breadcrumbs) ? p.breadcrumbs : [];
        const category = p.category || "";
        // Check if category matches any breadcrumb level or the category field
        return breadcrumbs.includes(cat) || category === cat;
      });
    }
    // search
    const q = (STATE.query || "").trim().toLowerCase();
    if (q) {
      items = items.filter((p) => {
        const t = String(p.title || "").toLowerCase();
        const d = String(p.description || "").toLowerCase();
        return t.includes(q) || d.includes(q);
      });
    }
    // in stock only
    if (STATE.onlyInStock) items = items.filter((p) => p.stock === "in_stock");

    // hide zero prices
    if (STATE.hidePriceZero) items = items.filter((p) => Number(p.price_uah || 0) > 0);

    // price range (работает только для тех, у кого цена > 0)
    const pf = Number(STATE.priceFrom || 0);
    const pt = Number.isFinite(STATE.priceTo) ? Number(STATE.priceTo) : Infinity;
    if (pf > 0 || pt < Infinity) {
      items = items.filter((p) => {
        const v = Number(p.price_uah || 0);
        if (v <= 0) return false;
        return v >= pf && v <= pt;
      });
    }

    // sort
    const key = STATE.sort;
    const featured = STATE.featured;
    items.sort((a, b) => {
      if (key === "recommended") {
        const af = featured.has(a.id) ? 0 : 1;
        const bf = featured.has(b.id) ? 0 : 1;
        if (af !== bf) return af - bf;
        return String(a.title || "").localeCompare(String(b.title || ""), "uk");
      }
      if (key === "price_asc") return Number(a.price_uah || 0) - Number(b.price_uah || 0);
      if (key === "price_desc") return Number(b.price_uah || 0) - Number(a.price_uah || 0);
      if (key === "title_asc") return String(a.title || "").localeCompare(String(b.title || ""), "uk");
      if (key === "title_desc") return String(b.title || "").localeCompare(String(a.title || ""), "uk");
      if (key === "newest") return String(b.id || "").localeCompare(String(a.id || ""));
      return 0;
    });

    STATE.filtered = items;
    const totalPages = Math.max(1, Math.ceil(items.length / STATE.pageSize));
    if (STATE.page > totalPages) STATE.page = totalPages;
    if (STATE.page < 1) STATE.page = 1;
    render();
  }
  function render() {
    const total = STATE.filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / STATE.pageSize));
    const start = (STATE.page - 1) * STATE.pageSize;
    const end = start + STATE.pageSize;
    const slice = STATE.filtered.slice(start, end);
    grid.innerHTML = slice.map(cardHTML).join("");
    pageInfo.textContent = `Сторінка ${STATE.page} з ${totalPages}`;
    prevBtn.disabled = STATE.page <= 1;
    nextBtn.disabled = STATE.page >= totalPages;
    if (activeInfo) {
      const parts = [];      
      // Тип объекта
      const typeLabels = {
        apartment: '🏠 Квартира',
        house: '🏡 Приватний дім',
        office: '🏢 Офіс / Магазин',
        shop: '🏭 Склад / Цех'
      };
      if (STATE.objectType && typeLabels[STATE.objectType]) {
        parts.push(typeLabels[STATE.objectType]);
      }
            if (STATE.activeCat) parts.push("Категорія: " + STATE.activeCat);
      if (STATE.query) parts.push("Пошук: “" + STATE.query + "”");
      parts.push("Знайдено: " + total);
      activeInfo.textContent = parts.join(" · "); 
  }
  }
  function renderCategories() {
    catsBar.innerHTML = "";

    const mkChip = (label, count, onClick, isActive = false, isSub = false) => {
      const chip = document.createElement("div");
      chip.className = "chip" + (isActive ? " active" : "") + (isSub ? " subcat" : "");
      chip.innerHTML = `
        ${isSub ? '<span class="arrow">→</span>' : ''}
        <span>${esc(label)}</span>
        <span class="count">${count}</span>
      `;
      chip.addEventListener("click", onClick);
      return chip;
    };

    const clearActive = () => qsa("#categoriesBar .chip").forEach((x) => x.classList.remove("active"));
    
    // All button
    const allChip = mkChip("Всі", STATE.catalog.length, () => {
      STATE.activeCat = "";
      STATE.page = 1;
      setParam("cat", "");
      clearActive();
      allChip.classList.add("active");
      window.Analytics?.trackFilter("category", "all");
      applyFilters();
    }, !getParam("cat"));
    catsBar.appendChild(allChip);

    const activeCat = getParam("cat");

    // Main categories with subcategories
    STATE.categoryTree.forEach((mainCat) => {
      const isMainActive = activeCat === mainCat.name;
      
      const mainChip = mkChip(mainCat.name, mainCat.count, () => {
        STATE.activeCat = mainCat.name;
        STATE.page = 1;
        setParam("cat", mainCat.name);
        clearActive();
        mainChip.classList.add("active");
        window.Analytics?.trackFilter("category", mainCat.name);
        applyFilters();
      }, isMainActive);
      
      catsBar.appendChild(mainChip);
      
      // Show top 3 subcategories for the active main category
      if (isMainActive && mainCat.subcats.length > 0) {
        mainCat.subcats.slice(0, 5).forEach((subCat) => {
          const isSubActive = activeCat === subCat.name;
          const subChip = mkChip(subCat.name, subCat.count, () => {
            STATE.activeCat = subCat.name;
            STATE.page = 1;
            setParam("cat", subCat.name);
            clearActive();
            subChip.classList.add("active");
            window.Analytics?.trackFilter("category", subCat.name);
            applyFilters();
          }, isSubActive, true);
          
          catsBar.appendChild(subChip);
        });
      }
    });
  }

  function bindEvents() {
    // карточки: add/fav
    grid.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      const fav = e.target.closest("[data-fav]");

      if (add) {
        const id = add.getAttribute("data-add");
        const p = STATE.catalog.find((x) => x.id === id);
        if (p && Store?.addToCart) {
          Store.addToCart(p, 1);
          App?.mountHeader?.();
          add.textContent = "Додано ✓";
          setTimeout(() => (add.textContent = "В кошик"), 650);
        }
      }

      if (fav) {
        const id = fav.getAttribute("data-fav");
        if (Store?.toggleFav) {
          const on = Store.toggleFav(id);
          fav.textContent = "Обране";
          App?.mountHeader?.();
        }
      }
    });

    // pager
    prevBtn.addEventListener("click", () => {
      STATE.page -= 1;
      setParam("page", String(STATE.page));
      applyFilters();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    nextBtn.addEventListener("click", () => {
      STATE.page += 1;
      setParam("page", String(STATE.page));
      applyFilters();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // search
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      STATE.query = (searchInput.value || "").trim();
      STATE.page = 1;
      setParam("q", STATE.query);
      setParam("page", "1");
      window.Analytics?.trackSearch(STATE.query);
      applyFilters();
    });

    // sort + pagesize
    sortSelect.addEventListener("change", () => {
      STATE.sort = sortSelect.value;
      STATE.page = 1;
      setParam("sort", STATE.sort);
      setParam("page", "1");
      window.Analytics?.trackFilter("sort", STATE.sort);
      applyFilters();
    });

    psSelect.addEventListener("change", () => {
      STATE.pageSize = Number(psSelect.value || 25);
      STATE.page = 1;
      setParam("ps", String(STATE.pageSize));
      setParam("page", "1");
      window.Analytics?.trackFilter("page_size", String(STATE.pageSize));
      applyFilters();
    });

    // sidebar filters (если есть)
    if (catSearch) {
      catSearch.addEventListener("input", () => {
        const q = (catSearch.value || "").trim().toLowerCase();
        qsa("#categoriesBar .chip").forEach((b) => {
          const txt = (b.textContent || "").toLowerCase();
          if (txt === "всі") return (b.style.display = "");
          b.style.display = txt.includes(q) ? "" : "none";
        });
      });
    }

    if (onlyInStockChk) {
      onlyInStockChk.addEventListener("change", () => {
        STATE.onlyInStock = !!onlyInStockChk.checked;
        STATE.page = 1;
        window.Analytics?.trackFilter("stock", STATE.onlyInStock ? "in_stock" : "all");
        applyFilters();
      });
    }

    if (hideZeroChk) {
      hideZeroChk.addEventListener("change", () => {
        STATE.hidePriceZero = !!hideZeroChk.checked;
        STATE.page = 1;
        window.Analytics?.trackFilter("price_zero", STATE.hidePriceZero ? "hide" : "show");
        applyFilters();
      });
    }

    if (priceFromInp) {
      priceFromInp.addEventListener("input", () => {
        STATE.priceFrom = Number(priceFromInp.value || 0);
        STATE.page = 1;
        window.Analytics?.trackFilter("price_from", String(STATE.priceFrom));
        applyFilters();
      });
    }
    if (priceToInp) {
      priceToInp.addEventListener("input", () => {
        const v = priceToInp.value;
        STATE.priceTo = v === "" ? Infinity : Number(v || 0);
        STATE.page = 1;
        window.Analytics?.trackFilter("price_to", v === "" ? "max" : String(STATE.priceTo));
        applyFilters();
      });
    }

    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener("click", () => {
        STATE.onlyInStock = false;
        STATE.hidePriceZero = true;
        STATE.priceFrom = 0;
        STATE.priceTo = Infinity;
        STATE.objectType = "";

        if (onlyInStockChk) onlyInStockChk.checked = false;
        if (hideZeroChk) hideZeroChk.checked = true;
        if (priceFromInp) priceFromInp.value = "";
        if (priceToInp) priceToInp.value = "";

        setParam("type", "");
        window.Analytics?.trackFilter("reset", "1");
        STATE.page = 1;
        applyFilters();
      });
    }

    // Кнопка обновления каталога
    const refreshBtn = qs('#refreshCatalog');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        const textEl = qs('#refreshText');
        if (textEl) textEl.textContent = 'Оновлення...';
        await reloadCatalog();
        lastCatalogTimestamp = localStorage.getItem('catalogTimestamp') || '0';
        hideUpdateButton();
        if (textEl) textEl.textContent = 'Оновити';
      });
    }

    // Проверяем обновления каждые 3 секунды
    setInterval(checkForUpdates, 3000);

    window.addEventListener("storage", () => App?.mountHeader?.());
  }

  // ---------- boot ----------
  async function reloadCatalog() {
    try {
      // Clear cache and reload from Store
      if (Store?.clearCatalogCache) Store.clearCatalogCache();
      STATE.catalog = await Store.loadCatalog();
      STATE.categoryTree = buildCategoryTree(STATE.catalog);
      renderCategories();
      applyFilters();
      console.log('Catalog reloaded from admin changes');
    } catch (err) {
      console.error('Failed to reload catalog:', err);
    }
  }

  try {
    App?.mountHeader?.();

    // initial params
    STATE.query = getParam("q");
    STATE.activeCat = getParam("cat");
    STATE.objectType = getParam("type") || "";
    STATE.sort = getParam("sort") || "recommended";
    STATE.page = Number(getParam("page") || 1);
    STATE.pageSize = Number(getParam("ps") || 25);

    searchInput.value = STATE.query;
    sortSelect.value = STATE.sort;
    psSelect.value = String(STATE.pageSize);

    // data - use Store.loadCatalog() to sync with admin panel
    STATE.catalog = await Store.loadCatalog();

    // Build hierarchical category tree from breadcrumbs
    STATE.categoryTree = buildCategoryTree(STATE.catalog);
    
    // Keep flat categories for compatibility
    let cats = [];
    try { cats = await loadJSON("./site_data/categories.json"); } catch { cats = []; }
    // нормализация категорий
    if (Array.isArray(cats) && cats.length) {
      if (typeof cats[0] === "string") STATE.categories = cats.map((s) => ({ name: s }));
      else STATE.categories = cats.map((o) => ({ name: o.name || o.title || String(o) }));
    } else {
      // fallback: use main categories from tree
      STATE.categories = STATE.categoryTree.map(c => ({ name: c.name, count: c.count }));
    }

    // featured
    try {
      const idx = await loadJSON("./site_data/index.json");
      const ids = idx.featured_product_ids || [];
      STATE.featured = new Set(ids);
    } catch {
      STATE.featured = new Set();
    }

    renderCategories();
    bindEvents();
    applyFilters();
    // Слушаем обновления от админ панели
    window.addEventListener('catalog:updated', reloadCatalog);  } catch (err) {
    console.error(err);
    alert("Помилка каталогу. Відкрий Console і покажи червону помилку (err).");
  }
})()
