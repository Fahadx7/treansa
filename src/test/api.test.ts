/**
 * Integration tests for Cloudflare Worker API routes.
 *
 * We construct a minimal Request object and invoke the Worker's fetch()
 * handler directly — no network, no Vite, no port binding needed.
 *
 * External calls (Yahoo Finance, stooq, Twelve Data) are intercepted by MSW
 * (configured in setup.ts).
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';

// Dynamically import the Worker so the module can be loaded in Node
// (worker.js is an ES module with `export default { fetch }`)
let worker: { fetch: (req: Request, env: Record<string, unknown>) => Promise<Response> };

const BASE = 'https://treansa.aboamran2013.workers.dev';

function makeRequest(path: string, method = 'GET', body?: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const mockEnv = {
  TWELVE_DATA_KEY: 'test-key-123',
  AI: undefined,
  ASSETS: {
    fetch: async (_req: Request) =>
      new Response('<!doctype html><html></html>', {
        headers: { 'Content-Type': 'text/html' },
      }),
  },
};

// ─── /api/health ────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns ok:true with expected shape', async () => {
    const { default: w } = await import('../../worker.js');
    const res  = await w.fetch(makeRequest('/api/health'), mockEnv);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(body.twelve_data_key).toBe(true);
  });
});

// ─── /api/tasi-index ────────────────────────────────────────────────────────

describe('GET /api/tasi-index', () => {
  it('returns a numeric price', async () => {
    const { default: w } = await import('../../worker.js');
    const res  = await w.fetch(makeRequest('/api/tasi-index'), mockEnv);
    // stooq is mocked via MSW; might succeed or fall through to cached data
    expect([200, 500, 503]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body.price).toBe('number');
    }
  });
});

// ─── /api/stock-chart ────────────────────────────────────────────────────────

describe('GET /api/stock-chart', () => {
  it('returns 400 when symbol is missing', async () => {
    const { default: w } = await import('../../worker.js');
    const res = await w.fetch(makeRequest('/api/stock-chart'), mockEnv);
    expect(res.status).toBe(400);
  });

  it('returns chart data from Twelve Data mock', async () => {
    const { default: w } = await import('../../worker.js');
    const res  = await w.fetch(
      makeRequest('/api/stock-chart?symbol=%5ETASI&range=1mo'),
      mockEnv,
    );
    // MSW intercepts api.twelvedata.com → should succeed
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.quotes)).toBe(true);
  });

  it('all range values are accepted', async () => {
    const { default: w } = await import('../../worker.js');
    const ranges = ['1d', '1w', '1mo', '6mo', '1y', '5y'];
    for (const range of ranges) {
      const res = await w.fetch(
        makeRequest(`/api/stock-chart?symbol=2222.SR&range=${range}`),
        mockEnv,
      );
      expect([200, 500, 503]).toContain(res.status); // not 400
    }
  });
});

// ─── CORS preflight ──────────────────────────────────────────────────────────

describe('OPTIONS preflight', () => {
  it('returns 204 with CORS headers', async () => {
    const { default: w } = await import('../../worker.js');
    const req = new Request(`${BASE}/api/stock-chart`, { method: 'OPTIONS' });
    const res = await w.fetch(req, mockEnv);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
