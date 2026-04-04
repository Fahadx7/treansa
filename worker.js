/**
 * Cloudflare Worker — TrandSA
 * All API routes in one file + static asset fallback via env.ASSETS
 */

// ─── Shared helpers ──────────────────────────────────────────────────────────

// Fetch with timeout (default 8s) — prevents hanging on slow external APIs
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Yahoo Finance fetch with query1 → query2 fallback + full browser headers
async function yahooFetch(path, headers = {}) {
  const base1 = `https://query1.finance.yahoo.com${path}`;
  const base2 = `https://query2.finance.yahoo.com${path}`;
  const h = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://finance.yahoo.com/',
    'Origin': 'https://finance.yahoo.com',
    ...headers,
  };
  try {
    const res = await fetchWithTimeout(base1, { headers: h }, 7000);
    if (res.ok) return res;
  } catch { /* fallthrough to query2 */ }
  try {
    const res = await fetchWithTimeout(base2, { headers: h }, 7000);
    if (res.ok) return res;
  } catch { /* fallthrough to stooq */ }
  return null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function corsHeaders() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
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
    const res = await fetchWithTimeout('https://stooq.com/q/l/?s=^tasi&f=sd2t2ohlcv&h&e=json', {
      headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' },
    }, 6000);
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
    { key: 'brent', symbol: 'BZ=F' },
    { key: 'gold',  symbol: 'GC=F' },
  ];
  const result = { success: true, brent: 0, gold: 0 };

  await Promise.all(items.map(async ({ key, symbol }) => {
    try {
      const res = await yahooFetch(
        `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      );
      if (!res?.ok) return;
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) result[key] = price;
    } catch { /* skip */ }
  }));

  commoditiesCache = { data: result, ts: Date.now() };
  return json(result);
}

// ─── Stock Price (with average volume calculation for liquidity) ─────────────

async function handleStockPrice(url) {
  const symbols = (url.searchParams.get('symbols') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!symbols.length) return json({ success: false, error: 'symbols required' }, 400);

  const results = [];

  await Promise.all(symbols.slice(0, 50).map(async (symbol) => {
    try {
      // Use 1mo range to get volume history for avgVolume calculation
      const res = await yahooFetch(
        `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`,
      );
      if (!res?.ok) return;
      const data = await res.json();
      const q = data?.chart?.result?.[0];
      if (!q) return;
      const meta = q.meta;
      const price = meta.regularMarketPrice ?? 0;
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
      const change = price - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose * 100) : 0;

      // Calculate average volume from historical data if meta doesn't provide it
      let avgVol = meta.averageDailyVolume10Day ?? 0;
      if (avgVol === 0) {
        const volumes = q.indicators?.quote?.[0]?.volume ?? [];
        // Use all days except the last (current/partial day)
        const histVols = volumes.slice(0, -1).filter(v => v != null && v > 0);
        // Take last 10 trading days
        const last10 = histVols.slice(-10);
        if (last10.length > 0) {
          avgVol = Math.round(last10.reduce((sum, v) => sum + v, 0) / last10.length);
        }
      }

      results.push({
        symbol,
        regularMarketPrice:         price,
        regularMarketChange:        parseFloat(change.toFixed(2)),
        regularMarketChangePercent: parseFloat(changePct.toFixed(2)),
        regularMarketVolume:        meta.regularMarketVolume ?? 0,
        averageDailyVolume10Day:    avgVol,
        regularMarketDayHigh:       meta.regularMarketDayHigh ?? 0,
        regularMarketDayLow:        meta.regularMarketDayLow ?? 0,
      });
    } catch { /* skip failed symbol */ }
  }));

  return json({ success: true, result: results });
}

// ─── Stock Chart (Yahoo Finance + Stooq fallback) ────────────────────────────

const RANGE_MAP = {
  '1d':  { period1: () => Math.floor(Date.now() / 1000) - 86400,     interval: '5m'  },
  '1w':  { period1: () => Math.floor(Date.now() / 1000) - 604800,    interval: '1h'  },
  '1mo': { period1: () => Math.floor(Date.now() / 1000) - 2592000,   interval: '1d'  },
  '6mo': { period1: () => Math.floor(Date.now() / 1000) - 15552000,  interval: '1d'  },
  '1y':  { period1: () => Math.floor(Date.now() / 1000) - 31536000,  interval: '1wk' },
  '5y':  { period1: () => Math.floor(Date.now() / 1000) - 157680000, interval: '1mo' },
};

// Stooq config per range
const STOOQ_CFG = {
  '1d':  { days: 5,    interval: 'd' },
  '1w':  { days: 7,    interval: 'd' },
  '1mo': { days: 30,   interval: 'd' },
  '6mo': { days: 180,  interval: 'd' },
  '1y':  { days: 365,  interval: 'w' },
  '5y':  { days: 1825, interval: 'm' },
};

function dateStr(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchChartFromStooq(symbol, range) {
  // stooq uses '^tasi' (raw ^, not encoded) and '.sa' for Saudi stocks
  const s = symbol.toLowerCase().replace('.sr', '.sa');
  const cfg = STOOQ_CFG[range] ?? STOOQ_CFG['1mo'];
  const d2 = new Date();
  const d1 = new Date(Date.now() - cfg.days * 86400000);
  // Do NOT encodeURIComponent the symbol — stooq needs '^tasi' literally
  const url = `https://stooq.com/q/d/l/?s=${s}&d1=${dateStr(d1)}&d2=${dateStr(d2)}&i=${cfg.interval}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/csv,*/*' },
    }, 8000);
    if (!res || !res.ok) return null;
    const csv = await res.text();
    const lines = csv.trim().split('\n').slice(1); // skip header row
    if (lines.length < 2) return null;
    const quotes = lines.map(line => {
      const [date, open, high, low, close, volume] = line.split(',');
      return {
        date:   new Date(date).toISOString(),
        open:   parseFloat(open)   || 0,
        high:   parseFloat(high)   || 0,
        low:    parseFloat(low)    || 0,
        close:  parseFloat(close)  || 0,
        volume: parseFloat(volume) || 0,
      };
    }).filter(q => q.close > 0);
    if (quotes.length === 0) return null;
    const last = quotes[quotes.length - 1];
    return {
      success: true,
      meta: { symbol, regularMarketPrice: last.close, currency: 'SAR' },
      quotes,
      source: 'stooq',
    };
  } catch {
    return null;
  }
}

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

  // Try Yahoo Finance first
  try {
    const res = await yahooFetch(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${cfg.interval}`,
    );
    if (res && res.ok) {
      const data   = await res.json();
      const result = data?.chart?.result?.[0];
      if (result) {
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

        if (quotes.length > 0) {
          const payload = { success: true, meta: result.meta, quotes };
          chartCache.set(cacheKey, { data: payload, ts: Date.now() });
          return json(payload);
        }
      }
    }
  } catch { /* fallthrough to stooq */ }

  // Fallback: Stooq.com
  const stooqData = await fetchChartFromStooq(symbol, range);
  if (stooqData) {
    chartCache.set(cacheKey, { data: stooqData, ts: Date.now() });
    return json(stooqData);
  }

  return json({ success: false, error: 'فشل جلب البيانات من جميع المصادر' }, 500);
}

// ─── Server-side Technical Indicators ────────────────────────────────────────

function calcRSI(closes, period = 14) {
  if (closes.length <= period) return 50;
  const g = [], l = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g.push(d > 0 ? d : 0);
    l.push(d < 0 ? -d : 0);
  }
  let ag = g.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let al = l.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < g.length; i++) {
    ag = (ag * (period - 1) + g[i]) / period;
    al = (al * (period - 1) + l[i]) / period;
  }
  return al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(2);
}

function calcMACD(closes) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let ema12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let ema26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  for (let i = 12; i < 26; i++) ema12 = closes[i] * k12 + ema12 * (1 - k12);
  const ms = [];
  for (let i = 26; i < closes.length; i++) {
    ema12 = closes[i] * k12 + ema12 * (1 - k12);
    ema26 = closes[i] * k26 + ema26 * (1 - k26);
    ms.push(ema12 - ema26);
  }
  if (!ms.length) return { macd: 0, signal: 0, histogram: 0 };
  let sig = ms.slice(0, Math.min(9, ms.length)).reduce((a, b) => a + b, 0) / Math.min(9, ms.length);
  for (let i = 9; i < ms.length; i++) sig = ms[i] * k9 + sig * (1 - k9);
  const m = ms[ms.length - 1];
  return { macd: +m.toFixed(4), signal: +sig.toFixed(4), histogram: +(m - sig).toFixed(4) };
}

function calcBB(closes, p = 20) {
  if (closes.length < p) return { middle: 0, upper: 0, lower: 0 };
  const last = closes.slice(-p);
  const mid = last.reduce((a, b) => a + b, 0) / p;
  const std = Math.sqrt(last.reduce((a, b) => a + (b - mid) ** 2, 0) / p);
  return { middle: +mid.toFixed(2), upper: +(mid + 2 * std).toFixed(2), lower: +(mid - 2 * std).toFixed(2) };
}

function calcATR(highs, lows, closes, p = 14) {
  if (highs.length < p + 1) return 0;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let a = trs.slice(0, p).reduce((s, v) => s + v, 0) / p;
  for (let i = p; i < trs.length; i++) a = (a * (p - 1) + trs[i]) / p;
  return +a.toFixed(4);
}

function calcStochRSI(closes, rsiP = 14, stochP = 14) {
  if (closes.length < rsiP + stochP + 5) return { k: 50, d: 50 };
  const series = [];
  for (let i = rsiP; i <= closes.length; i++) series.push(calcRSI(closes.slice(0, i), rsiP));
  if (series.length < stochP) return { k: 50, d: 50 };
  const kSeries = [];
  for (let i = stochP - 1; i < series.length; i++) {
    const w = series.slice(i - stochP + 1, i + 1);
    const mn = Math.min(...w), mx = Math.max(...w);
    kSeries.push(mx === mn ? 50 : ((series[i] - mn) / (mx - mn)) * 100);
  }
  const k = kSeries[kSeries.length - 1];
  const d = kSeries.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, kSeries.length);
  return { k: +k.toFixed(2), d: +d.toFixed(2) };
}

function computeAllIndicators(quotes) {
  const closes = quotes.map(q => q.close);
  const highs = quotes.map(q => q.high ?? q.close);
  const lows = quotes.map(q => q.low ?? q.close);
  return {
    rsi: calcRSI(closes),
    macd: calcMACD(closes),
    bb: calcBB(closes),
    atr: calcATR(highs, lows, closes),
    stochRsi: calcStochRSI(closes),
  };
}

// ─── Technical Pattern Detection ─────────────────────────────────────────────

function findPivots(prices, windowSize = 5) {
  const pivots = [];
  for (let i = windowSize; i < prices.length - windowSize; i++) {
    const left = prices.slice(i - windowSize, i);
    const right = prices.slice(i + 1, i + windowSize + 1);
    if (prices[i] > Math.max(...left) && prices[i] > Math.max(...right))
      pivots.push({ idx: i, type: 'high', price: prices[i] });
    else if (prices[i] < Math.min(...left) && prices[i] < Math.min(...right))
      pivots.push({ idx: i, type: 'low', price: prices[i] });
  }
  return pivots;
}

function detectSupportResistance(closes, highs, lows) {
  const levels = [];
  const pivots = findPivots(closes, 3);
  const highPivots = pivots.filter(p => p.type === 'high').map(p => p.price);
  const lowPivots = pivots.filter(p => p.type === 'low').map(p => p.price);
  const currentPrice = closes[closes.length - 1];

  // Cluster nearby pivots as support/resistance zones
  const clusterZone = (prices, label) => {
    if (!prices.length) return;
    prices.sort((a, b) => a - b);
    const threshold = currentPrice * 0.015; // 1.5% tolerance
    let cluster = [prices[0]];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] - cluster[cluster.length - 1] < threshold) {
        cluster.push(prices[i]);
      } else {
        const avg = cluster.reduce((a, b) => a + b, 0) / cluster.length;
        levels.push({ type: label, price: +avg.toFixed(2), strength: cluster.length });
        cluster = [prices[i]];
      }
    }
    const avg = cluster.reduce((a, b) => a + b, 0) / cluster.length;
    levels.push({ type: label, price: +avg.toFixed(2), strength: cluster.length });
  };

  clusterZone(highPivots, 'resistance');
  clusterZone(lowPivots, 'support');

  // Sort by proximity to current price
  return levels
    .filter(l => Math.abs(l.price - currentPrice) / currentPrice < 0.10)
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 6);
}

function detectTrendlines(closes) {
  const n = closes.length;
  if (n < 20) return { trend: 'غير محدد', slope: 0 };
  const recent = closes.slice(-20);
  // Simple linear regression
  const xMean = 9.5, yMean = recent.reduce((a, b) => a + b, 0) / 20;
  let num = 0, den = 0;
  for (let i = 0; i < 20; i++) {
    num += (i - xMean) * (recent[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = num / den;
  const slopePct = (slope / yMean) * 100;
  let trend;
  if (slopePct > 0.3) trend = 'صاعد';
  else if (slopePct < -0.3) trend = 'هابط';
  else trend = 'عرضي';
  return { trend, slope: +slopePct.toFixed(3) };
}

function detectCupAndHandle(closes) {
  if (closes.length < 30) return null;
  const recent = closes.slice(-60);
  if (recent.length < 30) return null;

  const pivots = findPivots(recent, 3);
  const highPivots = pivots.filter(p => p.type === 'high');
  const lowPivots = pivots.filter(p => p.type === 'low');

  if (highPivots.length < 2 || lowPivots.length < 1) return null;

  // Look for U-shape: high → low → high (cup), then minor dip (handle)
  for (let i = 0; i < highPivots.length - 1; i++) {
    const leftRim = highPivots[i];
    const rightRim = highPivots[i + 1];
    const cupBottom = lowPivots.find(l => l.idx > leftRim.idx && l.idx < rightRim.idx);
    if (!cupBottom) continue;

    const rimDiff = Math.abs(leftRim.price - rightRim.price) / leftRim.price;
    const cupDepth = (leftRim.price - cupBottom.price) / leftRim.price;

    if (rimDiff < 0.05 && cupDepth > 0.05 && cupDepth < 0.35) {
      const currentPrice = closes[closes.length - 1];
      const nearRim = Math.abs(currentPrice - rightRim.price) / rightRim.price < 0.03;
      return {
        detected: true,
        rimLevel: +((leftRim.price + rightRim.price) / 2).toFixed(2),
        cupDepth: +(cupDepth * 100).toFixed(1),
        breakoutPending: nearRim || currentPrice > rightRim.price,
      };
    }
  }
  return null;
}

function detectDoublePattern(closes) {
  if (closes.length < 20) return null;
  const pivots = findPivots(closes.slice(-40), 3);
  const highPivots = pivots.filter(p => p.type === 'high');
  const lowPivots = pivots.filter(p => p.type === 'low');

  // Double Top
  if (highPivots.length >= 2) {
    const [h1, h2] = highPivots.slice(-2);
    const diff = Math.abs(h1.price - h2.price) / h1.price;
    if (diff < 0.02 && h2.idx > h1.idx + 3) {
      return { pattern: 'قمة مزدوجة', level: +((h1.price + h2.price) / 2).toFixed(2), bearish: true };
    }
  }

  // Double Bottom
  if (lowPivots.length >= 2) {
    const [l1, l2] = lowPivots.slice(-2);
    const diff = Math.abs(l1.price - l2.price) / l1.price;
    if (diff < 0.02 && l2.idx > l1.idx + 3) {
      return { pattern: 'قاع مزدوج', level: +((l1.price + l2.price) / 2).toFixed(2), bearish: false };
    }
  }
  return null;
}

function detectAllPatterns(quotes) {
  const closes = quotes.map(q => q.close);
  const highs = quotes.map(q => q.high ?? q.close);
  const lows = quotes.map(q => q.low ?? q.close);

  const trendInfo = detectTrendlines(closes);
  const supportResistance = detectSupportResistance(closes, highs, lows);
  const cupHandle = detectCupAndHandle(closes);
  const doublePattern = detectDoublePattern(closes);

  const patterns = [];

  if (trendInfo.trend !== 'غير محدد') {
    patterns.push(`الاتجاه العام: ${trendInfo.trend} (ميل ${trendInfo.slope}%)`);
  }

  if (cupHandle?.detected) {
    patterns.push(`نموذج كوب وعروة - مستوى الحافة: ${cupHandle.rimLevel} | عمق الكوب: ${cupHandle.cupDepth}%${cupHandle.breakoutPending ? ' | اختراق وشيك!' : ''}`);
  }

  if (doublePattern) {
    patterns.push(`${doublePattern.pattern} عند مستوى ${doublePattern.level} (${doublePattern.bearish ? 'سلبي' : 'إيجابي'})`);
  }

  const supports = supportResistance.filter(l => l.type === 'support');
  const resistances = supportResistance.filter(l => l.type === 'resistance');
  if (supports.length) patterns.push(`الدعم: ${supports.map(s => s.price).join(' / ')}`);
  if (resistances.length) patterns.push(`المقاومة: ${resistances.map(r => r.price).join(' / ')}`);

  return {
    trend: trendInfo,
    supportResistance,
    cupHandle,
    doublePattern,
    summary: patterns.join('\n'),
  };
}

// ─── Fetch chart + compute indicators server-side ────────────────────────────

async function fetchAndEnrich(symbol) {
  try {
    const res = await yahooFetch(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`,
    );
    if (!res?.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp) return null;

    const ts = result.timestamp;
    const q = result.indicators?.quote?.[0] ?? {};
    const quotes = ts.map((t, i) => ({
      close: q.close?.[i] ?? 0,
      high: q.high?.[i] ?? 0,
      low: q.low?.[i] ?? 0,
      volume: q.volume?.[i] ?? 0,
    })).filter(x => x.close > 0);

    if (quotes.length < 20) return null;

    const indicators = computeAllIndicators(quotes);
    const patterns = detectAllPatterns(quotes);

    return { indicators, patterns };
  } catch {
    return null;
  }
}

