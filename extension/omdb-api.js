// Fandango/Vudu has no IMDb data of its own, only Rotten Tomatoes.
// OMDb is the practical free way to get an IMDb rating; it needs the
// user's own free personal API key, set via the extension's options page.
// OMDb's free tier is capped at 1000 requests/day, so lookups are cached
// (title+year rarely changes an IMDb rating day to day).

const IMDB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const imdbCache = new Map(); // "title|year" -> { rating, expiresAt }
const imdbPending = new Map(); // "title|year" -> Promise

async function getOmdbApiKey() {
  const { omdbApiKey } = await chrome.storage.sync.get('omdbApiKey');
  return omdbApiKey || null;
}

async function fetchImdbRatingUncached(title, year) {
  const apiKey = await getOmdbApiKey();
  if (!apiKey || !title) return null;

  const params = new URLSearchParams({ apikey: apiKey, t: title });
  if (year) params.set('y', year);

  try {
    const res = await fetch(`https://www.omdbapi.com/?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.Response !== 'True' || !data.imdbRating || data.imdbRating === 'N/A') return null;
    return data.imdbRating;
  } catch {
    return null;
  }
}

async function fetchImdbRating(title, year) {
  if (!title) return null;
  const key = `${title}|${year || ''}`;

  const cached = imdbCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rating;
  if (imdbPending.has(key)) return imdbPending.get(key);

  const promise = fetchImdbRatingUncached(title, year)
    .then((rating) => {
      imdbCache.set(key, { rating, expiresAt: Date.now() + IMDB_CACHE_TTL_MS });
      return rating;
    })
    .finally(() => imdbPending.delete(key));

  imdbPending.set(key, promise);
  return promise;
}
