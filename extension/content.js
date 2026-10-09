// Hover popup for athome.fandango.com movie/show tiles.
// Every tile is an <a href="/content/browse/details/<slug>/<contentId>">,
// so the Vudu contentId is read straight out of the DOM - no search/lookup call needed.

const TILE_SELECTOR = 'a[href*="/content/browse/details/"]';
const HOVER_DELAY_MS = 300;
const HIDE_DELAY_MS = 150;
const CACHE_TTL_MS = 60 * 60 * 1000; // matches Vudu's own cache-control: max-age=3600

const contentCache = new Map(); // contentId -> { data, expiresAt }
const pendingFetches = new Map(); // contentId -> Promise

let popupEl = null;
let hoverTimer = null;
let hideTimer = null;
let activeContentId = null;

function extractContentId(href) {
  const match = href.match(/\/content\/browse\/details\/[^/]+\/(\d+)(?:[/?#]|$)/);
  return match ? match[1] : null;
}

function getCached(contentId) {
  const entry = contentCache.get(contentId);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  return null;
}

function setCached(contentId, data) {
  contentCache.set(contentId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function getContentData(contentId) {
  const cached = getCached(contentId);
  if (cached) return cached;
  if (pendingFetches.has(contentId)) return pendingFetches.get(contentId);

  const promise = fetchContentInfo(contentId)
    .then((data) => {
      if (data) setCached(contentId, data);
      return data;
    })
    .catch((err) => {
      console.warn('[Fandango Hover Info] failed to fetch content', contentId, err);
      return null;
    })
    .finally(() => pendingFetches.delete(contentId));

  pendingFetches.set(contentId, promise);
  return promise;
}

function ensurePopupEl() {
  if (popupEl) return popupEl;
  popupEl = document.createElement('div');
  popupEl.className = 'afx-hover-popup';
  document.body.appendChild(popupEl);
  return popupEl;
}

function formatPrice(value) {
  return value == null ? null : `$${value.toFixed(2)}`;
}

function buildPopupHtml(data) {
  const ratingsRow = [];
  if (data.tomatoMeter != null) ratingsRow.push(`<span class="afx-rt">\u{1F345} ${data.tomatoMeter}%</span>`);
  ratingsRow.push(`<span class="afx-imdb" data-imdb-slot>IMDb: …</span>`);

  const metaBits = [data.genre, data.year].filter(Boolean).join(' · ');

  let priceRow;
  if (data.kind === 'tv') {
    priceRow = data.seasonInfo?.buyPrice != null
      ? `Season ${data.seasonInfo.seasonNumber} pass from ${formatPrice(data.seasonInfo.buyPrice)}`
      : 'Pricing varies by season';
  } else {
    const parts = [];
    if (data.freeWithAds) parts.push('<span class="afx-free">Free w/ Ads</span>');
    if (data.buyPrice != null) parts.push(`<span class="afx-price">Buy ${formatPrice(data.buyPrice)}</span>`);
    if (data.rentPrice != null) parts.push(`<span class="afx-price">Rent ${formatPrice(data.rentPrice)}</span>`);
    priceRow = parts.length ? parts.join(' ') : 'No offer available';
  }

  return `
    <div class="afx-row afx-title">${escapeHtml(data.title || '')}${data.year ? ` (${data.year})` : ''}</div>
    ${metaBits ? `<div class="afx-row afx-meta">${escapeHtml(metaBits)}</div>` : ''}
    <div class="afx-row afx-prices">${priceRow}</div>
    <div class="afx-row afx-ratings">${ratingsRow.join(' ')}</div>
  `;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function positionPopup(rect) {
  const el = ensurePopupEl();
  const margin = 8;
  const width = el.offsetWidth || 260;

  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

  const placeBelow = rect.top < 180;
  el.classList.toggle('afx-below', placeBelow);
  el.classList.toggle('afx-above', !placeBelow);
  el.style.left = `${left}px`;
  el.style.top = placeBelow ? `${rect.bottom + 10}px` : `${rect.top - 10}px`;
}

function showPopup(rect, data) {
  const el = ensurePopupEl();
  el.innerHTML = buildPopupHtml(data);
  positionPopup(rect);
  el.classList.add('afx-visible');
}

function updateImdbSlot(contentId, rating) {
  if (activeContentId !== contentId || !popupEl) return;
  const slot = popupEl.querySelector('[data-imdb-slot]');
  if (slot) slot.textContent = rating ? `IMDb: ${rating}` : 'IMDb: n/a';
}

function hidePopup() {
  activeContentId = null;
  if (popupEl) popupEl.classList.remove('afx-visible');
}

async function showForTile(anchor, contentId) {
  activeContentId = contentId;
  const data = await getContentData(contentId);
  if (!data || activeContentId !== contentId) return;

  showPopup(anchor.getBoundingClientRect(), data);

  fetchImdbRating(data.title, data.year).then((rating) => updateImdbSlot(contentId, rating));
}

function onMouseOver(event) {
  const anchor = event.target.closest(TILE_SELECTOR);
  if (!anchor) return;

  clearTimeout(hideTimer);

  const contentId = extractContentId(anchor.href);
  if (!contentId || contentId === activeContentId) return;

  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => showForTile(anchor, contentId), HOVER_DELAY_MS);
}

function onMouseOut(event) {
  const anchor = event.target.closest(TILE_SELECTOR);
  if (!anchor) return;

  // mouseout fires when moving between the tile's own children (e.g. poster
  // image -> title text), not just when actually leaving the tile. Ignore it
  // unless the pointer is genuinely headed somewhere outside this anchor.
  if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;

  clearTimeout(hoverTimer);
  hideTimer = setTimeout(hidePopup, HIDE_DELAY_MS);
}

document.addEventListener('mouseover', onMouseOver, true);
document.addEventListener('mouseout', onMouseOut, true);
window.addEventListener('scroll', hidePopup, { passive: true });
