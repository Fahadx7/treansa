/**
 * /api/tasi-index — Cloudflare Pages Function
 * Source: Twelve Data (requires TWELVE_DATA_API_KEY env var)
 * Symbol: TASI:XSAU (Tadawul All Share Index)
 *
 * Returns: { success, price, change, changePercent, high, low, volume, time }
 */

const BASE = 'https://api.twelvedata.com';
const TTL  = 5 * 60 * 1000;

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
    const url = `${BASE}/quote?symbol=${encodeURIComponent('TASI:XSAU')}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

    const q = await res.json();
    if (q.status === 'error') throw new Error(q.message ?? 'Twelve Data error');

    const price  = parseFloat(q.close          ?? q.previous_close ?? '0');
    const open   = parseFloat(q.open           ?? q.previous_close ?? String(price));
    const high   = parseFloat(q.high           ?? String(price));
    const low    = parseFloat(q.low            ?? String(price));
    const volume = parseInt(q.volume           ?? '0', 10);
    const prev   = parseFloat(q.previous_close ?? String(open));

    if (price < 1000) throw new Error(`Unexpected TASI price: ${price}`);

    const change        = price - prev;
    const changePercent = prev !== 0 ? (change / prev) * 100 : 0;

    const result = {
      success: true,
      price,
      change,
      changePercent,
      high,
      low,
      volume,
      time: new Date().toISOString(),
    };

    cache = { data: result, ts: Date.now() };
    return respond(result);

  } catch (e) {
    return respond({ success: false, error: e.message }, 503);
  }
}
