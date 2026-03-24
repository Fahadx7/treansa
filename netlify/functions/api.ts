import express from "express";
import serverless from "serverless-http";
import yahooFinance from 'yahoo-finance2';
import fetch from 'node-fetch';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';
import { SAUDI_STOCKS } from '../../src/symbols';

// تعطيل schema validation في yahoo-finance2 v3
yahooFinance.setGlobalConfig({
    validation: { logErrors: false, logNotices: false }
});

// --- إعدادات التليجرام ---
const cleanToken = (t: string) => {
    if (!t) return "";
    return t.replace(/\s/g, '')
            .replace(/^TOKEN=/i, '')
            .replace(/^"|"$/g, '')
            .trim();
};

const TOKEN = cleanToken(process.env.TELEGRAM_TOKEN || "");
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "")
    .replace(/\s/g, '')
    .replace(/^ID=/i, '')
    .replace(/^"|"$/g, '')
    .trim();

// حالة البوت (per-invocation في بيئة serverless)
let botStatus = {
    isValid: false,
    name: null as string | null,
    username: null as string | null,
    lastError: null as string | null,
    lastChecked: null as string | null,
    isFormatValid: false
};

const isTokenFormatValid = (t: string) => /^\d+:[A-Za-z0-9_-]{35,}$/.test(t);

// مخزن الحالة (في serverless تكون ephemeral لكل invocation)
let activeTrades: Record<string, any> = {};
let customAlerts: { symbol: string, targetPrice?: number, targetRsi?: number, triggered: boolean, createdAt: string }[] = [];

let scanStatus = {
    lastScan: null as string | null,
    isScanning: false,
    processedCount: 0,
    totalCount: 0,
    alerts: [] as any[],
    topGainers: [] as any[],
    topLosers: [] as any[],
    liquidityEntry: [] as any[],
    liquidityExit: [] as any[],
    waveStocks: [] as any[],
    tickerData: new Map<string, any>(),
    marketIndex: null as any,
    telegramBotName: null as string | null
};

