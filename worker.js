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
    { key: 'brent', symbol: 'BZ=F' },
    { key: 'gold',  symbol: 'GC=F' },
  ];
  const result = { success: true, brent: 0, gold: 0 };

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

// ─── Stock Price ──────────────────────────────────────────────────────────────

async function handleStockPrice(url) {
  const symbols = (url.searchParams.get('symbols') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!symbols.length) return json({ success: false, error: 'symbols required' }, 400);

  const results = [];

  await Promise.all(symbols.slice(0, 50).map(async (symbol) => {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
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
      results.push({
        symbol,
        regularMarketPrice:         price,
        regularMarketChange:        parseFloat(change.toFixed(2)),
        regularMarketChangePercent: parseFloat(changePct.toFixed(2)),
        regularMarketVolume:        meta.regularMarketVolume ?? 0,
        averageDailyVolume10Day:    meta.averageDailyVolume10Day ?? 0,
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

// ─── Rate limiting (in-memory per isolate) ───────────────────────────────────

const rateLimitMap = new Map();

function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

function isValidSaudiSymbol(symbol) {
  return typeof symbol === 'string' && /^\d{4}\.SR$/.test(symbol);
}

// ─── Gemini helper ────────────────────────────────────────────────────────────

async function geminiGenerate(apiKey, prompt, jsonMode = false) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    ...(jsonMode ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ─── AI Chat (Claude via Anthropic) ──────────────────────────────────────────

async function handleChat(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip + ':chat', 20, 60_000)) {
    return json({ success: false, error: 'تجاوزت الحد المسموح' }, 429);
  }
  if (!env.ANTHROPIC_API_KEY) return json({ success: false, error: 'مفتاح Anthropic غير مضبوط' }, 503);

  const { messages, system } = await request.json();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system, messages }),
  });
  if (!res.ok) return json({ success: false, error: `Anthropic error ${res.status}` }, 502);
  const data = await res.json();
  return json({ success: true, content: data?.content?.[0]?.text ?? '' });
}

// ─── AI Analysis (Gemini) ─────────────────────────────────────────────────────

async function handleAIAnalysis(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip + ':ai-analysis', 10, 60_000)) {
    return json({ success: false, error: 'تجاوزت الحد المسموح' }, 429);
  }
  if (!env.GEMINI_API_KEY) return json({ success: false, error: 'مفتاح Gemini غير مضبوط' }, 503);

  const { symbol, companyName, price, change, rsi, wave, macd, bb, atr, stochRsi } = await request.json();
  if (!symbol || !isValidSaudiSymbol(symbol)) return json({ success: false, error: 'رمز السهم غير صالح' }, 400);

  const stoch = stochRsi;
  const prompt = `أنت خبير مالي ومحلل فني محترف في السوق السعودي (تاسي).
قم بتحليل السهم التالي بناءً على البيانات المقدمة وقدم توصية احترافية باللغة العربية.
الشركة: ${companyName} (${symbol})
السعر الحالي: ${price}
التغير اليومي: ${change?.toFixed ? change.toFixed(2) : change}%
RSI (14): ${rsi?.toFixed ? rsi.toFixed(1) : rsi}
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

  try {
    const analysis = await geminiGenerate(env.GEMINI_API_KEY, prompt);
    return json({ success: true, analysis });
  } catch (e) {
    return json({ success: false, error: 'فشل تحليل الذكاء الاصطناعي.' }, 500);
  }
}

// ─── Multi-Agent Analysis ─────────────────────────────────────────────────────

async function handleMultiAgent(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip + ':multi-agent', 3, 60_000)) {
    return json({ success: false, error: 'تجاوزت الحد المسموح (3 طلبات في الدقيقة)' }, 429);
  }
  if (!env.GEMINI_API_KEY) return json({ success: false, error: 'مفتاح Gemini غير مضبوط' }, 503);

  const { symbol, companyName, price, change, rsi, wave, macd, bb, atr, stochRsi, volumeRatio } = await request.json();
  if (!symbol || !isValidSaudiSymbol(symbol)) return json({ success: false, error: 'رمز السهم غير صالح' }, 400);

  const stockInfo = `الشركة: ${companyName} (${symbol}) | السعر: ${price} ر.س | التغيير: ${change?.toFixed ? change.toFixed(2) : change}% | RSI: ${rsi?.toFixed ? rsi.toFixed(1) : rsi} | MACD: ${macd?.histogram?.toFixed ? macd.histogram.toFixed(3) : macd?.histogram ?? 'N/A'} | موجة: ${wave || 'غير محدد'}`;

  try {
    const [technical, fundamental, sentiment, risk] = await Promise.all([
      geminiGenerate(env.GEMINI_API_KEY, `أنت محلل فني متخصص في السوق السعودي. حلل هذا السهم من منظور فني بحت.