// ─── Psychology-aware sentiment scoring ──────────────────────────────────────

function analyzePsychology(rsi, volumeRatio, macdHist) {
  // RSI sentiment (35% weight)
  let rsiSentiment = 50;
  if (rsi < 20) rsiSentiment = 10;
  else if (rsi < 30) rsiSentiment = 25;
  else if (rsi < 45) rsiSentiment = 40;
  else if (rsi < 55) rsiSentiment = 50;
  else if (rsi < 70) rsiSentiment = 65;
  else if (rsi < 80) rsiSentiment = 80;
  else rsiSentiment = 95;

  // Volume sentiment (40% weight)
  let volSentiment = 50;
  if (volumeRatio > 3) volSentiment = 90;
  else if (volumeRatio > 2) volSentiment = 75;
  else if (volumeRatio > 1.5) volSentiment = 65;
  else if (volumeRatio > 0.7) volSentiment = 50;
  else volSentiment = 30;

  // MACD sentiment (25% weight)
  let macdSentiment = 50;
  if (macdHist > 0.5) macdSentiment = 80;
  else if (macdHist > 0) macdSentiment = 60;
  else if (macdHist > -0.5) macdSentiment = 40;
  else macdSentiment = 20;

  const composite = rsiSentiment * 0.35 + volSentiment * 0.40 + macdSentiment * 0.25;

  // Detect biases
  const biases = [];
  if (rsi > 75 && volumeRatio > 2) biases.push('FOMO (خوف من فوات الفرصة)');
  if (rsi < 25 && volumeRatio > 2.5) biases.push('بيع ذعري');
  if (volumeRatio > 3 && rsi > 50 && rsi < 70) biases.push('سلوك القطيع');
  if (rsi > 80) biases.push('ثقة مفرطة');
  if (rsi < 20 && volumeRatio < 0.5) biases.push('نفور من الخسارة');

  let label;
  if (composite > 75) label = 'طمع شديد';
  else if (composite > 60) label = 'تفاؤل';
  else if (composite > 45) label = 'محايد';
  else if (composite > 30) label = 'خوف';
  else label = 'خوف شديد';

  return { score: +composite.toFixed(1), label, biases };
}

