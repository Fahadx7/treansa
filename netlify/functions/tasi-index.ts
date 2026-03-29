import type { Handler } from '@netlify/functions';

const API_KEY = process.env.TWELVE_DATA_API_KEY ?? '';
const BASE    = 'https://api.twelvedata.com';

// In-memory cache — 5-minute TTL
let cache: { data: any; ts: number } | null = null;
const TTL = 5 * 60 * 1000;

export const handler: Handler = async () => {
  if (cache && Date.now() - cache.ts < TTL) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cache.data) };
  }

  try {
    const res = await fetch(`${BASE}/quote?symbol=TASI:XSAU&apikey=${API_KEY}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const q: any = await res.json();

    if (q.status === 'error' || !q.close) {
      throw new Error(q.message || 'No data from Twelve Data');
    }

    const price         = parseFloat(q.close);
    const change        = parseFloat(q.change        ?? '0');
    const changePercent = parseFloat(q.percent_change ?? '0');

    if (price < 1000) throw new Error(`Unexpected TASI price: ${price}`);

    const result = {
      success:       true,
      price,
      change,
      changePercent,
      high:   parseFloat(q.high          ?? q.close),
      low:    parseFloat(q.low           ?? q.close),
      volume: parseInt(q.volume          ?? '0', 10),
      time:   new Date().toISOString(),
    };

    cache = { data: result, ts: Date.now() };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };

  } catch (e: any) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: e.message }),
    };
  }
};
