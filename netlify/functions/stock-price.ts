import type { Handler } from '@netlify/functions';

const TTL = 5 * 60 * 1000;
const cache = new Map<string, { data: any; ts: number }>();

function toStooq(symbol: string): string {
  // "2222.SR" → "2222.sa"
  return symbol.replace(/\.SR$/i, '.sa');
}

async function fetchStooq(symbol: string): Promise<any | null> {
  const s = toStooq(symbol);
  const url = `https://stooq.com/q/l/?s=${s}&f=sd2t2ohlcv&h&e=csv`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;

    const values = lines[1].split(',');
    const [sym, date, time, open, high, low, close, volume] = values;
    if (!close || close === 'N/D') return null;

    const closeN = parseFloat(close);
    const openN  = parseFloat(open);
    const change = closeN - openN;
    const changePct = (change / openN) * 100;

    return {
      symbol,
      shortName:                  symbol,
      regularMarketPrice:         closeN,
      regularMarketChange:        parseFloat(change.toFixed(2)),
      regularMarketChangePercent: parseFloat(changePct.toFixed(2)),
      regularMarketVolume:        parseInt(volume ?? '0', 10),
      averageDailyVolume3Month:   0,
      fiftyTwoWeekHigh:           parseFloat(high),
      fiftyTwoWeekLow:            parseFloat(low),
      regularMarketDayHigh:       parseFloat(high),
      regularMarketDayLow:        parseFloat(low),
    };
  } catch {
    return null;
  }
}

export const handler: Handler = async (event) => {
  const raw = event.queryStringParameters?.symbols ?? '';
  const symbols = raw.split(',').map(s => s.trim()).filter(Boolean);

  if (!symbols.length) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'symbols required' }) };
  }

  const now = Date.now();
  const results: any[] = [];

  await Promise.all(symbols.map(async (sym) => {
    const hit = cache.get(sym);
    if (hit && now - hit.ts < TTL) {
      results.push(hit.data);
      return;
    }
    const data = await fetchStooq(sym);
    if (data) {
      cache.set(sym, { data, ts: now });
      results.push(data);
    }
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, result: results }),
  };
};
