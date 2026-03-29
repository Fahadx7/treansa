import type { Handler } from '@netlify/functions';

const API_KEY = process.env.TWELVE_DATA_API_KEY ?? '';
const BASE    = 'https://api.twelvedata.com';
const TTL     = 5 * 60 * 1000;

let cache: { data: any; ts: number } | null = null;

const SYMBOLS = 'BZ:COMEX,XAU/USD,USD/SAR';

export const handler: Handler = async () => {
  if (cache && Date.now() - cache.ts < TTL) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cache.data) };
  }

  try {
    const res = await fetch(`${BASE}/price?symbol=${encodeURIComponent(SYMBOLS)}&apikey=${API_KEY}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();

    // When multiple symbols: { "BZ:COMEX": { "price": "74.20" }, "XAU/USD": { "price": "2340.50" }, ... }
    const brent  = parseFloat(data['BZ:COMEX']?.price  ?? '0');
    const gold   = parseFloat(data['XAU/USD']?.price   ?? '0');
    const usdsar = parseFloat(data['USD/SAR']?.price   ?? '3.75');

    const result = { success: true, brent, gold, usdsar };
    cache = { data: result, ts: Date.now() };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: e.message }),
    };
  }
};
