/**
 * /api/stock-price — Cloudflare Pages Function
 * Source: Stooq (free, no API key)
 * Saudi symbol mapping: "2222.SR" → "2222.sa"
 *
 * Query params:
 *   symbols  — comma-separated list e.g. "2222.SR,1010.SR"
 *
 * Response mirrors the Yahoo Finance / Twelve Data shape that the frontend expects:
 *   { success: true, result: QuoteResult[] }
 */

interface StooqQuote {
  symbol: string;
  name?: string;
  date?: string;
  time?: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
}

interface StooqResponse {
  symbols: StooqQuote[];
}

interface QuoteResult {
  symbol: string;
  shortName: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketVolume: number;
  averageDailyVolume3Month: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
}

const TTL   = 5 * 60 * 1000;
const BATCH = 50; // Stooq accepts ~50 symbols per request safely

const quoteCache = new Map<string, { data: QuoteResult; ts: number }>();

/** "2222.SR" → "2222.sa" (Stooq Saudi suffix) */
function toStooq(symbol: string): string {
  return symbol.replace(/\.SR$/i, '.sa');
}

function mapQuote(originalSym: string, q: StooqQuote): QuoteResult {
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
    averageDailyVolume3Month:   0,   // not available from Stooq real-time
    fiftyTwoWeekHigh:           0,   // not available from Stooq real-time
    fiftyTwoWeekLow:            0,   // not available from Stooq real-time
    regularMarketDayHigh:       high,
    regularMarketDayLow:        low,
  };
}

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  const url     = new URL(context.request.url);
  const raw     = url.searchParams.get('symbols') ?? '';
  const symbols = raw.split(',').map(s => s.trim()).filter(Boolean);

  if (!symbols.length) {
    return respond({ success: false, error: 'symbols required' }, 400);
  }

  const now     = Date.now();
  const results: QuoteResult[] = [];
  const toFetch: string[]      = [];

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

      const data = await res.json() as StooqResponse;

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
    } catch { /* skip failed batch, try next */ }
  }

  return respond({ success: true, result: results });
}