${stockInfo}
ATR: ${atr ?? 'N/A'} | BB Upper: ${bb?.upper ?? 'N/A'} | Middle: ${bb?.middle ?? 'N/A'} | Lower: ${bb?.lower ?? 'N/A'} | StochRSI K: ${stochRsi?.k ?? 'N/A'} D: ${stochRsi?.d ?? 'N/A'}
قدم: 1. الاتجاه الفني مع نسبة الثقة 2. مستويات الدعم والمقاومة 3. نقطة الدخول ووقف الخسارة والهدف 4. خلاصة فنية في جملة.`),
      geminiGenerate(env.GEMINI_API_KEY, `أنت محلل أساسي متخصص في الشركات السعودية المدرجة.
${companyName} (${symbol}) - السعر: ${price} ر.س
قيّم: 1. جودة الشركة (ممتاز/جيد/متوسط/ضعيف) مع السبب 2. المركز التنافسي 3. المخاطر الأساسية 4. هل السعر مناسب للدخول؟ 5. خلاصة أساسية في جملة.`),
      geminiGenerate(env.GEMINI_API_KEY, `أنت محلل متخصص في مشاعر السوق وسيكولوجية المتداولين السعوديين.
${stockInfo} | نسبة الحجم: ${volumeRatio ?? 1}x
حلل: 1. معنويات السوق (خوف/حياد/طمع) 2. هل الحجم يدعم الحركة؟ 3. تراكم أم تخارج؟ 4. التوقع النفسي للأسبوع القادم 5. خلاصة المشاعر في جملة.`),
      geminiGenerate(env.GEMINI_API_KEY, `أنت مدير مخاطر محترف متخصص في السوق السعودي.
${stockInfo} | ATR: ${atr ?? 'N/A'} | نسبة الحجم: ${volumeRatio ?? 1}x
قيّم: 1. مستوى المخاطرة (منخفض/متوسط/عالي) مع السبب 2. وقف الخسارة المثالي بسعر محدد 3. نسبة المخاطرة/العائد 4. حجم المركز لمحفظة 100,000 ر.س 5. توصية إدارة المخاطر في جملة.`),
    ]);

    const synthesis = await geminiGenerate(env.GEMINI_API_KEY, `أنت محلل رئيسي تجمع آراء خبراء متعددين.
السهم: ${companyName} (${symbol}) - السعر: ${price} ر.س
التحليل الفني: ${technical}
التحليل الأساسي: ${fundamental}
تحليل المشاعر: ${sentiment}
تحليل المخاطر: ${risk}
قدم: 1. **القرار النهائي**: شراء الآن / انتظار / تجنب 2. **مستوى الإجماع** 3. **الاستراتيجية المقترحة** في 3 نقاط 4. **أهم تحذير واحد**.`);

    return json({ success: true, agents: { technical, fundamental, sentiment, risk, synthesis } });
  } catch (e) {
    return json({ success: false, error: 'فشل التحليل متعدد الوكلاء.' }, 500);
  }
}

// ─── Scenario Simulator ───────────────────────────────────────────────────────

async function handleScenario(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip + ':scenario', 5, 60_000)) {
    return json({ success: false, error: 'تجاوزت الحد المسموح' }, 429);
  }
  if (!env.GEMINI_API_KEY) return json({ success: false, error: 'مفتاح Gemini غير مضبوط' }, 503);

  const { scenario, stocks } = await request.json();
  if (!scenario || typeof scenario !== 'string' || scenario.trim().length < 5) {
    return json({ success: false, error: 'يرجى إدخال سيناريو صالح' }, 400);
  }

  const stocksList = Array.isArray(stocks)
    ? stocks.slice(0, 30).map(s => `${s.symbol}:${s.companyName}`).join('، ')
    : '2222:أرامكو، 2010:سابك، 1120:الراجحي، 7010:stc، 1180:البنك الأهلي، 2082:أكوا باور، 4030:البحري، 1211:معادن';

  const prompt = `أنت محلل اقتصادي متخصص في تأثير الأحداث الكلية على سوق الأسهم السعودي (تاسي).
