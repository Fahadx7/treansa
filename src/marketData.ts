import { SAUDI_STOCKS } from './symbols';

// ---- localStorage cache ----
const CACHE_KEY        = 'market_data_cache';
const CACHE_TTL        = 5 * 60 * 1000;   // 5 min
const CHART_CACHE_PFX  = 'chart_v2_';
const CHART_CACHE_TTL  = 10 * 60 * 1000;  // 10 min

export interface CachedMarketData {
  stocks: any[];
  marketIndex: any;
  savedAt: number;
}

export function loadCache(): CachedMarketData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedMarketData = JSON.parse(raw);
    if (Date.now() - parsed.savedAt > CACHE_TTL) return null;
    return parsed;
  } catch { return null; }
}

export function saveCache(stocks: any[], marketIndex: any): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ stocks, marketIndex, savedAt: Date.now() }));
  } catch { /* storage full */ }
}

function loadChartCache(key: string): { meta: any; quotes: any[] } | null {
  try {
    const raw = localStorage.getItem(CHART_CACHE_PFX + key);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Date.now() - p.savedAt > CHART_CACHE_TTL) return null;
    return { meta: p.meta, quotes: p.quotes.map((q: any) => ({ ...q, date: new Date(q.date) })) };
  } catch { return null; }
}

function saveChartCache(key: string, meta: any, quotes: any[]): void {
  try {
    const s = quotes.map(q => ({ ...q, date: (q.date as Date).toISOString() }));
    localStorage.setItem(CHART_CACHE_PFX + key, JSON.stringify({ meta, quotes: s, savedAt: Date.now() }));
  } catch { /* ignore */ }
}

export function getAllSymbols(): string[] {
  return Object.keys(SAUDI_STOCKS).map(s => `${s}.SR`);
}

export interface TASIData {
  price:         number;
  change:        number;
  changePercent: number;
  high:          number;
  low:           number;
  volume:        number;
  time:          string;
}

const TASI_CACHE_KEY = 'tasi_last_known';
const TASI_CACHE_TTL = 60 * 60 * 1000;

export function saveLastKnownTasi(d: TASIData): void {
  try { localStorage.setItem(TASI_CACHE_KEY, JSON.stringify({ ...d, savedAt: Date.now() })); } catch { /* storage full */ }
}

export function loadLastKnownTasi(ignoreTTL = false): TASIData | null {
  try {
    const raw = localStorage.getItem(TASI_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!ignoreTTL && Date.now() - (parsed.savedAt ?? 0) > TASI_CACHE_TTL) return null;
    return parsed as TASIData;
  } catch { return null; }
}

export async function fetchTASI(): Promise<TASIData> {
  const res = await fetch('/api/tasi-index');
  if (!res.ok) throw new Error(`TASI API: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success || data.price <= 0) throw new Error(data.error ?? 'فشل جلب مؤشر تاسي');
  const result: TASIData = {
    price:         data.price,
    change:        data.change        ?? 0,
    changePercent: data.changePercent ?? 0,
    high:          data.high          ?? data.price,
    low:           data.low           ?? data.price,
    volume:        data.volume        ?? 0,
    time:          data.time          ?? new Date().toISOString(),
  };
  saveLastKnownTasi(result);
  return result;
}

// ---- fetchQuotesBatch — Stooq via CORS proxy (no API key) ----
export async function fetchQuotesBatch(symbols: string[]): Promise<any[]> {
  const PROXIES = [
    (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${url}`,
  ];

  const results: any[] = [];

  await Promise.all(symbols.map(async (symbol) => {
    const s = symbol.replace(/\.SR$/i, '.sa');
    const targetUrl = `https://stooq.com/q/l/?s=${s}&f=sd2t2ohlcv&h&e=csv`;

    for (const proxy of PROXIES) {
      try {
        const res = await fetch(proxy(targetUrl));
        if (!res.ok) continue;

        let text = '';
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          text = json.contents ?? json;
        } else {
          text = await res.text();
        }

        const lines = text.trim().split('\n');
        if (lines.length < 2) continue;

        const values = lines[1].split(',');
        const [, , , open, high, low, close, volume] = values;
        if (!close || close.trim() === 'N/D') continue;

        const closeN   = parseFloat(close);
        const openN    = parseFloat(open);
        const change   = closeN - openN;
        const changePct = openN > 0 ? (change / openN) * 100 : 0;

        results.push({
          symbol,
          shortName:                  SAUDI_STOCKS[symbol.split('.')[0]] ?? symbol,
          regularMarketPrice:         closeN,
          regularMarketChange:        parseFloat(change.toFixed(2)),
          regularMarketChangePercent: parseFloat(changePct.toFixed(2)),
          regularMarketVolume:        parseInt(volume?.trim() ?? '0', 10),
          averageDailyVolume10Day:    0,
          regularMarketDayHigh:       parseFloat(high),
          regularMarketDayLow:        parseFloat(low),
        });
        break;
      } catch { continue; }
    }
  }));

  return results;
}

