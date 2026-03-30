/**
 * Cloudflare Worker — TrandSA
 * All API routes in one file + static asset fallback via env.ASSETS
 */

// ─── Shared helpers ──────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ─── In-memory caches (per isolate, 5-min TTL) ───────────────────────────────

const TTL = 5 * 60 * 1000;

let tasiCache       = null;
let commoditiesCache = null;
const quoteCache    = new Map();
const chartCache    = new Map();

// ─── TASI Index ───────────────────────────────────────────────────────────────

async function handleTasiIndex() {
  if (tasiCache && Date.now() - tasiCache.ts < TTL) return json(tasiCache.data);

  try {
    const res = await fetch('https://stooq.com/q/l/?s=^tasi&f=sd2t2ohlcv&h&e=json', {
      headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' },
    });
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

    const data = await res.json();
    const q    = data.symbols?.[0];
    if (!q || !q.close) throw new Error('No TASI data from Stooq');

    const price  = parseFloat(String(q.close));
    const open   = parseFloat(String(q.open  ?? q.close));
    if (price < 1000) throw new Error(`Unexpected TASI price: ${price}`);

    const change        = price - open;
    const changePercent = open !== 0 ? (change / open) * 100 : 0;

    const result = {
      success: true,
      price,
      change,
      changePercent,
      high:   parseFloat(String(q.high   ?? q.close)),
      low:    parseFloat(String(q.low    ?? q.close)),
      volume: parseInt(String(q.volume   ?? '0'), 10),
      time:   new Date().toISOString(),
    };

    tasiCache = { data: result, ts: Date.now() };
    return json(result);
  } catch (e) {
    return json({ success: false, error: e.message }, 503);
  }
}

// ─── Commodities ──────────────────────────────────────────────────────────────

async function handleCommodities() {
  if (commoditiesCache && Date.now() - commoditiesCache.ts < TTL) {
    return json(commoditiesCache.data);
  }

  try {
    const res = await fetch(
      'https://stooq.com/q/l/?s=lco.f,xauusd&f=sd2t2ohlcv&h&e=json',
      { headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' } },
    );
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

    const data    = await res.json();
    const symbols = data.symbols ?? [];

    function findClose(sym) {
      const found = symbols.find(s => s.symbol.toLowerCase() === sym.toLowerCase());
      return found ? parseFloat(String(found.close ?? '0')) : 0;
    }

    const brent = findClose('lco.f');
    const gold  = findClose('xauusd');
    if (brent === 0 && gold === 0) throw new Error('No commodity data from Stooq');

    const result = { success: true, brent, gold, usdsar: 3.75 };
    commoditiesCache = { data: result, ts: Date.now() };
    return json(result);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

// ─── Stock Price ──────────────────────────────────────────────────────────────

const BATCH = 50;

function toStooqSym(symbol) {
  return symbol.replace(/\.SR$/i, '.sa');
}

function mapQuote(originalSym, q) {
  const close  = parseFloat(String(q.close  ?? '0'));
  const open   = parseFloat(String(q.open   ?? q.close ?? '0'));
  const high   = parseFloat(String(q.high   ?? q.close ?? '0'));
  const low    = parseFloat(String(q.low    ?? q.close ?? '0'));
  const volume = parseInt(String(q.volume   ?? '0'), 10);
  const change        = close - open;
  const changePercent = open !== 0 ? (change / open) * 100 : 0;

  return {
    symbol:                     originalSym,
    shortName:                  q.name ?? originalSym,
    regularMarketPrice:         close,
    regularMarketChange:        change,
    regularMarketChangePercent: changePercent,
    regularMarketVolume:        volume,
    averageDailyVolume3Month:   0,
    fiftyTwoWeekHigh:           0,
    fiftyTwoWeekLow:            0,
    regularMarketDayHigh:       high,
    regularMarketDayLow:        low,
  };
}

async function handleStockPrice(url) {
  const raw     = url.searchParams.get('symbols') ?? '';
  const symbols = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!symbols.length) return json({ success: false, error: 'symbols required' }, 400);

  const now     = Date.now();
  const results = [];
  const toFetch = [];

  for (const sym of symbols) {
    const hit = quoteCache.get(sym);
    if (hit && now - hit.ts < TTL) results.push(hit.data);
    else toFetch.push(sym);
  }

  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch    = toFetch.slice(i, i + BATCH);
    const stooqStr = batch.map(toStooqSym).join(',');
    try {
      const res = await fetch(
        `https://stooq.com/q/l/?s=${encodeURIComponent(stooqStr)}&f=sd2t2ohlcv&h&e=json`,
        { headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' } },
      );
      if (!res.ok) continue;
      const data = await res.json();

      for (const originalSym of batch) {
        const stooqSym = toStooqSym(originalSym).toLowerCase();
        const q = (data.symbols ?? []).find(s => s.symbol.toLowerCase() === stooqSym);
        if (!q || !q.close || parseFloat(String(q.close)) === 0) continue;
        const mapped = mapQuote(originalSym, q);
        quoteCache.set(originalSym, { data: mapped, ts: now });
        results.push(mapped);
      }
    } catch { /* skip failed batch */ }
  }

  return json({ success: true, result: results });
}

// ─── Stock Chart ──────────────────────────────────────────────────────────────

const RANGE_DAYS = { '1d': 5, '1w': 7, '1mo': 30, '6mo': 180, '1y': 365, '5y': 1825 };

function toStooqDate(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function parseCsv(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 5) continue;
    const [dateStr, openStr, highStr, lowStr, closeStr, volStr] = parts;
    const close = parseFloat(closeStr);
    if (!close || close === 0) continue;
    bars.push({
      date:   new Date(dateStr.trim()).toISOString(),
      open:   parseFloat(openStr),
      high:   parseFloat(highStr),
      low:    parseFloat(lowStr),
      close,
      volume: parseInt(volStr ?? '0', 10),
    });
  }
  return bars.reverse(); // Stooq: newest-first → reverse to chronological
}

async function handleStockChart(url) {
  const symbol = url.searchParams.get('symbol') ?? '';
  const range  = url.searchParams.get('range')  ?? '1mo';
  if (!symbol) return json({ success: false, error: 'symbol required' }, 400);

  const cacheKey = `${symbol}_${range}`;
  const hit      = chartCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL) return json(hit.data);

  const days     = RANGE_DAYS[range] ?? RANGE_DAYS['1mo'];
  const today    = new Date();
  const fromDate = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
  const stooqSym = symbol.replace(/\.SR$/i, '.sa');

  try {
    const csvUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&d1=${toStooqDate(fromDate)}&d2=${toStooqDate(today)}&i=d`;
    const res = await fetch(csvUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' },
    });
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

    const quotes = parseCsv(await res.text());
    if (quotes.length === 0) throw new Error(`No chart data for ${symbol}`);

    const result = { success: true, meta: { symbol, stooqSymbol: stooqSym, range }, quotes };
    chartCache.set(cacheKey, { data: result, ts: Date.now() });
    return json(result);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/tasi-index')               return handleTasiIndex();
    if (url.pathname === '/api/commodities')              return handleCommodities();
    if (url.pathname.startsWith('/api/stock-price'))      return handleStockPrice(url);
    if (url.pathname.startsWith('/api/stock-chart'))      return handleStockChart(url);

    // All other requests → serve static assets (SPA)
    return env.ASSETS.fetch(request);
  },
};
