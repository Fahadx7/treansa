/**
 * test-morning-report.ts
 * Manual trigger endpoint to test morning report logic.
 * GET /.netlify/functions/test-morning-report
 * Returns the generated Telegram message as JSON (does NOT actually send it).
 * Set ?send=1 to also send via Telegram.
 */

import type { Handler } from "@netlify/functions";
import { SAUDI_STOCKS } from "../../src/symbols";

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

function arabicName(symbol: string, shortName?: string): string {
  const code = symbol.replace(".SR", "");
  return (shortName && SHORT_NAME_AR[shortName]) || SAUDI_STOCKS[code] || shortName || symbol;
}

const YF_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {}
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

async function getYFCrumb(): Promise<{ crumb: string; cookies: string } | null> {
  try {
    const r1 = await fetchWithTimeout("https://fc.yahoo.com", {
      headers: { "User-Agent": YF_UA },
      redirect: "follow",
    });
    const cookies = (r1.headers.get("set-cookie") || "")
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    const r2 = await fetchWithTimeout(
      "https://query2.finance.yahoo.com/v1/test/getcrumb",
      { headers: { "User-Agent": YF_UA, Cookie: cookies } }
    );
    if (!r2.ok) return null;
    const crumb = (await r2.text()).trim();
    return { crumb, cookies };
  } catch {
    return null;
  }
}

