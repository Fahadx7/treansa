import express from "express";
import serverless from "serverless-http";
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';
import { SAUDI_STOCKS } from '../../src/symbols';

// ========= Yahoo Finance direct fetch (replaces yahoo-finance2 package) =========
const YF_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
};

async function yfChart(symbol: string, interval: string, period1: number): Promise<{ meta: any; quotes: any[] }> {
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${period1}&period2=${period2}`;
    const res = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) throw new Error(`YF chart error ${res.status} for ${symbol}`);
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error(`No chart data for ${symbol}`);
    const timestamps: number[] = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const quotes = timestamps
        .map((t: number, i: number) => ({
            date: new Date(t * 1000),
            open:   q.open?.[i]   ?? null,
            high:   q.high?.[i]   ?? null,
            low:    q.low?.[i]    ?? null,
            close:  q.close?.[i]  ?? null,
            volume: q.volume?.[i] ?? null,
        }))
        .filter((q: any) => q.close !== null && q.close !== undefined);
    return { meta: result.meta, quotes };
}

async function yfQuote(symbols: string | string[]): Promise<any> {
    const list = Array.isArray(symbols) ? symbols.join(',') : symbols;
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(list)}`;
    const res = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) throw new Error(`YF quote error ${res.status}`);
    const data: any = await res.json();
    const results: any[] = data?.quoteResponse?.result || [];
    return Array.isArray(symbols) ? results : (results[0] ?? null);
}

// ========= Telegram =========
const cleanToken = (t: string) => {
    if (!t) return "";
    return t.replace(/\s/g, '').replace(/^TOKEN=/i, '').replace(/^"|"$/g, '').trim();
};
const TOKEN = cleanToken(process.env.TELEGRAM_TOKEN || "");
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "")
    .replace(/\s/g, '').replace(/^ID=/i, '').replace(/^"|"$/g, '').trim();

let botStatus = {
    isValid: false, name: null as string | null, username: null as string | null,
    lastError: null as string | null, lastChecked: null as string | null, isFormatValid: false
};
const isTokenFormatValid = (t: string) => /^\d+:[A-Za-z0-9_-]{35,}$/.test(t);

let activeTrades: Record<string, any> = {};
let customAlerts: { symbol: string, targetPrice?: number, targetRsi?: number, triggered: boolean, createdAt: string }[] = [];
let scanStatus = {
    lastScan: null as string | null, isScanning: false, processedCount: 0, totalCount: 0,
    alerts: [] as any[], topGainers: [] as any[], topLosers: [] as any[],
    liquidityEntry: [] as any[], liquidityExit: [] as any[], waveStocks: [] as any[],
    tickerData: new Map<string, any>(), marketIndex: null as any, telegramBotName: null as string | null
};

