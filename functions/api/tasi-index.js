/**
 * /api/tasi-index — Cloudflare Pages Function
 * Source: Stooq (free, no API key)
 * Symbol: ^tasi (Tadawul All Share Index)
 */

const TTL = 5 * 60 * 1000;
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

export async function onRequest() {
  if (cache && Date.now() - cache.ts < TTL) {
    return respond(cache.data);
  }

  try {
    const res = await fetch('https://stooq.com/q/l/?s=^tasi&f=sd2t2ohlcv&h&e=json', {
      headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' },
    });
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

    const data = await res.json();
    const q = data.symbols?.[0];
    if (!q || !q.close) throw new Error('No TASI data from Stooq');

    const price  = parseFloat(String(q.close));
    const open   = parseFloat(String(q.open  ?? q.close));
    const high   = parseFloat(String(q.high  ?? q.close));
    const low    = parseFloat(String(q.low   ?? q.close));
    const volume = parseInt(String(q.volume  ?? '0'), 10);

    if (price < 1000) throw new Error(`Unexpected TASI price: ${price}`);

    const change        = price - open;
    const changePercent = open !== 0 ? (change / open) * 100 : 0;

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
