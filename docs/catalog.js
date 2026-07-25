'use strict';

const DATA_FILE = './products.csv';
const YOUR_WHATSAPP_NUMBER = '34695886365';
const MAX_IMAGE_COLUMNS = 10;

const CATEGORY_ORDER = ['anillos', 'pendientes', 'broches', 'collares', 'relojes'];
const CATEGORY_LABELS = {
  anillos: 'Anillos',
  pendientes: 'Pendientes',
  broches: 'Broches',
  collares: 'Collares',
  relojes: 'Relojes'
};

let products = [];
let currentProductIndex = 0;
let currentImageIndex = 0;
let currentCategory = 'todo';

const grid = document.getElementById('catalog-grid');
const statusElement = document.getElementById('catalog-status');
const categoryNav = document.getElementById('category-nav');
const zoomModal = document.getElementById('zoom-modal');
const zoomMainImage = document.getElementById('zoom-main-image');
const zoomThumbs = document.getElementById('zoom-thumbs');
const zoomTitle = document.getElementById('zoom-title');

window.addEventListener('DOMContentLoaded', initialiseCatalog);

async function initialiseCatalog() {
  bindStaticEvents();

  try {
    const response = await fetch(`${DATA_FILE}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudo abrir ${DATA_FILE} (${response.status})`);

    const text = await response.text();
    const rows = parseDelimitedText(text);

    products = rows
      .map((row, index) => rowToProduct(row, index))
      .filter(product => product.active && product.name && product.images.length > 0)
      .sort((a, b) => Number(a.sold) - Number(b.sold) || a.order - b.order);

    if (products.length === 0) throw new Error('El archivo no contiene productos activos con imágenes.');

    renderNavigation();
    renderCatalog();
    filterCategory('todo', false);
    statusElement.hidden = true;
  } catch (error) {
    console.error(error);
    statusElement.hidden = false;
    statusElement.textContent = 'No se pudo cargar el catálogo. Revisa products.csv y vuelve a publicar la página.';
  }
}

function rowToProduct(row, index) {
  const images = [];
  for (let i = 1; i <= MAX_IMAGE_COLUMNS; i += 1) {
    const value = String(row[`imagen_${i}`] || '').trim();
    if (value) images.push(value);
  }

  const state = normaliseToken(row.estado || row.vendido || '');
  const activeValue = normaliseToken(row.activo || 'si');

  return {
    id: String(row.id || `producto-${index + 1}`).trim(),
    category: slugify(row.categoria || 'otros'),
    name: String(row.nombre || '').trim(),
    price: parsePrice(row.precio),
    sold: ['vendido', 'si', 'true', '1'].includes(state),
    description: String(row.descripcion || '').trim(),
    images,
    order: parseOrder(row.orden, index),
    active: !['no', 'false', '0', 'inactivo'].includes(activeValue)
  };
}

function renderNavigation() {
  const availableCategories = [...new Set(products.map(product => product.category))];
  const orderedCategories = [
    ...CATEGORY_ORDER.filter(category => availableCategories.includes(category)),
    ...availableCategories.filter(category => !CATEGORY_ORDER.includes(category)).sort()
  ];

  const buttons = [
    '<button type="button" class="category-tab active" data-category="todo">Todo</button>',
    ...orderedCategories.map(category => {
      const label = CATEGORY_LABELS[category] || titleCase(category.replace(/-/g, ' '));
      return `<button type="button" class="category-tab" data-category="${escapeHtml(category)}">${escapeHtml(label)}</button>`;
    })
  ];

  categoryNav.innerHTML = buttons.join('');
}