async function checkBot() {
    botStatus.lastChecked = new Date().toISOString();
    botStatus.isFormatValid = isTokenFormatValid(TOKEN);
    if (!TOKEN || TOKEN.includes("YOUR_TOKEN")) { botStatus.isValid = false; botStatus.lastError = "التوكن غير مضبوط"; return; }
    if (!botStatus.isFormatValid) { botStatus.isValid = false; botStatus.lastError = "تنسيق التوكن غير صحيح"; return; }
    try {
        const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`);
        const data: any = await res.json();
        if (data.ok) {
            botStatus.isValid = true; botStatus.name = data.result.first_name;
            botStatus.username = data.result.username; botStatus.lastError = null;
            (scanStatus as any).telegramBotName = data.result.username;
        } else { botStatus.isValid = false; botStatus.lastError = `خطأ ${data.error_code}: ${data.description}`; }
    } catch (e) { botStatus.isValid = false; botStatus.lastError = `خطأ في الاتصال: ${e}`; }
}

async function sendTelegramMsg(message: string) {
    if (!TOKEN || TOKEN.includes("YOUR_TOKEN")) return;
    try {
        const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "Markdown" })
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) return { success: false, error: data.description || `HTTP ${res.status}` };
        return { success: true };
    } catch (e) { return { success: false, error: String(e) }; }
}

// ========= Technical Indicators =========
function calculateRSI(closes: number[], period = 14) {
    if (closes.length <= period) return 50;
    let gains: number[] = [], losses: number[] = [];
    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateEMA(data: number[], period: number) {
    if (data.length < period) return data.length > 0 ? data.reduce((a, b) => a + b, 0) / data.length : 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
    return ema;
}

function calculateMACD(closes: number[]) {
    if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
    const macdSeries: number[] = [];
    const startIdx = Math.max(0, closes.length - 35);
    for (let i = startIdx; i < closes.length; i++) {
        const sub = closes.slice(0, i + 1);
        if (sub.length >= 26) macdSeries.push(calculateEMA(sub, 12) - calculateEMA(sub, 26));
    }
    const macdLine = macdSeries[macdSeries.length - 1];
    const signalLine = calculateEMA(macdSeries, 9);
    return { macd: Number(macdLine.toFixed(4)), signal: Number(signalLine.toFixed(4)), histogram: Number((macdLine - signalLine).toFixed(4)) };
}

function calculateBollingerBands(closes: number[], period = 20, multiplier = 2) {
    if (closes.length < period) return { middle: 0, upper: 0, lower: 0 };
    const lastPeriod = closes.slice(-period);
    const middle = lastPeriod.reduce((a, b) => a + b, 0) / period;
    const stdDev = Math.sqrt(lastPeriod.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period);
    return { middle: Number(middle.toFixed(2)), upper: Number((middle + multiplier * stdDev).toFixed(2)), lower: Number((middle - multiplier * stdDev).toFixed(2)) };
}

function calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number {
    if (highs.length < period + 1) return 0;
    const trs: number[] = [];
    for (let i = 1; i < highs.length; i++) {
        trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
    return Number(atr.toFixed(4));
}

function calculateStochasticRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14): { k: number; d: number } {
    if (closes.length < rsiPeriod + stochPeriod + 5) return { k: 50, d: 50 };
    const rsiSeries: number[] = [];
    for (let i = rsiPeriod; i <= closes.length; i++) rsiSeries.push(calculateRSI(closes.slice(0, i), rsiPeriod));
    if (rsiSeries.length < stochPeriod) return { k: 50, d: 50 };
    const kSeries: number[] = [];
    for (let i = stochPeriod - 1; i < rsiSeries.length; i++) {
        const win = rsiSeries.slice(i - stochPeriod + 1, i + 1);
        const minR = Math.min(...win), maxR = Math.max(...win);
        kSeries.push(maxR === minR ? 50 : ((rsiSeries[i] - minR) / (maxR - minR)) * 100);
    }
    const k = kSeries[kSeries.length - 1];
    const d = kSeries.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, kSeries.length);
    return { k: Number(k.toFixed(2)), d: Number(d.toFixed(2)) };
}

// ========= Stock Analysis =========
async function analyzeStock(symbol: string) {
    try {
        const period1 = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
        const result = await yfChart(symbol, '5m', period1);

        if (!result.quotes || result.quotes.length < 50) {
            try {
                const quote = await yfQuote(symbol);
                if (quote) scanStatus.tickerData.set(symbol, {
                    symbol, companyName: SAUDI_STOCKS[symbol.split('.')[0]] || symbol,
                    price: quote.regularMarketPrice, change: quote.regularMarketChangePercent || 0,
                    volume: quote.regularMarketVolume || 0, volumeRatio: 1, rsi: 50, wave: "غير محدد",
                    macd: { macd: 0, signal: 0, histogram: 0 }, bb: { middle: 0, upper: 0, lower: 0 }
                });
            } catch (e) {}
            return;
        }

        const quotes = result.quotes;
        const closes  = quotes.map((q: any) => q.close as number);
        const highs   = quotes.map((q: any) => (q.high  ?? q.close) as number);
        const lows    = quotes.map((q: any) => (q.low   ?? q.close) as number);
        const volumes = quotes.map((q: any) => q.volume as number);
        const lastClose  = closes[closes.length - 1];
        const lastVolume = volumes[volumes.length - 1];
        const sma50      = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
        const rsi        = calculateRSI(closes, 14);
        const macdData   = calculateMACD(closes);
        const bbData     = calculateBollingerBands(closes);
        const atr        = calculateATR(highs, lows, closes, 14);
        const stochRsi   = calculateStochasticRSI(closes, 14, 14);
        const avgVolume  = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const companyName = SAUDI_STOCKS[symbol.split('.')[0]] || symbol;
        const prevClose: number = result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? closes[0];
        const changePercent = prevClose > 0 ? ((lastClose - prevClose) / prevClose) * 100 : 0;
        const volumeRatio   = avgVolume > 0 ? lastVolume / avgVolume : 1;

        // Elliott Waves
        let elliottWave = "غير محدد";
        const windowSize = 10, recentCloses = closes.slice(-40);
        const pivots: { type: 'high' | 'low'; price: number; index: number }[] = [];
        for (let i = windowSize; i < recentCloses.length - windowSize; i++) {
            const c = recentCloses[i], l = recentCloses.slice(i - windowSize, i), r = recentCloses.slice(i + 1, i + windowSize + 1);
            if (c > Math.max(...l) && c > Math.max(...r)) pivots.push({ type: 'high', price: c, index: i });
            else if (c < Math.min(...l) && c < Math.min(...r)) pivots.push({ type: 'low', price: c, index: i });
        }
        if (pivots.length >= 3) {
            const [p0, p1, p2] = pivots.slice(-3);
            if (p0.type === 'low' && p1.type === 'high' && p2.type === 'low') {
                if (p2.price > p0.price && lastClose > p1.price) elliottWave = "بداية الموجة 3 (انفجارية) 🚀";
                else if (p2.price > p0.price) elliottWave = "نهاية الموجة 2 (تصحيح منتهي) ⏳";
            } else if (p0.type === 'high' && p1.type === 'low' && p2.type === 'high' && p2.price < p0.price && lastClose < p1.price) {
                elliottWave = "بداية موجة هابطة 📉";
            }
        } else if (pivots.length >= 2) {
            const [p0, p1] = pivots.slice(-2);
            if (p0.type === 'low' && p1.type === 'high' && lastClose > p1.price) elliottWave = "اختراق قمة سابقة ⚡";
        }

        const stockData = { symbol, companyName, price: lastClose, change: changePercent, volume: lastVolume, volumeRatio, rsi, wave: elliottWave, macd: macdData, bb: bbData, atr, stochRsi };
        scanStatus.tickerData.set(symbol, stockData);
        if (changePercent > 0) scanStatus.topGainers.push(stockData);
        else if (changePercent < 0) scanStatus.topLosers.push(stockData);
        if (volumeRatio > 2 && changePercent > 0) scanStatus.liquidityEntry.push(stockData);
        else if (volumeRatio > 2 && changePercent < 0) scanStatus.liquidityExit.push(stockData);
        if (elliottWave !== "غير محدد") scanStatus.waveStocks.push(stockData);

        const bullishScore = [lastClose > sma50, rsi > 52 && rsi < 72 && stochRsi.k > stochRsi.d, volumeRatio > 1.8, elliottWave.includes("الموجة 3") || elliottWave.includes("اختراق"), atr > 0 && atr < lastClose * 0.03].filter(Boolean).length;

        for (const alert of customAlerts) {
            if (alert.symbol === symbol && !alert.triggered) {
                let triggered = false, reason = "";
                if (alert.targetPrice !== undefined && lastClose >= alert.targetPrice) { triggered = true; reason = `وصل السعر إلى الهدف: ${alert.targetPrice}`; }
                if (alert.targetRsi !== undefined && rsi >= alert.targetRsi) { triggered = true; reason = `وصل RSI إلى الهدف: ${alert.targetRsi}`; }
                if (triggered) {
                    alert.triggered = true;
                    await sendTelegramMsg(`🔔 *تنبيه مخصص!*\n━━━━━━━━━━━━━━━\n🏢 الشركة: *${companyName}*\n📦 الرمز: \`${symbol}\`\n💰 السعر: \`${lastClose.toFixed(2)}\`\n📈 RSI: \`${rsi.toFixed(1)}\`\n📝 السبب: *${reason}*\n━━━━━━━━━━━━━━━\n⚡️ *رادار صائد الفرص الذكي*`);
                    scanStatus.alerts.unshift({ type: 'entry', symbol, companyName, price: lastClose, time: new Date().toISOString(), wave: `تنبيه مخصص: ${reason}` });
                }
            }
        }

        if (activeTrades[symbol]) activeTrades[symbol].wave = elliottWave;

        if (bullishScore >= 3 && !activeTrades[symbol]) {
            const atrSL = atr > 0 ? lastClose - (atr * 1.5) : lastClose * 0.97;
            await sendTelegramMsg(`🚀 *فرصة ذهبية مكتشفة!*\n━━━━━━━━━━━━━━━\n🏢 الشركة: *${companyName}*\n📦 الرمز: \`${symbol}\`\n💰 السعر: \`${lastClose.toFixed(2)}\`\n📈 RSI: \`${rsi.toFixed(1)}\` | Stoch K: \`${stochRsi.k.toFixed(1)}\`\n📊 الحجم: \`${(lastVolume / 1000).toFixed(1)}K\` (${volumeRatio.toFixed(1)}x)\n📉 ATR(14): \`${atr.toFixed(3)}\`\n━━━━━━━━━━━━━━━\n🎯 +3%: \`${(lastClose * 1.03).toFixed(2)}\` | +5%: \`${(lastClose * 1.05).toFixed(2)}\`\n🛑 وقف الخسارة: \`${atrSL.toFixed(2)}\` (1.5× ATR)\n━━━━━━━━━━━━━━━\n⚡️ *رادار صائد الفرص الذكي*`);
            activeTrades[symbol] = { symbol, companyName, entryPrice: lastClose, entryTime: new Date().toISOString(), rsi, sma50, wave: elliottWave };
            scanStatus.alerts.unshift({ type: 'entry', symbol, companyName, price: lastClose, wave: elliottWave, time: new Date().toISOString() });
        }

        if ((lastClose < sma50 || rsi > 82 || rsi < 38) && activeTrades[symbol]) {
            const entryPrice = activeTrades[symbol].entryPrice;
            const profit = ((lastClose - entryPrice) / entryPrice) * 100;
            const reason = lastClose < sma50 ? "كسر متوسط 50" : rsi > 82 ? "تشبع شرائي (RSI > 82)" : "ضعف الزخم (RSI < 38)";
            await sendTelegramMsg(`⚠️ *تنبيه خروج!*\n🏢 ${companyName} | ${symbol}\n💵 سعر الخروج: \`${lastClose.toFixed(2)}\`\n${profit >= 0 ? "💰" : "📉"} النتيجة: \`${profit.toFixed(2)}%\`\n🛑 السبب: ${reason}.`);
            delete activeTrades[symbol];
            scanStatus.alerts.unshift({ type: 'exit', symbol, companyName, price: lastClose, profit, time: new Date().toISOString() });
        }
    } catch (e: any) {
        if (e.message?.includes('No data') || e.message?.includes('delisted')) return;
        console.error(`❌ خطأ في تحليل ${symbol}:`, e.message || e);
    }
}

