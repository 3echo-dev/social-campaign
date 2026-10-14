/**
 * The public ad libraries: Meta Ad Library and TikTok Creative Center.
 *
 * Checked live on 2026-09-12 with a plain fetch and with Claude's WebFetch:
 *
 * - The Meta Ad Library answered 403 with a JavaScript bot check for every country,
 *   inside the EU and out, and WebFetch could not open it either. Meta's Ad Library
 *   API needs an access token from a verified developer account and, outside the EU
 *   and UK, returns only political and social issue ads, so it is not a no login
 *   route. The only faithful way in is a person with a browser.
 * - TikTok Creative Center's top ads page renders its list in the browser; the
 *   server rendered data block carried an empty list, and its data address answered
 *   "no permission" without a signed request. The TikTok Ad Library (EU, UK and
 *   Switzerland ads) answered "system busy" to a plain request.
 *
 * So each search really asks, reports exactly what came back, and hands Claude a
 * precise plan: the exact library addresses for the user to open, and the searches
 * that find quoted ads on the open web.
 *
 * When the stealth reader (Scrapling, installed with the research helper) is ready it
 * makes ONE attempt at the library page first. For Meta, Claude is told to use the
 * Meta Ads connector's `ads_library_search` before anything else; this reader is the
 * single fallback for when that connector is not connected. If it also gets nothing,
 * the slot stays blank with its status and the plan below is handed back. No retries.
 */

import { boundedFetch, FetchFailure } from './web.mjs';
import { adRecord, envelopeCode } from '../records.mjs';

/** EU member states, plus the EEA and the UK where the libraries publish the same detail. */
export const EU_LIKE = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL',
  'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
]);

/** Where the libraries live. Tests point these at a local server. */
export const AD_LIBRARY_URLS = {
  meta: 'https://www.facebook.com',
  tiktokCreativeCenter: 'https://ads.tiktok.com',
  tiktokLibrary: 'https://library.tiktok.com',
};

/**
 * The Meta Ad Library address a person opens.
 * @param {string} query
 * @param {string} country
 * @returns {string}
 */
export function metaLibraryUrl(query, country, base = AD_LIBRARY_URLS.meta) {
  const pageId = query.match(/(?:view_all_page_id=|^)(\d{6,20})$/)?.[1];
  const params = new URLSearchParams({ active_status: 'active', ad_type: 'all', country, media_type: 'all' });
  if (pageId) params.set('view_all_page_id', pageId);
  else {
    params.set('q', query);
    params.set('search_type', 'keyword_unordered');
  }
  return `${base}/ads/library/?${params.toString()}`;
}

/**
 * @param {string} query
 * @param {string} country
 * @returns {{creativeCenter: string, library: string}}
 */
export function tiktokLibraryUrls(query, country, bases = AD_LIBRARY_URLS) {
  const cc = new URLSearchParams({ region: country, keyword: query });
  const lib = new URLSearchParams({ region: EU_LIKE.has(country) ? country : 'all', adv_name: query, sort_type: 'last_shown_date,desc' });
  return {
    creativeCenter: `${bases.tiktokCreativeCenter}/business/creativecenter/inspiration/topads/pc/en?${cc.toString()}`,
    library: `${bases.tiktokLibrary}/ads?${lib.toString()}`,
  };
}

/**
 * @param {string} html
 * @returns {boolean}
 */
export function isBotChallenge(html) {
  return /__rd_verify_|executeChallenge|cf-challenge|challenge-platform|Just a moment\.\.\./i.test(html);
}

/**
 * Ads from Creative Center's server rendered data, when it carries any.
 * @param {string} html
 * @returns {Array<Record<string, any>>|null} null when there is no data block at all.
 */
export function parseCreativeCenter(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    const materials = data?.props?.pageProps?.data?.materials;
    return Array.isArray(materials) ? materials : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} AdSearchOutcome
 * @property {boolean} reached whether the library answered at all.
 * @property {Array<Record<string, any>>} records
 * @property {string} code a degraded code when records is empty.
 * @property {string} reason
 * @property {{library: string, alternate?: string}} urls
 * @property {Record<string, any>} [extra] fields the envelope carries as they are (for TikTok Top Ads: list_scope, keyword_applied).
 */

/**
 * The ad library reader.
 */
