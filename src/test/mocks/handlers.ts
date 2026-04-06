import { http, HttpResponse } from 'msw';

// ── Worker API mocks ──────────────────────────────────────────────────────────

export const handlers = [
  // TASI index
  http.get('/api/tasi-index', () =>
    HttpResponse.json({
      ok: true,
      price: 11285.73,
      change: 12.5,
      changePercent: 0.11,
      high: 11310.0,
      low: 11260.0,
      volume: 4200000,
      time: '14:30',
    }),
  ),

  // Stock price batch
  http.get('/api/stock-price', ({ request }) => {
    const url = new URL(request.url);
    const symbols = (url.searchParams.get('symbols') ?? '').split(',').filter(Boolean);
    const quotes = symbols.map((s, i) => ({
      symbol: s,
      price: 100 + i * 5,
      change: i % 2 === 0 ? 1.2 : -0.8,
      changePercent: i % 2 === 0 ? 1.2 : -0.8,
      volume: 100000,
      high: 105 + i,
      low: 98 + i,
      open: 100 + i,
    }));
    return HttpResponse.json({ ok: true, quotes });
  }),

  // Stock chart
  http.get('/api/stock-chart', ({ request }) => {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol') ?? 'UNKNOWN';
    const quotes = Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - (29 - i) * 86400000).toISOString(),
      open: 100 + i,
      high: 105 + i,
      low: 98 + i,
      close: 102 + i,
      volume: 500000,
    }));
    return HttpResponse.json({
      success: true,
      meta: { symbol, regularMarketPrice: 130, currency: 'SAR' },
      quotes,
      source: 'msw-mock',
    });
  }),

  // Commodities
  http.get('/api/commodities', () =>
    HttpResponse.json({
      success: true,
      brent: 82.1,
      gold: 3300.5,
      brentChange: -0.24,
      goldChange: 0.41,
    }),
  ),

  // stooq real-time (TASI index)
  http.get('https://stooq.com/q/l/', () =>
    HttpResponse.json({
      symbols: [{
        s: '^TASI', t: '2026-04-06', t2: '14:30:00',
        o: 11260.0, h: 11310.0, l: 11250.0, c: 11285.73, v: 4200000,
      }],
    }),
  ),

  // stooq historical (CSV) — simulate IP ban
  http.get('https://stooq.com/q/d/l/', () =>
    new HttpResponse('No data', { status: 403 }),
  ),

  // Yahoo Finance (external) — always block to simulate CF IP ban
  http.get('https://query1.finance.yahoo.com/*', () =>
    HttpResponse.json({ error: 'blocked' }, { status: 403 }),
  ),
  http.get('https://query2.finance.yahoo.com/*', () =>
    HttpResponse.json({ error: 'blocked' }, { status: 403 }),
  ),

  // Twelve Data
  http.get('https://api.twelvedata.com/time_series', ({ request }) => {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol') ?? 'UNKNOWN';
    const values = Array.from({ length: 30 }, (_, i) => ({
      datetime: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
      open: String(100 + i),
      high: String(105 + i),
      low: String(98 + i),
      close: String(102 + i),
      volume: '500000',
    }));
    return HttpResponse.json({
      meta: { symbol, interval: '1day', currency: 'SAR' },
      values,
      status: 'ok',
    });
  }),
];
