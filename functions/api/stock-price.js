/**
 * /api/stock-price — Cloudflare Pages Function
 * Source: Twelve Data (requires TWELVE_DATA_API_KEY env var)
 * Saudi symbol mapping: "2222.SR" → "2222:XSAU", "^TASI" → "TASI:XSAU"
 *
 * Query params:
 *   symbols — comma-separated e.g. "2222.SR,1010.SR"
 *
 * Response: { success: true, result: QuoteResult[] }
 */

const BASE  = 'https://api.twelvedata.com';
const TTL   = 5 * 60 * 1000;
const BATCH = 50;

const quoteCache = new Map();

/** "2222.SR" → "2222:XSAU", "^TASI" / "%5ETASI" → "TASI:XSAU" */
function toTwelveData(raw) {
  const decoded = decodeURIComponent(raw);
  return decoded
    .replace(/^\^/, '')
    .replace(/\.SR$/i, '') + ':XSAU';
}

function mapQuote(originalSym, q) {
  const close  = parseFloat(String(q.close  ?? q.previous_close ?? '0'));
  const open   = parseFloat(String(q.open   ?? q.previous_close ?? String(close)));
  const high   = parseFloat(String(q.high   ?? String(close)));
  const low    = parseFloat(String(q.low    ?? String(close)));
  const volume = parseInt(String(q.volume   ?? '0'), 10);
  const prev   = parseFloat(String(q.previous_close ?? String(open)));

  const change        = close - prev;
  const changePercent = prev !== 0 ? (change / prev) * 100 : 0;

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
  const url     = new URL(context.request.url);
  const raw     = url.searchParams.get('symbols') ?? '';
  const symbols = raw.split(',').map(s => s.trim()).filter(Boolean);

  if (!symbols.length) {
    return respond({ success: false, error: 'symbols required' }, 400);
  }

  const apiKey = context.env?.TWELVE_DATA_API_KEY ?? '';
  const now    = Date.now();
  const results = [];
  const toFetch = [];

  for (const sym of symbols) {
    const hit = quoteCache.get(sym);
    if (hit && now - hit.ts < TTL) results.push(hit.data);
    else toFetch.push(sym);
  }

  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch  = toFetch.slice(i, i + BATCH);
    const tdSyms = batch.map(toTwelveData).join(',');

    try {
      const res = await fetch(
        `${BASE}/quote?symbol=${encodeURIComponent(tdSyms)}&apikey=${apiKey}`,
      );
      if (!res.ok) continue;

      const data = await res.json();
      if (data.status === 'error') continue;

      // Twelve Data returns a single object for one symbol, or keyed object for multiple
      const entries = batch.length === 1
        ? [[toTwelveData(batch[0]), data]]
        : Object.entries(data);

      for (const [tdSym, q] of entries) {
        if (!q || q.status === 'error') continue;
        const close = parseFloat(String(q.close ?? '0'));
        if (!close || close === 0) continue;

        // Match back to original symbol
        const origIdx = batch.findIndex(s => toTwelveData(s) === tdSym);
        if (origIdx === -1) continue;
        const originalSym = batch[origIdx];

        const mapped = mapQuote(originalSym, q);
        quoteCache.set(originalSym, { data: mapped, ts: now });
        results.push(mapped);
      }
    } catch { /* skip failed batch */ }
  }

  return respond({ success: true, result: results });
}
