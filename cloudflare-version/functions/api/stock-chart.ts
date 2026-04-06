/**
 * /api/stock-chart — Cloudflare Pages Function
 * Source: Stooq historical data (free, no API key)
 * Saudi symbol mapping: "2222.SR" → "2222.sa"
 *
 * Query params:
 *   symbol  — e.g. "2222.SR"
 *   range   — "1d" | "1w" | "1mo" | "6mo" | "1y" | "5y"  (default: "1mo")
 *
 * Stooq historical URL:
 *   https://stooq.com/q/d/l/?s=2222.sa&d1=YYYYMMDD&d2=YYYYMMDD&i=d
 *   Returns CSV: Date,Open,High,Low,Close,Volume
 *
 * Note: Stooq intraday data is not reliably available for all markets.
 *   All ranges use daily ("i=d") granularity. The frontend chart adapts accordingly.
 */

interface ChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartResult {
  success: true;
  meta: Record<string, unknown>;
  quotes: ChartBar[];
}

interface ErrorResult {
  success: false;
  error: string;
}

type ChartRange = '1d' | '1w' | '1mo' | '6mo' | '1y' | '5y';

const RANGE_DAYS: Record<ChartRange, number> = {
  '1d':  5,    // show last 5 trading days for "1 day" view
  '1w':  7,
  '1mo': 30,
  '6mo': 180,
  '1y':  365,
  '5y':  1825,
};

const TTL        = 5 * 60 * 1000;
const chartCache = new Map<string, { data: ChartResult; ts: number }>();

/** "2222.SR" or "^TASI" → "2222.sa" or "tasi" */
function toStooq(symbol: string): string {
  return decodeURIComponent(symbol).replace(/^\^/, '').replace(/\.SR$/i, '.sa');
}

/** Date → "YYYYMMDD" string for Stooq */
function toStooqDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Parse Stooq CSV into ChartBar array.
 * CSV format: Date,Open,High,Low,Close,Volume  (header + data rows, newest-first)
 */
function parseCsv(csv: string): ChartBar[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const bars: ChartBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 5) continue;
    const [dateStr, openStr, highStr, lowStr, closeStr, volStr] = parts;
    const close = parseFloat(closeStr);
    if (!close || close === 0) continue;

    bars.push({
      date:   new Date(dateStr.trim()).toISOString(),
      open:   parseFloat(openStr),
      high:   parseFloat(highStr),
      low:    parseFloat(lowStr),
      close,
      volume: parseInt(volStr ?? '0', 10),
    });
  }

  // Stooq returns newest-first — reverse to chronological
  return bars.reverse();
}

function respond(data: ChartResult | ErrorResult, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  const url    = new URL(context.request.url);
  const symbol = url.searchParams.get('symbol') ?? '';
  const range  = (url.searchParams.get('range') ?? '1mo') as ChartRange;

  if (!symbol) {
    return respond({ success: false, error: 'symbol required' }, 400);
  }

  const cacheKey = `${symbol}_${range}`;
  const hit      = chartCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL) return respond(hit.data);

  const days      = RANGE_DAYS[range] ?? RANGE_DAYS['1mo'];
  const today     = new Date();
  const fromDate  = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
  const d1        = toStooqDate(fromDate);
  const d2        = toStooqDate(today);
  const stooqSym  = toStooq(symbol);

  try {
    const csvUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&d1=${d1}&d2=${d2}&i=d`;
    const res = await fetch(csvUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' },
    });
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

    const csv    = await res.text();
    const quotes = parseCsv(csv);
    if (quotes.length === 0) throw new Error(`No chart data for ${symbol}`);

    const result: ChartResult = {
      success: true,
      meta:    { symbol, stooqSymbol: stooqSym, range },
      quotes,
    };

    chartCache.set(cacheKey, { data: result, ts: Date.now() });
    return respond(result);

  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    return respond({ success: false, error }, 500);
  }
}
