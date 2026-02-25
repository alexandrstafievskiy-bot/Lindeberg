/* Global Store (no modules). корзина + обране. */
(function () {
  const CART_KEY = "cart";
  const FAV_KEY  = "fav";

  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }
  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function fmtUAH(n) {
    const v = toNum(n);
    if (!v) return "Ціну уточнюйте";
    return v.toLocaleString("uk-UA") + " ₴";
  }
  function getPrimaryImage(images) {
    if (!Array.isArray(images)) return "";
    const clean = images
      .filter(Boolean)
      .filter((u) => !String(u).includes("2382346564_w350_h100_tov-bis-7"));
    return clean[0] || images[0] || "";
  }
  function escapeHTML(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function read(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return safeJsonParse(raw, fallback);
  }
  function write(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  function getCart() {
    const v = read(CART_KEY, []);
    return Array.isArray(v) ? v : [];
  }
  function setCart(items) {
    write(CART_KEY, Array.isArray(items) ? items : []);
  }
  function getFav() {
    const v = read(FAV_KEY, []);
    return Array.isArray(v) ? v : [];
  }
  function setFav(ids) {
    write(FAV_KEY, Array.isArray(ids) ? ids : []);
  }

  function cartCount() {
    return getCart().reduce((s, x) => s + (Number(x.qty) || 0), 0);
  }
  function favCount() {
    return getFav().length;
  }

  function inFav(id) {
    return getFav().includes(String(id));
  }

  function toggleFav(id) {
    id = String(id);
    const fav = getFav();
    const i = fav.indexOf(id);
    if (i >= 0) fav.splice(i, 1);
    else fav.push(id);
    setFav(fav);
    if (window.Analytics && window.Analytics.trackAddToFav) {
      window.Analytics.trackAddToFav(id);
    }
    // событие, чтобы страницы обновлялись
    window.dispatchEvent(new Event("store:change"));
    return fav.includes(id);
  }
  function addToCart(product, qty) {
    if (!product || !product.id) return;
    const id = String(product.id);
    qty = Number(qty) || 1;
    const cart = getCart();
    const i = cart.findIndex(x => String(x.id) === id);
    if (i >= 0) {
      cart[i].qty = (Number(cart[i].qty) || 0) + qty;
    } else {
      cart.push({
        id,
        qty,
        title: product.title || "",
        price_uah: Number(product.price_uah) || 0,
        image: product.image || getPrimaryImage(product.images)
      });
    }
    setCart(cart);
    if (window.Analytics && window.Analytics.trackAddToCart) {
      window.Analytics.trackAddToCart(id);
    }
    window.dispatchEvent(new Event("store:change"));
  }

  function removeFromCart(id) {
    id = String(id);
    const cart = getCart().filter(x => String(x.id) !== id);
    setCart(cart);
    window.dispatchEvent(new Event("store:change"));
  }

  function setQty(id, qty) {
    id = String(id);
    qty = Number(qty) || 0;
    const cart = getCart();
    const i = cart.findIndex(x => String(x.id) === id);
    if (i < 0) return;
    if (qty <= 0) cart.splice(i, 1);
    else cart[i].qty = qty;
    setCart(cart);
    window.dispatchEvent(new Event("store:change"));
  }

  // catalog helpers
  let _catalogPromise = null;
  function clearCatalogCache() {
    _catalogPromise = null;
  }
  
  // Функция для чтения published catalog из IndexedDB
  function getPublishedCatalogFromDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open('stroyklimat-admin', 2);
      
      request.onerror = () => {
        console.warn('IndexedDB not available');
        resolve(null);
      };
      
      request.onsuccess = (event) => {
        const db = event.target.result;
        
        // Проверяем существование object store
        if (!db.objectStoreNames.contains('published')) {
          console.warn('Published store not found');
          db.close();
          resolve(null);
          return;
        }
        
        try {
          const tx = db.transaction('published', 'readonly');
          const store = tx.objectStore('published');
          const getRequest = store.get('catalog');
          
          getRequest.onsuccess = () => {
            db.close();
            const result = getRequest.result;
            if (result && result.data) {
              console.log('Loaded catalog from IndexedDB: ' + result.data.length + ' items');
              resolve(result.data);
            } else {
              resolve(null);
            }
          };
          
          getRequest.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch (e) {
          console.warn('Error accessing published store:', e);
          db.close();
          resolve(null);
        }
      };
    });
  }
  
  function loadCatalog() {
    if (_catalogPromise) return _catalogPromise;
    _catalogPromise = (async () => {
      try {
        // Сначала пытаемся загрузить из IndexedDB
        const published = await getPublishedCatalogFromDB();
        if (published && Array.isArray(published)) {
          return published;
        }
      } catch (e) {
        console.warn('Could not load from IndexedDB:', e);
      }
      
      // Fallback: загружаем из файла
      try {
        const r = await fetch("./site_data/catalog.json", { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status + " catalog.json");
        const data = await r.json();
        return Array.isArray(data) ? data : [];
      } catch (e) {
        console.error("loadCatalog failed:", e);
        return [];
      }
    })();
    return _catalogPromise;
  }

  async function getById(id) {
    const catalog = await loadCatalog();
    return catalog.find((p) => String(p.id) === String(id)) || null;
  }

  // expose
  window.Store = {
    fmtUAH,
    escapeHTML,
    getPrimaryImage,
    getCart, setCart,
    getFav, setFav,
    cartCount, favCount,
    inFav, toggleFav,
    addToCart, removeFromCart, setQty,
    loadCatalog, getById,
    clearCatalogCache
  };

  // Слушаем изменения от админ панели через localStorage (для той же вкладки)
  window.addEventListener('storage', function(e) {
    if (e.key === 'publishedCatalog') {
      console.log('📦 Catalog updated from admin panel (storage event)');
      clearCatalogCache();
      window.dispatchEvent(new Event('catalog:updated'));
    }
  });

  // Слушаем изменения через BroadcastChannel (для разных вкладок)
  if (window.BroadcastChannel) {
    const channel = new BroadcastChannel('catalog-updates');
    channel.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'catalog:updated') {
        console.log('📦 Catalog updated from admin panel (broadcast)');
        clearCatalogCache();
        window.dispatchEvent(new CustomEvent('catalog:updated', { detail: event.data }));
      }
    });
  }

  // legacy global aliases
  window.getCart = getCart;
  window.setCart = setCart;
  window.getFav = getFav;
  window.setFav = setFav;
  window.cartCount = cartCount;
  window.favCount = favCount;
  window.inFav = inFav;
  window.isFav = inFav;
  window.toggleFav = toggleFav;
  window.addToCart = addToCart;
  window.removeFromCart = removeFromCart;
  window.setQty = setQty;
  window.loadCatalog = loadCatalog;
  window.getById = getById;
  window.formatUAH = fmtUAH;
  window.fmtUAH = fmtUAH;
  window.getPrimaryImage = getPrimaryImage;
  window.escapeHTML = escapeHTML;
})();
