import { describe, it, expect, vi } from 'vitest';
import {
  loadCache,
  saveCache,
  loadLastKnownTasi,
  saveLastKnownTasi,
  getAllSymbols,
  calcRSI,
  calcMACD,
  calcBB,
  calcATR,
  calcStochRSI,
  buildHistoryFromChart,
  scoreStock,
  type TASIData,
  type ChartRange,
} from '../marketData';

// ─── Cache helpers ──────────────────────────────────────────────────────────

describe('loadCache / saveCache', () => {
  it('returns null when localStorage is empty', () => {
    expect(loadCache()).toBeNull();
  });

  it('round-trips stocks and marketIndex', () => {
    const stocks = [{ symbol: '2222.SR', price: 28.5 }];
    const idx    = { price: 11285, change: 12 };
    saveCache(stocks, idx);
    const cached = loadCache();
    expect(cached?.stocks).toEqual(stocks);
    expect(cached?.marketIndex).toEqual(idx);
  });

  it('returns null after TTL expires', () => {
    saveCache([{ symbol: '2222.SR', price: 28 }], {});
    const raw = JSON.parse(localStorage.getItem('market_data_cache')!);
    raw.savedAt = Date.now() - 6 * 60 * 1000; // 6 min ago
    localStorage.setItem('market_data_cache', JSON.stringify(raw));
    expect(loadCache()).toBeNull();
  });

  it('handles corrupted JSON gracefully', () => {
    localStorage.setItem('market_data_cache', 'NOT_JSON');
    expect(loadCache()).toBeNull();
  });
});

// ─── TASI persistence ───────────────────────────────────────────────────────

describe('saveLastKnownTasi / loadLastKnownTasi', () => {
  const sample: TASIData = {
    price: 11285.73, change: 12.5, changePercent: 0.11,
    high: 11310, low: 11260, volume: 4200000, time: '14:30',
  };

  it('returns null when nothing saved', () => {
    expect(loadLastKnownTasi()).toBeNull();
  });

  it('round-trips TASIData', () => {
    saveLastKnownTasi(sample);
    const loaded = loadLastKnownTasi();
    expect(loaded?.price).toBe(sample.price);
    expect(loaded?.changePercent).toBe(sample.changePercent);
  });

  it('returns null after TTL expires (respects TTL)', () => {
    saveLastKnownTasi(sample);
    const raw = JSON.parse(localStorage.getItem('tasi_last_known')!);
    raw.savedAt = Date.now() - 61 * 60 * 1000; // 61 min ago
    localStorage.setItem('tasi_last_known', JSON.stringify(raw));
    expect(loadLastKnownTasi()).toBeNull();
  });

  it('returns stale data when ignoreTTL=true', () => {
    saveLastKnownTasi(sample);
    const raw = JSON.parse(localStorage.getItem('tasi_last_known')!);
    raw.savedAt = Date.now() - 61 * 60 * 1000;
    localStorage.setItem('tasi_last_known', JSON.stringify(raw));
    expect(loadLastKnownTasi(true)?.price).toBe(sample.price);
  });
});

// ─── getAllSymbols ──────────────────────────────────────────────────────────

describe('getAllSymbols', () => {
  it('returns an array of strings', () => {
    const syms = getAllSymbols();
    expect(Array.isArray(syms)).toBe(true);
    expect(syms.length).toBeGreaterThan(0);
  });

  it('every symbol ends with .SR', () => {
    getAllSymbols().forEach(s => expect(s).toMatch(/\.SR$/));
  });
});

// ─── Technical indicators ───────────────────────────────────────────────────

describe('calcRSI', () => {
  const upTrend   = Array.from({ length: 30 }, (_, i) => 100 + i);       // steadily rising
  const downTrend = Array.from({ length: 30 }, (_, i) => 130 - i);       // steadily falling
  const flat      = Array.from({ length: 30 }, () => 100);

  it('returns 50 for insufficient data', () => {
    expect(calcRSI([100, 101, 102], 14)).toBe(50);
  });

  it('returns ~100 for a strong uptrend', () => {
    expect(calcRSI(upTrend)).toBeGreaterThan(85);
  });

  it('returns ~0 for a strong downtrend', () => {
    expect(calcRSI(downTrend)).toBeLessThan(15);
  });

  it('returns 100 for flat prices (no losses)', () => {
    // flat has no losses → al = 0 → returns 100
    expect(calcRSI(flat)).toBe(100);
  });

  it('result is always in [0, 100]', () => {
    const random = Array.from({ length: 50 }, () => Math.random() * 200);
    const rsi = calcRSI(random);
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });
});