async function checkBot() {
    botStatus.lastChecked = new Date().toISOString();
    botStatus.isFormatValid = isTokenFormatValid(TOKEN);

    if (!TOKEN || TOKEN.includes("YOUR_TOKEN")) {
        botStatus.isValid = false;
        botStatus.lastError = "التوكن غير مضبوط";
        return;
    }
    if (!botStatus.isFormatValid) {
        botStatus.isValid = false;
        botStatus.lastError = "تنسيق التوكن غير صحيح";
        return;
    }
    try {
        const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`);
        const data: any = await res.json();
        if (data.ok) {
            botStatus.isValid = true;
            botStatus.name = data.result.first_name;
            botStatus.username = data.result.username;
            botStatus.lastError = null;
            (scanStatus as any).telegramBotName = data.result.username;
        } else {
            botStatus.isValid = false;
            botStatus.lastError = `خطأ ${data.error_code}: ${data.description}`;
        }
    } catch (e) {
        botStatus.isValid = false;
        botStatus.lastError = `خطأ في الاتصال: ${e}`;
    }
}

async function sendTelegramMsg(message: string) {
    if (!TOKEN || TOKEN.includes("YOUR_TOKEN")) return;
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "Markdown" })
        });
        const data: any = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: data.description || `HTTP ${response.status}` };
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

function calculateRSI(closes: number[], period = 14) {
    if (closes.length <= period) return 50;
    let gains: number[] = [];
    let losses: number[] = [];
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
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateEMA(data: number[], period: number) {
    if (data.length < period) return data.length > 0 ? data.reduce((a, b) => a + b, 0) / data.length : 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateMACD(closes: number[]) {
    if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
    const macdSeries: number[] = [];
    const minRequired = 26 + 9;
    const startIdx = Math.max(0, closes.length - minRequired);
    for (let i = startIdx; i < closes.length; i++) {
        const subCloses = closes.slice(0, i + 1);
        if (subCloses.length >= 26) {
            macdSeries.push(calculateEMA(subCloses, 12) - calculateEMA(subCloses, 26));
        }
    }
    const macdLine = macdSeries[macdSeries.length - 1];
    const signalLine = calculateEMA(macdSeries, 9);
    const histogram = macdLine - signalLine;
    return {
        macd: Number(macdLine.toFixed(4)),
        signal: Number(signalLine.toFixed(4)),
        histogram: Number(histogram.toFixed(4))
    };
}

function calculateBollingerBands(closes: number[], period = 20, multiplier = 2) {
    if (closes.length < period) return { middle: 0, upper: 0, lower: 0 };
    const lastPeriod = closes.slice(-period);
    const middle = lastPeriod.reduce((a, b) => a + b, 0) / period;
    const variance = lastPeriod.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return {
        middle: Number(middle.toFixed(2)),
        upper: Number((middle + multiplier * stdDev).toFixed(2)),
        lower: Number((middle - multiplier * stdDev).toFixed(2))
    };
}

function calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number {
    if (highs.length < period + 1) return 0;
    const trs: number[] = [];
    for (let i = 1; i < highs.length; i++) {
        trs.push(Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        ));
    }
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
    }
    return Number(atr.toFixed(4));
}

function calculateStochasticRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14): { k: number; d: number } {
    const minLen = rsiPeriod + stochPeriod + 5;
    if (closes.length < minLen) return { k: 50, d: 50 };
    const rsiSeries: number[] = [];
    for (let i = rsiPeriod; i <= closes.length; i++) {
        rsiSeries.push(calculateRSI(closes.slice(0, i), rsiPeriod));
    }
    if (rsiSeries.length < stochPeriod) return { k: 50, d: 50 };
    const kSeries: number[] = [];
    for (let i = stochPeriod - 1; i < rsiSeries.length; i++) {
        const window = rsiSeries.slice(i - stochPeriod + 1, i + 1);
        const minRSI = Math.min(...window);
        const maxRSI = Math.max(...window);
        kSeries.push(maxRSI === minRSI ? 50 : ((rsiSeries[i] - minRSI) / (maxRSI - minRSI)) * 100);
    }
    const k = kSeries[kSeries.length - 1];
    const dWindow = kSeries.slice(-3);
    const d = dWindow.reduce((a, b) => a + b, 0) / dWindow.length;
    return { k: Number(k.toFixed(2)), d: Number(d.toFixed(2)) };
}

async function analyzeStock(symbol: string) {
    try {
        const period1 = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
        const result = await yahooFinance.chart(symbol, { interval: '5m', period1 }, { validateResult: false }) as any;

        if (!result || !result.quotes || result.quotes.length < 50) {
            try {
                const quote = await yahooFinance.quote(symbol, {}, { validateResult: false }) as any;
                if (quote) {
                    scanStatus.tickerData.set(symbol, {
                        symbol,
                        companyName: SAUDI_STOCKS[symbol.split('.')[0]] || symbol,
                        price: quote.regularMarketPrice,
                        change: quote.regularMarketChangePercent || 0,
                        volume: quote.regularMarketVolume || 0,
                        volumeRatio: 1, rsi: 50, wave: "غير محدد",
                        macd: { macd: 0, signal: 0, histogram: 0 },
                        bb: { middle: 0, upper: 0, lower: 0 }
                    });
                }
            } catch (e) {}
            return;
        }

        const quotes = (result.quotes as any[]).filter(q => q.close !== null && q.volume !== null);
        if (quotes.length < 50) return;

        const closes  = quotes.map(q => q.close as number);
        const highs   = quotes.map(q => (q.high  ?? q.close) as number);
        const lows    = quotes.map(q => (q.low   ?? q.close) as number);
        const volumes = quotes.map(q => q.volume as number);

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
        const windowSize = 10;
        const recentCloses = closes.slice(-40);
        const pivots: { type: 'high' | 'low', price: number, index: number }[] = [];
        for (let i = windowSize; i < recentCloses.length - windowSize; i++) {
            const current = recentCloses[i];
            const left  = recentCloses.slice(i - windowSize, i);
            const right = recentCloses.slice(i + 1, i + windowSize + 1);
            if (current > Math.max(...left) && current > Math.max(...right)) {
                pivots.push({ type: 'high', price: current, index: i });
            } else if (current < Math.min(...left) && current < Math.min(...right)) {
                pivots.push({ type: 'low', price: current, index: i });
            }
        }
        if (pivots.length >= 3) {
            const last3 = pivots.slice(-3);
            if (last3[0].type === 'low' && last3[1].type === 'high' && last3[2].type === 'low') {
                if (last3[2].price > last3[0].price && lastClose > last3[1].price) {
                    elliottWave = "بداية الموجة 3 (انفجارية) 🚀";
                } else if (last3[2].price > last3[0].price && lastClose < last3[1].price) {
                    elliottWave = "نهاية الموجة 2 (تصحيح منتهي) ⏳";
                }
            } else if (last3[0].type === 'high' && last3[1].type === 'low' && last3[2].type === 'high') {
                if (last3[2].price < last3[0].price && lastClose < last3[1].price) {
                    elliottWave = "بداية موجة هابطة 📉";
                }
            }
        } else if (pivots.length >= 2) {
            const last2 = pivots.slice(-2);
            if (last2[0].type === 'low' && last2[1].type === 'high' && lastClose > last2[1].price) {
                elliottWave = "اختراق قمة سابقة ⚡";
            }
        }

        const stockData = {
            symbol, companyName,
            price: lastClose, change: changePercent,
            volume: lastVolume, volumeRatio,
            rsi, wave: elliottWave,
            macd: macdData, bb: bbData, atr, stochRsi
        };

        scanStatus.tickerData.set(symbol, stockData);
        if (changePercent > 0) scanStatus.topGainers.push(stockData);
        else if (changePercent < 0) scanStatus.topLosers.push(stockData);
        if (volumeRatio > 2 && changePercent > 0) scanStatus.liquidityEntry.push(stockData);
        else if (volumeRatio > 2 && changePercent < 0) scanStatus.liquidityExit.push(stockData);
        if (elliottWave !== "غير محدد") scanStatus.waveStocks.push(stockData);

        const isBullishWave     = elliottWave.includes("الموجة 3") || elliottWave.includes("اختراق");
        const isVolumeBreakout  = volumeRatio > 1.8;
        const isRsiBullish      = rsi > 52 && rsi < 72 && stochRsi.k > stochRsi.d;
        const isPriceAboveSma   = lastClose > sma50;
        const isVolatilityNormal = atr > 0 && atr < lastClose * 0.03;
        const bullishScore = [isPriceAboveSma, isRsiBullish, isVolumeBreakout, isBullishWave, isVolatilityNormal].filter(Boolean).length;

        for (const alert of customAlerts) {
            if (alert.symbol === symbol && !alert.triggered) {
                let triggered = false;
                let reason = "";
                if (alert.targetPrice !== undefined && lastClose >= alert.targetPrice) {
                    triggered = true; reason = `وصل السعر إلى الهدف: ${alert.targetPrice}`;
                }
                if (alert.targetRsi !== undefined && rsi >= alert.targetRsi) {
                    triggered = true; reason = `وصل RSI إلى الهدف: ${alert.targetRsi}`;
                }
                if (triggered) {
                    alert.triggered = true;
                    await sendTelegramMsg(
                        `🔔 *تنبيه مخصص!*\n━━━━━━━━━━━━━━━\n🏢 الشركة: *${companyName}*\n📦 الرمز: \`${symbol}\`\n💰 السعر الحالي: \`${lastClose.toFixed(2)}\`\n📈 RSI الحالي: \`${rsi.toFixed(1)}\`\n📝 السبب: *${reason}*\n━━━━━━━━━━━━━━━\n⚡️ *رادار صائد الفرص الذكي*`
                    );
                    scanStatus.alerts.unshift({ type: 'entry', symbol, companyName, price: lastClose, time: new Date().toISOString(), wave: `تنبيه مخصص: ${reason}` });
                }
            }
        }

        if (activeTrades[symbol]) activeTrades[symbol].wave = elliottWave;

        if (bullishScore >= 3 && !activeTrades[symbol]) {
            const atrSL = atr > 0 ? lastClose - (atr * 1.5) : lastClose * 0.97;
            const waveInfo = elliottWave !== "غير محدد" ? `\n🌊 الموجة: *${elliottWave}*` : "";
            await sendTelegramMsg(
                `🚀 *فرصة ذهبية مكتشفة!*\n━━━━━━━━━━━━━━━\n🏢 الشركة: *${companyName}*\n📦 الرمز: \`${symbol}\`\n💰 السعر: \`${lastClose.toFixed(2)}\`\n📈 RSI: \`${rsi.toFixed(1)}\` | Stoch K: \`${stochRsi.k.toFixed(1)}\`\n📊 الحجم: \`${(lastVolume/1000).toFixed(1)}K\` (${volumeRatio.toFixed(1)}x)\n📉 ATR(14): \`${atr.toFixed(3)}\`${waveInfo}\n━━━━━━━━━━━━━━━\n🎯 الهدف الأول: \`${(lastClose * 1.03).toFixed(2)}\` (+3%)\n🎯 الهدف الثاني: \`${(lastClose * 1.05).toFixed(2)}\` (+5%)\n🛑 وقف الخسارة: \`${atrSL.toFixed(2)}\` (1.5× ATR)\n━━━━━━━━━━━━━━━\n⚡️ *رادار صائد الفرص الذكي*`
            );
            activeTrades[symbol] = { symbol, companyName, entryPrice: lastClose, entryTime: new Date().toISOString(), rsi, sma50, wave: elliottWave };
            scanStatus.alerts.unshift({ type: 'entry', symbol, companyName, price: lastClose, wave: elliottWave, time: new Date().toISOString() });
        }

        const isRsiOverbought = rsi > 82;
        const isPriceBelowSma = lastClose < sma50;
        const isRsiWeakening  = rsi < 38;
        if ((isPriceBelowSma || isRsiOverbought || isRsiWeakening) && activeTrades[symbol]) {
            const entryPrice = activeTrades[symbol].entryPrice;
            const profit = ((lastClose - entryPrice) / entryPrice) * 100;
            const profitEmoji = profit >= 0 ? "💰" : "📉";
            const exitReason = isPriceBelowSma ? "كسر متوسط 50 لأسفل" : isRsiOverbought ? "تشبع شرائي (RSI > 82)" : "ضعف الزخم (RSI < 38)";
            await sendTelegramMsg(`⚠️ *تنبيه جني أرباح / خروج!*\n\n🏢 الشركة: *${companyName}*\n📦 الرمز: \`${symbol}\`\n💵 سعر الخروج: \`${lastClose.toFixed(2)}\`\n${profitEmoji} النتيجة: \`${profit.toFixed(2)}%\`\n🛑 السبب: ${exitReason}.`);
            delete activeTrades[symbol];
            scanStatus.alerts.unshift({ type: 'exit', symbol, companyName, price: lastClose, profit, time: new Date().toISOString() });
        }
    } catch (e: any) {
        if (e.message?.includes('No data found') || e.message?.includes('delisted')) return;
        console.error(`❌ خطأ في تحليل ${symbol}:`, e.message || e);
    }
}