async function startFullScan() {
    if (scanStatus.isScanning) return;
    scanStatus.isScanning = true;
    scanStatus.processedCount = 0;
    scanStatus.topGainers = []; scanStatus.topLosers = [];
    scanStatus.liquidityEntry = []; scanStatus.liquidityExit = [];
    scanStatus.waveStocks = [];

    try {
        const tasiResult = await yfQuote('^TASI');
        if (tasiResult) scanStatus.marketIndex = { price: tasiResult.regularMarketPrice, change: tasiResult.regularMarketChange, changePercent: tasiResult.regularMarketChangePercent, high: tasiResult.regularMarketDayHigh, low: tasiResult.regularMarketDayLow, volume: tasiResult.regularMarketVolume, time: new Date().toISOString() };
    } catch (e) {}

    const symbols = Object.keys(SAUDI_STOCKS).map(s => `${s}.SR`);
    scanStatus.totalCount = symbols.length;

    // Step 1: Bulk quotes (20 at a time)
    for (let i = 0; i < symbols.length; i += 20) {
        const chunk = symbols.slice(i, i + 20);
        try {
            const quotes = await yfQuote(chunk);
            if (Array.isArray(quotes)) {
                for (const q of quotes) {
                    if (!q?.symbol) continue;
                    scanStatus.tickerData.set(q.symbol, { symbol: q.symbol, companyName: SAUDI_STOCKS[q.symbol.split('.')[0]] || q.symbol, price: q.regularMarketPrice || 0, change: q.regularMarketChangePercent || 0, volume: q.regularMarketVolume || 0, volumeRatio: 1, rsi: 50, wave: "جاري التحليل...", macd: { macd: 0, signal: 0, histogram: 0 }, bb: { middle: 0, upper: 0, lower: 0 } });
                }
            }
        } catch (e: any) {
            for (const s of chunk) {
                try {
                    const q = await yfQuote(s);
                    if (q?.symbol) scanStatus.tickerData.set(q.symbol, { symbol: q.symbol, companyName: SAUDI_STOCKS[q.symbol.split('.')[0]] || q.symbol, price: q.regularMarketPrice || 0, change: q.regularMarketChangePercent || 0, volume: q.regularMarketVolume || 0, volumeRatio: 1, rsi: 50, wave: "جاري التحليل...", macd: { macd: 0, signal: 0, histogram: 0 }, bb: { middle: 0, upper: 0, lower: 0 } });
                } catch (innerE) {}
            }
        }
        await new Promise(r => setTimeout(r, 300));
    }

    // Step 2: Deep analysis in small chunks
    for (let i = 0; i < symbols.length; i += 5) {
        const chunk = symbols.slice(i, i + 5);
        await Promise.all(chunk.map(async s => {
            let retries = 2;
            while (retries > 0) {
                try { await analyzeStock(s); break; }
                catch (e) { retries--; if (retries > 0) await new Promise(r => setTimeout(r, 1000)); }
            }
        }));
        scanStatus.processedCount += chunk.length;
        await new Promise(r => setTimeout(r, 1000));
    }

    scanStatus.isScanning = false;
    scanStatus.lastScan = new Date().toISOString();
    scanStatus.topGainers.sort((a, b) => b.change - a.change).splice(10);
    scanStatus.topLosers.sort((a, b) => a.change - b.change).splice(10);
    scanStatus.liquidityEntry.sort((a, b) => b.volumeRatio - a.volumeRatio).splice(10);
    scanStatus.liquidityExit.sort((a, b) => b.volumeRatio - a.volumeRatio).splice(10);
}