// ─── AI helper (Cloudflare Workers AI — free, no external key) ──────────────

const CF_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

async function callAI(env, prompt) {
  const ai = env.AI;
  if (!ai) return '⚠️ خدمة الذكاء الاصطناعي غير مفعّلة حالياً. يرجى التواصل مع الدعم لتفعيل Workers AI binding في لوحة Cloudflare.';
  const res = await ai.run(CF_MODEL, {
    messages: [
      { role: 'system', content: 'أنت محلل مالي خبير في السوق السعودي (تاسي). أجب دائماً باللغة العربية بشكل مختصر ومهني.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 1024,
    temperature: 0.7,
  });
  return res.response ?? '';
}

async function callAIChat(env, messages) {
  const ai = env.AI;
  if (!ai) return 'عذراً، خدمة المستشار الذكي غير متاحة حالياً. يرجى التحقق من إعدادات Workers AI في لوحة Cloudflare.';
  const res = await ai.run(CF_MODEL, {
    messages: [
      { role: 'system', content: `أنت "المستشار الذكي" — محلل مالي خبير متخصص في السوق السعودي (تاسي).
قواعدك:
- أجب دائماً بالعربية بشكل مهني ومختصر
- استخدم البيانات المقدمة لتحليل الأسهم
- قدم توصيات واضحة (شراء/بيع/انتظار) مع أسباب
- اذكر مستويات الدعم والمقاومة والأهداف السعرية
- حذّر من المخاطر دائماً
- لا تقدم نصائح استثمارية مباشرة، وضّح أن التحليل للأغراض التعليمية` },
      ...messages,
    ],
    max_tokens: 1024,
    temperature: 0.7,
  });
  return res.response ?? '';
}

// ─── Chat endpoint (for AI Advisor) ─────────────────────────────────────────

async function handleChat(request, env) {
  try {
    const body = await request.json();
    const messages = body.messages ?? [];
    if (!messages.length) return json({ success: false, error: 'لا توجد رسائل' }, 400);

    // Keep last 10 messages to stay within context limits
    const trimmed = messages.slice(-10).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 2000),
    }));

    const reply = await callAIChat(env, trimmed);
    return json({ success: true, reply });
  } catch (e) {
    return json({ success: false, error: e.message || 'فشل الاتصال بالمستشار' }, 500);
  }
}

