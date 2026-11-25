// Fandango/Vudu has no IMDb data of its own, only Rotten Tomatoes.
// OMDb is the practical free way to get an IMDb rating; it needs the
// user's own free personal API key, set via the extension's options page.
// OMDb's free tier is capped at 1000 requests/day, so lookups are cached
// (title+year rarely changes an IMDb rating day to day).

const IMDB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const imdbCache = new Map(); // "title|year" -> { rating, expiresAt }
const imdbPending = new Map(); // "title|year" -> Promise

// Catalogs (notably FanFlix) sometimes bake a disambiguating year into the
// title itself, e.g. "Death Wish (1974)" vs. "Death Wish (2018)". OMDb's
// exact-title lookup treats that whole string as the title and finds nothing,
// since IMDb's real title is just "Death Wish". Matches a trailing "(YYYY)".
const TITLE_YEAR_SUFFIX_RE = /\s*\((\d{4})\)\s*$/;

async function getOmdbApiKey() {
  const { omdbApiKey } = await chrome.storage.sync.get('omdbApiKey');
  return omdbApiKey || null;
}

async function omdbRequest(apiKey, params) {
  const res = await fetch(`https://www.omdbapi.com/?${new URLSearchParams({ apikey: apiKey, ...params }).toString()}`);
  if (!res.ok) return null;
  return res.json();
}

function ratingFromOmdbEntry(data) {
  if (!data || data.Response !== 'True' || !data.imdbRating || data.imdbRating === 'N/A') return null;
  return data.imdbRating;
}

async function fetchImdbRatingByTitle(apiKey, title, year) {
  try {
    const params = { t: title };
    if (year) params.y = year;
    return ratingFromOmdbEntry(await omdbRequest(apiKey, params));
  } catch {
    return null;
  }
}

// Falls back to OMDb's fuzzy search (which returns every match for a bare
// title, unlike "t=" exact lookup) and picks the entry whose year matches
// the one stripped from the original title, then fetches that entry's rating.
async function fetchImdbRatingByTitleAndYear(apiKey, title, year) {
  try {
    const searchData = await omdbRequest(apiKey, { s: title, type: 'movie' });
    if (!searchData || searchData.Response !== 'True' || !Array.isArray(searchData.Search)) return null;

    const match = searchData.Search.find((entry) => entry.Year === year);
    if (!match) return null;

    return ratingFromOmdbEntry(await omdbRequest(apiKey, { i: match.imdbID }));
  } catch {
    return null;
  }
}

async function fetchImdbRatingUncached(title, year) {
  const apiKey = await getOmdbApiKey();
  if (!apiKey || !title) return null;

  const direct = await fetchImdbRatingByTitle(apiKey, title, year);
  if (direct) return direct;

  // Only retry if the title itself carries a "(YYYY)" suffix - a normal
  // lookup miss (wrong title, no OMDb entry, etc.) should stay a miss.
  const yearInTitle = title.match(TITLE_YEAR_SUFFIX_RE);
  if (!yearInTitle) return null;

  const bareTitle = title.slice(0, yearInTitle.index).trim();
  return fetchImdbRatingByTitleAndYear(apiKey, bareTitle, yearInTitle[1]);
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
