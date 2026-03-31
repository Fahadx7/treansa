/**
 * Cloudflare Worker — TrandSA
 * All API routes in one file + static asset fallback via env.ASSETS
 */

// ─── Shared helpers ──────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function corsHeaders() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// ─── In-memory caches (per isolate, 5-min TTL) ───────────────────────────────

const TTL = 5 * 60 * 1000;

let tasiCache       = null;
let commoditiesCache = null;
const quoteCache    = new Map();
const chartCache    = new Map();

// ─── TASI Index ───────────────────────────────────────────────────────────────

async function handleTasiIndex() {
  if (tasiCache && Date.now() - tasiCache.ts < TTL) return json(tasiCache.data);

  try {
    const res = await fetch('https://stooq.com/q/l/?s=^tasi&f=sd2t2ohlcv&h&e=json', {
      headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' },
    });
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

    const data = await res.json();
    const q    = data.symbols?.[0];
    if (!q || !q.close) throw new Error('No TASI data from Stooq');

    const price  = parseFloat(String(q.close));
    const open   = parseFloat(String(q.open  ?? q.close));
    if (price < 1000) throw new Error(`Unexpected TASI price: ${price}`);

    const change        = price - open;
    const changePercent = open !== 0 ? (change / open) * 100 : 0;

    const result = {
      success: true,
      price,
      change,
      changePercent,
      high:   parseFloat(String(q.high   ?? q.close)),
      low:    parseFloat(String(q.low    ?? q.close)),
      volume: parseInt(String(q.volume   ?? '0'), 10),
      time:   new Date().toISOString(),
    };

    tasiCache = { data: result, ts: Date.now() };
    return json(result);
  } catch (e) {
    return json({ success: false, error: e.message }, 503);
  }
}

// ─── Commodities ──────────────────────────────────────────────────────────────

async function handleCommodities() {
  if (commoditiesCache && Date.now() - commoditiesCache.ts < TTL) {
    return json(commoditiesCache.data);
  }

  const items = [
    { key: 'brent',  symbol: 'BZ=F'     },
    { key: 'gold',   symbol: 'GC=F'     },
    { key: 'usdsar', symbol: 'USDSAR=X' },
  ];
  const result = { success: true, brent: 0, gold: 0, usdsar: 3.75 };

  await Promise.all(items.map(async ({ key, symbol }) => {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
      );
      if (!res.ok) return;
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) result[key] = price;
    } catch { /* skip */ }
  }));

  commoditiesCache = { data: result, ts: Date.now() };
  return json(result);
}

// ─── Stock Price (with average volume calculation for liquidity) ─────────────

async function handleStockPrice(url) {
  const symbols = (url.searchParams.get('symbols') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!symbols.length) return json({ success: false, error: 'symbols required' }, 400);

  const results = [];

  await Promise.all(symbols.slice(0, 50).map(async (symbol) => {
    try {
      // Use 1mo range to get volume history for avgVolume calculation
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } },
      );
      if (!res.ok) return;
      const data = await res.json();
      const q = data?.chart?.result?.[0];
      if (!q) return;
      const meta = q.meta;
      const price = meta.regularMarketPrice ?? 0;
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
      const change = price - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose * 100) : 0;

      // Calculate average volume from historical data if meta doesn't provide it
      let avgVol = meta.averageDailyVolume10Day ?? 0;
      if (avgVol === 0) {
        const volumes = q.indicators?.quote?.[0]?.volume ?? [];
        // Use all days except the last (current/partial day)
        const histVols = volumes.slice(0, -1).filter(v => v != null && v > 0);
        // Take last 10 trading days
        const last10 = histVols.slice(-10);
        if (last10.length > 0) {
          avgVol = Math.round(last10.reduce((sum, v) => sum + v, 0) / last10.length);
        }
      }

      results.push({
        symbol,
        regularMarketPrice:         price,
        regularMarketChange:        parseFloat(change.toFixed(2)),
        regularMarketChangePercent: parseFloat(changePct.toFixed(2)),
        regularMarketVolume:        meta.regularMarketVolume ?? 0,
        averageDailyVolume10Day:    avgVol,
        regularMarketDayHigh:       meta.regularMarketDayHigh ?? 0,
        regularMarketDayLow:        meta.regularMarketDayLow ?? 0,
      });
    } catch { /* skip failed symbol */ }
  }));

  return json({ success: true, result: results });
}

