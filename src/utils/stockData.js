/**
 * stockData.js — جلب البيانات المُحسَّن
 * =======================================
 * يحل 3 مشاكل:
 * 1. "فشل جلب البيانات" في شارت المؤشر العام
 * 2. "Load failed" في الأخبار
 * 3. "raw.slice is not a function" في الرادار الخفي
 *
 * الاستراتيجية:
 * Worker أولاً → CORS Proxies كـ fallback → cached data كملاذ أخير
 *
 * الاستخدام:
 * import { fetchChart, fetchNews, safeFetchChart } from './stockData';
 */

// ===== CONFIGURATION =====
// غيّر هذا الرابط لرابط الـ Worker الخاص بك بعد النشر
const WORKER_BASE = import.meta.env.VITE_API_WORKER_URL || 'https://trandsa-api.YOUR_SUBDOMAIN.workers.dev';

const CORS_PROXIES = [
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${url}`,
];

// ===== 1. CHART DATA =====

/**
 * جلب بيانات الشارت — يدعم جميع الفترات الزمنية
 * @param {string} symbol - رمز السهم (مثل '2222' أو '^TASI')
 * @param {string} range - الفترة: '1d','5d','1mo','6mo','1y','5y'
 * @param {string} interval - الفاصل: '5m','15m','1h','1d','1wk','1mo'
 * @returns {Promise<{success: boolean, data: Array, meta: Object}>}
 */
export async function fetchChart(symbol, range = '6mo', interval = '1d') {
  const cleanSymbol = normalizeSymbol(symbol);

  // === Strategy 1: Worker (الأفضل — بدون CORS) ===
  try {
    const workerUrl = `${WORKER_BASE}/api/chart?symbol=${encodeURIComponent(cleanSymbol)}&range=${range}&interval=${interval}`;
    const res = await fetch(workerUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        return json;
      }
    }
  } catch {
    // Worker فشل — نكمل للـ fallback
  }

  // === Strategy 2: Yahoo Finance عبر CORS Proxies ===
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?range=${range}&interval=${interval}`;

  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetch(proxy(yahooUrl), { signal: AbortSignal.timeout(6000) });
      const json = await res.json();
      const raw = json.contents ? JSON.parse(json.contents) : json;
      const parsed = parseYahooData(raw, cleanSymbol);
      if (parsed.success) return parsed;
    } catch {
      continue;
    }
  }

  // === Strategy 3: Return cached/empty ===
  return {
    success: false,
    error: 'فشل جلب البيانات — تحقق من الاتصال',
    symbol: cleanSymbol,
    data: [],
  };
}

/**
 * safeFetchChart — نسخة آمنة ما ترمي خطأ أبداً
 * مناسبة للـ components اللي تحتاج always-render
 */
export async function safeFetchChart(symbol, range, interval) {
  try {
    return await fetchChart(symbol, range, interval);
  } catch {
    return { success: false, data: [], error: 'خطأ غير متوقع' };
  }
}

// ===== 2. NEWS DATA =====

/**
 * جلب الأخبار — Worker أولاً ثم Argaam RSS
 * @param {string} [symbol] - رمز سهم محدد (اختياري)
 * @returns {Promise<{success: boolean, news: Array}>}
 */
export async function fetchNews(symbol) {
  // === Strategy 1: Worker ===
  try {
    let newsUrl = `${WORKER_BASE}/api/news`;
    if (symbol) newsUrl += `?symbol=${encodeURIComponent(normalizeSymbol(symbol))}`;

    const res = await fetch(newsUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.news)) {
        return json;
      }
    }
  } catch {
    // فشل — نكمل
  }

  // === Strategy 2: Argaam RSS مباشر عبر proxy ===
  try {
    const rssUrl = 'https://www.argaam.com/ar/rss/articles';
    for (const proxy of CORS_PROXIES) {
      try {
        const res = await fetch(proxy(rssUrl), { signal: AbortSignal.timeout(5000) });
        const json = await res.json();
        const xml = json.contents || (typeof json === 'string' ? json : '');
        if (xml) {
          const news = parseRSSItems(xml);
          if (news.length > 0) {
            return { success: true, source: 'argaam-rss-proxy', news };
          }
        }
      } catch { continue; }
    }
  } catch {
    // كل المحاولات فشلت
  }

  return {
    success: false,
    error: 'فشل تحميل الأخبار',
    news: [],
  };
}

// ===== 3. SAFE ARRAY HELPERS =====
// حل مشكلة "raw.slice is not a function"

/**
 * تحويل أي قيمة لـ Array بأمان
 * استخدمه في كل مكان يستقبل بيانات من API
 */
export function toSafeArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null) return [];
  if (typeof raw === 'object' && raw.data && Array.isArray(raw.data)) return raw.data;
  if (typeof raw === 'object' && raw.result && Array.isArray(raw.result)) return raw.result;
  return [];
}

/**
 * safeSlice — بديل آمن لـ .slice()
 * بدل: raw.slice(0, 10)
 * استخدم: safeSlice(raw, 0, 10)
 */
export function safeSlice(raw, start = 0, end) {
  const arr = toSafeArray(raw);
  return end !== undefined ? arr.slice(start, end) : arr.slice(start);
}

// ===== INTERNAL HELPERS =====

function normalizeSymbol(symbol) {
  if (!symbol) return '^TASI.SR';
  if (symbol === '^TASI' || symbol === 'TASI' || symbol === 'TASI:XSAU') {
    return '^TASI.SR';
  }
  if (/^\d+$/.test(symbol)) {
    return symbol + '.SR';
  }
  return symbol;
}

function parseYahooData(raw, symbol) {
  if (!raw) return { success: false, data: [], error: 'بيانات فارغة' };

  const chart = raw.chart;
  if (!chart) return { success: false, data: [], error: 'لا يوجد chart في البيانات' };

  if (chart.error) {
    return { success: false, data: [], error: chart.error.description || 'خطأ Yahoo Finance' };
  }

  const result = Array.isArray(chart.result) ? chart.result[0] : null;
  if (!result) return { success: false, data: [], error: 'لا توجد نتائج' };

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close) ? quote.close : [];

  if (timestamps.length === 0 || closes.length === 0) {
    return { success: false, data: [], error: 'بيانات فارغة' };
  }

  const data = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) {
      data.push({
        date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
        timestamp: timestamps[i],
        open: quote.open?.[i] ?? null,
        high: quote.high?.[i] ?? null,
        low: quote.low?.[i] ?? null,
        close: parseFloat(closes[i]?.toFixed(2)),
        volume: quote.volume?.[i] ?? 0,
      });
    }
  }

  const meta = result.meta || {};
  return {
    success: true,
    symbol: meta.symbol || symbol,
    currency: meta.currency || 'SAR',
    regularMarketPrice: meta.regularMarketPrice,
    previousClose: meta.previousClose,
    dataPoints: data.length,
    data,
  };
}

function parseRSSItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const getTag = (tag) => {
      const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
      const m = itemXml.match(re);
      return m ? (m[1] || m[2] || '').trim() : '';
    };

    items.push({
      title: getTag('title'),
      description: getTag('description').replace(/<[^>]+>/g, '').substring(0, 200),
      url: getTag('link'),
      publishedAt: getTag('pubDate'),
      source: 'argaam',
    });
  }

  return items.slice(0, 20);
}
