/**
 * trandsa-api-worker.js — Cloudflare Worker مستقل لحل CORS
 * ==========================================================
 * يُنشر كـ Worker منفصل باسم "trandsa-api" على Cloudflare
 * يحل مشكلتين:
 * 1. "فشل جلب البيانات" — يجلب شارت Yahoo Finance بدون CORS
 * 2. "Load failed" — يجلب أخبار Marketaux + Argaam RSS كـ fallback
 *
 * Routes:
 *   GET /api/health          — فحص صحة الـ Worker
 *   GET /api/chart           — بيانات الشارت من Yahoo Finance
 *   GET /api/news            — أخبار السوق من Marketaux أو Argaam RSS
 *
 * Environment Variables (اختياري):
 *   MARKETAUX_API_KEY        — مفتاح Marketaux للأخبار (مجاني 100/يوم)
 *
 * النشر:
 *   npx wrangler deploy trandsa-api-worker.js --name trandsa-api
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

// ===== In-Memory Cache (per isolate, 5-min TTL) =====
const TTL_MS = 5 * 60 * 1000;
const chartCache = new Map();
const newsCache  = new Map();

// ===== Main Handler =====

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const path = url.pathname;

    if (path === '/api/health') {
      return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
    }

    if (path === '/api/chart') {
      return handleChart(url);
    }

    if (path === '/api/news') {
      return handleNews(url, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

// ===== /api/chart =====

async function handleChart(url) {
  const symbol   = url.searchParams.get('symbol') || '^TASI.SR';
  const range    = url.searchParams.get('range')    || '6mo';
  const interval = url.searchParams.get('interval') || '1d';

  const cacheKey = `${symbol}:${range}:${interval}`;
  const cached   = chartCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return jsonResponse({ ...cached.data, cached: true });
  }

  const cleanSymbol = normalizeSymbol(symbol);
  const path = `/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?range=${range}&interval=${interval}&includePrePost=false`;

  // query1 → query2 fallback
  const res = await yahooFetch(path);
  if (!res) {
    return jsonResponse({ success: false, error: 'Yahoo Finance غير متاح', data: [] }, 502);
  }

  let raw;
  try {
    raw = await res.json();
  } catch {
    return jsonResponse({ success: false, error: 'فشل قراءة البيانات', data: [] }, 502);
  }

  const parsed = parseYahooChart(raw, cleanSymbol);
  if (parsed.success) {
    chartCache.set(cacheKey, { ts: Date.now(), data: parsed });
  }

  return jsonResponse(parsed);
}

// ===== /api/news =====

async function handleNews(url, env) {
  const symbol   = url.searchParams.get('symbol') || null;
  const cacheKey = symbol || '_general_';
  const cached   = newsCache.get(cacheKey);

  if (cached && Date.now() - cached.ts < TTL_MS) {
    return jsonResponse({ ...cached.data, cached: true });
  }

  // === Strategy 1: Marketaux (إذا توفر المفتاح) ===
  const marketauxKey = env?.MARKETAUX_API_KEY;
  if (marketauxKey) {
    const result = await fetchMarketaux(symbol, marketauxKey);
    if (result.success) {
      newsCache.set(cacheKey, { ts: Date.now(), data: result });
      return jsonResponse(result);
    }
  }

  // === Strategy 2: Argaam RSS ===
  const rssResult = await fetchArgaamRSS();
  if (rssResult.success) {
    newsCache.set(cacheKey, { ts: Date.now(), data: rssResult });
    return jsonResponse(rssResult);
  }

  return jsonResponse({ success: false, error: 'فشل تحميل الأخبار', news: [] }, 502);
}

// ===== Yahoo Finance =====

async function yahooFetch(path) {
  const urls = [
    `https://query1.finance.yahoo.com${path}`,
    `https://query2.finance.yahoo.com${path}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { headers: YAHOO_HEADERS }, 7000);
      if (res.ok) return res;
    } catch {
      continue;
    }
  }
  return null;
}

function parseYahooChart(raw, symbol) {
  if (!raw?.chart) return { success: false, data: [], error: 'لا يوجد chart' };
  if (raw.chart.error) return { success: false, data: [], error: raw.chart.error.description || 'خطأ Yahoo' };

  const result = Array.isArray(raw.chart.result) ? raw.chart.result[0] : null;
  if (!result) return { success: false, data: [], error: 'لا توجد نتائج' };

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote      = result.indicators?.quote?.[0] || {};
  const closes     = Array.isArray(quote.close) ? quote.close : [];

  if (timestamps.length === 0 || closes.length === 0) {
    return { success: false, data: [], error: 'بيانات فارغة' };
  }

  const data = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) {
      data.push({
        date:      new Date(timestamps[i] * 1000).toISOString().split('T')[0],
        timestamp: timestamps[i],
        open:      quote.open?.[i]   ?? null,
        high:      quote.high?.[i]   ?? null,
        low:       quote.low?.[i]    ?? null,
        close:     parseFloat(closes[i].toFixed(2)),
        volume:    quote.volume?.[i] ?? 0,
      });
    }
  }

  const meta = result.meta || {};
  return {
    success:             true,
    symbol:              meta.symbol || symbol,
    currency:            meta.currency || 'SAR',
    regularMarketPrice:  meta.regularMarketPrice ?? null,
    previousClose:       meta.previousClose      ?? null,
    dataPoints:          data.length,
    data,
  };
}

// ===== Marketaux News =====

async function fetchMarketaux(symbol, apiKey) {
  try {
    let apiUrl = `https://api.marketaux.com/v1/news/all?language=ar&api_token=${apiKey}&limit=20`;
    if (symbol) {
      const ticker = symbol.replace('.SR', '');
      apiUrl += `&symbols=${encodeURIComponent(ticker)}`;
    } else {
      apiUrl += '&countries=sa';
    }

    const res = await fetchWithTimeout(apiUrl, {}, 6000);
    if (!res.ok) return { success: false, news: [] };

    const json = await res.json();
    if (!Array.isArray(json.data)) return { success: false, news: [] };

    const news = json.data.map(item => ({
      title:       item.title       || '',
      description: (item.description || '').substring(0, 200),
      url:         item.url         || '',
      publishedAt: item.published_at || '',
      source:      item.source?.name || 'marketaux',
      imageUrl:    item.image_url    || null,
    }));

    return { success: true, source: 'marketaux', news };
  } catch {
    return { success: false, news: [] };
  }
}

// ===== Argaam RSS =====

async function fetchArgaamRSS() {
  try {
    const res = await fetchWithTimeout('https://www.argaam.com/ar/rss/articles', {
      headers: { 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
    }, 5000);

    if (!res.ok) return { success: false, news: [] };

    const xml  = await res.text();
    const news = parseRSSItems(xml);

    if (news.length === 0) return { success: false, news: [] };
    return { success: true, source: 'argaam-rss', news };
  } catch {
    return { success: false, news: [] };
  }
}

function parseRSSItems(xml) {
  const items    = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const getTag  = (tag) => {
      const re = new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`
      );
      const m = itemXml.match(re);
      return m ? (m[1] || m[2] || '').trim() : '';
    };

    items.push({
      title:       getTag('title'),
      description: getTag('description').replace(/<[^>]+>/g, '').substring(0, 200),
      url:         getTag('link'),
      publishedAt: getTag('pubDate'),
      source:      'argaam',
    });
  }

  return items.slice(0, 20);
}

// ===== Utilities =====

function normalizeSymbol(symbol) {
  if (!symbol) return '^TASI.SR';
  if (symbol === '^TASI' || symbol === 'TASI' || symbol === 'TASI:XSAU') return '^TASI.SR';
  if (/^\d+$/.test(symbol)) return symbol + '.SR';
  return symbol;
}

function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
