import { describe, it, expect } from 'vitest';
import {
  getAllSymbols,
  buildStockFromQuote,
  buildHistoryFromChart,
} from '../marketData';

// ── getAllSymbols ─────────────────────────────────────────────────────────────

describe('getAllSymbols', () => {
  it('returns an array of strings', () => {
    const symbols = getAllSymbols();
    expect(Array.isArray(symbols)).toBe(true);
    expect(symbols.length).toBeGreaterThan(0);
  });

  it('every symbol ends with .SR', () => {
    getAllSymbols().forEach(s => {
      expect(s.endsWith('.SR')).toBe(true);
    });
  });

  it('contains well-known Saudi symbols', () => {
    const symbols = getAllSymbols();
    expect(symbols).toContain('2222.SR'); // أرامكو
    expect(symbols).toContain('1120.SR'); // مصرف الراجحي
    expect(symbols).toContain('7010.SR'); // stc
  });

  it('contains no duplicates', () => {
    const symbols = getAllSymbols();
    const unique = new Set(symbols);
    expect(unique.size).toBe(symbols.length);
  });
});

// ── buildStockFromQuote ───────────────────────────────────────────────────────

describe('buildStockFromQuote', () => {
  const fullQuote = {
    symbol: '2222.SR',
    regularMarketPrice: 28.5,
    regularMarketChangePercent: 1.2,
    regularMarketVolume: 5_000_000,
    averageDailyVolume10Day: 2_000_000,
  };

  it('maps basic price fields correctly', () => {
    const stock = buildStockFromQuote(fullQuote);
    expect(stock.symbol).toBe('2222.SR');
    expect(stock.price).toBe(28.5);
    expect(stock.change).toBe(1.2);
    expect(stock.volume).toBe(5_000_000);
  });

  it('resolves Arabic company name from SAUDI_STOCKS', () => {
    const stock = buildStockFromQuote(fullQuote);
    expect(stock.companyName).toBe('أرامكو السعودية');
  });

  it('falls back to symbol when company not found', () => {
    const stock = buildStockFromQuote({ ...fullQuote, symbol: '9999.SR' });
    expect(stock.companyName).toBe('9999.SR');
  });

  it('calculates volumeRatio correctly', () => {
    const stock = buildStockFromQuote(fullQuote);
    expect(stock.volumeRatio).toBeCloseTo(2.5, 5); // 5_000_000 / 2_000_000
  });

  it('sets volumeRatio to 1 when average volume is 0 (division guard)', () => {
    const stock = buildStockFromQuote({ ...fullQuote, averageDailyVolume10Day: 0 });
    expect(stock.volumeRatio).toBe(1);
  });

  it('defaults price to 0 when missing', () => {
    const stock = buildStockFromQuote({ symbol: '1120.SR' });
    expect(stock.price).toBe(0);
  });

  it('initialises indicator placeholders with safe defaults', () => {
    const stock = buildStockFromQuote(fullQuote);
    expect(stock.rsi).toBe(50);
    expect(stock.wave).toBe('غير محدد');
    expect(stock.macd).toEqual({ macd: 0, signal: 0, histogram: 0 });
    expect(stock.bb).toEqual({ middle: 0, upper: 0, lower: 0 });
  });
});

// ── buildHistoryFromChart ─────────────────────────────────────────────────────

describe('buildHistoryFromChart', () => {
  const makeQuotes = (n: number, startPrice = 100) =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(2026, 0, i + 1).toISOString(),
      close: startPrice + i,
      high: startPrice + i + 2,
      low: startPrice + i - 2,
      volume: 1_000_000,
    }));

  it('returns an array with the same number of valid quotes', () => {
    const quotes = makeQuotes(30);
    const history = buildHistoryFromChart({}, quotes, '1mo');
    expect(history.length).toBe(30);
  });

  it('filters out quotes with null or zero close price', () => {
    const quotes = [
      ...makeQuotes(5),
      { date: new Date().toISOString(), close: null, high: 110, low: 90, volume: 0 },
      { date: new Date().toISOString(), close: 0, high: 100, low: 95, volume: 0 },
    ];
    const history = buildHistoryFromChart({}, quotes as any, '1mo');
    expect(history.length).toBe(5);
  });

  it('each entry has required chart fields', () => {
    const history = buildHistoryFromChart({}, makeQuotes(30), '1mo');
    const entry = history[0];
    expect(entry).toHaveProperty('time');
    expect(entry).toHaveProperty('fullDate');
    expect(entry).toHaveProperty('price');
    expect(entry).toHaveProperty('macd');
    expect(entry).toHaveProperty('signal');
    expect(entry).toHaveProperty('histogram');
    expect(entry).toHaveProperty('bbUpper');
    expect(entry).toHaveProperty('bbMiddle');
    expect(entry).toHaveProperty('bbLower');
  });

  it('prices are rounded to 2 decimal places', () => {
    const quotes = makeQuotes(30, 100.123456);
    const history = buildHistoryFromChart({}, quotes, '1mo');
    history.forEach(entry => {
      const decimals = entry.price.toString().split('.')[1]?.length ?? 0;
      expect(decimals).toBeLessThanOrEqual(2);
    });
  });

  it('returns empty array for empty quotes', () => {
    const history = buildHistoryFromChart({}, [], '1mo');
    expect(history).toEqual([]);
  });

  it('sorts quotes chronologically (oldest first)', () => {
    // Provide quotes in reverse order
    const quotes = makeQuotes(10).reverse();
    const history = buildHistoryFromChart({}, quotes, '1mo');
    for (let i = 1; i < history.length; i++) {
      const prev = new Date(history[i - 1].fullDate).getTime();
      const curr = new Date(history[i].fullDate).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it('time label format differs by range', () => {
    const quotes = makeQuotes(30);
    const intraday = buildHistoryFromChart({}, quotes, '1d');
    const monthly  = buildHistoryFromChart({}, quotes, '1mo');
    // '1d' format is HH:MM, '1mo' is DD/MM
    expect(intraday[0].time).toMatch(/^\d{2}:\d{2}$/);
    expect(monthly[0].time).toMatch(/^\d{2}\/\d{2}$/);
  });
});
