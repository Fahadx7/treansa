/**
 * /api/commodities — Cloudflare Pages Function
 * Source: Twelve Data (requires TWELVE_DATA_API_KEY env var)
 * Brent Crude → BZ:COMEX
 * Gold (XAU)  → XAU/USD
 * USD/SAR     → USD/SAR
 */

const BASE    = 'https://api.twelvedata.com';
const SYMBOLS = 'BZ:COMEX,XAU/USD,USD/SAR';
const TTL     = 5 * 60 * 1000;

let cache = null;

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
  if (cache && Date.now() - cache.ts < TTL) {
    return respond(cache.data);
  }

  const apiKey = context.env?.TWELVE_DATA_API_KEY ?? '';

  try {
    const res = await fetch(
      `${BASE}/price?symbol=${encodeURIComponent(SYMBOLS)}&apikey=${apiKey}`,
    );
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message ?? 'Twelve Data error');

    // Multiple symbols → keyed object: { "BZ:COMEX": { "price": "74.20" }, ... }
    const brent  = parseFloat(data['BZ:COMEX']?.price  ?? '0');
    const gold   = parseFloat(data['XAU/USD']?.price   ?? '0');
    const usdsar = parseFloat(data['USD/SAR']?.price   ?? '3.75');

    if (brent === 0 && gold === 0) throw new Error('No commodity data from Twelve Data');

    const result = { success: true, brent, gold, usdsar };
    cache = { data: result, ts: Date.now() };
    return respond(result);

  } catch (e) {
    return respond({ success: false, error: e.message }, 500);
  }
}