// ─── Multi-Agent Analysis (with server-side enrichment) ─────────────────────

async function handleMultiAgent(request, env) {
  try {
    const body = await request.json();
    const { symbol, companyName, price, change, volumeRatio } = body;
    if (!symbol) return json({ success: false, error: 'رمز السهم مطلوب' }, 400);

    // Always fetch chart data server-side and compute indicators + patterns
    const enrichment = await fetchAndEnrich(symbol);
    const rsi = enrichment?.indicators?.rsi ?? body.rsi ?? 'N/A';
    const macd = enrichment?.indicators?.macd ?? body.macd ?? {};
    const bb = enrichment?.indicators?.bb ?? body.bb ?? {};
    const atr = enrichment?.indicators?.atr ?? body.atr ?? 'N/A';
    const stochRsi = enrichment?.indicators?.stochRsi ?? body.stochRsi ?? {};
    const patterns = enrichment?.patterns ?? null;
    const wave = body.wave ?? 'غير محدد';

    // Psychology analysis
    const psych = analyzePsychology(
      typeof rsi === 'number' ? rsi : 50,
      volumeRatio ?? 1,
      macd?.histogram ?? 0,
    );

    const stockCtx = `الشركة: ${companyName} (${symbol})
السعر: ${price} ر.س | التغير: ${change ?? 0}%
RSI(14): ${rsi} | StochRSI: K=${stochRsi?.k ?? 'N/A'} D=${stochRsi?.d ?? 'N/A'}
MACD: ${macd?.macd ?? 'N/A'} | Signal: ${macd?.signal ?? 'N/A'} | Hist: ${macd?.histogram ?? 'N/A'}
Bollinger: Upper=${bb?.upper ?? 'N/A'} | Middle=${bb?.middle ?? 'N/A'} | Lower=${bb?.lower ?? 'N/A'}
ATR(14): ${atr} | موجة إليوت: ${wave} | نسبة الحجم: ${volumeRatio ?? 'N/A'}x
${patterns?.summary ? `\nالأنماط الفنية المكتشفة:\n${patterns.summary}` : ''}
\nالتحليل النفسي: المعنويات ${psych.label} (${psych.score}/100)${psych.biases.length ? ` | تحيزات: ${psych.biases.join('، ')}` : ''}`;

    // Run 4 specialist agents in parallel, then synthesize
    const [technical, fundamental, sentiment, risk] = await Promise.all([
      callAI(env, `أنت محلل فني خبير في السوق السعودي. حلل البيانات التالية وقدم تحليلاً فنياً مختصراً (3-5 نقاط):
${stockCtx}
ركز على:
- اتجاه RSI/MACD/StochRSI وإشارات التقاطع
- مستويات الدعم والمقاومة المكتشفة
- الأنماط الفنية (كوب وعروة، قمة/قاع مزدوج، ترند)
- موجة إليوت والمرحلة الحالية
- إشارات الدخول/الخروج بناءً على ATR وBollinger`),

      callAI(env, `أنت محلل أساسي خبير في السوق السعودي. قدم تحليلاً أساسياً مختصراً (3-5 نقاط) لـ:
${stockCtx}
ركز على: القطاع، النمو المتوقع، العوامل الاقتصادية المؤثرة، مقارنة بالقطاع.`),

      callAI(env, `أنت محلل معنويات ونفسية السوق السعودي. حلل المعنويات والتحيزات النفسية المحيطة بـ:
${stockCtx}
ركز على:
- مستوى المعنويات الحالي ودرجة الطمع/الخوف
- التحيزات النفسية المكتشفة وتأثيرها على القرار
- حجم التداول مقارنة بالمتوسط ودلالته
- ضغط البيع/الشراء ومناطق التجميع/التصريف`),

      callAI(env, `أنت خبير إدارة مخاطر في السوق السعودي. قيّم المخاطر لـ:
${stockCtx}
ركز على:
- وقف الخسارة المقترح بناءً على ATR (السعر - 2×ATR للشراء)
- حجم المركز المناسب (لا يتجاوز 2% مخاطرة من المحفظة)
- نسبة المخاطرة/العائد لكل هدف
- مخاطر القطاع والسوق
- تأثير التحيزات النفسية على إدارة المخاطر`),
    ]);

    // Synthesis with full context
    const synthesis = await callAI(env, `أنت كبير المحللين في السوق السعودي. لديك تقارير 4 محللين + تحليل نفسي:

📊 التحليل الفني: ${technical.slice(0, 500)}
📈 التحليل الأساسي: ${fundamental.slice(0, 500)}
💭 معنويات السوق: ${sentiment.slice(0, 500)}
⚠️ إدارة المخاطر: ${risk.slice(0, 500)}

السهم: ${companyName} (${symbol}) بسعر ${price} ر.س
ATR(14): ${atr}
${patterns?.summary ? `الأنماط: ${patterns.summary.slice(0, 200)}` : ''}
المعنويات: ${psych.label} (${psych.score}/100)

قدم ملخصاً تنفيذياً نهائياً يتضمن:
1. التوصية النهائية (شراء قوي / شراء / انتظار / بيع / بيع قوي) مع نسبة الثقة
2. نقطة الدخول المثالية
3. الهدف الأول والثاني (بناءً على مستويات المقاومة وATR)
4. وقف الخسارة (بناءً على ATR: السعر - 2×ATR)
5. نسبة المخاطرة/العائد
6. الأنماط الفنية المؤثرة على القرار
7. تحذير نفسي (إن وُجدت تحيزات)
8. الاستراتيجية المقترحة
اجعل الرد مختصراً ومهنياً.`);

    return json({
      success: true,
      agents: { technical, fundamental, sentiment, risk, synthesis },
      enrichment: {
        indicators: enrichment?.indicators ?? null,
        patterns: patterns ? { trend: patterns.trend, supportResistance: patterns.supportResistance, cupHandle: patterns.cupHandle, doublePattern: patterns.doublePattern } : null,
        psychology: psych,
      },
    });
  } catch (e) {
    return json({ success: false, error: e.message || 'فشل التحليل' }, 500);
  }
}

