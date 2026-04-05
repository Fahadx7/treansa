import type { Handler } from '@netlify/functions';

const API_KEY = process.env.TWELVE_DATA_API_KEY ?? '';
const BASE    = 'https://api.twelvedata.com';
const TTL     = 5 * 60 * 1000;

const cache = new Map<string, { data: any; ts: number }>();

type ChartRange = '1d' | '1w' | '1mo' | '6mo' | '1y' | '5y';

const RANGE_MAP: Record<ChartRange, { interval: string; outputsize: number }> = {
  '1d':  { interval: '5min',   outputsize: 78  },
  '1w':  { interval: '1h',     outputsize: 168 },
  '1mo': { interval: '1day',   outputsize: 30  },
  '6mo': { interval: '1day',   outputsize: 180 },
  '1y':  { interval: '1week',  outputsize: 52  },
  '5y':  { interval: '1month', outputsize: 60  },
};

export const handler: Handler = async (event) => {
  const symbol = event.queryStringParameters?.symbol ?? '';
  const range  = (event.queryStringParameters?.range ?? '1mo') as ChartRange;

  if (!symbol) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'symbol required' }) };
  }

  const cacheKey = `${symbol}_${range}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hit.data) };
  }

  const cfg = RANGE_MAP[range] ?? RANGE_MAP['1mo'];
  // "2222.SR" → "2222:XSAU", "^TASI" / "%5ETASI" → "TASI:XSAU"
  const tdSym = decodeURIComponent(symbol).replace(/^\^/, '').replace(/\.SR$/i, '') + ':XSAU';

  try {
    const url = `${BASE}/time_series?symbol=${encodeURIComponent(tdSym)}&interval=${cfg.interval}&outputsize=${cfg.outputsize}&apikey=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();

    if (data.status === 'error') throw new Error(data.message ?? 'Twelve Data error');

    const values: any[] = data.values ?? [];
    // Twelve Data returns newest-first — reverse to chronological order
    const quotes = values
      .reverse()
      .map((v: any) => ({
        date:   new Date(v.datetime).toISOString(),
        open:   parseFloat(v.open   ?? '0'),
        high:   parseFloat(v.high   ?? '0'),
        low:    parseFloat(v.low    ?? '0'),
        close:  parseFloat(v.close  ?? '0'),
        volume: parseInt(v.volume   ?? '0', 10),
      }))
      .filter(q => q.close > 0);

    const result = { success: true, meta: data.meta ?? {}, quotes };
    cache.set(cacheKey, { data: result, ts: Date.now() });

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
