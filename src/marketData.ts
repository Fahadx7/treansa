import { SAUDI_STOCKS } from './symbols';

// ---- localStorage cache ----
const CACHE_KEY = 'market_data_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
  } catch {
    return null;
  }
}

export function saveCache(stocks: any[], marketIndex: any): void {
  try {
    const data: CachedMarketData = { stocks, marketIndex, savedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* storage full — ignore */ }
}

// ---- All Yahoo Finance calls go through the Netlify function (server-side, no CORS)

export function getAllSymbols(): string[] {
  return Object.keys(SAUDI_STOCKS).map(s => `${s}.SR`);
}

export async function fetchQuotesBatch(symbols: string[]): Promise<any[]> {
  const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
  if (!res.ok) throw new Error(`Quotes API: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'فشل جلب بيانات الأسهم');
  return data.result ?? [];
}

export async function fetchChart(
  symbol: string,
  _interval: string,
  _range: string,
): Promise<{ meta: any; quotes: any[] }> {
  const res = await fetch(`/api/chart/${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`Chart API: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'فشل جلب بيانات الرسم البياني');
  // dates come back as ISO strings from JSON — convert to Date objects
  const quotes = (data.quotes as any[]).map(q => ({ ...q, date: new Date(q.date) }));
  return { meta: data.meta, quotes };
}

// ---- Technical Indicators ----

function calcRSI(closes: number[], period = 14): number {
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

function calcEMA(data: number[], p: number): number {
  if (!data.length) return 0;
  if (data.length < p) return data.reduce((a, b) => a + b, 0) / data.length;
  const k = 2 / (p + 1);
  let e = data.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < data.length; i++) e = data[i] * k + e * (1 - k);
  return e;
}

function calcMACD(closes: number[]) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const series: number[] = [];
  for (let i = Math.max(0, closes.length - 35); i < closes.length; i++) {
    const sub = closes.slice(0, i + 1);
    if (sub.length >= 26) series.push(calcEMA(sub, 12) - calcEMA(sub, 26));
  }
  const m = series[series.length - 1];
  const s = calcEMA(series, 9);
  return { macd: +m.toFixed(4), signal: +s.toFixed(4), histogram: +(m - s).toFixed(4) };
}

function calcBB(closes: number[], p = 20) {
  if (closes.length < p) return { middle: 0, upper: 0, lower: 0 };
  const last = closes.slice(-p);
  const mid = last.reduce((a, b) => a + b, 0) / p;
  const std = Math.sqrt(last.reduce((a, b) => a + (b - mid) ** 2, 0) / p);
  return { middle: +mid.toFixed(2), upper: +(mid + 2 * std).toFixed(2), lower: +(mid - 2 * std).toFixed(2) };
}

function calcATR(highs: number[], lows: number[], closes: number[], p = 14): number {
  if (highs.length < p + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let a = trs.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < trs.length; i++) a = (a * (p - 1) + trs[i]) / p;
  return +a.toFixed(4);
}

function calcStochRSI(closes: number[], rsiP = 14, stochP = 14) {
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
  return { k: +k.toFixed(2), d: +d.toFixed(2) };
}

function detectElliott(closes: number[]): string {
  const W = 10;
  const recent = closes.slice(-40);
  const pivots: { type: 'high' | 'low'; price: number }[] = [];
  for (let i = W; i < recent.length - W; i++) {
    const cur = recent[i];
    const L = recent.slice(i - W, i), R = recent.slice(i + 1, i + W + 1);
    if (cur > Math.max(...L) && cur > Math.max(...R)) pivots.push({ type: 'high', price: cur });
    else if (cur < Math.min(...L) && cur < Math.min(...R)) pivots.push({ type: 'low', price: cur });
  }
  const last = closes[closes.length - 1];
  if (pivots.length >= 3) {
    const [p1, p2, p3] = pivots.slice(-3);
    if (p1.type === 'low' && p2.type === 'high' && p3.type === 'low') {
      if (p3.price > p1.price && last > p2.price) return 'بداية الموجة 3 (انفجارية) 🚀';
      if (p3.price > p1.price && last < p2.price) return 'نهاية الموجة 2 (تصحيح منتهي) ⏳';
    } else if (p1.type === 'high' && p2.type === 'low' && p3.type === 'high') {
      if (p3.price < p1.price && last < p2.price) return 'بداية موجة هابطة 📉';
    }
  } else if (pivots.length >= 2) {
    const [p1, p2] = pivots.slice(-2);
    if (p1.type === 'low' && p2.type === 'high' && last > p2.price) return 'اختراق قمة سابقة ⚡';
  }
  return 'غير محدد';
}

export function computeIndicators(quotes: any[]) {
  const closes = quotes.map(q => q.close as number);
  const highs  = quotes.map(q => (q.high  ?? q.close) as number);
  const lows   = quotes.map(q => (q.low   ?? q.close) as number);
  return {
    rsi:      calcRSI(closes),
    macd:     calcMACD(closes),
    bb:       calcBB(closes),
    atr:      calcATR(highs, lows, closes),
    stochRsi: calcStochRSI(closes),
    wave:     detectElliott(closes),
  };
}

export function buildStockFromQuote(q: any): any {
  const symbol: string = q.symbol;
  const avgVol = q.averageDailyVolume10Day || 0;
  const vol    = q.regularMarketVolume     || 0;
  return {
    symbol,
    companyName: SAUDI_STOCKS[symbol.split('.')[0]] || symbol,
    price:       q.regularMarketPrice        || 0,
    change:      q.regularMarketChangePercent || 0,
    volume:      vol,
    volumeRatio: avgVol > 0 ? vol / avgVol : 1,
    rsi:  50,
    wave: 'غير محدد',
    macd: { macd: 0, signal: 0, histogram: 0 },
    bb:   { middle: 0, upper: 0, lower: 0 },
  };
}

export function buildHistoryFromChart(meta: any, quotes: any[]): any[] {
  const N = 50;
  const start = Math.max(0, quotes.length - N);
  return quotes.slice(start).map((q: any, i: number) => {
    const actual     = start + i;
    const subCloses  = quotes.slice(0, actual + 1).map((sq: any) => sq.close as number);
    const m = calcMACD(subCloses);
    const b = calcBB(subCloses);
    return {
      time:      (q.date as Date).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      fullDate:  q.date,
      price:     +((q.close as number).toFixed(2)),
      macd:      m.macd,
      signal:    m.signal,
      histogram: m.histogram,
      bbUpper:   b.upper,
      bbMiddle:  b.middle,
      bbLower:   b.lower,
    };
  });
}