async function startFullScan() {
    if (scanStatus.isScanning) return;
    scanStatus.isScanning = true;
    scanStatus.processedCount = 0;
    scanStatus.topGainers = [];
    scanStatus.topLosers = [];
    scanStatus.liquidityEntry = [];
    scanStatus.liquidityExit = [];
    scanStatus.waveStocks = [];

    try {
        const tasiResult = await yahooFinance.quote('^TASI', {}, { validateResult: false }) as any;
        if (tasiResult) {
            scanStatus.marketIndex = {
                price: tasiResult.regularMarketPrice,
                change: tasiResult.regularMarketChange,
                changePercent: tasiResult.regularMarketChangePercent,
                high: tasiResult.regularMarketDayHigh,
                low: tasiResult.regularMarketDayLow,
                volume: tasiResult.regularMarketVolume,
                time: new Date().toISOString()
            };
        }
    } catch (e) { console.error("خطأ في جلب المؤشر العام:", e); }

    const symbols = Object.keys(SAUDI_STOCKS).map(s => `${s}.SR`);
    scanStatus.totalCount = symbols.length;

    const quoteChunkSize = 20;
    for (let i = 0; i < symbols.length; i += quoteChunkSize) {
        const chunk = symbols.slice(i, i + quoteChunkSize);
        try {
            const quotes = await yahooFinance.quote(chunk, {}, { validateResult: false }) as any;
            if (Array.isArray(quotes)) {
                for (const q of quotes) {
                    if (!q || !q.symbol) continue;
                    scanStatus.tickerData.set(q.symbol, {
                        symbol: q.symbol,
                        companyName: SAUDI_STOCKS[q.symbol.split('.')[0]] || q.symbol,
                        price: q.regularMarketPrice || 0,
                        change: q.regularMarketChangePercent || 0,
                        volume: q.regularMarketVolume || 0,
                        volumeRatio: 1, rsi: 50, wave: "جاري التحليل...",
                        macd: { macd: 0, signal: 0, histogram: 0 },
                        bb: { middle: 0, upper: 0, lower: 0 }
                    });
                }
            }
        } catch (e: any) {
            for (const s of chunk) {
                try {
                    const q = await yahooFinance.quote(s, {}, { validateResult: false }) as any;
                    if (q && q.symbol) {
                        scanStatus.tickerData.set(q.symbol, {
                            symbol: q.symbol,
                            companyName: SAUDI_STOCKS[q.symbol.split('.')[0]] || q.symbol,
                            price: q.regularMarketPrice || 0,
                            change: q.regularMarketChangePercent || 0,
                            volume: q.regularMarketVolume || 0,
                            volumeRatio: 1, rsi: 50, wave: "جاري التحليل...",
                            macd: { macd: 0, signal: 0, histogram: 0 },
                            bb: { middle: 0, upper: 0, lower: 0 }
                        });
                    }
                } catch (innerE) {}
            }
        }
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    const chunkSize = 5;
    for (let i = 0; i < symbols.length; i += chunkSize) {
        const chunk = symbols.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (s) => {
            let retries = 2;
            while (retries > 0) {
                try { await analyzeStock(s); break; }
                catch (e) { retries--; if (retries > 0) await new Promise(r => setTimeout(r, 1000)); }
            }
        }));
        scanStatus.processedCount += chunk.length;
        await new Promise(resolve => setTimeout(resolve, 1000));
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
    const now = Date.now();
    const rec = _rlStore.get(ip);
    if (!rec || now > rec.resetAt) {
        _rlStore.set(ip, { count: 1, resetAt: now + windowMs });
        return true;
    }
    if (rec.count >= maxRequests) return false;
    rec.count++;
    return true;
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
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50kb' }));

app.get("/api/status", (req, res) => {
    const tickerArray = Array.from(scanStatus.tickerData.values());
    res.json({
        ...scanStatus,
        tickerData: tickerArray,
        activeTradesCount: Object.keys(activeTrades).length,
        activeTrades: Object.values(activeTrades),
        customAlerts: customAlerts.filter(a => !a.triggered),
        telegramConnected: botStatus.isValid,
        telegramBotName: botStatus.username,
        botStatusError: botStatus.isValid ? null : botStatus.lastError
    });
});

app.post("/api/feedback", async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip + ':feedback', 5, 60_000)) {
        return res.status(429).json({ success: false, error: "تجاوزت الحد المسموح. انتظر دقيقة." });
    }
    const { name, email, message, type } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length < 5 || message.length > 2000) {
        return res.status(400).json({ success: false, error: "الرسالة يجب أن تكون بين 5 و 2000 حرف." });
    }
    if (botStatus.isValid && CHAT_ID) {
        const text = `📝 *ملاحظة جديدة من مستخدم*\n\n👤 *الاسم:* ${name || 'غير معروف'}\n📧 *الإيميل:* ${email || 'غير متوفر'}\n🏷️ *النوع:* ${type || 'عام'}\n\n💬 *الرسالة:*\n${message}`;
        try {
            await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' })
            });
        } catch (e) { console.error("فشل إرسال الملاحظة لتليجرام:", e); }
    }
    res.json({ success: true, message: "تم استلام ملاحظتك بنجاح، شكراً لك!" });
});

