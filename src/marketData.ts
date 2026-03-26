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

function loadChartCache(symbol: string): { meta: any; quotes: any[] } | null {
  try {
    const raw = localStorage.getItem(CHART_CACHE_PFX + symbol);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Date.now() - p.savedAt > CHART_CACHE_TTL) return null;
    return { meta: p.meta, quotes: p.quotes.map((q: any) => ({ ...q, date: new Date(q.date) })) };
  } catch { return null; }
}

function saveChartCache(symbol: string, meta: any, quotes: any[]): void {
  try {
    const s = quotes.map(q => ({ ...q, date: (q.date as Date).toISOString() }));
    localStorage.setItem(CHART_CACHE_PFX + symbol, JSON.stringify({ meta, quotes: s, savedAt: Date.now() }));
  } catch { /* ignore */ }
}

// ---- All Yahoo Finance calls go through Netlify (server-side, no CORS) ----

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
  const cached = loadChartCache(symbol);
  if (cached) return cached;

  const res = await fetch(`/api/chart/${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`Chart API: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'فشل جلب بيانات الرسم البياني');
  const quotes = (data.quotes as any[]).map(q => ({ ...q, date: new Date(q.date) }));
  saveChartCache(symbol, data.meta, quotes);
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

// O(n) MACD — single forward pass, no O(n²) EMA rebuilding
export function calcMACD(closes: number[]) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;

  // Seed with SMA
  let ema12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let ema26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;

  // Advance ema12 from bar 12 → 25
  for (let i = 12; i < 26; i++) ema12 = closes[i] * k12 + ema12 * (1 - k12);

  // Build MACD series bar 26 → end
  const ms: number[] = [];
  for (let i = 26; i < closes.length; i++) {
    ema12 = closes[i] * k12 + ema12 * (1 - k12);
    ema26 = closes[i] * k26 + ema26 * (1 - k26);
    ms.push(ema12 - ema26);
  }
  if (!ms.length) return { macd: 0, signal: 0, histogram: 0 };

  // Signal = EMA9 of MACD series
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
  return { k: +k.toFixed(2), d: +d.toFixed(2) };
}

