/**
 * /api/stock-chart — Cloudflare Pages Function
 * Source: Twelve Data (requires TWELVE_DATA_API_KEY env var)
 * Saudi symbol mapping: "2222.SR" → "2222:XSAU", "^TASI" / "%5ETASI" → "TASI:XSAU"
 *
 * Query params:
 *   symbol — e.g. "2222.SR" or "^TASI" or "%5ETASI"
 *   range  — "1d"|"1w"|"1mo"|"6mo"|"1y"|"5y"  (default: "1mo")
 */

const BASE = 'https://api.twelvedata.com';
const TTL  = 5 * 60 * 1000;

const chartCache = new Map();

const RANGE_MAP = {
  '1d':  { interval: '5min',   outputsize: 78  },
  '1w':  { interval: '1h',     outputsize: 168 },
  '1mo': { interval: '1day',   outputsize: 30  },
  '6mo': { interval: '1day',   outputsize: 180 },
  '1y':  { interval: '1week',  outputsize: 52  },
  '5y':  { interval: '1month', outputsize: 60  },
};

/** "2222.SR" → "2222:XSAU", "^TASI" / "%5ETASI" → "TASI:XSAU" */
function toTwelveData(raw) {
  const decoded = decodeURIComponent(raw);
  return decoded
    .replace(/^\^/, '')
    .replace(/\.SR$/i, '') + ':XSAU';
}

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequest(context) {
  const url    = new URL(context.request.url);
  const symbol = url.searchParams.get('symbol') ?? '';
  const range  = url.searchParams.get('range') ?? '1mo';

  if (!symbol) {
    return respond({ success: false, error: 'symbol required' }, 400);
  }

  const cacheKey = `${symbol}_${range}`;
  const hit      = chartCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL) return respond(hit.data);

  const apiKey = context.env?.TWELVE_DATA_API_KEY ?? '';
  const cfg    = RANGE_MAP[range] ?? RANGE_MAP['1mo'];
  const tdSym  = toTwelveData(symbol);

  try {
    const tdUrl = `${BASE}/time_series?symbol=${encodeURIComponent(tdSym)}&interval=${cfg.interval}&outputsize=${cfg.outputsize}&apikey=${apiKey}`;
    const res   = await fetch(tdUrl);
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message ?? 'Twelve Data error');

    const values = data.values ?? [];
    const quotes = values
      .reverse()
      .map(v => ({
        date:   new Date(v.datetime).toISOString(),
        open:   parseFloat(v.open   ?? '0'),
        high:   parseFloat(v.high   ?? '0'),
        low:    parseFloat(v.low    ?? '0'),
        close:  parseFloat(v.close  ?? '0'),
        volume: parseInt(v.volume   ?? '0', 10),
      }))
      .filter(q => q.close > 0);

    if (quotes.length === 0) throw new Error(`No chart data for ${symbol}`);

    const result = {
      success: true,
      meta:    { symbol, tdSymbol: tdSym, range, ...(data.meta ?? {}) },
      quotes,
    };

    chartCache.set(cacheKey, { data: result, ts: Date.now() });
    return respond(result);

  } catch (e) {
    return respond({ success: false, error: e.message }, 500);
  }
}