app.post("/api/alerts", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip + ':alerts', 10, 60_000)) {
        return res.status(429).json({ success: false, error: "تجاوزت الحد المسموح." });
    }
    const { symbol, targetPrice, targetRsi } = req.body;
    if (!symbol || !isValidSaudiSymbol(symbol)) {
        return res.status(400).json({ success: false, error: "رمز السهم غير صالح" });
    }
    const parsedPrice = targetPrice ? parseFloat(targetPrice) : undefined;
    const parsedRsi   = targetRsi   ? parseFloat(targetRsi)   : undefined;
    if (parsedPrice !== undefined && (isNaN(parsedPrice) || parsedPrice <= 0)) {
        return res.status(400).json({ success: false, error: "قيمة السعر غير صالحة" });
    }
    if (parsedRsi !== undefined && (isNaN(parsedRsi) || parsedRsi < 0 || parsedRsi > 100)) {
        return res.status(400).json({ success: false, error: "قيمة RSI يجب أن تكون بين 0 و 100" });
    }
    if (!parsedPrice && !parsedRsi) {
        return res.status(400).json({ success: false, error: "يجب تحديد سعر أو RSI مستهدف" });
    }
    const newAlert = { symbol, targetPrice: parsedPrice, targetRsi: parsedRsi, triggered: false, createdAt: new Date().toISOString() };
    customAlerts.push(newAlert);
    res.json({ success: true, alert: newAlert });
});

