/**
 * /api/commodities — Cloudflare Pages Function
 * Source: Stooq (free, no API key)
 * Brent Crude  → lco.f  (ICE Brent Crude Oil Futures)
 * Gold (XAU)   → xauusd (XAU/USD spot)
 * USD/SAR      → fixed 3.75 (not available on Stooq)
 */

const USD_SAR_FIXED = 3.75;
const TTL           = 5 * 60 * 1000;

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
    const res = await fetch(
      'https://stooq.com/q/l/?s=lco.f,xauusd&f=sd2t2ohlcv&h&e=json',
      { headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' } },
    );
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

    const data    = await res.json();
    const symbols = data.symbols ?? [];

    function findClose(sym) {
      const found = symbols.find(s => s.symbol.toLowerCase() === sym.toLowerCase());
      return found ? parseFloat(String(found.close ?? '0')) : 0;
    }

    const brent = findClose('lco.f');
    const gold  = findClose('xauusd');

    if (brent === 0 && gold === 0) throw new Error('No commodity data from Stooq');

    const result = { success: true, brent, gold, usdsar: USD_SAR_FIXED };

    cache = { data: result, ts: Date.now() };
    return respond(result);

  } catch (e) {
    return respond({ success: false, error: e.message }, 500);
  }
}