// ─── Scenario Simulation ─────────────────────────────────────────────────────

async function handleScenario(request, env) {
  try {
    const body = await request.json();
    const { scenario, stocks } = body;
    if (!scenario) return json({ success: false, error: 'السيناريو مطلوب' }, 400);

    const stockList = (stocks ?? []).slice(0, 20)
      .map(s => `${s.companyName} (${s.symbol})`).join('، ');

    const prompt = `أنت خبير اقتصادي في السوق السعودي. حلل السيناريو التالي وتأثيره على السوق:

السيناريو: "${scenario}"

الأسهم المتاحة: ${stockList || 'جميع أسهم تاسي'}

أجب بتنسيق JSON فقط (بدون markdown أو backticks) بالهيكل التالي:
{
  "scenario_summary": "ملخص السيناريو وتحليله",
  "overall_market_impact": "إيجابي/سلبي/محايد مع شرح",
  "impact_percentage": "النسبة المتوقعة للتأثير مثل -2% إلى +3%",
  "affected_sectors": ["القطاع1", "القطاع2"],
  "top_positive_stocks": [{"symbol": "XXXX.SR", "name": "اسم الشركة", "reason": "السبب"}],
  "top_negative_stocks": [{"symbol": "XXXX.SR", "name": "اسم الشركة", "reason": "السبب"}],
  "trading_strategy": "الاستراتيجية المقترحة للمتداول",
  "time_horizon": "الأفق الزمني للتأثير"
}`;

    const raw = await callAI(env,prompt);

    // Parse JSON from response (handle potential markdown wrapping)
    let result;
    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      result = {
        scenario_summary: raw.slice(0, 500),
        overall_market_impact: 'غير محدد',
        impact_percentage: 'غير محدد',
        affected_sectors: [],
        top_positive_stocks: [],
        top_negative_stocks: [],
        trading_strategy: 'يرجى إعادة المحاولة',
        time_horizon: 'غير محدد',
      };
    }

    return json({ success: true, result });
  } catch (e) {
    return json({ success: false, error: e.message || 'فشل تحليل السيناريو' }, 500);
  }
}