app.post("/api/test-telegram", async (req, res) => {
    try {
        await checkBot();
        if (!botStatus.isValid) throw new Error(botStatus.lastError || "فشل التحقق من البوت");
        const testMsg = `🔔 *رسالة تجريبية من رادار صائد الفرص*\n\n✅ الإعدادات صحيحة!\n🤖 البوت: ${botStatus.name} (@${botStatus.username})\n🆔 رقم الدردشة: \`${CHAT_ID}\`\n⏰ الوقت: ${new Date().toLocaleTimeString()}\n\nإذا وصلت هذه الرسالة، فكل شيء يعمل بشكل مثالي!`;
        const result = await sendTelegramMsg(testMsg);
        if (result && !result.success) throw new Error((result as any).error);
        res.json({ success: true, message: `تم الإرسال بنجاح عبر البوت @${botStatus.username}`, chatId: CHAT_ID, botName: botStatus.name });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/api/scan", async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip + ':scan', 2, 120_000)) {
        return res.status(429).json({ success: false, message: "يمكنك طلب المسح مرتين كل دقيقتين فقط." });
    }
    if (scanStatus.isScanning) {
        return res.status(400).json({ success: false, message: "جاري المسح بالفعل" });
    }
    // في بيئة serverless نبدأ المسح ونعيد الاستجابة فوراً
    startFullScan().catch(err => console.error("❌ خطأ في المسح:", err));
    res.json({ success: true, message: "بدأ المسح اليدوي" });
});