// ========= Rate Limiter =========
const _rlStore = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now(), rec = _rlStore.get(ip);
    if (!rec || now > rec.resetAt) { _rlStore.set(ip, { count: 1, resetAt: now + windowMs }); return true; }
    if (rec.count >= maxRequests) return false;
    rec.count++; return true;
}

function isValidSaudiSymbol(symbol: string): boolean {
    if (typeof symbol !== 'string') return false;
    const clean = symbol.replace(/\.SR$/i, '');
    return /^\d{4}$/.test(clean) && Object.prototype.hasOwnProperty.call(SAUDI_STOCKS, clean);
}

// ========= Express App =========
const app = express();

app.use((_, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50kb' }));

app.get("/api/status", (req, res) => {
    res.json({
        ...scanStatus, tickerData: Array.from(scanStatus.tickerData.values()),
        activeTradesCount: Object.keys(activeTrades).length,
        activeTrades: Object.values(activeTrades),
        customAlerts: customAlerts.filter(a => !a.triggered),
        telegramConnected: botStatus.isValid, telegramBotName: botStatus.username,
        botStatusError: botStatus.isValid ? null : botStatus.lastError
    });
});

app.post("/api/feedback", async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip + ':feedback', 5, 60_000)) return res.status(429).json({ success: false, error: "تجاوزت الحد المسموح." });
    const { name, email, message, type } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length < 5 || message.length > 2000) return res.status(400).json({ success: false, error: "الرسالة يجب أن تكون بين 5 و 2000 حرف." });
    if (botStatus.isValid && CHAT_ID) {
        try { await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: CHAT_ID, text: `📝 *ملاحظة*\n👤 ${name || 'مجهول'}\n📧 ${email || '-'}\n🏷️ ${type || 'عام'}\n\n${message}`, parse_mode: 'Markdown' }) }); } catch (e) {}
    }
    res.json({ success: true, message: "تم استلام ملاحظتك بنجاح، شكراً لك!" });
});

