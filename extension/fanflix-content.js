// Hover popup for fanflix.co storefront tiles.
// Every tile is an <a href=".../c/<campaign-slug>?...&show=<productId>">; the
// matching product (title, synopsis, price, genre, etc.) comes from the
// page's own embedded catalog data via fanflix-api.js (one same-origin fetch
// per page, cached), and the optional IMDb rating comes from omdb-api.js.

// "show=" (not "?show=") - marketing links can prepend utm_source/utm_medium
// params, pushing "show" past the leading "?" into a "&show=" position.
const FFX_TILE_SELECTOR = 'a[href*="show="]';
const FFX_HOVER_DELAY_MS = 300;
const FFX_HIDE_DELAY_MS = 150;

let ffxPopupEl = null;
let ffxHoverTimer = null;
let ffxHideTimer = null;
let ffxActiveProductId = null;

function extractShowId(href) {
  try {
    return new URL(href, location.href).searchParams.get('show');
  } catch {
    return null;
  }
}

function ensureFfxPopupEl() {
  if (ffxPopupEl) return ffxPopupEl;
  ffxPopupEl = document.createElement('div');
  ffxPopupEl.className = 'afx-hover-popup';
  document.body.appendChild(ffxPopupEl);
  return ffxPopupEl;
}

function formatFfxPrice(cents) {
  return cents == null ? null : `$${(cents / 100).toFixed(2)}`;
}

function escapeFfxHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '');
}

function truncate(str, max) {
  if (!str || str.length <= max) return str || '';
  return `${str.slice(0, max - 1).trimEnd()}…`;
}

// Bundles (e.g. "Trolls 3-Movie Collection") have multiple Contents entries;
// only single-title products have one clear movie to show genre/runtime/IMDb for.
function primaryContent(product) {
  const contents = product.Contents || [];
  return contents.length === 1 ? contents[0] : null;
}

function buildFfxPopupHtml(product) {
  const content = primaryContent(product);
  const bundleCount = (product.Contents || []).length;

  const metaBits = [];
  if (content) {
    if (content.Genre && content.Genre.length) metaBits.push(content.Genre.slice(0, 3).join(', '));
    if (content.ReleaseYear) metaBits.push(content.ReleaseYear);
    if (content.Runtime) metaBits.push(content.Runtime);
    if (content.Rating) metaBits.push(content.Rating);
  } else if (bundleCount > 1) {
    metaBits.push(`${bundleCount} movies`);
  }

  const synopsisSource = product.SynopsisOverride || content?.Synopsis || '';
  const synopsis = truncate(stripHtml(synopsisSource), 160);

  const priceBits = [];
  const price = formatFfxPrice(product.Price);
  if (price) priceBits.push(`<span class="afx-price">${escapeFfxHtml(price)}</span>`);
  if (product.Profile) priceBits.push(`<span class="afx-quality">${escapeFfxHtml(product.Profile)}</span>`);

  const providers = (product.Providers || []).join(', ');

  return `
    <div class="afx-row afx-title">${escapeFfxHtml(product.Name || '')}${
      product.TagText
        ? ` <span class="afx-tag"${product.TagColor ? ` style="background:${escapeFfxHtml(product.TagColor)}"` : ''}>${escapeFfxHtml(product.TagText)}</span>`
        : ''
    }</div>
    ${metaBits.length ? `<div class="afx-row afx-meta">${escapeFfxHtml(metaBits.join(' · '))}</div>` : ''}
    ${synopsis ? `<div class="afx-row afx-synopsis">${escapeFfxHtml(synopsis)}</div>` : ''}
    <div class="afx-row afx-prices">${priceBits.join(' ')}</div>
    ${content ? `<div class="afx-row afx-ratings"><span class="afx-imdb" data-imdb-slot>IMDb: …</span></div>` : ''}
    ${providers ? `<div class="afx-row afx-providers">Redeem via ${escapeFfxHtml(providers)}</div>` : ''}
  `;
}

function positionFfxPopup(rect) {
  const el = ensureFfxPopupEl();
  const margin = 8;
  const width = el.offsetWidth || 260;

  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

  const placeBelow = rect.top < 220;
  el.classList.toggle('afx-below', placeBelow);
  el.classList.toggle('afx-above', !placeBelow);
  el.style.left = `${left}px`;
  el.style.top = placeBelow ? `${rect.bottom + 10}px` : `${rect.top - 10}px`;
}

function showFfxPopup(rect, product) {
  const el = ensureFfxPopupEl();
  el.innerHTML = buildFfxPopupHtml(product);
  positionFfxPopup(rect);
  el.classList.add('afx-visible');
}

function updateFfxImdbSlot(productId, rating) {
  if (ffxActiveProductId !== productId || !ffxPopupEl) return;
  const slot = ffxPopupEl.querySelector('[data-imdb-slot]');
  if (slot) slot.textContent = rating ? `IMDb: ${rating}` : 'IMDb: n/a';
}

function hideFfxPopup() {
  ffxActiveProductId = null;
  if (ffxPopupEl) ffxPopupEl.classList.remove('afx-visible');
}

async function showForFfxTile(anchor, productId) {
  ffxActiveProductId = productId;

  const product = await getFanflixProduct(productId);
  if (!product || ffxActiveProductId !== productId) return;

  showFfxPopup(anchor.getBoundingClientRect(), product);

  const content = primaryContent(product);
  if (content) {
    fetchImdbRating(content.Title, content.ReleaseYear).then((rating) => updateFfxImdbSlot(productId, rating));
  }
}

function onFfxMouseOver(event) {
  const anchor = event.target.closest(FFX_TILE_SELECTOR);
  if (!anchor) return;

  clearTimeout(ffxHideTimer);

  const productId = extractShowId(anchor.href);
  if (!productId || productId === ffxActiveProductId) return;

  clearTimeout(ffxHoverTimer);
  ffxHoverTimer = setTimeout(() => showForFfxTile(anchor, productId), FFX_HOVER_DELAY_MS);
}

function onFfxMouseOut(event) {
  const anchor = event.target.closest(FFX_TILE_SELECTOR);
  if (!anchor) return;

  // mouseout fires when moving between the tile's own children, not just when
  // actually leaving the tile. Ignore it unless the pointer is genuinely
  // headed somewhere outside this anchor.
  if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;

  clearTimeout(ffxHoverTimer);
  ffxHideTimer = setTimeout(hideFfxPopup, FFX_HIDE_DELAY_MS);
}

document.addEventListener('mouseover', onFfxMouseOver, true);
document.addEventListener('mouseout', onFfxMouseOut, true);
window.addEventListener('scroll', hideFfxPopup, { passive: true });