function renderCatalog() {
  grid.innerHTML = products.map((product, productIndex) => {
    const title = productDisplayTitle(product);
    const images = product.images.map((source, imageIndex) => {
      const displaySource = cloudinaryWidth(source, 800);
      const modalSource = cloudinaryWidth(source, 1200);
      const message = `Hola! estoy interesado en esta pieza: ${title}. Imagen: ${modalSource}`;
      const whatsappUrl = buildWhatsappUrl(YOUR_WHATSAPP_NUMBER, message);
      const description = product.description || 'Joya de colección, acabado a mano.';

      return `
        <div class="carousel-item" data-product-index="${productIndex}" data-image-index="${imageIndex}">
          <img src="${escapeHtml(displaySource)}" alt="${escapeHtml(product.name)} - ${imageIndex + 1}" loading="lazy" decoding="async">
          <div class="desc-overlay" aria-hidden="true">
            <div>
              <div>${escapeHtml(description)}</div>
              <div class="wa-wrap">
                <a class="whatsapp-link" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener" aria-label="Contactar por WhatsApp" title="Contactar por WhatsApp">
                  ${whatsappIcon()}
                </a>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <article class="item item-${escapeHtml(product.category)}" data-product-index="${productIndex}">
        <button type="button" class="zoom-btn" data-product-index="${productIndex}" aria-label="Ampliar ${escapeHtml(product.name)}">+</button>
        <div class="carousel">${images}</div>
        <div class="meta mt-3 text-center"><h3 class="italic uppercase">${escapeHtml(title)}</h3></div>
      </article>`;
  }).join('');
}

function bindStaticEvents() {
  categoryNav.addEventListener('click', event => {
    const button = event.target.closest('.category-tab');
    if (!button) return;
    filterCategory(button.dataset.category, true);
  });

  grid.addEventListener('click', event => {
    const zoomButton = event.target.closest('.zoom-btn');
    if (zoomButton) {
      openZoom(Number(zoomButton.dataset.productIndex), 0);
      return;
    }

    if (event.target.closest('.whatsapp-link')) return;

    const carouselItem = event.target.closest('.carousel-item');
    if (!carouselItem) return;

    const overlay = carouselItem.querySelector('.desc-overlay');
    if (!overlay) return;

    document.querySelectorAll('.desc-overlay.active').forEach(activeOverlay => {
      if (activeOverlay !== overlay) setOverlayState(activeOverlay, false);
    });
    setOverlayState(overlay, !overlay.classList.contains('active'));
  });

  document.getElementById('next-btn').addEventListener('click', event => {
    event.stopPropagation();
    nextImage();
  });

  document.getElementById('prev-btn').addEventListener('click', event => {
    event.stopPropagation();
    previousImage();
  });

  document.getElementById('close-btn').addEventListener('click', closeZoom);

  zoomModal.addEventListener('click', event => {
    const frame = zoomModal.querySelector('.modal-frame');
    if (frame && !frame.contains(event.target)) closeZoom();
  });

  document.addEventListener('keydown', event => {
    if (zoomModal.style.display !== 'flex') return;
    if (event.key === 'Escape') closeZoom();
    if (event.key === 'ArrowRight') nextImage();
    if (event.key === 'ArrowLeft') previousImage();
  });
}

function filterCategory(category, shouldScroll = true) {
  currentCategory = category || 'todo';

  document.querySelectorAll('.category-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.category === currentCategory);
  });

  document.querySelectorAll('#catalog-grid .item').forEach(item => {
    item.style.display = currentCategory === 'todo' || item.classList.contains(`item-${currentCategory}`) ? 'block' : 'none';
  });

  document.querySelectorAll('.desc-overlay.active').forEach(overlay => setOverlayState(overlay, false));
  if (shouldScroll) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openZoom(productIndex, imageIndex = 0) {
  const product = products[productIndex];
  if (!product || product.images.length === 0) return;

  currentProductIndex = productIndex;
  currentImageIndex = Math.max(0, Math.min(imageIndex, product.images.length - 1));
  renderModal();

  zoomModal.style.display = 'flex';
  zoomModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeZoom() {
  zoomModal.style.display = 'none';
  zoomModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = 'auto';
  zoomMainImage.src = '';
  zoomThumbs.innerHTML = '';
}

function renderModal() {
  const product = products[currentProductIndex];
  if (!product) return;

  zoomTitle.textContent = productDisplayTitle(product);
  zoomThumbs.innerHTML = product.images.map((source, index) => `
    <img
      src="${escapeHtml(cloudinaryWidth(source, 300))}"
      alt="Miniatura ${index + 1} de ${escapeHtml(product.name)}"
      data-image-index="${index}"
      class="${index === currentImageIndex ? 'active' : ''}">
  `).join('');

  zoomThumbs.querySelectorAll('img').forEach(thumb => {
    thumb.addEventListener('click', () => {
      currentImageIndex = Number(thumb.dataset.imageIndex);
      updateModalImage();
    });
  });

  updateModalImage();
}

function updateModalImage() {
  const product = products[currentProductIndex];
  if (!product || product.images.length === 0) return;

  currentImageIndex = (currentImageIndex + product.images.length) % product.images.length;
  zoomMainImage.src = cloudinaryWidth(product.images[currentImageIndex], 1600);
  zoomMainImage.alt = `${product.name} - imagen ${currentImageIndex + 1}`;

  zoomThumbs.querySelectorAll('img').forEach((thumb, index) => {
    thumb.classList.toggle('active', index === currentImageIndex);
  });
}

function nextImage() {
  const product = products[currentProductIndex];
  if (!product || product.images.length === 0) return;
  currentImageIndex = (currentImageIndex + 1) % product.images.length;
  updateModalImage();
}

function previousImage() {
  const product = products[currentProductIndex];
  if (!product || product.images.length === 0) return;
  currentImageIndex = (currentImageIndex - 1 + product.images.length) % product.images.length;
  updateModalImage();
}

function setOverlayState(overlay, active) {
  overlay.classList.toggle('active', active);
  overlay.setAttribute('aria-hidden', active ? 'false' : 'true');
}

function productDisplayTitle(product) {
  const price = Number.isFinite(product.price) ? ` ${formatPrice(product.price)}€` : '';
  return `${product.name}${price}${product.sold ? ' - Vendido' : ''}`;
}

function buildWhatsappUrl(number, text) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function cloudinaryWidth(url, width) {
  const value = String(url || '').trim();
  if (!value.includes('/image/upload/')) return value;
  return value.replace(/\/image\/upload\/(?:w_\d+,q_auto,f_auto\/)?/, `/image/upload/w_${width},q_auto,f_auto/`);
}

function parsePrice(value) {
  const raw = String(value ?? '').trim().replace(/[€\s]/g, '');
  if (!raw) return null;

  let normalised = raw;
  if (raw.includes(',') && raw.includes('.')) {
    normalised = raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (raw.includes(',')) {
    normalised = raw.replace(',', '.');
  }

  const number = Number(normalised);
  return Number.isFinite(number) ? number : null;
}

function parseOrder(value, fallbackIndex) {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) ? number : fallbackIndex + 1;
}

function formatPrice(value) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
}

function slugify(value) {
  return normaliseToken(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'otros';
}

function normaliseToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, letter => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function parseDelimitedText(text) {
  const cleanText = String(text || '').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(cleanText);
  const matrix = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < cleanText.length; index += 1) {
    const character = cleanText[index];
    const nextCharacter = cleanText[index + 1];

    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(cell);
      if (row.some(value => String(value).trim() !== '')) matrix.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some(value => String(value).trim() !== '')) matrix.push(row);
  if (matrix.length < 2) return [];

  const headers = matrix.shift().map(normaliseHeader);
  return matrix.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const candidates = [';', '\t', ','];
  return candidates.reduce((best, candidate) => {
    const count = firstLine.split(candidate).length;
    return count > best.count ? { delimiter: candidate, count } : best;
  }, { delimiter: ';', count: 0 }).delimiter;
}

function normaliseHeader(value) {
  return normaliseToken(String(value || '').replace(/^\uFEFF/, ''))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function whatsappIcon() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M19.11 17.44c-.29-.14-1.71-.84-1.97-.94-.26-.10-.45-.14-.64.14-.19.29-.74.94-.91 1.13-.17.19-.34.21-.63.07-.29-.14-1.23-.45-2.34-1.43-.86-.77-1.44-1.71-1.61-2-.17-.29-.02-.45.13-.59.13-.13.29-.34.43-.51.14-.17.19-.29.29-.48.10-.19.05-.36-.02-.51-.07-.14-.64-1.54-.88-2.11-.23-.55-.47-.48-.64-.49-.17-.01-.36-.01-.55-.01-.19 0-.51.07-.77.36-.26.29-1.01.99-1.01 2.41 0 1.42 1.03 2.79 1.17 2.98.14.19 2.03 3.1 4.93 4.35.69.30 1.23.48 1.65.61.69.22 1.31.19 1.81.12.55-.08 1.71-.70 1.95-1.38.24-.67.24-1.25.17-1.38-.07-.13-.26-.21-.55-.36z"/>
      <path d="M16.02 2.67C8.68 2.67 2.67 8.68 2.67 16c0 2.59.74 5.11 2.14 7.27L2 30l6.95-2.73c2.05 1.12 4.37 1.71 6.78 1.71 7.34 0 13.35-6.01 13.35-13.35 0-7.32-6.01-13.35-13.35-13.35zm0 23.7c-2.19 0-4.33-.59-6.18-1.71l-.44-.26-4.12 1.62 1.61-4.01-.29-.41c-1.18-1.79-1.8-3.88-1.8-6.03 0-6.11 4.97-11.09 11.09-11.09 6.11 0 11.09 4.97 11.09 11.09 0 6.11-4.98 11.09-11.09 11.09z"/>
    </svg>`;
}
