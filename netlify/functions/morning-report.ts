/**
 * morning-report.ts
 * Netlify Scheduled Function — runs at 06:30 UTC (09:30 Riyadh) Sun–Thu
 * Generates an Arabic morning briefing and sends it via Telegram.
 */

import { SAUDI_STOCKS } from '../../src/symbols';

const SHORT_NAME_AR: Record<string, string> = {
  'Yanbu National Petrochemical Co': 'ينساب',
  'Rabigh Refining and Petrochemical': 'بترورابغ',
  'Advanced Petrochemical Co': 'البتروكيماويات المتقدمة',
  'Saudi Aramco': 'أرامكو',
  'Al Rajhi Bank': 'الراجحي',
  'Saudi Basic Industries': 'سابك',
  'stc': 'الاتصالات السعودية',
  'Saudi National Bank': 'البنك الأهلي',
  'Riyad Bank': 'بنك الرياض',
  'Alinma Bank': 'مصرف الإنماء',
};

/** Return Arabic name — checks shortName map first, then symbol code map, then falls back. */
function arabicName(symbol: string, shortName?: string): string {
  const code = symbol.replace('.SR', '');
  return (shortName && SHORT_NAME_AR[shortName]) || SAUDI_STOCKS[code] || shortName || symbol;
}

// ─── Yahoo Finance helpers ───────────────────────────────────────────────────

const YF_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const YF_HEADERS: Record<string, string> = {
  'User-Agent': YF_UA,
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a crumb + cookies pair for authenticated YF requests. */
async function getYFCrumb(): Promise<{ crumb: string; cookies: string } | null> {
  try {
    const r1 = await fetchWithTimeout('https://fc.yahoo.com', {
      headers: { 'User-Agent': YF_UA },
      redirect: 'follow',
    });
    const cookies = (r1.headers.get('set-cookie') || '')
      .split(',')
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');

    const r2 = await fetchWithTimeout(
      'https://query2.finance.yahoo.com/v1/test/getcrumb',
      { headers: { 'User-Agent': YF_UA, Cookie: cookies } },
    );
    if (!r2.ok) return null;
    const crumb = (await r2.text()).trim();
    return { crumb, cookies };
  } catch {
    return null;
  }
}

interface StockQuote {
  symbol: string;
  shortName: string;
  regularMarketPrice: number;
  regularMarketChangePercent: number;
  regularMarketVolume: number;
}

interface TasiData {
  price: number;
  change: number;
  changePercent: number;
}

interface CommodityData {
  symbol: string;
  price: number;
  changePercent: number;
}

/** Fetch commodity prices (Brent Oil, Gold). Returns empty array on failure. */
async function fetchCommodities(
  crumb: string,
  cookies: string,
): Promise<CommodityData[]> {
  const symbols = ['BZ=F', 'GC=F'];
  const crumbQ = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}${crumbQ}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { ...YF_HEADERS, Cookie: cookies },
      timeoutMs: 8000,
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const results: any[] = data?.quoteResponse?.result ?? [];
    return results
      .filter((q) => typeof q.regularMarketPrice === 'number')
      .map((q) => ({
        symbol: q.symbol as string,
        price: q.regularMarketPrice as number,
        changePercent: (q.regularMarketChangePercent as number) ?? 0,
      }));
  } catch {
    return [];
  }
}

/** Fetch a batch of YF quotes. Returns an empty array on failure. */
async function fetchQuotes(
  symbols: string[],
  crumb: string,
  cookies: string,
): Promise<StockQuote[]> {
  const list = symbols.join(',');
  const crumbQ = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(list)}${crumbQ}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { ...YF_HEADERS, Cookie: cookies },
      timeoutMs: 10000,
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data?.quoteResponse?.result || []) as StockQuote[];
  } catch {
    return [];
  }
}

