// product.js — non-module product page script using global Store and app helpers
(function(){
  async function loadJSON(path){ const r = await fetch(path, {cache: 'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status+' '+path); return await r.json(); }
  function escapeHTML(s){ return String(s||"").replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
  function fmtUAH(n){ const v = Number(n||0); if(!v) return 'Ціну уточнюйте'; return v.toLocaleString('uk-UA') + ' ₴'; }
  function getParam(name){ const u = new URL(location.href); return u.searchParams.get(name) || ''; }
  function getPrimaryImage(images){ if(!Array.isArray(images)) return ''; const clean = images.filter(Boolean).map(String).filter(u => !u.includes('tov-bis-7') && !u.includes('w350_h100')); return clean[0] || images[0] || ''; }

  async function main(){
    try{
      if(typeof mountHeader === 'function') mountHeader();
      if(typeof setSearchValueFromURL === 'function') setSearchValueFromURL();

      let catalog = await (window.Store?.loadCatalog ? window.Store.loadCatalog() : loadJSON('./site_data/catalog.json'));

      const id = getParam('id');
      let p = catalog.find(x=>String(x.id) === String(id));
      if(!p){ document.getElementById('product').innerHTML = '<div>Товар не знайдено.</div>'; return; }

      if (window.Analytics && window.Analytics.trackProductClick) {
        window.Analytics.trackProductClick(p.id);
      }

      document.title = (p.title || 'Товар') + ' — STROYKLIMAT';

      const images = (p.images || []).filter(u => u && !String(u).includes('tov-bis-7') && !String(u).includes('w350_h100'));
      const mainImg = images[0] || getPrimaryImage(p.images) || '';
      let active = mainImg;

      function render(){
        const badge = p.stock === 'on_order' ? 'Під замовлення' : 'В наявності';
        const favOn = (window.Store && window.Store.inFav && window.Store.inFav(p.id));

        const thumbs = images.slice(0,10).map(u => `<button class="${u===active?"active":""}" data-img="${escapeHTML(u)}"><img src="${escapeHTML(u)}" alt="thumb"/></button>`).join('');

        document.getElementById('product').innerHTML = `
          <div class="gallery">
            <div class="mainimg">${active ? `<img src="${escapeHTML(active)}" alt="${escapeHTML(p.title)}"/>` : `<div class="muted">Немає фото</div>`}</div>
            <div class="thumbs">${thumbs || `<div class="muted">Немає додаткових фото</div>`}</div>
          </div>
          <div class="kv">
            <h1>${escapeHTML(p.title)}</h1>
            <div class="meta"><span class="chip">${badge}</span> ${p.url ? `<a class="chip" href="${escapeHTML(p.url)}" target="_blank" rel="noreferrer">Відкрити на stroyklimat.net</a>` : ''}</div>
            <div class="bigprice">${fmtUAH(p.price_uah)}</div>
            <div class="buyrow">
              <button class="btn primary add-to-cart" id="addCart">В кошик</button>
              <button class="btn primary price-request-btn" id="priceRequest">💬 Запросити ціну</button>
              <button class="btn" id="toggleFav">${favOn ? '★ В обраному' : '☆ Додати в обране'}</button>
              <a class="btn" href="tel:+380509735955">📞 Подзвонити</a>
            </div>
            <div class="desc"><h3>Опис / Інформація</h3><div class="text">${escapeHTML(String(p.description||'')).replace(/\n/g,'<br/>')}</div></div>
          </div>`;

        document.querySelector('.thumbs')?.addEventListener('click', (e)=>{ const b = e.target.closest('[data-img]'); if(!b) return; active = b.getAttribute('data-img'); render(); });

        document.getElementById('addCart')?.addEventListener('click', ()=>{ if(window.Store && window.Store.addToCart) window.Store.addToCart(p, 1); if(typeof mountHeader === 'function') mountHeader(); });

        document.getElementById('priceRequest')?.addEventListener('click', ()=>{ 
          const mode = localStorage.getItem('storeMode') || 'shop';
          if(mode === 'showcase' && window.Showcase) {
            window.Showcase.showPriceRequestModal(p.id, p.title, p.price_uah);
          }
        });

        document.getElementById('toggleFav')?.addEventListener('click', ()=>{ if(window.Store && window.Store.toggleFav){ const on = window.Store.toggleFav(p.id); document.getElementById('toggleFav').textContent = on ? '★ В обраному' : '☆ Додати в обране'; if(typeof mountHeader === 'function') mountHeader(); } });
      }

      render();

      // related
      const related = [];
      const byUrl = new Map((catalog||[]).map(x=>[x.url, x]));
      for(const u of (p.related_urls || [])){
        const rp = byUrl.get(u);
        if(rp) related.push(rp);
        if(related.length >= 8) break;
      }

      function cardHTML(p){ const img = getPrimaryImage(p.images); const fav = (window.Store && window.Store.inFav && window.Store.inFav(p.id)); return `
        <article class="card" data-id="${escapeHTML(p.id)}">
          <a class="card-link" href="./product.html?id=${encodeURIComponent(p.id)}"></a>
          <div class="img">${img ? `<img loading="lazy" src="${escapeHTML(img)}" alt="${escapeHTML(p.title)}">` : `<div class="img-ph"></div>`}</div>
          <div class="body"><div class="title">${escapeHTML(p.title)}</div><div class="price">${fmtUAH(p.price_uah)}</div><div class="row"><button class="btn btn-primary" data-add="${escapeHTML(p.id)}">В кошик</button><button class="btn btn-ghost fav" data-fav="${escapeHTML(p.id)}">Обране</button></div></div>
        </article>`; }

      document.getElementById('related').innerHTML = (related.map(cardHTML).join(''));
      document.getElementById('related').addEventListener('click', (e)=>{ const add = e.target.closest('[data-add]'); const fav = e.target.closest('[data-fav]'); if(add){ const id = add.getAttribute('data-add'); if(window.Store && window.Store.addToCart) window.Store.addToCart(id,1); if(typeof mountHeader === 'function') mountHeader(); } if(fav){ const pid = fav.getAttribute('data-fav'); if(window.Store && window.Store.toggleFav) { const on = window.Store.toggleFav(pid); fav.textContent = (on ? '★' : '☆') + ' Обране'; if(typeof mountHeader === 'function') mountHeader(); } } });

    }catch(err){ console.error(err); }
  }

  main();
  
  // Слушаем обновления от админ панели
  window.addEventListener('catalog:updated', main);
})();