export type ChartRange = '1d' | '1w' | '1mo' | '6mo' | '1y' | '5y';

export async function fetchChart(
  symbol: string,
  range: ChartRange = '1mo',
): Promise<{ meta: any; quotes: any[] }> {
  const cacheKey = `${symbol}_${range}`;
  const cached = loadChartCache(cacheKey);
  if (cached) return cached;

  const res = await fetch(`/api/stock-chart?symbol=${encodeURIComponent(symbol)}&range=${range}`);
  if (!res.ok) throw new Error(`Chart API: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'فشل جلب بيانات الرسم البياني');
  const quotes = (data.quotes as any[]).map(q => ({ ...q, date: new Date(q.date) }));
  saveChartCache(cacheKey, data.meta, quotes);
  return { meta: data.meta, quotes };
}

// ---- Technical Indicators ----

export function calcRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  const g: number[] = [], l: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g.push(d > 0 ? d : 0);
    l.push(d < 0 ? -d : 0);
  }
  let ag = g.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let al = l.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < g.length; i++) {
    ag = (ag * (period - 1) + g[i]) / period;
    al = (al * (period - 1) + l[i]) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

export function calcMACD(closes: number[]) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;

  let ema12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let ema26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;

  for (let i = 12; i < 26; i++) ema12 = closes[i] * k12 + ema12 * (1 - k12);

  const ms: number[] = [];
  for (let i = 26; i < closes.length; i++) {
    ema12 = closes[i] * k12 + ema12 * (1 - k12);
    ema26 = closes[i] * k26 + ema26 * (1 - k26);
    ms.push(ema12 - ema26);
  }
  if (!ms.length) return { macd: 0, signal: 0, histogram: 0 };

  let sig = ms.slice(0, Math.min(9, ms.length)).reduce((a, b) => a + b, 0) / Math.min(9, ms.length);
  for (let i = 9; i < ms.length; i++) sig = ms[i] * k9 + sig * (1 - k9);

  const m = ms[ms.length - 1];
  return { macd: +m.toFixed(4), signal: +sig.toFixed(4), histogram: +(m - sig).toFixed(4) };
}

export function calcBB(closes: number[], p = 20) {
  if (closes.length < p) return { middle: 0, upper: 0, lower: 0 };
  const last = closes.slice(-p);
  const mid  = last.reduce((a, b) => a + b, 0) / p;
  const std  = Math.sqrt(last.reduce((a, b) => a + (b - mid) ** 2, 0) / p);
  return { middle: +mid.toFixed(2), upper: +(mid + 2 * std).toFixed(2), lower: +(mid - 2 * std).toFixed(2) };
}

export function calcATR(highs: number[], lows: number[], closes: number[], p = 14): number {
  if (highs.length < p + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let a = trs.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < trs.length; i++) a = (a * (p - 1) + trs[i]) / p;
  return +a.toFixed(4);
}

export function calcStochRSI(closes: number[], rsiP = 14, stochP = 14) {
  if (closes.length < rsiP + stochP + 5) return { k: 50, d: 50 };
  const series: number[] = [];
  for (let i = rsiP; i <= closes.length; i++) series.push(calcRSI(closes.slice(0, i), rsiP));
  if (series.length < stochP) return { k: 50, d: 50 };
  const kSeries: number[] = [];
  for (let i = stochP - 1; i < series.length; i++) {
    const w = series.slice(i - stochP + 1, i + 1);
    const mn = Math.min(...w), mx = Math.max(...w);
    kSeries.push(mx === mn ? 50 : ((series[i] - mn) / (mx - mn)) * 100);
  }
  const k = kSeries[kSeries.length - 1];
  const d = kSeries.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, kSeries.length);
  return { k: +k.toFixed(2), d: +