app.post("/api/alerts", (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip + ':alerts', 10, 60_000)) return res.status(429).json({ success: false, error: "تجاوزت الحد المسموح." });
    const { symbol, targetPrice, targetRsi } = req.body;
    if (!symbol || !isValidSaudiSymbol(symbol)) return res.status(400).json({ success: false, error: "رمز السهم غير صالح" });
    const parsedPrice = targetPrice ? parseFloat(targetPrice) : undefined;
    const parsedRsi   = targetRsi   ? parseFloat(targetRsi)   : undefined;
    if (parsedPrice !== undefined && (isNaN(parsedPrice) || parsedPrice <= 0)) return res.status(400).json({ success: false, error: "قيمة السعر غير صالحة" });
    if (parsedRsi !== undefined && (isNaN(parsedRsi) || parsedRsi < 0 || parsedRsi > 100)) return res.status(400).json({ success: false, error: "قيمة RSI يجب أن تكون بين 0 و 100" });
    if (!parsedPrice && !parsedRsi) return res.status(400).json({ success: false, error: "يجب تحديد سعر أو RSI مستهدف" });
    const newAlert = { symbol, targetPrice: parsedPrice, targetRsi: parsedRsi, triggered: false, createdAt: new Date().toISOString() };
    customAlerts.push(newAlert);
    res.json({ success: true, alert: newAlert });
});