// ─── AI Analysis (single stock — with server-side enrichment) ────────────────

async function handleAiAnalysis(request, env) {
  try {
    const body = await request.json();
    const { symbol, companyName, price, change, volumeRatio, wave } = body;
    if (!symbol) return json({ success: false, error: 'رمز السهم غير صالح' }, 400);

    // Server-side enrichment
    const enrichment = await fetchAndEnrich(symbol);
    const rsi = enrichment?.indicators?.rsi ?? body.rsi ?? 'N/A';
    const macd = enrichment?.indicators?.macd ?? body.macd ?? {};
    const bb = enrichment?.indicators?.bb ?? body.bb ?? {};
    const atr = enrichment?.indicators?.atr ?? body.atr ?? 'N/A';
    const stoch = enrichment?.indicators?.stochRsi ?? body.stochRsi ?? {};
    const patterns = enrichment?.patterns ?? null;

    const prompt = `أنت خبير مالي ومحلل فني محترف في السوق السعودي (تاسي).
قم بتحليل السهم التالي بناءً على البيانات المقدمة وقدم توصية احترافية باللغة العربية.
الشركة: ${companyName} (${symbol})
السعر الحالي: ${price}
التغير اليومي: ${change ?? 0}%
RSI (14): ${rsi}
Stochastic RSI: K=${stoch?.k ?? 'N/A'} | D=${stoch?.d ?? 'N/A'}
موجة إليوت: ${wave || 'غير محدد'}
MACD: ${macd?.macd ?? 'N/A'} | Signal: ${macd?.signal ?? 'N/A'} | Hist: ${macd?.histogram ?? 'N/A'}
Bollinger Bands: Upper=${bb?.upper ?? 'N/A'} | Middle=${bb?.middle ?? 'N/A'} | Lower=${bb?.lower ?? 'N/A'}
ATR (14): ${atr}
نسبة الحجم: ${volumeRatio ?? 'N/A'}x
${patterns?.summary ? `\nالأنماط الفنية:\n${patterns.summary}` : ''}

يرجى التركيز على:
1. الاتجاه المتوقع (صاعد/هابط/عرضي) مع مستوى الثقة.
2. نقاط الدخول المثالية بناءً على المؤشرات والأنماط.
3. الأهداف السعرية (الأول والثاني) بناءً على مستويات المقاومة وATR.
4. وقف الخسارة المقترح (السعر - 2×ATR).
5. الأنماط الفنية المكتشفة وتأثيرها.
6. نصيحة إدارة المخاطر.
اجعل التحليل مختصراً، مهنياً، ومباشراً.`;

    const analysis = await callAI(env, prompt);
    return json({ success: true, analysis });
  } catch (e) {
    return json({ success: false, error: 'فشل تحليل الذكاء الاصطناعي' }, 500);
  }
}