app.get("/api/history/:symbol", async (req, res) => {
    const { symbol } = req.params;
    if (!isValidSaudiSymbol(symbol)) {
        return res.status(400).json({ success: false, error: "رمز السهم غير صالح" });
    }
    try {
        const period1 = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
        const result = await yahooFinance.chart(symbol, { interval: '1h', period1 }, { validateResult: false }) as any;
        if (!result || !result.quotes || result.quotes.length === 0) {
            return res.json({ success: false, error: "بيانات غير متوفرة" });
        }
        const quotes = (result.quotes as any[]).filter(q => q.close !== null);
        const displayCount = 50;
        const startIndex = Math.max(0, quotes.length - displayCount);
        const history = quotes.slice(startIndex).map((q, i) => {
            const actualIndex = startIndex + i;
            const subCloses = quotes.slice(0, actualIndex + 1).map((sq: any) => sq.close as number);
            const macd = calculateMACD(subCloses);
            const bb   = calculateBollingerBands(subCloses);
            return {
                time: new Date(q.date).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
                fullDate: q.date,
                price: Number(q.close.toFixed(2)),
                macd: macd.macd, signal: macd.signal, histogram: macd.histogram,
                bbUpper: bb.upper, bbMiddle: bb.middle, bbLower: bb.lower
            };
        });
        res.json({ success: true, history });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
});

app.post("/api/ai-analysis", async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip + ':ai', 10, 60_000)) {
        return res.status(429).json({ success: false, error: "تجاوزت الحد المسموح للذكاء الاصطناعي." });
    }
    const { symbol, companyName, price, change, rsi, wave, macd, bb, atr, stochRsi: stoch } = req.body;
    if (!symbol || !isValidSaudiSymbol(symbol)) {
        return res.status(400).json({ success: false, error: "رمز السهم غير صالح" });
    }
    if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ success: false, error: "مفتاح Gemini غير مضبوط في الخادم." });
    }
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ parts: [{ text: prompt }] }]
        });
        res.json({ success: true, analysis: response.text });
    } catch (e: any) {
        console.error("❌ Gemini AI Error:", e.message);
        res.status(500).json({ success: false, error: "فشل تحليل الذكاء الاصطناعي." });
    }
});