async function fetchTASI(crumb: string, cookies: string) {
  try {
    const p1 = Math.floor(Date.now() / 1000) - 7 * 86400;
    const p2 = Math.floor(Date.now() / 1000);
    const cq = crumb ? `&crumb=${encodeURIComponent(crumb)}` : "";
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETASI?interval=1d&period1=${p1}&period2=${p2}${cq}`;
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": YF_UA, Accept: "application/json", Cookie: cookies },
      timeoutMs: 10000,
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price: number = meta.regularMarketPrice || meta.chartPreviousClose || 0;
    if (price < 1000) return null;
    const prev: number = meta.chartPreviousClose || price;
    return {
      price,
      change: price - prev,
      changePercent: prev ? ((price - prev) / prev) * 100 : 0,
    };
  } catch {
    return null;
  }
}

async function fetchTopStocks(crumb: string, cookies: string) {
  const symbols = [
    "2222.SR","1120.SR","2010.SR","2380.SR","1180.SR",
    "4200.SR","2330.SR","4030.SR","1211.SR","1010.SR",
    "1150.SR","2280.SR","4240.SR","2290.SR","1050.SR",
  ];
  const cq = crumb ? `&crumb=${encodeURIComponent(crumb)}` : "";
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}${cq}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": YF_UA, Accept: "application/json", Cookie: cookies },
      timeoutMs: 10000,
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data?.quoteResponse?.result || []).filter(
      (q: any) => typeof q.regularMarketChangePercent === "number"
    );
  } catch {
    return [];
  }
}

async function fetchCommodities(crumb: string, cookies: string): Promise<{ brent: number | null; brentChg: number | null; gold: number | null; goldChg: number | null }> {
  const cq = crumb ? `&crumb=${encodeURIComponent(crumb)}` : "";
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=BZ%3DF%2CGC%3DF${cq}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": YF_UA, Accept: "application/json", Cookie: cookies },
      timeoutMs: 8000,
    });
    if (!res.ok) return { brent: null, brentChg: null, gold: null, goldChg: null };
    const data: any = await res.json();
    const results: any[] = data?.quoteResponse?.result ?? [];
    const brentQ = results.find((q: any) => q.symbol === "BZ=F");
    const goldQ = results.find((q: any) => q.symbol === "GC=F");
    return {
      brent: brentQ?.regularMarketPrice ?? null,
      brentChg: brentQ?.regularMarketChangePercent ?? null,
      gold: goldQ?.regularMarketPrice ?? null,
      goldChg: goldQ?.regularMarketChangePercent ?? null,
    };
  } catch {
    return { brent: null, brentChg: null, gold: null, goldChg: null };
  }
}

async function fetchNews(): Promise<string[]> {
  try {
    const url =
      "https://news.google.com/rss/search?q=saudi+stock+market+tadawul&hl=en&gl=SA&ceid=SA:en";
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": YF_UA },
      timeoutMs: 6000,
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const titles: string[] = [];
    const re = /<title[^>]*>([^<]{10,})<\/title>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null && titles.length < 4) {
      const t = m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").trim();
      if (!t.toLowerCase().includes("google")) titles.push(t);
    }
    return titles;
  } catch {
    return [];
  }
}

async function claudeForecast(context: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "(مفتاح Claude غير مضبوط)";
  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        messages: [{ role: "user", content: context }],
      }),
      timeoutMs: 20000,
    });
    if (!res.ok) return "(فشل Claude)";
    const d: any = await res.json();
    const raw = (d?.content?.[0]?.text ?? "").trim();
    if (!raw) return "(لا رد)";
    if (raw.length <= 150) return raw;
    const cut = raw.slice(0, 150);
    const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('\u060C'), cut.lastIndexOf('!'), cut.lastIndexOf('\u061F'));
    return lastDot > 60 ? cut.slice(0, lastDot + 1) : cut;
  } catch {
    return "(انتهت مهلة Claude)";
  }
}

const ARABIC_DAYS = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
const ARABIC_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function riyadhDate() {
  const d = new Date(Date.now() + 3 * 3600_000);
  return `${ARABIC_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${ARABIC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const handler: Handler = async (event) => {
  const shouldSend = event.queryStringParameters?.send === "1";
  const steps: string[] = [];

  // 1. Crumb
  steps.push("جاري جلب crumb...");
  const auth = await getYFCrumb();
  const crumb = auth?.crumb ?? "";
  const cookies = auth?.cookies ?? "";
  steps.push(crumb ? `✅ crumb: ${crumb.slice(0, 8)}...` : "⚠️ لا crumb (سيُكمل بدونه)");

  // 2. TASI
  steps.push("جاري جلب تاسي...");
  const tasi = await fetchTASI(crumb, cookies);
  steps.push(tasi ? `✅ تاسي: ${tasi.price.toFixed(2)} (${tasi.changePercent >= 0 ? "+" : ""}${tasi.changePercent.toFixed(2)}%)` : "❌ فشل جلب تاسي");

  // 3. Stocks
  steps.push("جاري جلب الأسهم...");
  const quotes = await fetchTopStocks(crumb, cookies);
  const sorted = [...quotes].sort((a: any, b: any) => b.regularMarketChangePercent - a.regularMarketChangePercent);
  const gainers = sorted.filter((q: any) => q.regularMarketChangePercent > 0).slice(0, 3);
  const losers = sorted.filter((q: any) => q.regularMarketChangePercent < 0).reverse().slice(0, 3);
  const gainersCount = sorted.filter((q: any) => q.regularMarketChangePercent > 0).length;
  const losersCount = sorted.filter((q: any) => q.regularMarketChangePercent < 0).length;
  steps.push(`✅ أسهم: ${quotes.length} سهم، صاعد: ${gainersCount}، هابط: ${losersCount}`);

  // 4. Commodities
  steps.push("جاري جلب السلع العالمية...");
  const comm = await fetchCommodities(crumb, cookies);
  steps.push(comm.brent != null ? `✅ برنت: $${comm.brent.toFixed(2)}, ذهب: $${(comm.gold ?? 0).toFixed(0)}` : "⚠️ السلع غير متاحة");

  // 5. News
  steps.push("جاري جلب الأخبار...");
  const news = await fetchNews();
  steps.push(`✅ أخبار: ${news.length} خبر`);

  // 6. Claude
  steps.push("جاري توليد التحليل بـ Claude...");
  const prompt = `أنت محلل مالي. اكتب توقعاً مختصراً لجلسة السوق السعودي اليوم في جملتين فقط بالعربية. البيانات: تاسي ${tasi?.price.toFixed(2) ?? "غير متاح"}، أبرز الصاعدين: ${gainers.map((g: any) => arabicName(g.symbol, g.shortName)).join("، ")}.`;
  const forecast = await claudeForecast(prompt);
  steps.push(`✅ Claude: ${forecast.slice(0, 60)}...`);

  // 7. Build message
  const dateLabel = riyadhDate();
  const tasiLine = tasi
    ? `${tasi.price.toFixed(2)} نقطة ${tasi.changePercent >= 0 ? "▲" : "▼"} ${Math.abs(tasi.changePercent).toFixed(2)}%`
    : "— غير متاح";

  const gainersBlock = gainers.map((s: any) =>
    `• ${arabicName(s.symbol, s.shortName)}: +${s.regularMarketChangePercent.toFixed(2)}%`
  ).join("\n") || "• لا بيانات";

  const newsBlock = news.slice(0, 3).map((n) => `• ${n}`).join("\n") || "• لا أخبار";

  const fmtChg = (v: number | null) => v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—";
  const commoditiesBlock = comm.brent != null || comm.gold != null
    ? [
        `🛢️ *السلع العالمية:*`,
        comm.brent != null ? `• برنت: $${comm.brent.toFixed(2)} (${fmtChg(comm.brentChg)})` : null,
        comm.gold != null ? `• ذهب: $${comm.gold!.toFixed(0)} (${fmtChg(comm.goldChg)})` : null,
      ].filter(Boolean).join("\n")
    : null;

  const message = [
    `🌅 *تقرير ترندسا الصباحي*`,
    `📅 ${dateLabel}`,
    `⏰ قبل 30 دقيقة من افتتاح السوق`,
    ``,
    `📊 *السوق:*`,
    `• المؤشر: ${tasiLine}`,
    `• صاعد: ${gainersCount} | هابط: ${losersCount}`,
    commoditiesBlock ? `\n${commoditiesBlock}` : null,
    ``,
    `🔥 *أبرز الصاعدين:*`,
    gainersBlock,
    ``,
    `📰 *أخبار:*`,
    newsBlock,
    ``,
    `🎯 *توقع اليوم:*`,
    forecast,
    ``,
    `⚠️ للاستشارة فقط وليس توصية مالية`,
    `🔗 trandsa2030.netlify.app`,
  ].filter((l) => l !== null).join("\n");

  // 7. Optionally send
  let sendResult = "لم يُرسَل (أضف ?send=1 للإرسال)";
  if (shouldSend) {
    const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || "")
      .replace(/\s/g, "").replace(/^TOKEN=/i, "").replace(/^"|"$/g, "").trim();
    const chatId = (process.env.TELEGRAM_CHAT_ID || "")
      .replace(/\s/g, "").replace(/^ID=/i, "").replace(/^"|"$/g, "").trim();
    if (token && chatId) {
      try {
        const r = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
          timeoutMs: 10000,
        });
        const d: any = await r.json().catch(() => ({}));
        sendResult = r.ok ? "✅ أُرسل بنجاح عبر Telegram" : `❌ فشل: ${d.description ?? r.status}`;
      } catch (e: any) {
        sendResult = `❌ خطأ: ${e.message}`;
      }
    } else {
      sendResult = "❌ بيانات Telegram غير مضبوطة في env";
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ steps, message, sendResult }, null, 2),
  };
};