export class AdLibraryBackend {
  /**
   * @param {{bases?: typeof AD_LIBRARY_URLS, allowPrivate?: boolean, timeoutMs?: number, politeness?: import('./web.mjs').Politeness, stealth?: {isReady: () => boolean, topAds: Function, metaAdLibrary: Function}}} [options]
   * `stealth` is the optional StealthBackend; it is used only when it reports ready.
   */
  constructor(options = {}) {
    this.bases = { ...AD_LIBRARY_URLS, ...(options.bases ?? {}) };
    this.options = options;
  }

  /**
   * @param {string} url
   * @returns {Promise<import('./web.mjs').FetchResult|null>}
   */
  async get(url) {
    try {
      if (this.options.politeness) await this.options.politeness.wait(new URL(url).host);
      return await boundedFetch(url, { allowPrivate: this.options.allowPrivate, timeoutMs: this.options.timeoutMs ?? 20_000 });
    } catch (error) {
      if (error instanceof FetchFailure) return null;
      throw error;
    }
  }

  /**
   * @param {string} query
   * @param {string} country
   * @returns {Promise<AdSearchOutcome>}
   */
  async meta(query, country) {
    const library = metaLibraryUrl(query, country, this.bases.meta);
    const publicUrl = metaLibraryUrl(query, country);
    const stealth = this.options.stealth;
    if (stealth && stealth.isReady()) {
      const read = await stealth.metaAdLibrary({ query, country, limit: 30 });
      if (read.ok && Array.isArray(read.ads) && read.ads.length > 0) {
        const observedAt = new Date().toISOString();
        const records = read.ads.map((/** @type {Record<string, any>} */ ad) =>
          adRecord({
            platform: 'meta',
            url: ad.snapshotUrl ?? publicUrl,
            advertiser: ad.pageName ?? null,
            ad_id: ad.id != null ? String(ad.id) : null,
            library_url: ad.snapshotUrl ?? publicUrl,
            started_at: ad.startDate ?? null,
            active: true,
            countries: [country],
            primary_text: ad.text ?? null,
            headline: ad.headline ?? null,
            cta: ad.cta ?? null,
            source_ref: publicUrl,
            observed_at: observedAt,
            confidence: 0.75,
          }),
        );
        return { reached: true, records, code: 'unsupported', reason: '', urls: { library: publicUrl } };
      }
      // One attempt only: blank with the reason, and the plan for a person with a browser.
      return {
        reached: true,
        records: [],
        // The stealth reader's own codes (`empty`, `error`) are not envelope codes: fold them, or the envelope throws.
        code: envelopeCode(read.ok ? 'empty' : read.code),
        reason: read.ok ? 'The Meta Ad Library page loaded but no ads were found in it.' : read.reason,
        urls: { library: publicUrl },
      };
    }
    const result = await this.get(library);
    const eu = EU_LIKE.has(country);
    if (!result) {
      return { reached: false, records: [], code: 'timed_out', reason: 'The Meta Ad Library could not be reached.', urls: { library: publicUrl } };
    }
    const challenge = isBotChallenge(result.body);
    if (result.status === 403 || challenge) {
      return {
        reached: true,
        records: [],
        code: eu ? 'blocked' : 'region_restricted',
        reason: eu
          ? 'The Meta Ad Library answered with a browser check, so it can only be read by a person in a browser.'
          : `The Meta Ad Library answered with a browser check, and outside the EU and UK its open data covers only political and social issue ads, so the ads running in ${country} can only be read by a person in a browser.`,
        urls: { library: publicUrl },
      };
    }
    if (result.status === 429) {
      return { reached: true, records: [], code: 'rate_limited', reason: 'The Meta Ad Library asked readers to slow down.', urls: { library: publicUrl } };
    }
    return {
      reached: true,
      records: [],
      code: 'unsupported',
      reason: 'The Meta Ad Library answered, but its ads are drawn in the browser and are not in the page it sends.',
      urls: { library: publicUrl },
    };
  }