describe('calcMACD', () => {
  it('returns zeros for insufficient data', () => {
    expect(calcMACD([100, 101])).toEqual({ macd: 0, signal: 0, histogram: 0 });
  });

  it('returns an object with macd, signal, histogram', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const result = calcMACD(prices);
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('histogram');
  });

  it('histogram = macd - signal', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
    const { macd, signal, histogram } = calcMACD(prices);
    expect(histogram).toBeCloseTo(macd - signal, 3);
  });
});

describe('calcBB (Bollinger Bands)', () => {
  it('returns zeros for insufficient data', () => {
    expect(calcBB([100, 101], 20)).toEqual({ middle: 0, upper: 0, lower: 0 });
  });

  it('upper > middle > lower', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
    const { upper, middle, lower } = calcBB(prices);
    expect(upper).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(lower);
  });

  it('flat series has identical upper and lower (std=0)', () => {
    const flat = Array.from({ length: 25 }, () => 100);
    const { upper, lower, middle } = calcBB(flat);
    expect(upper).toBe(middle);
    expect(lower).toBe(middle);
  });
});

describe('calcATR', () => {
  it('returns 0 for insufficient data', () => {
    expect(calcATR([101], [99], [100], 14)).toBe(0);
  });

  it('returns a positive number for normal OHLC data', () => {
    const n = 20;
    const highs  = Array.from({ length: n }, (_, i) => 105 + i);
    const lows   = Array.from({ length: n }, (_, i) => 95 + i);
    const closes = Array.from({ length: n }, (_, i) => 100 + i);
    expect(calcATR(highs, lows, closes)).toBeGreaterThan(0);
  });
});

describe('calcStochRSI', () => {
  it('returns {k:50, d:50} for insufficient data', () => {
    expect(calcStochRSI([100, 101, 102])).toEqual({ k: 50, d: 50 });
  });

  it('k and d are in [0, 100]', () => {
    const prices = Array.from({ length: 60 }, () => 100 + Math.random() * 20 - 10);
    const { k, d } = calcStochRSI(prices);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThanOrEqual(100);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(100);
  });
});

// ─── buildHistoryFromChart ──────────────────────────────────────────────────

describe('buildHistoryFromChart', () => {
  const makeQuotes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.now() - (n - 1 - i) * 86400000).toISOString(),
      open: 100 + i, high: 110 + i, low: 95 + i, close: 105 + i, volume: 1000,
    }));

  it('returns an array of chart points', () => {
    const result = buildHistoryFromChart({}, makeQuotes(30), '1mo');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('each point has time and price', () => {
    const result = buildHistoryFromChart({}, makeQuotes(30), '1mo');
    result.forEach(pt => {
      expect(pt).toHaveProperty('time');
      expect(pt).toHaveProperty('price');
      expect(typeof pt.price).toBe('number');
    });
  });

  it('returns empty array for empty quotes', () => {
    expect(buildHistoryFromChart({}, [], '1mo')).toHaveLength(0);
  });
});

// ─── scoreStock ────────────────────────────────────────────────────────────

describe('scoreStock', () => {
  // scoreStock(stock, indicators?) — stock is a plain object, not quotes[]
  const baseStock = { rsi: 55, volumeRatio: 2.0, price: 105 };
  const indicators = {
    rsi: 55,
    macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
    bb: { middle: 100, upper: 110, lower: 90 },
    stochRsi: { k: 60, d: 55 },
    wave: '⚡ موجة صاعدة',
  };

  it('returns an object with total, label, color, reasons', () => {
    const result = scoreStock(baseStock, indicators);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('color');
    expect(result).toHaveProperty('reasons');
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it('total is a non-negative integer', () => {
    const { total } = scoreStock(baseStock, indicators);
    expect(typeof total).toBe('number');
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('scores higher when more signals match', () => {
    const weak   = scoreStock({ rsi: 20, volumeRatio: 0.5, price: 80 });
    const strong = scoreStock(baseStock, indicators);
    expect(strong.total).toBeGreaterThan(weak.total);
  });

  it('handles empty stock without throwing', () => {
    expect(() => scoreStock({})).not.toThrow();
  });

  it('color is one of the expected values', () => {
    const { color } = scoreStock(baseStock, indicators);
    expect(['emerald', 'amber', 'blue', 'slate']).toContain(color);
  });
});
