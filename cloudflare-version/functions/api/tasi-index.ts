/**
 * /api/tasi-index — Cloudflare Pages Function
 * Source: Stooq (free, no API key)
 * Symbol: ^tasi (Tadawul All Share Index)
 */

interface StooqQuote {
  symbol: string;
  name?: string;
  date: string;
  time: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
}

interface StooqResponse {
  symbols: StooqQuote[];
}

interface TasiResult {
  success: true;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  time: string;
}

interface ErrorResult {
  success: false;
  error: string;
}

const TTL = 5 * 60 * 1000;
let cache: { data: TasiResult; ts: number } | null = null;

function respond(data: TasiResult | ErrorResult, status = 200): Response {
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
    const res = await fetch('https://stooq.com/q/l/?s=^tasi&f=sd2t2ohlcv&h&e=json', {
      headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' },
    });
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

    const data = await res.json() as StooqResponse;
    const q = data.symbols?.[0];
    if (!q || !q.close) throw new Error('No TASI data from Stooq');

    const price  = parseFloat(String(q.close));
    const open   = parseFloat(String(q.open  ?? q.close));
    const high   = parseFloat(String(q.high  ?? q.close));
    const low    = parseFloat(String(q.low   ?? q.close));
    const volume = parseInt(String(q.volume  ?? '0'), 10);

    if (price < 1000) throw new Error(`Unexpected TASI price: ${price}`);

    // Stooq real-time quotes don't include previous-close, so change = close − open (intraday)
    const change        = price - open;
    const changePercent = open !== 0 ? (change / open) * 100 : 0;

    const result: TasiResult = {
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

  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    return respond({ success: false, error }, 503);
  }
}
