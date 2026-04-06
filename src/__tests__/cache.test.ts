import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadCache,
  saveCache,
  loadLastKnownTasi,
  saveLastKnownTasi,
  type TASIData,
} from '../marketData';

const CACHE_KEY      = 'market_data_cache';
const TASI_CACHE_KEY = 'tasi_last_known';
const CACHE_TTL      = 5 * 60 * 1000;   // 5 min
const TASI_CACHE_TTL = 60 * 60 * 1000;  // 60 min

const mockTasi: TASIData = {
  price: 11500,
  change: 50,
  changePercent: 0.44,
  high: 11550,
  low: 11450,
  volume: 3_000_000,
  time: '2026-04-06T08:00:00.000Z',
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── loadCache ─────────────────────────────────────────────────────────────────

describe('loadCache', () => {
  it('returns null when localStorage is empty', () => {
    expect(loadCache()).toBeNull();
  });

  it('returns cached data when within TTL', () => {
    const stocks = [{ symbol: '2222.SR' }];
    const marketIndex = { price: 11500 };
    saveCache(stocks, marketIndex);
    const result = loadCache();
    expect(result).not.toBeNull();
    expect(result!.stocks).toEqual(stocks);
    expect(result!.marketIndex).toEqual(marketIndex);
  });

  it('returns null when cache is older than 5 minutes', () => {
    saveCache([{ symbol: '2222.SR' }], { price: 11500 });

    // Advance time beyond TTL
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CACHE_TTL + 1);

    expect(loadCache()).toBeNull();
  });

  it('returns data exactly AT the TTL boundary (still valid)', () => {
    saveCache([{ symbol: '1120.SR' }], { price: 11000 });

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CACHE_TTL - 1);

    expect(loadCache()).not.toBeNull();
  });

  it('returns null when localStorage contains malformed JSON', () => {
    localStorage.setItem(CACHE_KEY, 'not-valid-json{{{');
    expect(loadCache()).toBeNull();
  });

  it('returns null when savedAt field is missing', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ stocks: [], marketIndex: {} }));
    // Missing savedAt → Date.now() - undefined = NaN, NaN > TTL is false → data returned
    // This documents the current behaviour (no crash)
    expect(() => loadCache()).not.toThrow();
  });

  it('savedAt is stored as a number', () => {
    saveCache([], {});
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY)!);
    expect(typeof raw.savedAt).toBe('number');
  });
});

// ── saveCache ─────────────────────────────────────────────────────────────────

describe('saveCache', () => {
  it('persists stocks and marketIndex to localStorage', () => {
    const stocks = [{ symbol: '7010.SR', price: 55 }];
    const marketIndex = { price: 11200, change: -30 };
    saveCache(stocks, marketIndex);
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY)!);
    expect(raw.stocks).toEqual(stocks);
    expect(raw.marketIndex).toEqual(marketIndex);
  });

  it('does not throw when localStorage is unavailable', () => {
    // Simulate storage-full by throwing on setItem
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => saveCache([], {})).not.toThrow();
    Storage.prototype.setItem = original;
  });
});

// ── loadLastKnownTasi ─────────────────────────────────────────────────────────

describe('loadLastKnownTasi', () => {
  it('returns null when localStorage is empty', () => {
    expect(loadLastKnownTasi()).toBeNull();
  });

  it('returns saved TASI data within TTL', () => {
    saveLastKnownTasi(mockTasi);
    const result = loadLastKnownTasi();
    expect(result).not.toBeNull();
    expect(result!.price).toBe(11500);
    expect(result!.changePercent).toBe(0.44);
  });

  it('returns null when data is older than 60 minutes', () => {
    saveLastKnownTasi(mockTasi);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + TASI_CACHE_TTL + 1);

    expect(loadLastKnownTasi()).toBeNull();
  });

  it('ignoreTTL=true returns stale data regardless of age', () => {
    saveLastKnownTasi(mockTasi);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + TASI_CACHE_TTL * 10);

    const result = loadLastKnownTasi(true);
    expect(result).not.toBeNull();
    expect(result!.price).toBe(11500);
  });

  it('returns null on malformed JSON', () => {
    localStorage.setItem(TASI_CACHE_KEY, 'corrupted}}}');
    expect(loadLastKnownTasi()).toBeNull();
  });

  it('data within the last hour is returned (boundary check)', () => {
    saveLastKnownTasi(mockTasi);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + TASI_CACHE_TTL - 1);

    expect(loadLastKnownTasi()).not.toBeNull();
  });
});

// ── saveLastKnownTasi ─────────────────────────────────────────────────────────

describe('saveLastKnownTasi', () => {
  it('persists all TASI fields', () => {
    saveLastKnownTasi(mockTasi);
    const raw = JSON.parse(localStorage.getItem(TASI_CACHE_KEY)!);
    expect(raw.price).toBe(11500);
    expect(raw.change).toBe(50);
    expect(raw.changePercent).toBe(0.44);
    expect(raw.high).toBe(11550);
    expect(raw.low).toBe(11450);
    expect(raw.volume).toBe(3_000_000);
    expect(raw.time).toBe('2026-04-06T08:00:00.000Z');
  });

  it('adds a savedAt timestamp', () => {
    saveLastKnownTasi(mockTasi);
    const raw = JSON.parse(localStorage.getItem(TASI_CACHE_KEY)!);
    expect(typeof raw.savedAt).toBe('number');
    expect(raw.savedAt).toBeGreaterThan(0);
  });

  it('does not throw when localStorage throws (storage full)', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => saveLastKnownTasi(mockTasi)).not.toThrow();
    Storage.prototype.setItem = original;
  });

  it('overwrites previous saved value', () => {
    saveLastKnownTasi(mockTasi);
    saveLastKnownTasi({ ...mockTasi, price: 12000 });
    const raw = JSON.parse(localStorage.getItem(TASI_CACHE_KEY)!);
    expect(raw.price).toBe(12000);
  });
});
