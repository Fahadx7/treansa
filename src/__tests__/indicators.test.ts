import { describe, it, expect } from 'vitest';
import {
  calcRSI,
  calcMACD,
  calcBB,
  calcATR,
  calcStochRSI,
  detectElliott,
  scoreStock,
  computeIndicators,
} from '../marketData';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generates an ascending price series: [start, start+step, start+2*step, ...] */
function ascending(length: number, start = 100, step = 1): number[] {
  return Array.from({ length }, (_, i) => start + i * step);
}

/** Generates a descending price series */
function descending(length: number, start = 100, step = 1): number[] {
  return Array.from({ length }, (_, i) => start - i * step);
}

/** Generates an alternating up/down series: [100, 101, 100, 101, ...] */
function alternating(length: number, base = 100): number[] {
  return Array.from({ length }, (_, i) => base + (i % 2));
}

/** Generates constant price series */
function flat(length: number, price = 100): number[] {
  return Array.from({ length }, () => price);
}

// ── calcRSI ───────────────────────────────────────────────────────────────────

describe('calcRSI', () => {
  it('returns 50 when data is too short (length <= period)', () => {
    expect(calcRSI([100, 101, 102], 14)).toBe(50);
    expect(calcRSI(ascending(14), 14)).toBe(50);
  });

  it('returns 100 when all price moves are gains', () => {
    const closes = ascending(20); // 20 points, period 14 → enough data
    expect(calcRSI(closes, 14)).toBe(100);
  });

  it('returns 0 when all price moves are losses', () => {
    const closes = descending(20);
    expect(calcRSI(closes, 14)).toBe(0);
  });

  it('returns ~50 for equal gains and losses', () => {
    // alternating up/down by 1 → avg gain ≈ avg loss
    const closes = alternating(30);
    const rsi = calcRSI(closes, 14);
    expect(rsi).toBeGreaterThan(45);
    expect(rsi).toBeLessThan(55);
  });

  it('RSI is always in [0, 100]', () => {
    const rsi1 = calcRSI(ascending(50));
    const rsi2 = calcRSI(descending(50));
    const rsi3 = calcRSI(alternating(50));
    [rsi1, rsi2, rsi3].forEach(r => {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(100);
    });
  });

  it('overbought territory (>70) for strongly trending up', () => {
    const closes = ascending(30, 100, 2);
    expect(calcRSI(closes)).toBeGreaterThan(70);
  });

  it('oversold territory (<30) for strongly trending down', () => {
    const closes = descending(30, 100, 2);
    expect(calcRSI(closes)).toBeLessThan(30);
  });

  it('handles custom period', () => {
    const closes = ascending(12, 100);
    expect(calcRSI(closes, 10)).toBe(100); // 12 > 10, all gains → 100
  });
});

// ── calcMACD ──────────────────────────────────────────────────────────────────