app.post("/api/ai-news", async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip + ':ai-news', 5, 60_000)) {
        return res.status(429).json({ success: false, error: "تجاوزت الحد المسموح." });
    }
    const { symbol, companyName } = req.body;
    if (!symbol || !isValidSaudiSymbol(symbol)) {
        return res.status(400).json({ success: false, error: "رمز السهم غير صالح" });
    }
    if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ success: false, error: "مفتاح Gemini غير مضبوط في الخادم." });
    }
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `ابحث عن آخر الأخبار المتعلقة بشركة ${companyName} (رمز السهم: ${symbol}) في السوق السعودي.
قدم قائمة بأهم 5 أخبار حديثة. لكل خبر:
1. العنوان (title)
2. ملخص مختصر (summary) باللغة العربية
3. التاريخ التقريبي (date)
4. المصدر (source)
5. رابط الخبر (url)
الرد بتنسيق JSON فقط.`;
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                tools: [{ googleSearch: {} }],
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title:   { type: Type.STRING },
                            summary: { type: Type.STRING },
                            date:    { type: Type.STRING },
                            source:  { type: Type.STRING },
                            url:     { type: Type.STRING }
                        },
                        required: ["title", "summary", "date", "source", "url"]
                    }
                }
            }
        });
        try {
            const newsData = JSON.parse(response.text || "[]");
            res.json({ success: true, news: Array.isArray(newsData) ? newsData : [] });
        } catch {
            res.json({ success: true, news: [] });
        }
    } catch (e: any) {
        console.error("❌ Gemini News Error:", e.message);
        res.status(500).json({ success: false, error: "فشل جلب الأخبار." });
    }
});

app.post("/api/ai-logo", async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip + ':logo', 3, 300_000)) {
        return res.status(429).json({ success: false, error: "يمكنك توليد 3 شعارات كل 5 دقائق فقط." });
    }
    if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ success: false, error: "مفتاح Gemini غير مضبوط." });
    }
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = "A professional and modern logo for a smart trading platform named 'trandsa'. The logo should feature a stylized upward trend line or wave, incorporating elements of AI and market data. Minimalist, high-tech, emerald green and deep blue color scheme. Suitable for a financial application. White background, vector style.";
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash-preview-image-generation',
            contents: [{ parts: [{ text: prompt }] }],
            config: { responseModalities: ['TEXT', 'IMAGE'] }
        });
        const images: string[] = [];
        for (const part of (response.candidates?.[0]?.content?.parts ?? [])) {
            if ((part as any).inlineData) {
                images.push(`data:image/png;base64,${(part as any).inlineData.data}`);
            }
        }
        res.json({ success: true, images });
    } catch (e: any) {
        console.error("❌ Logo Generation Error:", e.message);
        res.status(500).json({ success: false, error: "فشل توليد الشعار." });
    }
});

export const handler = serverless(app);