  /**
   * @param {string} query
   * @param {string} country
   * @returns {Promise<AdSearchOutcome>}
   */
  async tiktok(query, country) {
    const local = tiktokLibraryUrls(query, country, this.bases);
    const pub = tiktokLibraryUrls(query, country);
    const urls = { library: pub.creativeCenter, alternate: pub.library };
    const stealth = this.options.stealth;
    if (stealth && stealth.isReady()) {
      const read = await stealth.topAds({ country, keyword: query, period: 30, limit: 20 });
      if (read.ok && Array.isArray(read.ads) && read.ads.length > 0) {
        const observedAt = new Date().toISOString();
        const records = read.ads.map((/** @type {Record<string, any>} */ ad) =>
          adRecord({
            platform: 'tiktok',
            url: pub.creativeCenter,
            advertiser: ad.brand ?? null,
            ad_id: ad.id != null ? String(ad.id) : null,
            library_url: ad.url ?? pub.creativeCenter,
            countries: [country],
            format: ad.videoUrl || ad.cover ? 'video' : null,
            primary_text: ad.title ?? ad.caption ?? null,
            landing_url: ad.landing ?? null,
            media_urls: [ad.videoUrl, ad.cover].filter(Boolean),
            thumbnail_url: typeof ad.cover === 'string' ? ad.cover : null,
            metrics: { likes: ad.likes ?? null, ctr: ad.ctr ?? null },
            industry: ad.industryName ?? ad.industry ?? null,
            objective: ad.objective ?? null,
            source_ref: pub.creativeCenter,
            observed_at: observedAt,
            confidence: 0.8,
          }),
        );
        // The list is the Creative Center's own ranking for the region (or for the keyword, when the page ran that
        // search). It carries no start dates, so nothing here is ordered by how long an ad has been running.
        const applied = read.keywordApplied === true;
        const scope = applied ? 'keyword' : 'region_wide';
        const reason = applied
          ? `Creative Center top ads matching the keyword "${query}" in ${country} over the last 30 days, in its own order. It carries no start dates.`
          : `Creative Center's region-wide top ads list for ${country} over the last 30 days, in its own order, with no start dates. ${read.keywordNote ?? `The keyword "${query}" was not applied.`}`;
        return { reached: true, records, code: 'unsupported', reason, urls, extra: { list_scope: scope, keyword: query, keyword_applied: applied, dated: false } };
      }
      if (read.ok && read.keywordApplied === true) {
        // The page ran the search and nothing matches the keyword: the answer, so no other reader is tried.
        return { reached: true, records: [], code: 'empty_page', reason: read.note ?? `Creative Center has no top ads matching "${query}" in ${country} over the last 30 days.`, urls, extra: { list_scope: 'keyword', keyword: query, keyword_applied: true, dated: false, definitive: true } };
      }
      return {
        reached: true,
        records: [],
        code: envelopeCode(read.ok ? 'empty' : read.code),
        reason: read.ok ? 'TikTok Creative Center loaded but its top ads list was empty.' : read.reason,
        urls,
      };
    }
    const result = await this.get(local.creativeCenter);
    if (!result) {
      return { reached: false, records: [], code: 'timed_out', reason: 'TikTok Creative Center could not be reached.', urls };
    }
    if (!result.ok) {
      return {
        reached: true,
        records: [],
        code: result.status === 429 ? 'rate_limited' : 'blocked',
        reason: `TikTok Creative Center answered ${result.status}.`,
        urls,
      };
    }
    const materials = parseCreativeCenter(result.body);
    if (materials && materials.length > 0) {
      const records = materials.map((item) =>
        adRecord({
          platform: 'tiktok',
          url: pub.creativeCenter,
          advertiser: item.brand_name ?? null,
          ad_id: item.id != null ? String(item.id) : null,
          library_url: item.id ? `https://ads.tiktok.com/business/creativecenter/topads/${item.id}/pc/en` : pub.creativeCenter,
          countries: [country],
          format: item.video_info ? 'video' : null,
          primary_text: item.ad_title ?? null,
          cta: item.cta ?? null,
          landing_url: item.landing_page ?? null,
          media_urls: item.video_info?.cover ? [item.video_info.cover] : [],
          thumbnail_url: typeof item.video_info?.cover === 'string' ? item.video_info.cover : null,
          metrics: { likes: item.like ?? null, ctr: item.ctr ?? null },
          source_ref: pub.creativeCenter,
          observed_at: result.fetched_at,
          confidence: 0.85,
        }),
      );
      return { reached: true, records, code: 'unsupported', reason: '', urls };
    }
    return {
      reached: true,
      records: [],
      code: 'unsupported',
      reason: 'TikTok Creative Center answered, but its ads list is drawn in the browser and the page it sends is empty.',
      urls,
    };
  }
}