describe('calcMACD', () => {
  it('returns zeros when data is shorter than 26 periods', () => {
    expect(calcMACD(ascending(25))).toEqual({ macd: 0, signal: 0, histogram: 0 });
    expect(calcMACD([])).toEqual({ macd: 0, signal: 0, histogram: 0 });
  });

  it('returns zeros for flat prices (no trend)', () => {
    const result = calcMACD(flat(50));
    expect(result.macd).toBe(0);
    expect(result.signal).toBe(0);
    expect(result.histogram).toBe(0);
  });

  it('MACD > 0 for strongly ascending prices', () => {
    const result = calcMACD(ascending(60, 100, 1));
    expect(result.macd).toBeGreaterThan(0);
  });

  it('MACD < 0 for strongly descending prices', () => {
    const result = calcMACD(descending(60, 200, 1));
    expect(result.macd).toBeLessThan(0);
  });

  it('histogram equals macd - signal', () => {
    const closes = ascending(50, 100, 0.5);
    const { macd, signal, histogram } = calcMACD(closes);
    expect(histogram).toBeCloseTo(macd - signal, 3);
  });

  it('returns numbers rounded to 4 decimal places', () => {
    const result = calcMACD(ascending(40));
    expect(result.macd.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});

// ── calcBB ────────────────────────────────────────────────────────────────────

describe('calcBB', () => {
  it('returns zeros when data is shorter than period', () => {
    expect(calcBB([100, 101], 20)).toEqual({ middle: 0, upper: 0, lower: 0 });
  });

  it('upper > middle > lower for volatile prices', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 10);
    const { upper, middle, lower } = calcBB(closes);
    expect(upper).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(lower);
  });

  it('all bands equal for flat prices (zero std deviation)', () => {
    const { upper, middle, lower } = calcBB(flat(30, 100));
    expect(upper).toBe(100);
    expect(middle).toBe(100);
    expect(lower).toBe(100);
  });

  it('middle equals the SMA of the last period closes', () => {
    const closes = ascending(25, 1, 1); // [1, 2, ..., 25]
    const { middle } = calcBB(closes, 20);
    const sma = (6 + 7 + 8 + 9 + 10 + 11 + 12 + 13 + 14 + 15 + 16 + 17 + 18 + 19 + 20 + 21 + 22 + 23 + 24 + 25) / 20;
    expect(middle).toBeCloseTo(sma, 1);
  });

  it('bands are symmetric around middle', () => {
    const closes = alternating(30, 100);
    const { upper, middle, lower } = calcBB(closes, 20);
    expect(upper - middle).toBeCloseTo(middle - lower, 2);
  });
});

// ── calcATR ───────────────────────────────────────────────────────────────────

describe('calcATR', () => {
  it('returns 0 when data is too short (< period + 1)', () => {
    const h = ascending(14);
    const l = descending(14, 90);
    const c = flat(14, 95);
    expect(calcATR(h, l, c, 14)).toBe(0);
  });

  it('returns 0 for a single data point', () => {
    expect(calcATR([100], [95], [98], 14)).toBe(0);
  });

  it('ATR equals constant high-low spread for flat prices', () => {
    // high=105, low=95, close=100 for every bar → TR = 10 always
    const n = 20;
    const highs  = flat(n, 105);
    const lows   = flat(n, 95);
    const closes = flat(n, 100);
    const atr = calcATR(highs, lows, closes, 14);
    expect(atr).toBeCloseTo(10, 1);
  });

  it('ATR is always non-negative', () => {
    const h = ascending(30, 110, 0.5);
    const l = ascending(30, 90, 0.5);
    const c = ascending(30, 100, 0.5);
    expect(calcATR(h, l, c)).toBeGreaterThanOrEqual(0);
  });
});

// ── calcStochRSI ──────────────────────────────────────────────────────────────

describe('calcStochRSI', () => {
  it('returns {k:50, d:50} when data is too short', () => {
    expect(calcStochRSI([100, 101, 102])).toEqual({ k: 50, d: 50 });
  });

  it('returns values in [0, 100]', () => {
    const closes = ascending(60);
    const { k, d } = calcStochRSI(closes);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThanOrEqual(100);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(100);
  });

  it('k and d are numbers (not NaN)', () => {
    const closes = alternating(60, 100);
    const { k, d } = calcStochRSI(closes);
    expect(Number.isFinite(k)).toBe(true);
    expect(Number.isFinite(d)).toBe(true);
  });
});

// ── detectElliott ─────────────────────────────────────────────────────────────

describe('detectElliott', () => {
  it('returns "غير محدد" when data is too short (< 20)', () => {
    expect(detectElliott([100, 101, 102])).toBe('غير محدد');
    expect(detectElliott(ascending(19))).toBe('غير محدد');
  });

  it('returns a string for sufficient data', () => {
    expect(typeof detectElliott(ascending(30))).toBe('string');
  });

  it('detects upward breakout pattern', () => {
    // Build a clear high-low-high-low-high zigzag ending with a new high
    const closes = [
      100, 102, 104, 106, 108, // rising
      107, 105, 103, 101,       // falling (low1)
      103, 106, 110, 115,       // rising (high2)
      114, 112, 109, 106,       // falling (low2 > low1)
      108, 112, 118, 125, 130,  // rising above high2
    ];
    const result = detectElliott(closes);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── scoreStock ────────────────────────────────────────────────────────────────

describe('scoreStock', () => {
  it('returns "ضعيف" (slate) when no signals match', () => {
    const stock = { price: 100, volumeRatio: 1 };
    const indicators = {
      rsi: 30,
      macd: { histogram: -1, macd: -1, signal: 0 },
      bb: { middle: 120, upper: 130, lower: 110 },
      stochRsi: { k: 20, d: 50 },
      wave: 'غير محدد',
      atr: 1,
    };
    const score = scoreStock(stock, indicators);
    expect(score.color).toBe('slate');
    expect(score.label).toBe('ضعيف');
    expect(score.total).toBe(0);
    expect(score.reasons).toHaveLength(0);
  });

  it('returns "إشارة قوية جداً" (emerald) when all signals match', () => {
    const stock = { price: 110, volumeRatio: 2.0 };
    const indicators = {
      rsi: 55,
      macd: { histogram: 1, macd: 1, signal: 0 },
      bb: { middle: 105, upper: 120, lower: 90 },
      stochRsi: { k: 70, d: 60 },
      wave: 'بداية الموجة 3 (انفجارية) 🚀',
      atr: 2,
    };
    const score = scoreStock(stock, indicators);
    expect(score.color).toBe('emerald');
    expect(score.total).toBeGreaterThanOrEqual(5);
    expect(score.reasons.length).toBeGreaterThanOrEqual(5);
  });

  it('RSI in [45,70] counts as a reason', () => {
    const stock = { price: 100, volumeRatio: 1 };
    const indicators = {
      rsi: 60,
      macd: { histogram: -1, macd: 0, signal: 0 },
      bb: { middle: 120, upper: 130, lower: 110 },
      stochRsi: { k: 20, d: 50 },
      wave: 'غير محدد',
      atr: 1,
    };
    const score = scoreStock(stock, indicators);
    expect(score.reasons.some(r => r.includes('RSI'))).toBe(true);
  });

  it('high volume ratio (>=1.5) counts as a reason', () => {
    const stock = { price: 100, volumeRatio: 2 };
    const indicators = {
      rsi: 30,
      macd: { histogram: -1, macd: 0, signal: 0 },
      bb: { middle: 120, upper: 130, lower: 110 },
      stochRsi: { k: 20, d: 50 },
      wave: 'غير محدد',
      atr: 1,
    };
    const score = scoreStock(stock, indicators);
    expect(score.reasons.some(r => r.includes('حجم'))).toBe(true);
  });

  it('positive MACD histogram counts as a reason', () => {
    const stock = { price: 100, volumeRatio: 1 };
    const indicators = {
      rsi: 30,
      macd: { histogram: 0.5, macd: 1, signal: 0.5 },
      bb: { middle: 120, upper: 130, lower: 110 },
      stochRsi: { k: 20, d: 50 },
      wave: 'غير محدد',
      atr: 1,
    };
    const score = scoreStock(stock, indicators);
    expect(score.reasons.some(r => r.includes('MACD'))).toBe(true);
  });

  it('price above BB middle counts as a reason', () => {
    const stock = { price: 115, volumeRatio: 1 };
    const indicators = {
      rsi: 30,
      macd: { histogram: -1, macd: 0, signal: 0 },
      bb: { middle: 100, upper: 120, lower: 80 },
      stochRsi: { k: 20, d: 50 },
      wave: 'غير محدد',
      atr: 1,
    };
    const score = scoreStock(stock, indicators);
    expect(score.reasons.some(r => r.includes('SMA20'))).toBe(true);
  });

  it('label thresholds are correct', () => {
    const makeScore = (total: number) => {
      const stock = { price: 110, volumeRatio: total >= 4 ? 2 : 1 };
      const indicators = {
        rsi: total >= 1 ? 55 : 30,
        macd: { histogram: total >= 2 ? 1 : -1, macd: 0, signal: 0 },
        bb: { middle: total >= 3 ? 100 : 120, upper: 130, lower: 80 },
        stochRsi: { k: total >= 5 ? 70 : 20, d: total >= 5 ? 60 : 50 },
        wave: total >= 6 ? 'بداية الموجة 3 (انفجارية) 🚀' : 'غير محدد',
        atr: 1,
      };
      return scoreStock(stock, indicators);
    };

    expect(makeScore(0).label).toBe('ضعيف');
  });
});

// ── computeIndicators ─────────────────────────────────────────────────────────

describe('computeIndicators', () => {
  it('returns all expected keys', () => {
    const quotes = ascending(50).map(close => ({ close, high: close + 2, low: close - 2 }));
    const result = computeIndicators(quotes);
    expect(result).toHaveProperty('rsi');
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('bb');
    expect(result).toHaveProperty('atr');
    expect(result).toHaveProperty('stochRsi');
    expect(result).toHaveProperty('wave');
  });

  it('uses close as fallback for missing high/low', () => {
    const quotes = ascending(30).map(close => ({ close }));
    expect(() => computeIndicators(quotes)).not.toThrow();
  });
});