// ---- Improved Elliott Wave ----
// Uses 60-bar lookback + W=5 pivot window for finer detection
// Stores idx for filtering out consecutive pivots of same type
export function detectElliott(closes: number[]): string {
  if (closes.length < 20) return 'غير محدد';
  const W      = 5;
  const recent = closes.slice(-60);
  const pivots: { type: 'high' | 'low'; price: number }[] = [];

  for (let i = W; i < recent.length - W; i++) {
    const cur = recent[i];
    const L   = recent.slice(i - W, i);
    const R   = recent.slice(i + 1, i + W + 1);
    if (cur > Math.max(...L) && cur > Math.max(...R))
      pivots.push({ type: 'high', price: cur });
    else if (cur < Math.min(...L) && cur < Math.min(...R))
      pivots.push({ type: 'low', price: cur });
  }

  const last = recent[recent.length - 1];

  // 4-pivot patterns (more reliable)
  if (pivots.length >= 4) {
    const [p1, p2, p3, p4] = pivots.slice(-4);
    // Low→High→Higher Low→Higher High + price above p4 = Wave 3
    if (p1.type === 'low' && p2.type === 'high' && p3.type === 'low' && p4.type === 'high') {
      if (p3.price > p1.price && p4.price > p2.price && last > p4.price)
        return 'بداية الموجة 3 (انفجارية) 🚀';
    }
    // High→Low→Lower High→Lower Low + price below p4 = Bearish wave
    if (p1.type === 'high' && p2.type === 'low' && p3.type === 'high' && p4.type === 'low') {
      if (p3.price < p1.price && p4.price < p2.price && last < p4.price)
        return 'بداية موجة هابطة 📉';
    }
  }

  // 3-pivot patterns
  if (pivots.length >= 3) {
    const [p1, p2, p3] = pivots.slice(-3);
    if (p1.type === 'low' && p2.type === 'high' && p3.type === 'low') {
      if (p3.price > p1.price && last > p2.price)  return 'بداية الموجة 3 (انفجارية) 🚀';
      if (p3.price > p1.price && last > p3.price)  return 'نهاية الموجة 2 (تصحيح منتهي) ⏳';
      if (p3.price < p1.price)                     return 'قاع أدنى — تصحيح ABC ⚠️';
    }
    if (p1.type === 'high' && p2.type === 'low' && p3.type === 'high') {
      if (p3.price < p1.price && last < p2.price)  return 'بداية موجة هابطة 📉';
      if (p3.price > p1.price && last > p3.price)  return 'اختراق قمة سابقة ⚡';
    }
  }

  // 2-pivot patterns
  if (pivots.length >= 2) {
    const [p1, p2] = pivots.slice(-2);
    if (p1.type === 'low'  && p2.type === 'high' && last > p2.price) return 'اختراق قمة سابقة ⚡';
    if (p1.type === 'high' && p2.type === 'low'  && last < p2.price) return 'كسر قاع سابق 📉';
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

// ---- Confluence Scoring (0–6) ----
// Philosophy: صيد الأسهم بالتقاطع — لا نثق بمؤشر واحد،
// نحتاج 3+ مؤشرات متوافقة لإعطاء الإشارة قيمة.
// مصادر: Larry Connors (RSI2), تداول اليابانيين (Ichimoku confluence),
//         نظرية داو (حجم + سعر), تحليل موجات إليوت.

export interface StockScore {
  total: number;
  label: string;
  color: 'emerald' | 'amber' | 'blue' | 'slate';
  reasons: string[];
}

export function scoreStock(
  stock: any,
  indicators?: ReturnType<typeof computeIndicators>,
): StockScore {
  const reasons: string[] = [];

  const rsi         = indicators?.rsi         ?? stock.rsi         ?? 50;
  const macd        = indicators?.macd        ?? stock.macd;
  const bb          = indicators?.bb          ?? stock.bb;
  const stochRsi    = indicators?.stochRsi    ?? stock.stochRsi;
  const wave        = indicators?.wave        ?? stock.wave        ?? 'غير محدد';
  const volumeRatio = stock.volumeRatio ?? 1;
  const price       = stock.price       ?? 0;

  // 1. RSI زخم صعودي (45–70) — لم يتشبع بعد
  if (rsi >= 45 && rsi <= 70)
    reasons.push(`RSI ${rsi.toFixed(0)} في منطقة الزخم`);

  // 2. MACD هيستوجرام إيجابي
  if (macd?.histogram > 0)
    reasons.push('MACD هيستوجرام إيجابي');

  // 3. السعر فوق خط البولنجر الوسطى (SMA20)
  if (bb?.middle > 0 && price > bb.middle)
    reasons.push('السعر فوق SMA20');

  // 4. حجم تداول مرتفع (سيولة ذكية)
  if (volumeRatio >= 1.5)
    reasons.push(`حجم ${volumeRatio.toFixed(1)}x المتوسط`);

  // 5. StochRSI تقاطع صعودي وليس في منطقة تشبع
  if (stochRsi && stochRsi.k > stochRsi.d && stochRsi.k < 80)
    reasons.push('StochRSI تقاطع صعودي');

  // 6. نمط موجات إليوت صعودي
  if (wave && wave !== 'غير محدد' &&
      (wave.includes('🚀') || wave.includes('⚡') || wave.includes('⏳')))
    reasons.push(wave.replace(/[🚀⚡⏳📉⚠️]/g, '').trim());

  const total = reasons.length;
  let label: string;
  let color: StockScore['color'];

  if      (total >= 5) { label = 'إشارة قوية جداً'; color = 'emerald'; }
  else if (total >= 4) { label = 'إشارة قوية';      color = 'emerald'; }
  else if (total >= 3) { label = 'إشارة متوسطة';    color = 'amber';   }
  else if (total >= 2) { label = 'مراقبة';           color = 'blue';    }
  else                 { label = 'ضعيف';             color = 'slate';   }

  return { total, label, color, reasons };
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

// ---- Background chart enrichment ----
// Fetches real OHLCV data for the top-N stocks by volume ratio and
// computes RSI, MACD, BB, ATR, StochRSI, Elliott Wave in-place.
// Calls onBatchDone after each parallel batch so the UI updates progressively.
const ENRICH_TOP_N  = 20;
const ENRICH_BATCH  = 5;

export async function enrichStocksWithChartData(
  stocks: any[],
  onBatchDone: (updated: any[]) => void,
): Promise<void> {
  const enriched = [...stocks];
  const candidates = [...stocks]
    .sort((a, b) => b.volumeRatio - a.volumeRatio)
    .slice(0, ENRICH_TOP_N);

  for (let i = 0; i < candidates.length; i += ENRICH_BATCH) {
    const batch = candidates.slice(i, i + ENRICH_BATCH);
    const results = await Promise.allSettled(
      batch.map(s => fetchChart(s.symbol, '1h', '30d')),
    );
    let changed = false;
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status !== 'fulfilled' || r.value.quotes.length < 20) continue;
      const ind = computeIndicators(r.value.quotes);
      const idx = enriched.findIndex(s => s.symbol === batch[j].symbol);
      if (idx === -1) continue;
      enriched[idx] = {
        ...enriched[idx],
        rsi:      ind.rsi,
        macd:     ind.macd,
        bb:       ind.bb,
        atr:      ind.atr,
        stochRsi: ind.stochRsi,
        wave:     ind.wave,
      };
      changed = true;
    }
    if (changed) onBatchDone([...enriched]);
  }
}

export function buildHistoryFromChart(meta: any, quotes: any[]): any[] {
  const N          = 50;
  const start      = Math.max(0, quotes.length - N);
  const allCloses  = quotes.map((q: any) => q.close as number);

  return quotes.slice(start).map((q: any, i: number) => {
    const actual    = start + i;
    const subCloses = allCloses.slice(0, actual + 1);
    const m = calcMACD(subCloses);
    const b = calcBB(subCloses);
    return {
      time:      new Date(q.date).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
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