// ─── Stock Chart (Yahoo Finance) ─────────────────────────────────────────────

const RANGE_MAP = {
  '1d':  { period1: () => Math.floor(Date.now() / 1000) - 86400,     interval: '5m'  },
  '1w':  { period1: () => Math.floor(Date.now() / 1000) - 604800,    interval: '1h'  },
  '1mo': { period1: () => Math.floor(Date.now() / 1000) - 2592000,   interval: '1d'  },
  '6mo': { period1: () => Math.floor(Date.now() / 1000) - 15552000,  interval: '1d'  },
  '1y':  { period1: () => Math.floor(Date.now() / 1000) - 31536000,  interval: '1wk' },
  '5y':  { period1: () => Math.floor(Date.now() / 1000) - 157680000, interval: '1mo' },
};

async function handleStockChart(url) {
  const symbol = url.searchParams.get('symbol') ?? '';
  const range  = url.searchParams.get('range')  ?? '1mo';
  if (!symbol) return json({ success: false, error: 'symbol required' }, 400);

  const cacheKey = `${symbol}_${range}`;
  const hit      = chartCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL) return json(hit.data);

  const cfg     = RANGE_MAP[range] ?? RANGE_MAP['1mo'];
  const period1 = cfg.period1();
  const period2 = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${cfg.interval}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data   = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No data');

    const timestamps = result.timestamp ?? [];
    const quote      = result.indicators?.quote?.[0] ?? {};
    const closes     = quote.close  ?? [];
    const opens      = quote.open   ?? [];
    const highs      = quote.high   ?? [];
    const lows       = quote.low    ?? [];
    const volumes    = quote.volume ?? [];

    const quotes = timestamps.map((t, i) => ({
      date:   new Date(t * 1000).toISOString(),
      open:   opens[i]   ?? 0,
      high:   highs[i]   ?? 0,
      low:    lows[i]    ?? 0,
      close:  closes[i]  ?? 0,
      volume: volumes[i] ?? 0,
    })).filter(q => q.close > 0);

    const payload = { success: true, meta: result.meta, quotes };
    chartCache.set(cacheKey, { data: payload, ts: Date.now() });
    return json(payload);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

// ─── AI helper (Cloudflare Workers AI — free, no external key) ──────────────

const CF_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