app.post("/api/test-telegram", async (req, res) => {
    try {
        await checkBot();
        if (!botStatus.isValid) throw new Error(botStatus.lastError || "فشل التحقق من البوت");
        const result = await sendTelegramMsg(`🔔 *رسالة تجريبية*\n✅ الإعدادات صحيحة!\n🤖 البوت: ${botStatus.name} (@${botStatus.username})\n⏰ ${new Date().toLocaleTimeString()}`);
        if (result && !result.success) throw new Error((result as any).error);
        res.json({ success: true, message: `تم الإرسال عبر @${botStatus.username}`, chatId: CHAT_ID, botName: botStatus.name });
    } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

app.post("/api/scan", async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip + ':scan', 2, 120_000)) return res.status(429).json({ success: false, message: "يمكنك طلب المسح مرتين كل دقيقتين فقط." });
    if (scanStatus.isScanning) return res.status(400).json({ success: false, message: "جاري المسح بالفعل" });
    startFullScan().catch(err => console.error("❌ خطأ في المسح:", err));
    res.json({ success: true, message: "بدأ المسح اليدوي" });
});

app.get("/api/history/:symbol", async (req, res) => {
    const { symbol } = req.params;
    if (!isValidSaudiSymbol(symbol)) return res.status(400).json({ success: false, error: "رمز السهم غير صالح" });
    try {
        const period1 = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
        const result = await yfChart(symbol, '1h', period1);
        if (!result.quotes.length) return res.json({ success: false, error: "بيانات غير متوفرة" });
        const startIndex = Math.max(0, result.quotes.length - 50);
        const history = result.quotes.slice(startIndex).map((q: any, i: number) => {
            const sub = result.quotes.slice(0, startIndex + i + 1).map((sq: any) => sq.close as number);
            const macd = calculateMACD(sub), bb = calculateBollingerBands(sub);
            return { time: new Date(q.date).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }), fullDate: q.date, price: Number(q.close.toFixed(2)), macd: macd.macd, signal: macd.signal, histogram: macd.histogram, bbUpper: bb.upper, bbMiddle: bb.middle, bbLower: bb.lower };
        });
        res.json({ success: true, history });
    } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/ai-analysis", async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip + ':ai', 10, 60_000)) return res.status(429).json({ success: false, error: "تجاوزت الحد المسموح." });
    const { symbol, companyName, price, change, rsi, wave, macd, bb, atr, stochRsi: stoch } = req.body;
    if (!symbol || !isValidSaudiSymbol(symbol)) return res.status(400).json({ success: false, error: "رمز السهم غير صالح" });
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ success: false, error: "مفتاح Gemini غير مضبوط في الخادم." });
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `أنت خبير مالي محترف في السوق السعودي (تاسي). حلل السهم التالي وقدم توصية باللغة العربية.
الشركة: ${companyName} (${symbol}) | السعر: ${price} | التغير: ${change?.toFixed?.(2) ?? change}%
RSI(14): ${rsi?.toFixed?.(1) ?? rsi} | Stoch RSI: K=${stoch?.k ?? 'N/A'} D=${stoch?.d ?? 'N/A'}
موجة إليوت: ${wave || 'غير محدد'} | MACD Histogram: ${macd?.histogram ?? 'N/A'}
BB: Upper=${bb?.upper ?? 'N/A'} Lower=${bb?.lower ?? 'N/A'} | ATR(14): ${atr ?? 'N/A'}
قدم: 1) الاتجاه المتوقع ومستوى الثقة 2) نقاط الدخول المثالية 3) الأهداف السعرية 4) وقف الخسارة 5) إدارة المخاطر`;
        const response = await ai.models.generateContent({ model: "gemini-2.0-flash", contents: [{ parts: [{ text: prompt }] }] });
        res.json({ success: true, analysis: response.text });
    } catch (e: any) { res.status(500).json({ success: false, error: "فشل تحليل الذكاء الاصطناعي." }); }
});

