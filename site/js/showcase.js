/**
 * Showcase Mode Controller
 * Преобразует магазин в витрину (запрос цены вместо покупки)
 */

window.Showcase = (function() {
  const STORE_MODE_KEY = 'storeMode';
  
  function init() {
    const mode = localStorage.getItem(STORE_MODE_KEY) || 'shop';
    applyMode(mode);
  }

  function getMode() {
    return localStorage.getItem(STORE_MODE_KEY) || 'shop';
  }

  function setMode(mode) {
    localStorage.setItem(STORE_MODE_KEY, mode);
    applyMode(mode);
    location.reload();
  }

  function isShowcase() {
    return getMode() === 'showcase';
  }

  function applyMode(mode) {
    if (mode === 'showcase') {
      // Скрыть кнопку добавления в карзину, показать "Запросить цену"
      document.documentElement.setAttribute('data-store-mode', 'showcase');
    } else {
      document.documentElement.setAttribute('data-store-mode', 'shop');
    }
  }

  function showPriceRequestModal(productId, productTitle, productPrice) {
    const modal = document.createElement('div');
    modal.className = 'showcase-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
      <div class="showcase-form">
        <div style="padding: 30px;">
          <h2>Запросити ціну</h2>
          <p style="color: var(--muted); margin-bottom: 20px;">${productTitle}</p>
          
          <div class="form-group">
            <label class="form-label">Ваше ім'я *</label>
            <input id="priceReqName" class="form-input" type="text" placeholder="Іван">
          </div>

          <div class="form-group">
            <label class="form-label">Телефон *</label>
            <input id="priceReqPhone" class="form-input" type="tel" placeholder="+38 (0__)...">
          </div>

          <div class="form-group">
            <label class="form-label">Email</label>
            <input id="priceReqEmail" class="form-input" type="email" placeholder="email@example.com">
          </div>

          <div class="form-group">
            <label class="form-label">Коментар</label>
            <textarea id="priceReqComment" class="form-textarea" placeholder="Вкажіть кількість, особливості..."></textarea>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px;">
            <button class="btn primary" onclick="Showcase.sendRequest('${productId}', '${productTitle}')">Надіслати</button>
            <button class="btn" onclick="this.closest('.showcase-modal').remove()">Скасувати</button>
          </div>

          <div style="margin-top: 15px; padding: 10px; background: var(--card); border-radius: 6px; font-size: 12px; color: var(--muted);">
            Ми зв'яжемося з вами протягом 1-2 годин і запропонуємо кращу ціну та умови доставки.
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => modal.style.display = 'flex', 10);
  }

  function sendRequest(productId, productTitle) {
    const name = document.getElementById('priceReqName').value.trim();
    const phone = document.getElementById('priceReqPhone').value.trim();
    const email = document.getElementById('priceReqEmail').value.trim();
    const comment = document.getElementById('priceReqComment').value.trim();

    if (!name || !phone) {
      alert('Вкажіть ім\'я та телефон');
      return;
    }

    // Формируем текст заявки
    const text = `
📋 ЗАПИТ ЦІНИ

Товар: ${productTitle}
ID: ${productId}

👤 Контакти:
Ім'я: ${name}
Телефон: ${phone}
${email ? `Email: ${email}` : ''}

${comment ? `💬 Коментар:\n${comment}` : ''}

Час: ${new Date().toLocaleString('uk-UA')}
    `.trim();

    // Копируем в буфер обмена
    navigator.clipboard.writeText(text).then(() => {
      // Предлагаем несколько каналов
      showChannelOptions(text, phone, email, name);
    });
  }

  function showChannelOptions(text, phone, email, name) {
    const baseText = encodeURIComponent(text);
    const phoneEncoded = encodeURIComponent(phone);
    
    const modal = document.createElement('div');
    modal.className = 'showcase-modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
      <div class="showcase-form">
        <div style="padding: 30px; text-align: center;">
          <h2>✅ Заявка скопійована!</h2>
          <p style="color: var(--muted); margin-bottom: 20px;">Оберіть спосіб зв'язку:</p>
          
          <div style="display: grid; gap: 10px;">
            <a href="https://viber.click/${phoneEncoded}?text=${baseText}" class="btn primary" target="_blank" onclick="this.closest('.showcase-modal').remove()">💬 Viber</a>
            <a href="https://t.me/stroyklimat?text=${baseText}" class="btn" target="_blank" onclick="this.closest('.showcase-modal').remove()">✈️ Telegram</a>
            <a href="https://wa.me/${phoneEncoded.replace(/[^0-9]/g, '')}?text=${baseText}" class="btn" target="_blank" onclick="this.closest('.showcase-modal').remove()">💚 WhatsApp</a>
            <a href="mailto:denis_bis@ukr.net?subject=Запрос%20цены&body=${baseText}" class="btn" target="_blank" onclick="this.closest('.showcase-modal').remove()">📧 Email</a>
          </div>

          <p style="color: var(--muted); font-size: 12px; margin-top: 20px;">Текст вже в буфері обміну ✓</p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  return {
    init,
    getMode,
    setMode,
    isShowcase,
    showPriceRequestModal,
    sendRequest
  };
})();

// Init on load
document.addEventListener('DOMContentLoaded', Showcase.init);