/** Fetch TASI index via v8 chart API (most reliable for indices). */
async function fetchTASI(
  crumb: string,
  cookies: string,
): Promise<TasiData | null> {
  try {
    const period1 = Math.floor(Date.now() / 1000) - 7 * 86400;
    const period2 = Math.floor(Date.now() / 1000);
    const crumbQ = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETASI?interval=1d&period1=${period1}&period2=${period2}${crumbQ}`;
    const res = await fetchWithTimeout(url, {
      headers: { ...YF_HEADERS, Cookie: cookies },
      timeoutMs: 10000,
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price: number = meta.regularMarketPrice ?? meta.previousClose ?? 0;
    const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const change = price - prevClose;
    const changePercent = prevClose ? (change / prevClose) * 100 : 0;
    return { price, change, changePercent };
  } catch {
    return null;
  }
}

// ─── RSS helpers ─────────────────────────────────────────────────────────────

interface RssItem {
  title: string;
  link: string;
  source: string;
}

function parseRssItems(xml: string, source: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (/<title[^>]*><!\[CDATA\[(.+?)\]\]><\/title>/i.exec(block) ||
      /<title[^>]*>([^<]+)<\/title>/i.exec(block))?.[1]?.trim() ?? '';
    const link = (/<link[^>]*>([^<]+)<\/link>/i.exec(block))?.[1]?.trim() ?? '';
    if (title) items.push({ title, link, source });
  }
  return items.slice(0, 5);
}

async function fetchEconomicNews(): Promise<RssItem[]> {
  const feeds: Array<{ url: string; source: string }> = [
    {
      url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5ETASI&region=SA&lang=en-US',
      source: 'Yahoo Finance',
    },
    {
      url: 'https://news.google.com/rss/search?q=السوق+السعودي+تداول&hl=ar&gl=SA&ceid=SA:ar',
      source: 'Google News',
    },
    {
      url: 'https://news.google.com/rss/search?q=saudi+stock+market+tadawul&hl=en&gl=SA&ceid=SA:en',
      source: 'Google News EN',
    },
  ];

  const results = await Promise.allSettled(
    feeds.map(({ url, source }) =>
      fetchWithTimeout(url, {
        headers: { 'User-Agent': YF_UA, Accept: 'application/rss+xml, text/xml' },
        timeoutMs: 6000,
      })
        .then((r) => (r.ok ? r.text() : ''))
        .then((xml) => parseRssItems(xml, source))
        .catch((): RssItem[] => []),
    ),
  );

  const all: RssItem[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  // Deduplicate by title similarity (first word match)
  const seen = new Set<string>();
  return all.filter((item) => {
    const key = item.title.split(' ').slice(0, 4).join(' ').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

// ─── Claude AI ───────────────────────────────────────────────────────────────

/** Translate a single headline to Arabic using Claude. Falls back to original on error. */
async function translateHeadline(title: string, apiKey: string): Promise<string> {
  try {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 80,
        messages: [{ role: 'user', content: `ترجم هذا العنوان للعربية في جملة واحدة فقط: ${title}` }],
      }),
      timeoutMs: 10000,
    });
    if (!res.ok) return title;
    const data: any = await res.json();
    return (data?.content?.[0]?.text ?? '').trim() || title;
  } catch {
    return title;
  }
}

/** Translate all headlines in parallel. Returns original titles if API key missing. */
async function translateHeadlines(titles: string[]): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return titles;
  return Promise.all(titles.map((t) => translateHeadline(t, apiKey)));
}

async function claudeBriefing(opts: {
  tasiPrice: number | null;
  tasiChangePercent: number | null;
  gainers: StockQuote[];
  losers: StockQuote[];
  newsItems: RssItem[];
  dateLabel: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'تعذّر توليد التحليل: مفتاح Claude غير مضبوط.';

  const { tasiPrice, tasiChangePercent, gainers, losers, newsItems, dateLabel } = opts;

  const gainersText = gainers
    .slice(0, 3)
    .map((s) => `${arabicName(s.symbol, s.shortName)}: ${s.regularMarketChangePercent.toFixed(2)}%`)
    .join('، ');

  const losersText = losers
    .slice(0, 3)
    .map((s) => `${arabicName(s.symbol, s.shortName)}: ${s.regularMarketChangePercent.toFixed(2)}%`)
    .join('، ');

  const newsText = newsItems
    .slice(0, 4)
    .map((n, i) => `${i + 1}. ${n.title}`)
    .join('\n');

  const tasiLine =
    tasiPrice != null
      ? `مؤشر تاسي أمس: ${tasiPrice.toFixed(2)} نقطة (${tasiChangePercent != null && tasiChangePercent >= 0 ? '+' : ''}${tasiChangePercent?.toFixed(2) ?? '—'}%)`
      : 'بيانات تاسي غير متاحة';

  const prompt = `أنت محلل مالي متخصص في السوق السعودي. البيانات التالية ليوم ${dateLabel}:

${tasiLine}
أبرز الصاعدين: ${gainersText || 'غير متاح'}
أبرز الهابطين: ${losersText || 'غير متاح'}

أخبار اقتصادية حديثة:
${newsText || 'لا توجد أخبار'}

اكتب توقعاً لجلسة اليوم في جملة أو جملتين فقط، بحد أقصى 150 حرفاً عربياً. اكتب جملاً كاملة فقط ولا تقطع في منتصف الجملة. لا markdown ولا تحفظات قانونية.`;

  try {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        messages: [{ role: 'user', content: prompt }],
      }),
      timeoutMs: 20000,
    });

    if (!res.ok) return 'تعذّر توليد التحليل.';
    const data: any = await res.json();
    const raw = (data?.content?.[0]?.text ?? '').trim();
    if (!raw) return 'تعذّر توليد التحليل.';
    // Hard cap at 150 chars, cutting only at a sentence boundary
    if (raw.length <= 150) return raw;
    const cut = raw.slice(0, 150);
    const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('\u060C'), cut.lastIndexOf('!'), cut.lastIndexOf('\u061F'));
    return lastDot > 60 ? cut.slice(0, lastDot + 1) : cut;
  } catch {
    return 'تعذّر توليد التحليل.';
  }
}

// ─── Email sender (Resend) ────────────────────────────────────────────────────

function buildEmailHtml(opts: {
  dateLabel: string;
  tasiLine: string;
  gainersCount: number;
  losersCount: number;
  commoditiesBlock: string | null;
  gainersBlock: string;
  losersBlock: string;
  newsBlock: string;
  forecast: string;
}): string {
  const { dateLabel, tasiLine, gainersCount, losersCount, commoditiesBlock, gainersBlock, losersBlock, newsBlock, forecast } = opts;

  const sectionStyle = 'background:#161b22;border-right:3px solid #00d4aa;border-radius:8px;padding:16px 20px;margin-bottom:16px;';
  const labelStyle = 'color:#00d4aa;font-weight:bold;font-size:14px;margin-bottom:10px;display:block;';
  const rowStyle = 'color:#e6edf3;font-size:14px;line-height:1.8;direction:rtl;text-align:right;';
  const mutedStyle = 'color:#8b949e;font-size:12px;';

  const commHtml = commoditiesBlock
    ? `<div style="${sectionStyle}">
        <span style="${labelStyle}">🛢️ السلع العالمية</span>
        <div style="${rowStyle}">${commoditiesBlock.replace(/^🛢️ \*السلع العالمية:\*\n/, '').split('\n').map(l => `${l}<br/>`).join('')}</div>
      </div>`
    : '';

  const losersHtml = losersBlock
    ? `<div style="${sectionStyle}border-right-color:#ff3d5a;">
        <span style="color:#ff3d5a;font-weight:bold;font-size:14px;margin-bottom:10px;display:block;">📉 أبرز الهابطين</span>
        <div style="${rowStyle}">${losersBlock.split('\n').map(l => `${l}<br/>`).join('')}</div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="text-align:center;padding:24px 0 16px;">
      <div style="font-size:28px;font-weight:900;color:#00d4aa;letter-spacing:1px;">ترندسا</div>
      <div style="font-size:13px;color:#8b949e;margin-top:4px;">منصة تحليل السوق السعودي</div>
    </div>

    <!-- Title bar -->
    <div style="background:linear-gradient(135deg,#00d4aa22,#00d4aa08);border:1px solid #00d4aa33;border-radius:12px;padding:16px;text-align:center;margin-bottom:20px;">
      <div style="font-size:18px;font-weight:bold;color:#e6edf3;">🌅 تقرير ترندسا الصباحي</div>
      <div style="font-size:13px;color:#8b949e;margin-top:6px;">📅 ${dateLabel} &nbsp;|&nbsp; ⏰ قبل 30 دقيقة من افتتاح السوق</div>
    </div>

    <!-- Market -->
    <div style="${sectionStyle}">
      <span style="${labelStyle}">📊 السوق أمس</span>
      <div style="${rowStyle}">
        المؤشر: ${tasiLine}<br/>
        📈 صاعد: <span style="color:#00d4aa">${gainersCount}</span> &nbsp;|&nbsp; 📉 هابط: <span style="color:#ff3d5a">${losersCount}</span>
      </div>
    </div>

    <!-- Commodities -->
    ${commHtml}

    <!-- Gainers -->
    <div style="${sectionStyle}">
      <span style="${labelStyle}">🔥 أبرز الصاعدين</span>
      <div style="${rowStyle}">${gainersBlock.split('\n').map(l => `<span style="color:#00d4aa">${l}</span><br/>`).join('')}</div>
    </div>

    <!-- Losers -->
    ${losersHtml}

    <!-- News -->
    <div style="${sectionStyle}border-right-color:#58a6ff;">
      <span style="color:#58a6ff;font-weight:bold;font-size:14px;margin-bottom:10px;display:block;">📰 أخبار مؤثرة</span>
      <div style="${rowStyle}">${newsBlock.split('\n').map(l => `${l}<br/>`).join('')}</div>
    </div>

    <!-- Forecast -->
    <div style="background:linear-gradient(135deg,#1a2332,#161b22);border:1px solid #30363d;border-radius:8px;padding:16px 20px;margin-bottom:16px;">
      <span style="${labelStyle}">🎯 توقع اليوم</span>
      <div style="color:#e6edf3;font-size:15px;line-height:1.7;direction:rtl;text-align:right;">${forecast}</div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px 0;border-top:1px solid #21262d;margin-top:8px;">
      <div style="${mutedStyle}">💡 للاستشارة والتثقيف المالي فقط</div>
      <div style="${mutedStyle};margin-top:4px;">
        <a href="https://trandsa2030.netlify.app" style="color:#00d4aa;text-decoration:none;">trandsa2030.netlify.app</a>
      </div>
    </div>

  </div>
</body>
</html>`;
}

async function sendEmail(opts: {
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[morning-report] RESEND_API_KEY not set — skipping email');
    return;
  }
  try {
    const res = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'trandsa@resend.dev',
        to: ['aboamran2016@gmail.com'],
        subject: opts.subject,
        html: opts.html,
      }),
      timeoutMs: 15000,
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[morning-report] Resend error:', err.message ?? res.status);
    }
  } catch (e: any) {
    console.error('[morning-report] sendEmail failed:', e.message);
  }
}

// ─── Telegram sender ──────────────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<void> {
  const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || '')
    .replace(/\s/g, '')
    .replace(/^TOKEN=/i, '')
    .replace(/^"|"$/g, '')
    .trim();

  const chatId = (process.env.TELEGRAM_CHAT_ID || '')
    .replace(/\s/g, '')
    .replace(/^ID=/i, '')
    .replace(/^"|"$/g, '')
    .trim();

  if (!token || !chatId) {
    console.error('[morning-report] Telegram credentials missing');
    return;
  }

  const res = await fetchWithTimeout(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      timeoutMs: 10000,
    },
  );

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    console.error('[morning-report] Telegram error:', err.description ?? res.status);
  }
}

// ─── Arabic date/day formatting ───────────────────────────────────────────────

const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function riyadhNow(): Date {
  // UTC+3
  return new Date(Date.now() + 3 * 3600_000);
}

function formatDateArabic(d: Date): string {
  const day = ARABIC_DAYS[d.getUTCDay()] ?? '';
  const dom = d.getUTCDate();
  const month = ARABIC_MONTHS[d.getUTCMonth()] ?? '';
  const year = d.getUTCFullYear();
  return `${day} ${dom} ${month} ${year}`;
}

// ─── Saudi stock symbols (top 30 by market cap for speed) ─────────────────────

const TOP_SAUDI_SYMBOLS = [
  '2222.SR', '1120.SR', '2010.SR', '2380.SR', '1180.SR',
  '2350.SR', '4200.SR', '2330.SR', '4030.SR', '1211.SR',
  '1010.SR', '1150.SR', '2280.SR', '4240.SR', '2290.SR',
  '1050.SR', '3010.SR', '4050.SR', '2170.SR', '4160.SR',
  '2060.SR', '1080.SR', '4100.SR', '2300.SR', '3050.SR',
  '4020.SR', '2190.SR', '4081.SR', '4130.SR', '1303.SR',
];

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(): Promise<Response> {
  console.log('[morning-report] Starting — %s', new Date().toISOString());

  const now = riyadhNow();
  const dateLabel = formatDateArabic(now);

  // 1. Get crumb for authenticated YF requests
  const auth = await getYFCrumb();
  const crumb = auth?.crumb ?? '';
  const cookies = auth?.cookies ?? '';

  // 2. Fetch TASI index
  const tasiData = await fetchTASI(crumb, cookies);

  // 3. Fetch stock quotes + commodities in parallel
  const half = Math.ceil(TOP_SAUDI_SYMBOLS.length / 2);
  const [batch1, batch2, commodities] = await Promise.all([
    fetchQuotes(TOP_SAUDI_SYMBOLS.slice(0, half), crumb, cookies),
    fetchQuotes(TOP_SAUDI_SYMBOLS.slice(half), crumb, cookies),
    fetchCommodities(crumb, cookies),
  ]);
  const allQuotes = [...batch1, ...batch2].filter(
    (q) => typeof q.regularMarketChangePercent === 'number',
  );

  // 4. Sort gainers / losers
  const sorted = [...allQuotes].sort(
    (a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent,
  );
  const gainers = sorted.filter((q) => q.regularMarketChangePercent > 0).slice(0, 5);
  const losers = sorted
    .filter((q) => q.regularMarketChangePercent < 0)
    .reverse()
    .slice(0, 5);

  const gainersCount = allQuotes.filter((q) => q.regularMarketChangePercent > 0).length;
  const losersCount = allQuotes.filter((q) => q.regularMarketChangePercent < 0).length;

  // 5. Fetch news and translate headlines to Arabic
  const newsItems = await fetchEconomicNews();
  const translatedTitles = await translateHeadlines(newsItems.slice(0, 3).map((n) => n.title));

  // 6. Claude briefing
  const forecast = await claudeBriefing({
    tasiPrice: tasiData?.price ?? null,
    tasiChangePercent: tasiData?.changePercent ?? null,
    gainers,
    losers,
    newsItems,
    dateLabel,
  });

  // 7. Build Telegram message
  const tasiLine =
    tasiData != null
      ? `${tasiData.price.toFixed(2)} نقطة  ${tasiData.changePercent >= 0 ? '▲' : '▼'} ${Math.abs(tasiData.changePercent).toFixed(2)}%`
      : '— (غير متاح)';

  const gainersBlock = gainers
    .map((s) => `• ${arabicName(s.symbol, s.shortName)}: +${s.regularMarketChangePercent.toFixed(2)}%`)
    .join('\n');

  const losersBlock = losers
    .map((s) => `• ${arabicName(s.symbol, s.shortName)}: ${s.regularMarketChangePercent.toFixed(2)}%`)
    .join('\n');

  const newsBlock = translatedTitles.map((t) => `• ${t}`).join('\n');

  const brent = commodities.find((c) => c.symbol === 'BZ=F');
  const gold = commodities.find((c) => c.symbol === 'GC=F');
  const commoditiesBlock =
    brent || gold
      ? [
          `🛢️ *السلع العالمية:*`,
          brent
            ? `• برنت: $${brent.price.toFixed(2)} (${brent.changePercent >= 0 ? '+' : ''}${brent.changePercent.toFixed(2)}%)`
            : null,
          gold
            ? `• ذهب: $${gold.price.toFixed(0)} (${gold.changePercent >= 0 ? '+' : ''}${gold.changePercent.toFixed(2)}%)`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null;

  const message = [
    `🌅 *تقرير ترندسا الصباحي*`,
    `📅 ${dateLabel}`,
    `⏰ قبل 30 دقيقة من افتتاح السوق`,
    ``,
    `📊 *السوق أمس:*`,
    `• المؤشر: ${tasiLine}`,
    `• صاعد: ${gainersCount} | هابط: ${losersCount}`,
    commoditiesBlock ? `\n${commoditiesBlock}` : null,
    ``,
    gainers.length > 0
      ? `🔥 *أبرز الصاعدين:*\n${gainersBlock}`
      : '🔥 *أبرز الصاعدين:* غير متاح',
    ``,
    losers.length > 0
      ? `📉 *أبرز الهابطين:*\n${losersBlock}`
      : '',
    newsItems.length > 0
      ? `\n📰 *أخبار مؤثرة:*\n${newsBlock}`
      : '',
    ``,
    `🎯 *توقع اليوم:*\n${forecast}`,
    ``,
    `⚠️ للاستشارة فقط وليس توصية مالية`,
    `🔗 trandsa2030.netlify.app`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');

  // 8. Build email HTML and send both Telegram + Email in parallel
  const emailHtml = buildEmailHtml({
    dateLabel,
    tasiLine,
    gainersCount,
    losersCount,
    commoditiesBlock: commoditiesBlock ?? null,
    gainersBlock: gainersBlock || '• لا بيانات',
    losersBlock,
    newsBlock,
    forecast,
  });

  await Promise.all([
    sendTelegram(message),
    sendEmail({
      subject: `🌅 تقرير ترندسا الصباحي - ${dateLabel}`,
      html: emailHtml,
    }),
  ]);

  console.log('[morning-report] Done — report sent for %s', dateLabel);
  return new Response('OK', { status: 200 });
}
