/**
 * /api/commodities — Cloudflare Pages Function
 * Source: Stooq (free, no API key)
 * Symbols:
 *   Brent Crude  → lco.f  (ICE Brent Crude Oil Futures)
 *   Gold (XAU)   → xauusd (XAU/USD spot)
 *   USD/SAR      → Stooq does not carry this pair — defaults to 3.75
 */

interface StooqQuote {
  symbol: string;
  close: string | number;
}

interface StooqResponse {
  symbols: StooqQuote[];
}

interface CommoditiesResult {
  success: true;
  brent: number;
  gold: number;
  usdsar: number;
}

interface ErrorResult {
  success: false;
  error: string;
}

const USD_SAR_FIXED = 3.75;
const TTL           = 5 * 60 * 1000;

let cache: { data: CommoditiesResult; ts: number } | null = null;

function respond(data: CommoditiesResult | ErrorResult, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequest(): Promise<Response> {
  if (cache && Date.now() - cache.ts < TTL) {
    return respond(cache.data);
  }

  try {
    const res = await fetch(
      'https://stooq.com/q/l/?s=lco.f,xauusd&f=sd2t2ohlcv&h&e=json',
      { headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' } },
    );
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

    const data = await res.json() as StooqResponse;
    const symbols = data.symbols ?? [];

    function findClose(sym: string): number {
      const found = symbols.find(s =>
        s.symbol.toLowerCase() === sym.toLowerCase(),
      );
      return found ? parseFloat(String(found.close ?? '0')) : 0;
    }

    const brent = findClose('lco.f');
    const gold  = findClose('xauusd');

    if (brent === 0 && gold === 0) throw new Error('No commodity data from Stooq');

    const result: CommoditiesResult = {
      success: true,
      brent,
      gold,
      usdsar: USD_SAR_FIXED,
    };

    cache = { data: result, ts: Date.now() };
    return respond(result);

  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    return respond({ success: false, error }, 500);
  }
}