السيناريو: "${scenario.trim()}"
من قائمة الأسهم: ${stocksList}
أجب بـ JSON فقط:
{"scenario_summary":"ملخص التأثير","overall_market_impact":"إيجابي أو سلبي أو محايد","impact_percentage":"نسبة التأثير على تاسي","affected_sectors":[{"sector":"القطاع","impact":"إيجابي أو سلبي","reason":"السبب","severity":3}],"top_negative_stocks":[{"symbol":"رمز","company":"شركة","reason":"سبب","expected_change":"-5%"}],"top_positive_stocks":[{"symbol":"رمز","company":"شركة","reason":"سبب","expected_change":"+3%"}],"trading_strategy":"الاستراتيجية في 3 نقاط","time_horizon":"الإطار الزمني"}`;

  try {
    const text = await geminiGenerate(env.GEMINI_API_KEY, prompt, true);
    let result;
    try { result = JSON.parse(text); } catch { result = { scenario_summary: text, overall_market_impact: 'غير محدد' }; }
    return json({ success: true, result });
  } catch (e) {
    return json({ success: false, error: 'فشل تحليل السيناريو.' }, 500);
  }
}

// ─── AI News ──────────────────────────────────────────────────────────────────

async function handleAINews(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip + ':ai-news', 5, 60_000)) {
    return json({ success: false, error: 'تجاوزت الحد المسموح' }, 429);
  }
  if (!env.GEMINI_API_KEY) return json({ success: false, error: 'مفتاح Gemini غير مضبوط' }, 503);

  const { symbol, companyName } = await request.json();
  if (!symbol || !isValidSaudiSymbol(symbol)) return json({ success: false, error: 'رمز السهم غير صالح' }, 400);

  const prompt = `ابحث عن آخر الأخبار المتعلقة بشركة ${companyName} (رمز السهم: ${symbol}) في السوق السعودي.
قدم قائمة بأهم 5 أخبار حديثة بتنسيق JSON:
[{"title":"العنوان","summary":"ملخص مختصر","date":"التاريخ","source":"المصدر","url":"الرابط"}]`;

  try {
    const text = await geminiGenerate(env.GEMINI_API_KEY, prompt, true);
    let news;
    try { news = JSON.parse(text); } catch { news = []; }
    return json({ success: true, news });
  } catch (e) {
    return json({ success: false, error: 'فشل جلب الأخبار.' }, 500);
  }
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
    }

    if (url.pathname === '/api/tasi-index')               return handleTasiIndex();
    if (url.pathname === '/api/commodities')              return handleCommodities();
    if (url.pathname.startsWith('/api/stock-price'))      return handleStockPrice(url);
    if (url.pathname.startsWith('/api/stock-chart'))      return handleStockChart(url);
    if (url.pathname === '/api/chat')                     return handleChat(request, env);
    if (url.pathname === '/api/ai-analysis')              return handleAIAnalysis(request, env);
    if (url.pathname === '/api/multi-agent')              return handleMultiAgent(request, env);
    if (url.pathname === '/api/scenario')                 return handleScenario(request, env);
    if (url.pathname === '/api/ai-news')                  return handleAINews(request, env);

    if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
      return env.ASSETS.fetch(request);
    }

    // All other requests → serve static assets (SPA)
    return env.ASSETS.fetch(request);
  },
};
