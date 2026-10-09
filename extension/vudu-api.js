// Thin client for Vudu's public apicache API that backs athome.fandango.com.
// Responses are wrapped in an XSSI guard: "/*-secure-{...}*/".
// Fields are oddly all single-element arrays, e.g. {"title":["Foo"]}.

const VUDU_API_BASE = 'https://apicache.vudu.com/api2/_type';

function vuduUrl(type, pairs) {
  const segments = pairs.flatMap(([key, value]) => [key, String(value)]);
  return `${VUDU_API_BASE}/${type}/${segments.join('/')}/format/application*2Fjson`;
}

async function fetchVudu(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Vudu API ${res.status} for ${url}`);
  const text = await res.text();
  const json = text.replace(/^\/\*-secure-/, '').replace(/\*\/\s*$/, '');
  return JSON.parse(json);
}

function arr(obj, key) {
  return (obj && obj[key]) || [];
}

function first(obj, key) {
  const a = arr(obj, key);
  return a.length ? a[0] : undefined;
}

function cheapestOffer(contentVariants, offerType) {
  let cheapest = null;
  for (const variant of arr(contentVariants[0], 'contentVariant')) {
    for (const offer of arr(first(variant, 'offers'), 'offer')) {
      if (first(offer, 'offerType') !== offerType) continue;
      const price = parseFloat(first(offer, 'price'));
      if (Number.isFinite(price) && (cheapest === null || price < cheapest)) cheapest = price;
    }
  }
  return cheapest;
}

function extractCommon(content) {
  const genreList = first(content, 'genres');
  const genre = genreList ? first(arr(genreList, 'genre')[0] || {}, 'name') : undefined;
  const ratingsSummary = arr(first(content, 'ratingsSummaries'), 'ratingsSummary')[0];

  return {
    contentId: first(content, 'contentId'),
    title: first(content, 'title'),
    year: (first(content, 'releaseTime') || '').slice(0, 4) || undefined,
    mpaaRating: first(content, 'mpaaRating'),
    genre,
    posterUrl: first(content, 'posterUrl'),
    tomatoMeter: first(content, 'tomatoMeter'),
    tomatoAudienceScore: first(content, 'tomatoAudienceScore'),
    tomatoUrl: first(content, 'tomatoUrl'),
    vuduStars: ratingsSummary
      ? { avg: first(ratingsSummary, 'starRatingsAvg'), count: first(ratingsSummary, 'starRatingsCount') }
      : undefined,
    freeWithAds: first(content, 'uxPromoTag') === 'freeWithAds',
  };
}

function baseFollowups(contentId) {
  return [
    ['contentId', contentId],
    ['count', 1],
    ['followup', 'genres'],
    ['followup', 'ratingsSummaries'],
    ['followup', 'usefulStreamableOffers'],
  ];
}

async function fetchSeriesSeasonPrice(seriesId) {
  const seasons = await fetchVudu(
    vuduUrl('contentSearch', [
      ['seriesId', seriesId],
      ['type', 'season'],
      ['listType', 'useful'],
      ['includeComingSoon', 'true'],
      ['count', 50],
      ['offset', 0],
    ])
  );
  const firstSeason = arr(seasons, 'content')[0];
  if (!firstSeason) return null;

  const seasonId = first(firstSeason, 'contentId');
  const seasonNumber = first(firstSeason, 'seasonNumber');
  const seasonData = await fetchVudu(vuduUrl('contentSearch', baseFollowups(seasonId)));
  const seasonContent = arr(seasonData, 'content')[0];
  if (!seasonContent) return null;

  return {
    seasonNumber,
    buyPrice: cheapestOffer(arr(seasonContent, 'contentVariants'), 'pto'),
  };
}

async function fetchSeries(contentId, content) {
  const seasonInfo = await fetchSeriesSeasonPrice(contentId).catch(() => null);
  return {
    kind: 'tv',
    ...extractCommon(content),
    seasonInfo,
  };
}

// Entry point: resolves a tile's contentId into either a movie or TV result.
async function fetchContentInfo(contentId) {
  const data = await fetchVudu(vuduUrl('contentSearch', baseFollowups(contentId)));
  const content = arr(data, 'content')[0];
  if (!content) return null;

  const type = first(content, 'type');
  if (type === 'series') return fetchSeries(contentId, content);

  const contentVariants = arr(content, 'contentVariants');
  return {
    kind: 'movie',
    ...extractCommon(content),
    buyPrice: cheapestOffer(contentVariants, 'pto'),
    rentPrice: cheapestOffer(contentVariants, 'ptr'),
  };
}
