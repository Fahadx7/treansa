import type { Handler } from '@netlify/functions';

const API_KEY = process.env.TWELVE_DATA_API_KEY ?? '';
const BASE    = 'https://api.twelvedata.com';
const TTL     = 5 * 60 * 1000;

// symbol-level cache: "2222.SR" → { data, ts }
const cache = new Map<string, { data: any; ts: number }>();

function toTD(symbol: string): string {
  // "2222.SR" → "2222:XSAU"
  return symbol.replace(/\.SR$/i, '') + ':XSAU';
}

function mapQuote(sym: string, q: any): any {
  // Map Twelve Data /quote fields to the Yahoo Finance shape that buildStockFromQuote expects
  return {
    symbol:                    sym,                                          // "2222.SR"
    shortName:                 q.name ?? sym,
    regularMarketPrice:        parseFloat(q.close              ?? '0'),
    regularMarketChange:       parseFloat(q.change             ?? '0'),
    regularMarketChangePercent:parseFloat(q.percent_change     ?? '0'),
    regularMarketVolume:       parseInt(q.volume               ?? '0', 10),
    averageDailyVolume3Month:  parseInt(q.average_volume       ?? '0', 10),
    fiftyTwoWeekHigh:          parseFloat(q.fifty_two_week?.high ?? q.close ?? '0'),
    fiftyTwoWeekLow:           parseFloat(q.fifty_two_week?.low  ?? q.close ?? '0'),
    regularMarketDayHigh:      parseFloat(q.high               ?? q.close ?? '0'),
    regularMarketDayLow:       parseFloat(q.low                ?? q.close ?? '0'),
  };
}

export const handler: Handler = async (event) => {
  const raw = event.queryStringParameters?.symbols ?? '';
  const symbols = raw.split(',').map(s => s.trim()).filter(Boolean);

  if (!symbols.length) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'symbols required' }) };
  }

  const now     = Date.now();
  const results: any[]    = [];
  const toFetch: string[] = [];

  for (const sym of symbols) {
    const hit = cache.get(sym);
    if (hit && now - hit.ts < TTL) results.push(hit.data);
    else toFetch.push(sym);
  }

  if (toFetch.length > 0) {
    // Twelve Data accepts up to ~120 symbols per batch request
    const BATCH = 120;
    for (let i = 0; i < toFetch.length; i += BATCH) {
      const batch = toFetch.slice(i, i + BATCH);
      const tdSyms = batch.map(toTD).join(',');

      try {
        const res = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(tdSyms)}&apikey=${API_KEY}`);
        if (!res.ok) continue;
        const data: any = await res.json();

        // Single symbol → object; multiple → { "SYM:XSAU": {...}, ... }
        const isBatch = batch.length > 1;

        for (const sym of batch) {
          const tdKey = toTD(sym);
          const q = isBatch ? data[tdKey] : data;
          if (!q || q.status === 'error' || !q.close) continue;
          const mapped = mapQuote(sym, q);
          cache.set(sym, { data: mapped, ts: now });
          results.push(mapped);
        }
      } catch { /* skip failed batch */ }
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, result: results }),
  };
};