async function callAI(env, prompt) {
  const ai = env.AI;
  if (!ai) throw new Error('Workers AI غير مفعّل — أضف ai binding في wrangler.toml');
  const res = await ai.run(CF_MODEL, {
    messages: [
      { role: 'system', content: 'أنت محلل مالي خبير في السوق السعودي (تاسي). أجب دائماً باللغة العربية بشكل مختصر ومهني.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 1024,
    temperature: 0.7,
  });
  return res.response ?? '';
}

// ─── Multi-Agent Analysis ────────────────────────────────────────────────────

async function handleMultiAgent(request, env) {
  try {
    const body = await request.json();
    const { symbol, companyName, price, change, rsi, wave, macd, bb, atr, stochRsi, volumeRatio } = body;
    if (!symbol) return json({ success: false, error: 'رمز السهم مطلوب' }, 400);

    const stockCtx = `الشركة: ${companyName} (${symbol})
السعر: ${price} ر.س | التغير: ${change ?? 0}%
RSI(14): ${rsi ?? 'N/A'} | StochRSI: K=${stochRsi?.k ?? 'N/A'} D=${stochRsi?.d ?? 'N/A'}
MACD: ${macd?.macd ?? 'N/A'} | Signal: ${macd?.signal ?? 'N/A'} | Hist: ${macd?.histogram ?? 'N/A'}
Bollinger: Upper=${bb?.upper ?? 'N/A'} | Lower=${bb?.lower ?? 'N/A'}
ATR(14): ${atr ?? 'N/A'} | موجة إليوت: ${wave ?? 'غير محدد'} | نسبة الحجم: ${volumeRatio ?? 'N/A'}x`;

    // Run 4 specialist agents in parallel, then synthesize
    const [technical, fundamental, sentiment, risk] = await Promise.all([
      callAI(env,`أنت محلل فني خبير في السوق السعودي. حلل البيانات التالية وقدم تحليلاً فنياً مختصراً (3-5 نقاط):
${stockCtx}
ركز على: اتجاه RSI/MACD، مستويات الدعم والمقاومة، موجة إليوت، إشارات الدخول/الخروج.`),

      callAI(env,`أنت محلل أساسي خبير في السوق السعودي. قدم تحليلاً أساسياً مختصراً (3-5 نقاط) لـ:
${stockCtx}
ركز على: القطاع، النمو المتوقع، العوامل الاقتصادية المؤثرة، مقارنة بالقطاع.`),

      callAI(env,`أنت محلل معنويات السوق السعودي. حلل المعنويات المحيطة بـ:
${stockCtx}
ركز على: اتجاه السوق العام، حجم التداول مقارنة بالمتوسط، ضغط البيع/الشراء، ثقة المستثمرين.`),

      callAI(env,`أنت خبير إدارة مخاطر في السوق السعودي. قيّم المخاطر لـ:
${stockCtx}
ركز على: نسبة المخاطرة/العائد، وقف الخسارة المقترح (بناءً على ATR)، حجم المركز المناسب، مخاطر القطاع.`),
    ]);

    // Synthesis
    const synthesis = await callAI(env,`أنت كبير المحللين في السوق السعودي. لديك تقارير 4 محللين:

📊 التحليل الفني: ${technical.slice(0, 500)}
📈 التحليل الأساسي: ${fundamental.slice(0, 500)}
💭 معنويات السوق: ${sentiment.slice(0, 500)}
⚠️ إدارة المخاطر: ${risk.slice(0, 500)}

السهم: ${companyName} (${symbol}) بسعر ${price} ر.س

قدم ملخصاً تنفيذياً نهائياً يتضمن:
1. التوصية النهائية (شراء/بيع/انتظار) مع نسبة الثقة
2. نقطة الدخول المثالية
3. الهدف الأول والثاني
4. وقف الخسارة
5. الاستراتيجية المقترحة
اجعل الرد مختصراً ومهنياً.`);

    return json({
      success: true,
      agents: { technical, fundamental, sentiment, risk, synthesis },
    });
  } catch (e) {
    return json({ success: false, error: e.message || 'فشل التحليل' }, 500);
  }
}

// ─── Scenario Simulation ─────────────────────────────────────────────────────

async function handleScenario(request, env) {
  try {
    const body = await request.json();
    const { scenario, stocks } = body;
    if (!scenario) return json({ success: false, error: 'السيناريو مطلوب' }, 400);

    const stockList = (stocks ?? []).slice(0, 20)
      .map(s => `${s.companyName} (${s.symbol})`).join('، ');

    const prompt = `أنت خبير اقتصادي في السوق السعودي. حلل السيناريو التالي وتأثيره على السوق:

السيناريو: "${scenario}"

الأسهم المتاحة: ${stockList || 'جميع أسهم تاسي'}

أجب بتنسيق JSON فقط (بدون markdown أو backticks) بالهيكل التالي:
{
  "scenario_summary": "ملخص السيناريو وتحليله",
  "overall_market_impact": "إيجابي/سلبي/محايد مع شرح",
  "impact_percentage": "النسبة المتوقعة للتأثير مثل -2% إلى +3%",
  "affected_sectors": ["القطاع1", "القطاع2"],
  "top_positive_stocks": [{"symbol": "XXXX.SR", "name": "اسم الشركة", "reason": "السبب"}],
  "top_negative_stocks": [{"symbol": "XXXX.SR", "name": "اسم الشركة", "reason": "السبب"}],
  "trading_strategy": "الاستراتيجية المقترحة للمتداول",
  "time_horizon": "الأفق الزمني للتأثير"
}`;

    const raw = await callAI(env,prompt);

    // Parse JSON from response (handle potential markdown wrapping)
    let result;
    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      result = {
        scenario_summary: raw.slice(0, 500),
        overall_market_impact: 'غير محدد',
        impact_percentage: 'غير محدد',
        affected_sectors: [],
        top_positive_stocks: [],
        top_negative_stocks: [],
        trading_strategy: 'يرجى إعادة المحاولة',
        time_horizon: 'غير محدد',
      };
    }

    return json({ success: true, result });
  } catch (e) {
    return json({ success: false, error: e.message || 'فشل تحليل السيناريو' }, 500);
  }
}

// ─── AI Analysis (single stock) ──────────────────────────────────────────────

async function handleAiAnalysis(request, env) {
  try {
    const { symbol, companyName, price, change, rsi, wave, macd, bb, atr, stochRsi: stoch } = await request.json();
    if (!symbol) return json({ success: false, error: 'رمز السهم غير صالح' }, 400);

    const prompt = `أنت خبير مالي ومحلل فني محترف في السوق السعودي (تاسي).
قم بتحليل السهم التالي بناءً على البيانات المقدمة وقدم توصية احترافية باللغة العربية.
الشركة: ${companyName} (${symbol})
السعر الحالي: ${price}
التغير اليومي: ${change ?? 0}%
RSI (14): ${rsi ?? 'N/A'}
Stochastic RSI: K=${stoch?.k ?? 'N/A'} | D=${stoch?.d ?? 'N/A'}
موجة إليوت: ${wave || 'غير محدد'}
MACD Histogram: ${macd?.histogram ?? 'N/A'}
Bollinger Bands: Upper=${bb?.upper ?? 'N/A'} | Lower=${bb?.lower ?? 'N/A'}
ATR (14): ${atr ?? 'N/A'}

يرجى التركيز على:
1. الاتجاه المتوقع (صاعد/هابط/عرضي) مع مستوى الثقة.
2. نقاط الدخول المثالية بناءً على المؤشرات.
3. الأهداف السعرية المتوقعة (الأول والثاني).
4. مستوى وقف الخسارة المقترح بناءً على ATR.
5. نصيحة إدارة المخاطر للمتداول.
اجعل التحليل مختصراً، مهنياً، ومباشراً.`;

    const analysis = await callAI(env,prompt);
    return json({ success: true, analysis });
  } catch (e) {
    return json({ success: false, error: 'فشل تحليل الذكاء الاصطناعي' }, 500);
  }
}

// ─── AI News ─────────────────────────────────────────────────────────────────

async function handleAiNews(request, env) {
  try {
    const { symbol, companyName } = await request.json();
    if (!symbol) return json({ success: false, error: 'رمز السهم غير صالح' }, 400);

    const prompt = `ابحث عن آخر الأخبار المتعلقة بشركة ${companyName} (رمز السهم: ${symbol}) في السوق السعودي.
قدم قائمة بأهم 5 أخبار حديثة بتنسيق JSON فقط (بدون markdown أو backticks).
لكل خبر: title, summary, date, source, url.
[{"title":"...","summary":"...","date":"...","source":"...","url":"..."}]`;

    const raw = await callAI(env,prompt);
    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const news = JSON.parse(cleaned);
      return json({ success: true, news: Array.isArray(news) ? news : [] });
    } catch {
      return json({ success: true, news: [] });
    }
  } catch (e) {
    return json({ success: false, error: 'فشل جلب الأخبار' }, 500);
  }
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight for POST endpoints
    if (request.method === 'OPTIONS') return corsHeaders();

    // GET endpoints
    if (url.pathname === '/api/tasi-index')               return handleTasiIndex();
    if (url.pathname === '/api/commodities')              return handleCommodities();
    if (url.pathname.startsWith('/api/stock-price'))      return handleStockPrice(url);
    if (url.pathname.startsWith('/api/stock-chart'))      return handleStockChart(url);

    // POST endpoints (Gemini AI)
    if (request.method === 'POST') {
      if (url.pathname === '/api/multi-agent')  return handleMultiAgent(request, env);
      if (url.pathname === '/api/scenario')     return handleScenario(request, env);
      if (url.pathname === '/api/ai-analysis')  return handleAiAnalysis(request, env);
      if (url.pathname === '/api/ai-news')      return handleAiNews(request, env);
    }

    if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
      return env.ASSETS.fetch(request);
    }

    // All other requests → serve static assets (SPA)
    return env.ASSETS.fetch(request);
  },
};
