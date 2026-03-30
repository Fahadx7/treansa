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

  const items = [
    { key: 'brent',  symbol: 'BZ=F'     },
    { key: 'gold',   symbol: 'GC=F'     },
    { key: 'usdsar', symbol: 'USDSAR=X' },
  ];
  const result = { success: true, brent: 0, gold: 0, usdsar: 3.75 };

  await Promise.all(items.map(async ({ key, symbol }) => {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
      );
      if (!res.ok) return;
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) result[key] = price;
    } catch { /* skip */ }
  }));

  commoditiesCache = { data: result, ts: Date.now() };
  return json(result);
}

// ─── Stock Price ──────────────────────────────────────────────────────────────

async function handleStockPrice(url) {
  const symbols = (url.searchParams.get('symbols') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!symbols.length) return json({ success: false, error: 'symbols required' }, 400);

  const results = [];

  await Promise.all(symbols.slice(0, 50).map(async (symbol) => {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } },
      );
      if (!res.ok) return;
      const data = await res.json();
      const q = data?.chart?.result?.[0];
      if (!q) return;
      const meta = q.meta;
      const price = meta.regularMarketPrice ?? 0;
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
      const change = price - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose * 100) : 0;
      results.push({
        symbol,
        regularMarketPrice:         price,
        regularMarketChange:        parseFloat(change.toFixed(2)),
        regularMarketChangePercent: parseFloat(changePct.toFixed(2)),
        regularMarketVolume:        meta.regularMarketVolume ?? 0,
        averageDailyVolume10Day:    meta.averageDailyVolume10Day ?? 0,
        regularMarketDayHigh:       meta.regularMarketDayHigh ?? 0,
        regularMarketDayLow:        meta.regularMarketDayLow ?? 0,
      });
    } catch { /* skip failed symbol */ }
  }));

  return json({ success: true, result: results });
}

// ─── Stock Chart (Yahoo Finance) ─────────────────────────────────────────────

const RANGE_MAP = {
  '1d':  { period1: () => Math.floor(Date.now() / 1000) - 86400,     interval: '5m'  },
  '1w':  { period1: () => Math.floor(Date.now() / 1000) - 604800,    interval: '1h'  },
  '1mo': { period1: () => Math.floor(Date.now() / 1000) - 2592000,   interval: '1d'  },
  '6mo': { period1: () => Math.floor(Date.now() / 1000) - 15552000,  interval: '1d'  },
  '1y':  { period1: () => Math.floor(Date.now() / 1000) - 31536000,  interval: '1wk' },
  '5y':  { period1: () => Math.floor(Date.now() / 1000) - 157680000, interval: '1mo' },
};

async function handleStockChart(url) {
  const symbol = url.searchParams.get('symbol') ?? '';
  const range  = url.searchParams.get('range')  ?? '1mo';
  if (!symbol) return json({ success: false, error: 'symbol required' }, 400);

  const cacheKey = `${symbol}_${range}`;
  const hit      = chartCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL) return json(hit.data);

  const cfg     = RANGE_MAP[range] ?? RANGE_MAP['1mo'];
  const period1 = cfg.period1();
  const period2 = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${cfg.interval}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data   = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No data');

    const timestamps = result.timestamp ?? [];
    const quote      = result.indicators?.quote?.[0] ?? {};
    const closes     = quote.close  ?? [];
    const opens      = quote.open   ?? [];
    const highs      = quote.high   ?? [];
    const lows       = quote.low    ?? [];
    const volumes    = quote.volume ?? [];

    const quotes = timestamps.map((t, i) => ({
      date:   new Date(t * 1000).toISOString(),
      open:   opens[i]   ?? 0,
      high:   highs[i]   ?? 0,
      low:    lows[i]    ?? 0,
      close:  closes[i]  ?? 0,
      volume: volumes[i] ?? 0,
    })).filter(q => q.close > 0);

    const payload = { success: true, meta: result.meta, quotes };
    chartCache.set(cacheKey, { data: payload, ts: Date.now() });
    return json(payload);
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

    if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
      return env.ASSETS.fetch(request);
    }

    // All other requests → serve static assets (SPA)
    return env.ASSETS.fetch(request);
  },
};
