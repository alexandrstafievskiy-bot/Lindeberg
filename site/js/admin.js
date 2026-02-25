/**
 * STROYKLIMAT Admin Panel
 * Управління каталогом przez JSON, IndexedDB + localStorage
 */

window.Admin = (function() {
  const PIN_HASH = "81dc9bdb52d04dc20036dbd8313ed055"; // MD5("1234")
  const DB_NAME = 'stroyklimat-admin';
  const STORE_NAME = 'catalog-versions';
  const PUBLISHED_STORE = 'published';
  
  let db = null;
  let currentDraft = [];
  let originalCatalog = [];
  let currentEditId = null;
  let currentPage = 1;
  let lastPageItems = [];
  const selectedIds = new Set();
  const ITEMS_PER_PAGE = 50;
  const ADMIN_CATEGORIES_KEY = 'adminCategories';
  const ADMIN_BRANDS_KEY = 'adminBrands';

  function escHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function readAdminList(key) {
    try {
      const raw = localStorage.getItem(key);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeAdminList(key, list) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  // ===== INIT & AUTH =====
  async function init() {
    await initIndexedDB();
    await migrateLegacyData(); // Переносим старые данные из localStorage
    checkAuth();
    if (isAuthenticated()) {
      setupUI();
      await loadCatalog();
      renderProducts();
    }
  }

  async function initIndexedDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('IndexedDB is not available, falling back to localStorage');
        db = null;
        resolve();
        return;
      }

      const request = indexedDB.open(DB_NAME, 2); // Версия 2 для добавления published store
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db = request.result;

        // Если в существующей БД нет нужных хранилищ — пересоздаем
        if (!db.objectStoreNames.contains(STORE_NAME) || !db.objectStoreNames.contains(PUBLISHED_STORE)) {
          db.close();
          rebuildDatabase().then(resolve).catch(reject);
          return;
        }

        resolve();
      };
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        const oldVersion = e.oldVersion;
        
        // Версия 1: черновики
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          }
        }
        
        // Версия 2: опубликованный каталог
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(PUBLISHED_STORE)) {
            db.createObjectStore(PUBLISHED_STORE, { keyPath: 'id' });
          }
        }
      };
    });
  }

  function rebuildDatabase() {
    return new Promise((resolve, reject) => {
      const del = indexedDB.deleteDatabase(DB_NAME);
      del.onerror = () => reject(del.error);
      del.onsuccess = () => {
        const reopen = indexedDB.open(DB_NAME, 2);
        reopen.onerror = () => reject(reopen.error);
        reopen.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          }
          if (!db.objectStoreNames.contains(PUBLISHED_STORE)) {
            db.createObjectStore(PUBLISHED_STORE, { keyPath: 'id' });
          }
        };
        reopen.onsuccess = () => {
          db = reopen.result;
          resolve();
        };
      };
    });
  }

  // Миграция данных из localStorage в IndexedDB
  async function migrateLegacyData() {
    try {
      const legacyData = localStorage.getItem('publishedCatalog');
      if (legacyData) {
        console.log('Migrating legacy catalog from localStorage to IndexedDB...');
        const catalog = JSON.parse(legacyData);
        await savePublishedCatalog(catalog);
        localStorage.removeItem('publishedCatalog');
        console.log('Migration completed, removed from localStorage');
      }
    } catch (e) {
      console.error('Migration failed:', e);
    }
  }

  function hashPassword(pin) {
    // Simple hash - не безопасный, но для демо подойдёт
    let hash = 0;
    for (let i = 0; i < pin.length; i++) {
      hash = ((hash << 5) - hash) + pin.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  function checkAuth() {
    const stored = localStorage.getItem('adminAuth');
    if (stored) {
      document.querySelector('.admin-wrapper').style.display = 'grid';
      document.getElementById('loginModal').style.display = 'none';
    } else {
      document.querySelector('.admin-wrapper').style.display = 'none';
      document.getElementById('loginModal').style.display = 'flex';
    }
  }

  function isAuthenticated() {
    return localStorage.getItem('adminAuth') === 'true';
  }

  function login() {
    const pin = document.getElementById('adminPin').value;
    
    if (pin === 'StroyKKlimat2026') {
      localStorage.setItem('adminAuth', 'true');
      document.querySelector('.admin-wrapper').style.display = 'grid';
      document.getElementById('loginModal').style.display = 'none';
      setupUI();
      loadCatalog().then(() => renderProducts());
    } else {
      showAlert('Невірний PIN', 'error');
    }
  }

  function logout() {
    if (confirm('Вихід з адмін панелі?')) {
      localStorage.removeItem('adminAuth');
      location.href = './index.html';
    }
  }

  // ===== CATALOG MANAGEMENT =====
  async function loadCatalog() {
    try {
      // Загружаем опубликованный каталог из IndexedDB
      const published = await getPublishedCatalog();
      if (published && Array.isArray(published) && published.length > 0) {
        originalCatalog = published;
        console.log('Loaded published catalog from IndexedDB:', published.length, 'items');
      } else {
        // Fallback: загружаем из JSON файла
        console.log('No published catalog in IndexedDB, loading from JSON file...');
        const response = await fetch('./site_data/catalog.json');
        if (!response.ok) {
          throw new Error('Failed to load catalog.json: ' + response.status);
        }
        const jsonData = await response.json();
        if (!Array.isArray(jsonData)) {
          throw new Error('catalog.json is not an array');
        }
        originalCatalog = jsonData;
        console.log('Loaded catalog from JSON:', originalCatalog.length, 'items');
      }

      // Загружаем draft из IndexedDB
      const stored = await getFromDB();
      if (stored && Array.isArray(stored) && stored.length > 0) {
        currentDraft = stored;
        console.log('Loaded draft from IndexedDB:', currentDraft.length, 'items');
      } else {
        currentDraft = JSON.parse(JSON.stringify(originalCatalog));
        console.log('No draft found, using original catalog');
      }
      
      loadCategories();
      
      if (currentDraft.length === 0) {
        showAlert('Каталог порожній. Імпортуй товари або створи нові.', 'warning');
      }
    } catch (e) {
      console.error('Помилка завантаження каталогу:', e);
      showAlert('Помилка завантаження каталогу: ' + e.message, 'error');
      // Fallback to empty catalog
      currentDraft = [];
      originalCatalog = [];
    }
  }

  function getFromDB() {
    return new Promise((resolve) => {
      if (!db) {
        resolve(null);
        return;
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        resolve(null);
        return;
      }
      const store = db.transaction(STORE_NAME).objectStore(STORE_NAME);
      const request = store.get('current');
      request.onsuccess = () => resolve(request.result?.data);
      request.onerror = () => resolve(null);
    });
  }

  function saveToDB(data) {
    return new Promise((resolve) => {
      if (!db) {
        resolve();
        return;
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        resolve();
        return;
      }
      const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
      store.put({ id: 'current', data, timestamp: Date.now() });
      resolve();
    });
  }

  // ===== PUBLISHED CATALOG (IndexedDB) =====
  async function savePublishedCatalog(data) {
    return new Promise((resolve, reject) => {
      if (!db) {
        try {
          localStorage.setItem('publishedCatalog', JSON.stringify(data));
          localStorage.setItem('catalogTimestamp', Date.now().toString());
          resolve();
        } catch (e) {
          reject(new Error('DB not initialized'));
        }
        return;
      }
      try {
        const tx = db.transaction(PUBLISHED_STORE, 'readwrite');
        const store = tx.objectStore(PUBLISHED_STORE);
        const timestamp = Date.now();
        
        store.put({ 
          id: 'catalog', 
          data: data, 
          timestamp: timestamp 
        });
        
        // Обновляем timestamp в localStorage для синхронизации
        localStorage.setItem('catalogTimestamp', timestamp.toString());
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function getPublishedCatalog() {
    return new Promise((resolve, reject) => {
      if (!db) {
        try {
          const legacy = localStorage.getItem('publishedCatalog');
          resolve(legacy ? JSON.parse(legacy) : null);
        } catch (e) {
          resolve(null);
        }
        return;
      }
      if (!db.objectStoreNames.contains(PUBLISHED_STORE)) {
        resolve(null);
        return;
      }
      try {
        const tx = db.transaction(PUBLISHED_STORE, 'readonly');
        const store = tx.objectStore(PUBLISHED_STORE);
        const request = store.get('catalog');
        
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.data : null);
        };
        request.onerror = () => resolve(null);
      } catch (e) {
        reject(e);
      }
    });
  }

  // ===== PRODUCT MANAGEMENT =====
  function showPanel(panel, el) {
    const panelId = panel === 'products' ? 'productPanel' : panel + 'Panel';
    const targetPanel = document.getElementById(panelId);
    if (!targetPanel) {
      console.error('Panel not found:', panelId);
      return;
    }
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    targetPanel.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    if (el && el.classList) {
      el.classList.add('active');
    } else if (typeof event !== 'undefined' && event.target) {
      event.target.classList.add('active');
    }

    if (panel === 'stats') renderStats();
    if (panel === 'versions') renderVersions();
    if (panel === 'categories') renderCategoriesPanel();
    
    // Close mobile menu when switching panels
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.querySelector('.mobile-sidebar-overlay');
    if (sidebar && overlay) {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
    }
  }

  function filterProducts() {
    currentPage = 1;
    renderProducts();
  }

  function getFilteredProducts() {
    const searchEl = document.getElementById('searchFilter');
    const categoryEl = document.getElementById('categoryFilter');
    const brandEl = document.getElementById('brandFilter');

    if (!searchEl || !categoryEl) {
      console.error('Search elements not found');
      return [];
    }

    const search = searchEl.value.toLowerCase();
    const category = categoryEl.value;
    const brand = brandEl ? brandEl.value : '';

    return currentDraft.filter(p => {
      const matchSearch = !search || (p.title && p.title.toLowerCase().includes(search));
      const matchCategory = !category || p.category === category;
      const matchBrand = !brand || p.brand === brand;
      return matchSearch && matchCategory && matchBrand;
    });
  }

  function renderProducts() {
    syncSelectedIds();
    const filtered = getFilteredProducts();

    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const page = filtered.slice(start, end);
    lastPageItems = page;

    const html = page.map(p => {
      const shortId = p.id ? (p.id.length > 8 ? p.id.substring(0, 8) + '...' : p.id) : 'N/A';
      const stockIcon = p.stock === 'in_stock' ? '✓' : (p.stock === 'limited' ? '⚠' : '✗');
      const desc = (p.description || '').substring(0, 50);
      const isChecked = selectedIds.has(p.id);
      return `
      <div class="table-row" data-id="${p.id}">
        <div class="cell">
          <input type="checkbox" class="checkbox" ${isChecked ? 'checked' : ''} onchange="Admin.toggleSelectOne('${p.id}', this.checked)">
        </div>
        <div class="cell">${shortId}</div>
        <div class="cell">${p.title || 'Без назви'}</div>
        <div class="cell">${p.category || '-'}</div>
        <div class="cell">₴${p.price_uah || 0}</div>
        <div class="cell">${stockIcon}</div>
        <div class="cell">${desc}${desc.length >= 50 ? '...' : ''}</div>
        <div class="cell">
          <button class="btn" onclick="Admin.editProduct('${p.id}')" style="font-size:12px;padding:6px 10px;">✏️</button>
        </div>
      </div>
    `;
    }).join('');

    const tableEl = document.getElementById('productsTable');
    if (tableEl) {
      tableEl.innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--muted);">Товарів не знайдено</div>';
    }

    // Пагинация
    const pages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    const paginationHtml = pages > 1 ? Array.from({length: Math.min(pages, 10)}, (_, i) => {
      const pageNum = i + 1;
      return `<button class="page-btn ${pageNum === currentPage ? 'active' : ''}" onclick="Admin.goToPage(${pageNum})">${pageNum}</button>`;
    }).join('') : '';
    
    const paginationEl = document.getElementById('pagination');
    if (paginationEl) {
      paginationEl.innerHTML = paginationHtml;
    }
    
    updateSelectAllState();
    updateSelectedCount();

    // Render mobile cards
    renderMobileCards(page);
  }
  
  function renderMobileCards(products) {
    const cardsEl = document.getElementById('productCards');
    if (!cardsEl) return;
    
    const html = products.map(p => {
      const stockIcon = p.stock === 'in_stock' ? '✓' : (p.stock === 'limited' ? '⚠' : '✗');
      const stockText = p.stock === 'in_stock' ? 'В наявності' : (p.stock === 'limited' ? 'Обмежено' : 'Немає');
      const desc = (p.description || 'Без опису').substring(0, 80);
      const isChecked = selectedIds.has(p.id);
      
      return `
        <div class="product-card">
          <div class="product-card-header">
            <div class="product-card-title">${p.title || 'Без назви'}</div>
            <label>
              <input type="checkbox" class="checkbox" ${isChecked ? 'checked' : ''} onchange="Admin.toggleSelectOne('${p.id}', this.checked)">
            </label>
            <button class="btn" onclick="Admin.editProduct('${p.id}')" style="font-size:12px;padding:6px 10px;margin-left:10px;">✏️</button>
          </div>
          <div class="product-card-body">
            <div class="product-card-row">
              <div class="product-card-label">Категорія:</div>
              <div class="product-card-value">${p.category || '-'}</div>
            </div>
            <div class="product-card-row">
              <div class="product-card-label">Ціна:</div>
              <div class="product-card-value">₴${p.price_uah || 0}</div>
            </div>
            <div class="product-card-row">
              <div class="product-card-label">Наявність:</div>
              <div class="product-card-value">${stockIcon} ${stockText}</div>
            </div>
            ${p.brand ? `
            <div class="product-card-row">
              <div class="product-card-label">Бренд:</div>
              <div class="product-card-value">${p.brand}</div>
            </div>` : ''}
            ${p.sku ? `
            <div class="product-card-row">
              <div class="product-card-label">Артикул:</div>
              <div class="product-card-value">${p.sku}</div>
            </div>` : ''}
            <div class="product-card-row">
              <div class="product-card-label">Опис:</div>
              <div class="product-card-value">${desc}${desc.length >= 80 ? '...' : ''}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    cardsEl.innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--muted);">Товарів не знайдено</div>';
  }

  function toggleSelectOne(id, checked) {
    if (checked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    updateSelectAllState();
    updateSelectedCount();
  }

  function toggleSelectAllPage(checked) {
    if (!lastPageItems.length) return;
    lastPageItems.forEach(item => {
      if (checked) {
        selectedIds.add(item.id);
      } else {
        selectedIds.delete(item.id);
      }
    });
    renderProducts();
  }

  function updateSelectAllState() {
    const selectAll = document.getElementById('selectAllPage');
    const selectAllHeader = document.getElementById('selectAllPageHeader');
    if (!selectAll && !selectAllHeader) return;
    if (!lastPageItems.length) {
      if (selectAll) selectAll.checked = false;
      if (selectAllHeader) selectAllHeader.checked = false;
      return;
    }
    const allChecked = lastPageItems.every(item => selectedIds.has(item.id));
    if (selectAll) selectAll.checked = allChecked;
    if (selectAllHeader) selectAllHeader.checked = allChecked;
  }

  function updateSelectedCount() {
    const el = document.getElementById('selectedCount');
    if (el) {
      el.textContent = `Вибрано: ${selectedIds.size}`;
    }
  }

  function syncSelectedIds() {
    const ids = new Set(currentDraft.map(p => p.id));
    Array.from(selectedIds).forEach(id => {
      if (!ids.has(id)) selectedIds.delete(id);
    });
  }

  function updateBulkValueUI() {
    const action = document.getElementById('bulkAction');
    const value = document.getElementById('bulkValue');
    const stock = document.getElementById('bulkStockValue');
    if (!action || !value || !stock) return;

    value.style.display = 'none';
    stock.style.display = 'none';

    if (action.value === 'discount_percent' || action.value === 'price_delta') {
      value.style.display = 'inline-block';
      value.value = '';
      value.placeholder = action.value === 'discount_percent' ? 'Відсоток' : 'Сума (UAH)';
    }

    if (action.value === 'stock') {
      stock.style.display = 'inline-block';
    }
  }

  function getBulkTargets() {
    const scope = document.getElementById('bulkScope');
    if (scope && scope.value === 'filtered') {
      return getFilteredProducts();
    }
    return currentDraft.filter(p => selectedIds.has(p.id));
  }

  function buildPreview(targets, action, value) {
    if (!targets.length) return 'Немає товарів для зміни.';

    let preview = `Товарів: ${targets.length}`;
    const examples = targets.slice(0, 3);

    if (action === 'discount_percent') {
      preview += `\nЗнижка: ${value}%`;
      examples.forEach(p => {
        const oldPrice = p.price_uah || 0;
        const newPrice = Math.max(0, Math.round(oldPrice * (1 - value / 100)));
        preview += `\n${p.title}: ₴${oldPrice} → ₴${newPrice}`;
      });
    } else if (action === 'price_delta') {
      preview += `\nЗміна ціни: ${value} UAH`;
      examples.forEach(p => {
        const oldPrice = p.price_uah || 0;
        const newPrice = Math.max(0, Math.round(oldPrice + value));
        preview += `\n${p.title}: ₴${oldPrice} → ₴${newPrice}`;
      });
    } else if (action === 'stock') {
      preview += `\nНаявність: ${value}`;
    } else if (action === 'featured_on') {
      preview += '\nFeatured: увімкнено';
    } else if (action === 'featured_off') {
      preview += '\nFeatured: вимкнено';
    }

    return preview;
  }

  function previewBulk() {
    const action = document.getElementById('bulkAction');
    const valueInput = document.getElementById('bulkValue');
    const stock = document.getElementById('bulkStockValue');
    if (!action || !valueInput || !stock) return;
    if (!action.value) {
      showAlert('Оберіть операцію', 'warning');
      return;
    }

    let value = 0;
    if (action.value === 'discount_percent' || action.value === 'price_delta') {
      value = parseFloat(valueInput.value);
      if (Number.isNaN(value)) {
        showAlert('Введіть значення', 'warning');
        return;
      }
    }
    if (action.value === 'stock') {
      value = stock.value;
    }

    const targets = getBulkTargets();
    alert(buildPreview(targets, action.value, value));
  }

  function applyBulk() {
    const action = document.getElementById('bulkAction');
    const valueInput = document.getElementById('bulkValue');
    const stock = document.getElementById('bulkStockValue');
    if (!action || !valueInput || !stock) return;
    if (!action.value) {
      showAlert('Оберіть операцію', 'warning');
      return;
    }

    let value = 0;
    if (action.value === 'discount_percent' || action.value === 'price_delta') {
      value = parseFloat(valueInput.value);
      if (Number.isNaN(value)) {
        showAlert('Введіть значення', 'warning');
        return;
      }
    }
    if (action.value === 'stock') {
      value = stock.value;
    }

    const targets = getBulkTargets();
    if (!targets.length) {
      showAlert('Немає товарів для зміни', 'warning');
      return;
    }

    const preview = buildPreview(targets, action.value, value);
    if (!confirm(`${preview}\n\nЗастосувати зміни?`)) {
      return;
    }

    targets.forEach(p => {
      if (action.value === 'discount_percent') {
        const oldPrice = p.price_uah || 0;
        p.price_uah = Math.max(0, Math.round(oldPrice * (1 - value / 100)));
      } else if (action.value === 'price_delta') {
        const oldPrice = p.price_uah || 0;
        p.price_uah = Math.max(0, Math.round(oldPrice + value));
      } else if (action.value === 'stock') {
        p.stock = value;
      } else if (action.value === 'featured_on') {
        p.featured = true;
      } else if (action.value === 'featured_off') {
        p.featured = false;
      }
    });

    saveToDB(currentDraft);
    savePublishedCatalog(currentDraft).then(() => {
      showAlert('Масова операція застосована', 'success');
      recordHistory('bulk:' + action.value, currentDraft.length);
    }).catch(() => {
      showAlert('Зміни застосовані, але не збережені в публікації', 'warning');
    });
    loadCategories();
    renderProducts();
  }
  
  function toggleMobileMenu() {
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.querySelector('.mobile-sidebar-overlay');
    
    if (sidebar && overlay) {
      sidebar.classList.toggle('active');
      overlay.classList.toggle('active');
    }
  }

  function goToPage(page) {
    currentPage = page;
    renderProducts();
  }

  function newProduct() {
    currentEditId = null;
    document.getElementById('modalTitle').textContent = 'Новий Товар';
    document.getElementById('deleteBtn').style.display = 'none';
    
    document.getElementById('editTitle').value = '';
    document.getElementById('editPrice').value = '';
    document.getElementById('editSku').value = '';
    document.getElementById('editBrand').value = '';
    document.getElementById('editImage').value = '';
    document.getElementById('editDescription').value = '';
    document.getElementById('editFeatured').checked = false;
    document.getElementById('editStock').value = 'in_stock';

    document.getElementById('productModal').classList.add('active');
  }

  function editProduct(id) {
    const product = currentDraft.find(p => p.id === id);
    if (!product) {
      showAlert('Товар не знайдено', 'error');
      return;
    }

    currentEditId = id;
    document.getElementById('modalTitle').textContent = 'Редагувати Товар';
    document.getElementById('deleteBtn').style.display = 'block';

    document.getElementById('editTitle').value = product.title || '';
    document.getElementById('editCategory').value = product.category || '';
    document.getElementById('editPrice').value = product.price_uah || 0;
    document.getElementById('editSku').value = product.sku || '';
    document.getElementById('editBrand').value = product.brand || '';
    document.getElementById('editImage').value = (product.images && product.images[0]) || '';
    document.getElementById('editDescription').value = product.description || '';
    document.getElementById('editFeatured').checked = product.featured || false;
    document.getElementById('editStock').value = product.stock || 'in_stock';

    document.getElementById('productModal').classList.add('active');
  }

  function saveProduct() {
    const title = document.getElementById('editTitle').value.trim();
    const price = parseFloat(document.getElementById('editPrice').value);
    const category = document.getElementById('editCategory').value;

    if (!title || !category || !price) {
      showAlert('Заповни обов\'язкові поля', 'warning');
      return;
    }

    if (currentEditId) {
      // Редаґувати
      const idx = currentDraft.findIndex(p => p.id === currentEditId);
      if (idx !== -1) {
        currentDraft[idx] = {
          ...currentDraft[idx],
          title,
          price_uah: price,
          category: document.getElementById('editCategory').value,
          sku: document.getElementById('editSku').value,
          brand: document.getElementById('editBrand').value,
          stock: document.getElementById('editStock').value,
          images: document.getElementById('editImage').value ? [document.getElementById('editImage').value] : [],
          description: document.getElementById('editDescription').value,
          featured: document.getElementById('editFeatured').checked
        };
      }
    } else {
      // Новий товар
      currentDraft.push({
        id: 'p' + Date.now(),
        title,
        price_uah: price,
        category: document.getElementById('editCategory').value,
        sku: document.getElementById('editSku').value,
        brand: document.getElementById('editBrand').value,
        stock: document.getElementById('editStock').value,
        images: document.getElementById('editImage').value ? [document.getElementById('editImage').value] : [],
        description: document.getElementById('editDescription').value,
        featured: document.getElementById('editFeatured').checked
      });
    }

    saveToDB(currentDraft);
    savePublishedCatalog(currentDraft).then(() => {
      // Trigger custom event для текущей вкладки
      window.dispatchEvent(new CustomEvent('catalog:updated', { detail: { data: currentDraft }}));
      // Broadcast для других вкладок
      if (window.BroadcastChannel) {
        const channel = new BroadcastChannel('catalog-updates');
        channel.postMessage({ type: 'catalog:updated', data: currentDraft });
        channel.close();
      }
      showAlert('Товар збережено і опубліковано', 'success');
      recordHistory('save_product', currentDraft.length);
    }).catch(e => {
      console.error('Publishing failed:', e);
      showAlert('Товар збережено, але помилка публікації', 'warning');
    });
    closeModal();
    renderProducts();
  }

  function deleteProduct() {
    if (!confirm('Видалити товар?')) return;
    
    currentDraft = currentDraft.filter(p => p.id !== currentEditId);
    saveToDB(currentDraft);
    savePublishedCatalog(currentDraft).then(() => {
      // Trigger custom event для текущей вкладки
      window.dispatchEvent(new CustomEvent('catalog:updated', { detail: { data: currentDraft }}));
      // Broadcast для других вкладок
      if (window.BroadcastChannel) {
        const channel = new BroadcastChannel('catalog-updates');
        channel.postMessage({ type: 'catalog:updated', data: currentDraft });
        channel.close();
      }
      showAlert('Товар видалено і опубліковано', 'success');
      recordHistory('delete_product', currentDraft.length);
    }).catch(e => {
      console.error('Publishing failed:', e);
      showAlert('Товар видалено, але помилка публікації', 'warning');
    });
    closeModal();
    renderProducts();
  }

  function closeModal() {
    document.getElementById('productModal').classList.remove('active');
    currentEditId = null;
  }

  // ===== CATEGORIES =====
  function loadCategories() {
    if (!currentDraft || currentDraft.length === 0) {
      console.warn('No products in catalog, skipping category load');
      const select = document.getElementById('editCategory');
      const filter = document.getElementById('categoryFilter');
      const brandFilter = document.getElementById('brandFilter');
      if (select) select.innerHTML = '<option value="">Без категорії</option>';
      if (filter) filter.innerHTML = '<option value="">Всі категорії</option>';
      if (brandFilter) brandFilter.innerHTML = '<option value="">Всі бренди</option>';
      return;
    }

    const storedCategories = readAdminList(ADMIN_CATEGORIES_KEY);
    const storedBrands = readAdminList(ADMIN_BRANDS_KEY);
    const categories = [...new Set([...storedCategories, ...currentDraft.map(p => p.category).filter(Boolean)])].sort();
    const brands = [...new Set([...storedBrands, ...currentDraft.map(p => p.brand).filter(Boolean)])].sort();
    const select = document.getElementById('editCategory');
    const filter = document.getElementById('categoryFilter');
    const brandFilter = document.getElementById('brandFilter');
    
    if (select) {
      select.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    
    if (filter) {
      filter.innerHTML = '<option value="">Всі категорії</option>' + categories.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    if (brandFilter) {
      brandFilter.innerHTML = '<option value="">Всі бренди</option>' + brands.map(b => `<option value="${b}">${b}</option>`).join('');
    }
  }

  function renderCategoriesPanel() {
    const list = document.getElementById('categoriesList');
    if (!list) return;

    const categoriesCount = {};
    const brandsCount = {};
    currentDraft.forEach(p => {
      if (p.category) categoriesCount[p.category] = (categoriesCount[p.category] || 0) + 1;
      if (p.brand) brandsCount[p.brand] = (brandsCount[p.brand] || 0) + 1;
    });

    const storedCategories = readAdminList(ADMIN_CATEGORIES_KEY);
    const storedBrands = readAdminList(ADMIN_BRANDS_KEY);
    const categories = [...new Set([...storedCategories, ...Object.keys(categoriesCount)])]
      .sort((a, b) => (categoriesCount[b] || 0) - (categoriesCount[a] || 0));
    const brands = [...new Set([...storedBrands, ...Object.keys(brandsCount)])]
      .sort((a, b) => (brandsCount[b] || 0) - (brandsCount[a] || 0));

    const catHtml = categories.map((name) => {
      const count = categoriesCount[name] || 0;
      return `
        <div class="card" data-cat-row data-cat-name="${escHTML(name)}" style="padding:12px 14px; border:1px solid var(--stroke); border-radius:10px;">
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
            <div>
              <div style="font-weight:700;">${escHTML(name)}</div>
              <div style="color:var(--muted); font-size:12px;">Товарів: ${count}</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <input class="form-input" style="min-width:180px" value="${escHTML(name)}">
              <button class="btn" onclick="Admin.renameCategory(this)">Змінити</button>
              <button class="btn danger" onclick="Admin.deleteCategory(this)">Видалити</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const brandHtml = brands.map((name) => {
      const count = brandsCount[name] || 0;
      return `
        <div class="card" data-brand-row data-brand-name="${escHTML(name)}" style="padding:12px 14px; border:1px solid var(--stroke); border-radius:10px;">
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
            <div>
              <div style="font-weight:700;">${escHTML(name)}</div>
              <div style="color:var(--muted); font-size:12px;">Товарів: ${count}</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <input class="form-input" style="min-width:180px" value="${escHTML(name)}">
              <button class="btn" onclick="Admin.renameBrand(this)">Змінити</button>
              <button class="btn danger" onclick="Admin.deleteBrand(this)">Видалити</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    list.innerHTML = `
      <div style="display:grid; gap:14px;">
        <div class="card" style="padding:12px 14px; border:1px solid var(--stroke); border-radius:10px;">
          <div style="font-weight:700; margin-bottom:8px;">Додати категорію</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <input id="newCategoryName" class="form-input" placeholder="Нова категорія">
            <button class="btn primary" onclick="Admin.addCategory()">Додати</button>
          </div>
        </div>
        <div class="card" style="padding:12px 14px; border:1px solid var(--stroke); border-radius:10px;">
          <div style="font-weight:700; margin-bottom:8px;">Додати бренд</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <input id="newBrandName" class="form-input" placeholder="Новий бренд">
            <button class="btn primary" onclick="Admin.addBrand()">Додати</button>
          </div>
        </div>
        <h3 style="margin:0;">Категорії</h3>
        <div style="display:grid; gap:10px;">${catHtml || '<div style="color:var(--muted);">Категорії відсутні</div>'}</div>
        <h3 style="margin:8px 0 0;">Бренди</h3>
        <div style="display:grid; gap:10px;">${brandHtml || '<div style="color:var(--muted);">Бренди відсутні</div>'}</div>
      </div>
    `;
  }

  function addCategory() {
    const input = document.getElementById('newCategoryName');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
      showAlert('Введіть назву категорії', 'warning');
      return;
    }
    const list = readAdminList(ADMIN_CATEGORIES_KEY);
    if (list.includes(name)) {
      showAlert('Категорія вже існує', 'warning');
      return;
    }
    list.push(name);
    writeAdminList(ADMIN_CATEGORIES_KEY, list);
    input.value = '';
    loadCategories();
    renderCategoriesPanel();
    showAlert('Категорію додано', 'success');
    recordHistory('add_category', currentDraft.length);
  }

  function renameCategory(btn) {
    const row = btn?.closest('[data-cat-row]');
    if (!row) return;
    const oldName = row.getAttribute('data-cat-name');
    const input = row.querySelector('input');
    const newName = (input?.value || '').trim();
    if (!newName) {
      showAlert('Введіть назву категорії', 'warning');
      return;
    }
    if (oldName === newName) return;
    currentDraft.forEach(p => {
      if (p.category === oldName) p.category = newName;
    });
    const list = readAdminList(ADMIN_CATEGORIES_KEY).filter(c => c !== oldName);
    if (!list.includes(newName)) list.push(newName);
    writeAdminList(ADMIN_CATEGORIES_KEY, list);
    saveToDB(currentDraft);
    savePublishedCatalog(currentDraft);
    loadCategories();
    renderProducts();
    renderCategoriesPanel();
    showAlert('Категорію змінено', 'success');
    recordHistory('rename_category', currentDraft.length);
  }

  function deleteCategory(btn) {
    const row = btn?.closest('[data-cat-row]');
    if (!row) return;
    const name = row.getAttribute('data-cat-name');
    if (!name) return;
    if (!confirm(`Видалити категорію "${name}"?`)) return;
    currentDraft.forEach(p => {
      if (p.category === name) p.category = '';
    });
    const list = readAdminList(ADMIN_CATEGORIES_KEY).filter(c => c !== name);
    writeAdminList(ADMIN_CATEGORIES_KEY, list);
    saveToDB(currentDraft);
    savePublishedCatalog(currentDraft);
    loadCategories();
    renderProducts();
    renderCategoriesPanel();
    showAlert('Категорію видалено', 'success');
    recordHistory('delete_category', currentDraft.length);
  }

  function addBrand() {
    const input = document.getElementById('newBrandName');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
      showAlert('Введіть назву бренду', 'warning');
      return;
    }
    const list = readAdminList(ADMIN_BRANDS_KEY);
    if (list.includes(name)) {
      showAlert('Бренд вже існує', 'warning');
      return;
    }
    list.push(name);
    writeAdminList(ADMIN_BRANDS_KEY, list);
    input.value = '';
    loadCategories();
    renderCategoriesPanel();
    showAlert('Бренд додано', 'success');
    recordHistory('add_brand', currentDraft.length);
  }

  function renameBrand(btn) {
    const row = btn?.closest('[data-brand-row]');
    if (!row) return;
    const oldName = row.getAttribute('data-brand-name');
    const input = row.querySelector('input');
    const newName = (input?.value || '').trim();
    if (!newName) {
      showAlert('Введіть назву бренду', 'warning');
      return;
    }
    if (oldName === newName) return;
    currentDraft.forEach(p => {
      if (p.brand === oldName) p.brand = newName;
    });
    const list = readAdminList(ADMIN_BRANDS_KEY).filter(b => b !== oldName);
    if (!list.includes(newName)) list.push(newName);
    writeAdminList(ADMIN_BRANDS_KEY, list);
    saveToDB(currentDraft);
    savePublishedCatalog(currentDraft);
    loadCategories();
    renderProducts();
    renderCategoriesPanel();
    showAlert('Бренд змінено', 'success');
    recordHistory('rename_brand', currentDraft.length);
  }

  function deleteBrand(btn) {
    const row = btn?.closest('[data-brand-row]');
    if (!row) return;
    const name = row.getAttribute('data-brand-name');
    if (!name) return;
    if (!confirm(`Видалити бренд "${name}"?`)) return;
    currentDraft.forEach(p => {
      if (p.brand === name) p.brand = '';
    });
    const list = readAdminList(ADMIN_BRANDS_KEY).filter(b => b !== name);
    writeAdminList(ADMIN_BRANDS_KEY, list);
    saveToDB(currentDraft);
    savePublishedCatalog(currentDraft);
    loadCategories();
    renderProducts();
    renderCategoriesPanel();
    showAlert('Бренд видалено', 'success');
    recordHistory('delete_brand', currentDraft.length);
  }

  // ===== IMPORT/EXPORT =====
  function exportCatalog() {
    const json = JSON.stringify(currentDraft, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalog.json';
    a.click();
    URL.revokeObjectURL(url);
    showAlert('Каталог експортовано', 'success');
  }

  function importFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) throw new Error('Не масив');

        const diff = {
          added: 0,
          updated: 0,
          total: imported.length
        };

        imported.forEach(product => {
          const existing = currentDraft.findIndex(p => p.id === product.id);
          if (existing === -1) {
            diff.added++;
          } else {
            diff.updated++;
          }
        });

        currentDraft = imported;
        saveToDB(currentDraft);
        loadCategories();
        renderProducts();
        recordHistory('import', currentDraft.length);
        
        showAlert(`✓ Імпортовано: ${diff.added} нових, ${diff.updated} оновлено`, 'success');
      } catch (err) {
        showAlert('Помилка імпорту файлу: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  // ===== STATISTICS =====
  function renderStats() {
    const stats = {
      total: currentDraft.length,
      categories: new Set(currentDraft.map(p => p.category)).size,
      brands: new Set(currentDraft.map(p => p.brand)).size,
      noImage: currentDraft.filter(p => !p.images || p.images.length === 0).length,
      noDescription: currentDraft.filter(p => !p.description || p.description.length === 0).length,
      inStock: currentDraft.filter(p => p.stock === 'in_stock').length,
      prices: currentDraft.map(p => p.price_uah).filter(p => p > 0)
    };

    stats.avgPrice = stats.prices.length > 0 ? Math.round(stats.prices.reduce((a,b) => a+b) / stats.prices.length) : 0;
    stats.minPrice = stats.prices.length > 0 ? Math.min(...stats.prices) : 0;
    stats.maxPrice = stats.prices.length > 0 ? Math.max(...stats.prices) : 0;

    document.getElementById('statsGrid').innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">Всього товарів</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.categories}</div>
        <div class="stat-label">Категорій</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.brands}</div>
        <div class="stat-label">Брендів</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.inStock}</div>
        <div class="stat-label">В наявності</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">₴${stats.avgPrice}</div>
        <div class="stat-label">Середня ціна</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">₴${stats.minPrice}-${stats.maxPrice}</div>
        <div class="stat-label">Діапазон цін</div>
      </div>
    `;

    document.getElementById('statsDetails').innerHTML = `
      <ul style="list-style: none; padding: 0;">
        <li>❌ Без фото: ${stats.noImage} товарів</li>
        <li>📝 Без опису: ${stats.noDescription} товарів</li>
        <li>✅ У наявності: ${stats.inStock} товарів</li>
      </ul>
    `;

    renderAnalyticsStats();
  }

  function readAnalyticsData() {
    try {
      const raw = localStorage.getItem('analyticsData');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function formatDuration(sec) {
    const total = Math.max(0, Number(sec) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    if (h) return `${h} год ${m} хв`;
    if (m) return `${m} хв ${s} с`;
    return `${s} с`;
  }

  function renderAnalyticsStats() {
    const box = document.getElementById('analyticsStats');
    if (!box) return;

    const data = readAnalyticsData();
    if (!data || !data.totals) {
      box.innerHTML = '<div style="color:var(--muted);">Аналітика ще не зібрана</div>';
      return;
    }

    const totals = data.totals || {};
    const pages = data.pages || {};
    const products = data.products || {};
    const searches = data.searches || {};
    const filters = data.filters || {};

    const topPages = Object.entries(pages)
      .sort((a, b) => (b[1].views || 0) - (a[1].views || 0))
      .slice(0, 5)
      .map(([path, info]) => `<li>${path} — ${info.views || 0} переглядів, ${formatDuration(info.timeSec || 0)}</li>`)
      .join('');

    const productMap = new Map(currentDraft.map(p => [p.id, p.title]));
    const topProducts = Object.entries(products)
      .sort((a, b) => (b[1].views || 0) - (a[1].views || 0))
      .slice(0, 5)
      .map(([id, info]) => `<li>${productMap.get(id) || id} — ${info.views || 0} переглядів</li>`)
      .join('');

    const topSearches = Object.entries(searches)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([q, count]) => `<li>"${q}" — ${count}</li>`)
      .join('');

    const topFilters = Object.entries(filters)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f, count]) => `<li>${f} — ${count}</li>`)
      .join('');

    box.innerHTML = `
      <div style="display:grid; gap:12px;">
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-value">${totals.pageViews || 0}</div><div class="stat-label">Переглядів</div></div>
          <div class="stat-card"><div class="stat-value">${totals.searches || 0}</div><div class="stat-label">Пошуків</div></div>
          <div class="stat-card"><div class="stat-value">${totals.productClicks || 0}</div><div class="stat-label">Кліків по товарах</div></div>
          <div class="stat-card"><div class="stat-value">${totals.addToCart || 0}</div><div class="stat-label">Додано в кошик</div></div>
          <div class="stat-card"><div class="stat-value">${totals.addToFav || 0}</div><div class="stat-label">В обране</div></div>
          <div class="stat-card"><div class="stat-value">${formatDuration(totals.totalTimeSec || 0)}</div><div class="stat-label">Час на сайті</div></div>
        </div>
        <div>
          <strong>Топ сторінок</strong>
          <ul style="list-style: none; padding: 0; margin: 6px 0; color: var(--muted);">${topPages || '<li>Немає даних</li>'}</ul>
        </div>
        <div>
          <strong>Що цікавить клієнта (товари)</strong>
          <ul style="list-style: none; padding: 0; margin: 6px 0; color: var(--muted);">${topProducts || '<li>Немає даних</li>'}</ul>
        </div>
        <div>
          <strong>Популярні пошуки</strong>
          <ul style="list-style: none; padding: 0; margin: 6px 0; color: var(--muted);">${topSearches || '<li>Немає даних</li>'}</ul>
        </div>
        <div>
          <strong>Популярні фільтри</strong>
          <ul style="list-style: none; padding: 0; margin: 6px 0; color: var(--muted);">${topFilters || '<li>Немає даних</li>'}</ul>
        </div>
      </div>
    `;
  }

  // ===== VERSIONS =====
  function renderVersions() {
    const list = document.getElementById('versionsList');
    if (!list) return;
    let history = [];
    try {
      history = JSON.parse(localStorage.getItem('catalogHistory') || '[]');
    } catch {
      history = [];
    }
    if (!history.length) {
      list.innerHTML = '<p style="color:var(--muted);">Історія поки порожня.</p>';
      return;
    }
    const html = history.map(h => {
      const date = new Date(h.time || Date.now());
      return `
        <div class="card" style="padding:12px 14px; border:1px solid var(--stroke); border-radius:10px; margin-bottom:10px;">
          <div style="font-weight:700;">${h.action || 'update'}</div>
          <div style="color:var(--muted); font-size:12px;">${date.toLocaleString()} · Товарів: ${h.count || 0}</div>
        </div>
      `;
    }).join('');
    list.innerHTML = html;
  }

  // ===== SETTINGS =====
  function saveSettings() {
    const mode = document.querySelector('input[name="storeMode"]:checked').value;
    localStorage.setItem('storeMode', mode);
    showAlert('Налаштування збережено', 'success');
  }

  async function publishCatalog() {
    try {
      await savePublishedCatalog(currentDraft);
      // Trigger custom event для текущей вкладки
      window.dispatchEvent(new CustomEvent('catalog:updated', { detail: { data: currentDraft }}));
      // Broadcast для других вкладок
      if (window.BroadcastChannel) {
        const channel = new BroadcastChannel('catalog-updates');
        channel.postMessage({ type: 'catalog:updated', data: currentDraft });
        channel.close();
      }
      showAlert('Каталог опублікований! Користувачі бачитимуть нові дані', 'success');
      recordHistory('publish', currentDraft.length);
    } catch (e) {
      console.error('Publishing failed:', e);
      showAlert('Помилка публікації каталогу', 'error');
    }
  }

  function resetCatalog() {
    if (confirm('Скинути каталог на оригіналь?')) {
      currentDraft = JSON.parse(JSON.stringify(originalCatalog));
      saveToDB(currentDraft);
      renderProducts();
      loadCategories();
      showAlert('Каталог скинуто', 'success');
      recordHistory('reset', currentDraft.length);
    }
  }

  function recordHistory(action, count) {
    try {
      const history = JSON.parse(localStorage.getItem('catalogHistory') || '[]');
      history.unshift({ action, count, time: Date.now() });
      localStorage.setItem('catalogHistory', JSON.stringify(history.slice(0, 50)));
    } catch {
      // ignore
    }
  }

  // ===== UI HELPERS =====
  function setupUI() {
    // Theme toggle
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
      const theme = localStorage.getItem('theme') || 'dark';
      document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
      themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
      
      themeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next === 'light' ? 'light' : '');
        localStorage.setItem('theme', next);
        themeBtn.textContent = next === 'light' ? '☀️' : '🌙';
      });
    }
    
    // Close modal on ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('productModal');
        if (modal && modal.classList.contains('active')) {
          closeModal();
        }
      }
    });
    
    // Close modal on background click
    const modal = document.getElementById('productModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal();
        }
      });
    }

    updateBulkValueUI();
  }

  function showAlert(message, type = 'info') {
    const box = document.getElementById('alertBox');
    const alert = document.createElement('div');
    alert.className = `alert ${type}`;
    alert.textContent = message;
    box.appendChild(alert);
    setTimeout(() => alert.remove(), 3000);
  }

  // ===== PUBLIC API =====
  return {
    init,
    login,
    logout,
    showPanel,
    newProduct,
    editProduct,
    saveProduct,
    deleteProduct,
    closeModal,
    filterProducts,
    goToPage,
    exportCatalog,
    importFile,
    saveSettings,
    publishCatalog,
    resetCatalog,
    toggleMobileMenu,
    toggleSelectOne,
    toggleSelectAllPage,
    previewBulk,
    applyBulk,
    updateBulkValueUI,
    addCategory,
    renameCategory,
    deleteCategory,
    addBrand,
    renameBrand,
    deleteBrand
  };
})();

// Initialize on load
document.addEventListener('DOMContentLoaded', Admin.init);