app.post("/api/ai-news", async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip + ':ai-news', 5, 60_000)) return res.status(429).json({ success: false, error: "تجاوزت الحد المسموح." });
    const { symbol, companyName } = req.body;
    if (!symbol || !isValidSaudiSymbol(symbol)) return res.status(400).json({ success: false, error: "رمز السهم غير صالح" });
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ success: false, error: "مفتاح Gemini غير مضبوط." });
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ parts: [{ text: `ابحث عن آخر الأخبار المتعلقة بشركة ${companyName} (${symbol}) في السوق السعودي. قدم أهم 5 أخبار حديثة بتنسيق JSON فقط.` }] }],
            config: { tools: [{ googleSearch: {} }], responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, summary: { type: Type.STRING }, date: { type: Type.STRING }, source: { type: Type.STRING }, url: { type: Type.STRING } }, required: ["title", "summary", "date", "source", "url"] } } }
        });
        try { const newsData = JSON.parse(response.text || "[]"); res.json({ success: true, news: Array.isArray(newsData) ? newsData : [] }); }
        catch { res.json({ success: true, news: [] }); }
    } catch (e: any) { res.status(500).json({ success: false, error: "فشل جلب الأخبار." }); }
});

app.post("/api/ai-logo", async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip + ':logo', 3, 300_000)) return res.status(429).json({ success: false, error: "يمكنك توليد 3 شعارات كل 5 دقائق فقط." });
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ success: false, error: "مفتاح Gemini غير مضبوط." });
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({ model: 'gemini-2.0-flash-preview-image-generation', contents: [{ parts: [{ text: "A professional modern logo for a smart trading platform named 'trandsa'. Stylized upward trend line, AI elements, emerald green and deep blue. Minimalist, white background, vector style." }] }], config: { responseModalities: ['TEXT', 'IMAGE'] } });
        const images: string[] = [];
        for (const part of (response.candidates?.[0]?.content?.parts ?? [])) {
            if ((part as any).inlineData) images.push(`data:image/png;base64,${(part as any).inlineData.data}`);
        }
        res.json({ success: true, images });
    } catch (e: any) { res.status(500).json({ success: false, error: "فشل توليد الشعار." }); }
});

export const handler = serverless(app);
