/**
 * /api/stock-price — Cloudflare Pages Function
 * Source: Stooq (free, no API key)
 * Saudi symbol mapping: "2222.SR" → "2222.sa"
 *
 * Query params:
 *   symbols — comma-separated e.g. "2222.SR,1010.SR"
 *
 * Response shape mirrors the Yahoo Finance / Twelve Data format the frontend expects:
 *   { success: true, result: QuoteResult[] }
 */

const TTL   = 5 * 60 * 1000;
const BATCH = 50;

const quoteCache = new Map();

/** "2222.SR" → "2222.sa" */
function toStooq(symbol) {
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
    const stooqStr = batch.map(toStooq).join(',');

    try {
      const res = await fetch(
        `https://stooq.com/q/l/?s=${encodeURIComponent(stooqStr)}&f=sd2t2ohlcv&h&e=json`,
        { headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' } },
      );
      if (!res.ok) continue;

      const data = await res.json();

      for (const originalSym of batch) {
        const stooqSym = toStooq(originalSym).toLowerCase();
        const q = (data.symbols ?? []).find(
          s => s.symbol.toLowerCase() === stooqSym,
        );
        if (!q || !q.close || parseFloat(String(q.close)) === 0) continue;

        const mapped = mapQuote(originalSym, q);
        quoteCache.set(originalSym, { data: mapped, ts: now });
        results.push(mapped);
      }
    } catch { /* skip failed batch */ }
  }

  return respond({ success: true, result: results });
}
