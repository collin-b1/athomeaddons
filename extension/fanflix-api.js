// Reads FanFlix's catalog data for the current page.
// Every fanflix.co storefront page (e.g. /c/<campaign-slug>) ships its *entire*
// product list - title, synopsis, year, runtime, rating, genre, price - as a
// JSON blob assigned to a page-global in an inline <script>:
//   var ctx = { ..., "Products": [ { "ID": "1mkn2xnzx27ft", "Name": "...", ... } ] };
// A tile's product id is the "show" query param on its <a href>, and it maps
// 1:1 to Products[n].ID.
//
// The live DOM can't be read directly for this: FanFlix's own bootstrap JS
// scrubs/empties that <script> right after reading it (presumably to avoid
// leaving the raw payload sitting in the page), so by the time a content
// script at document_idle looks, it's already gone. Instead we re-fetch the
// page's own URL - same-origin, allowed by FanFlix's "connect-src 'self'"
// CSP - to get the pristine server-rendered HTML and parse it from that.

let pendingCtxFetch = null;
let cachedProductIndex = null;

// Pulls out the JSON object literal following "var ctx =" by balancing braces
// (string-aware). A naive match up to the first ";" breaks because Terms/
// Synopsis fields contain HTML with embedded semicolons.
function extractFanflixCtxJson(html) {
  const marker = 'var ctx =';
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;

  let i = markerIndex + marker.length;
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] !== '{') return null;

  const objStart = i;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }

  return html.slice(objStart, i);
}

async function fetchFanflixCtx() {
  const res = await fetch(location.href, { credentials: 'include' });
  if (!res.ok) throw new Error(`FanFlix page fetch ${res.status}`);
  const html = await res.text();

  const jsonText = extractFanflixCtxJson(html);
  if (!jsonText) {
    console.warn('[FanFlix Hover Info] no "var ctx =" catalog blob found in page HTML - FanFlix may have changed their page template, or served a different page to this fetch.');
    return null;
  }

  return JSON.parse(jsonText);
}

function buildFanflixProductIndex(ctx) {
  const index = new Map();
  if (ctx && Array.isArray(ctx.Products)) {
    for (const product of ctx.Products) index.set(product.ID, product);
  }
  return index;
}

async function getFanflixProductIndex() {
  if (cachedProductIndex) return cachedProductIndex;
  if (!pendingCtxFetch) {
    pendingCtxFetch = fetchFanflixCtx()
      .then((ctx) => {
        cachedProductIndex = buildFanflixProductIndex(ctx);
        return cachedProductIndex;
      })
      .catch((err) => {
        console.warn('[FanFlix Hover Info] failed to load catalog data', err);
        return new Map();
      })
      .finally(() => {
        pendingCtxFetch = null;
      });
  }
  return pendingCtxFetch;
}

// Entry point: looks up a tile's product by the id read out of its href.
async function getFanflixProduct(productId) {
  const index = await getFanflixProductIndex();
  return index.get(productId) || null;
}