// ─── AI News ─────────────────────────────────────────────────────────────────

async function handleAiNews(request, env) {
  try {
    const { symbol, companyName } = await request.json();
    if (!symbol) return json({ success: false, error: 'رمز السهم غير صالح' }, 400);

    const prompt = `ابحث عن آخر الأخبار المتعلقة بشركة ${companyName} (رمز السهم: ${symbol}) في السوق السعودي.
قدم قائمة بأهم 5 أخبار حديثة بتنسيق JSON فقط (بدون markdown أو backticks).
لكل خبر: title, summary, date, source, url.
[{"title":"...","summary":"...","date":"...","source":"...","url":"..."}]`;

    const raw = await callAI(env,prompt);
    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const news = JSON.parse(cleaned);
      return json({ success: true, news: Array.isArray(news) ? news : [] });
    } catch {
      return json({ success: true, news: [] });
    }
  } catch (e) {
    return json({ success: false, error: 'فشل جلب الأخبار' }, 500);
  }
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight for POST endpoints
    if (request.method === 'OPTIONS') return corsHeaders();

    // Diagnostic endpoint — checks AI binding and connectivity
    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        ai: !!env.AI,
        assets: !!env.ASSETS,
        ts: new Date().toISOString(),
        cf: request.cf ? { country: request.cf.country, colo: request.cf.colo } : null,
      });
    }

    // GET endpoints
    if (url.pathname === '/api/tasi-index')               return handleTasiIndex();
    if (url.pathname === '/api/commodities')              return handleCommodities();
    if (url.pathname.startsWith('/api/stock-price'))      return handleStockPrice(url);
    if (url.pathname.startsWith('/api/stock-chart'))      return handleStockChart(url);

    // POST endpoints (Cloudflare Workers AI)
    if (request.method === 'POST') {
      if (url.pathname === '/api/chat')         return handleChat(request, env);
      if (url.pathname === '/api/multi-agent')  return handleMultiAgent(request, env);
      if (url.pathname === '/api/scenario')     return handleScenario(request, env);
      if (url.pathname === '/api/ai-analysis')  return handleAiAnalysis(request, env);
      if (url.pathname === '/api/ai-news')      return handleAiNews(request, env);
    }

    if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
      return env.ASSETS.fetch(request);
    }

    // All other requests → serve static assets (SPA)
    return env.ASSETS.fetch(request);
  },
};
