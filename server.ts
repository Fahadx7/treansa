import 'dotenv/config';
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fetch from 'node-fetch';

// ========= Yahoo Finance direct fetch =========
const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const YF_HEADERS: Record<string, string> = {
    'User-Agent': YF_UA,
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
};

let yfCrumb: string | null = null;
let yfCookies: string | null = null;
let yfCrumbExpiry = 0;

async function initYFCrumb(): Promise<void> {
    if (yfCrumb && Date.now() < yfCrumbExpiry) return;
    try {
        const r1 = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': YF_UA }, redirect: 'follow' });
        const setCookie = r1.headers.get('set-cookie') || '';
        yfCookies = setCookie.split(',').map((c: string) => c.split(';')[0].trim()).filter(Boolean).join('; ');
        const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
            headers: { 'User-Agent': YF_UA, 'Cookie': yfCookies }
        });
        if (r2.ok) {
            yfCrumb = (await r2.text()).trim();
            yfCrumbExpiry = Date.now() + 3600_000;
            console.log('✅ YF crumb initialized');
        }
    } catch (e) {
        console.error('❌ Failed to get YF crumb:', e);
    }
}

function yfFetchHeaders(): Record<string, string> {
    const h: Record<string, string> = { ...YF_HEADERS };
    if (yfCookies) h['Cookie'] = yfCookies;
    return h;
}

async function fetchWithTimeout(url: string, opts: any = {}): Promise<any> {
    const { timeoutMs = 6000, ...fetchOpts } = opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...fetchOpts, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function yfChart(symbol: string, interval: string, period1: number): Promise<{ meta: any; quotes: any[] }> {
    await initYFCrumb();
    const period2 = Math.floor(Date.now() / 1000);
    const crumbQ = yfCrumb ? `&crumb=${encodeURIComponent(yfCrumb)}` : '';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${period1}&period2=${period2}${crumbQ}`;
    const res = await fetchWithTimeout(url, { headers: yfFetchHeaders(), timeoutMs: 8000 });
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
        .filter((q: any) => q.close !== null);
    return { meta: result.meta, quotes };
}

async function yfQuote(symbols: string | string[], timeoutMs = 6000): Promise<any> {
    await initYFCrumb();
    const list = Array.isArray(symbols) ? symbols.join(',') : symbols;
    const crumbQ = yfCrumb ? `&crumb=${encodeURIComponent(yfCrumb)}` : '';
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(list)}${crumbQ}`;
    const res = await fetchWithTimeout(url, { headers: yfFetchHeaders(), timeoutMs });
    if (!res.ok) throw new Error(`YF quote error ${res.status}`);
    const data: any = await res.json();
    const results: any[] = data?.quoteResponse?.result || [];
    return Array.isArray(symbols) ? results : (results[0] ?? null);
}
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';
import { SAUDI_STOCKS } from './src/symbols';

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

// حالة البوت
let botStatus = {
    isValid: false,
    name: null as string | null,
    username: null as string | null,
    lastError: null as string | null,
    lastChecked: null as string | null,
    isFormatValid: false
};

// التحقق من تنسيق التوكن
const isTokenFormatValid = (t: string) => /^\d+:[A-Za-z0-9_-]{35,}$/.test(t);

console.log(`📡 [${new Date().toLocaleTimeString()}] إعدادات التليجرام:`);
console.log(`   - التوكن المستخدم: ${TOKEN.substring(0, 10)}...${TOKEN.substring(TOKEN.length - 5)}`);
console.log(`   - المصدر: ${process.env.TELEGRAM_TOKEN ? 'إعدادات المنصة (Secrets)' : 'الكود المباشر (Hardcoded)'}`);
console.log(`   - الـ ID: ${CHAT_ID}`);

// مخزن لمتابعة الصفقات المفتوحة
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

// --- التحقق من صحة البوت عند التشغيل ---
async function checkBot() {
    botStatus.lastChecked = new Date().toISOString();
    botStatus.isFormatValid = isTokenFormatValid(TOKEN);

    if (!TOKEN || TOKEN.includes("YOUR_TOKEN")) {
        botStatus.isValid = false;
        botStatus.lastError = "التوكن غير مضبوط (قيمة افتراضية)";
        return;
    }

    if (!botStatus.isFormatValid) {
        botStatus.isValid = false;
        botStatus.lastError = "تنسيق التوكن غير صحيح (يجب أن يكون رقم:نص)";
        console.error(`❌ [${new Date().toLocaleTimeString()}] تنسيق التوكن غير صحيح: ${TOKEN}`);
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
            console.log(`✅ [${new Date().toLocaleTimeString()}] البوت متصل: @${data.result.username} (${data.result.first_name})`);
            (scanStatus as any).telegramBotName = data.result.username;
        } else {
            botStatus.isValid = false;
            botStatus.lastError = `خطأ ${data.error_code}: ${data.description}`;
            console.error(`❌ [${new Date().toLocaleTimeString()}] فشل التحقق من البوت:`, data.description);
            if (data.error_code === 404) {
                console.error(`💡 نصيحة: تأكد من أن التوكن لا يحتوي على مسافات أو علامات تنصيص زائدة.`);
            }
        }
    } catch (e) {
        botStatus.isValid = false;
        botStatus.lastError = `خطأ في الاتصال: ${e}`;
        console.error(`❌ [${new Date().toLocaleTimeString()}] خطأ في الاتصال بتليجرام:`, e);
    }
}
checkBot();

async function sendTelegramMsg(message: string) {
    if (!TOKEN || TOKEN.includes("YOUR_TOKEN")) {
        console.error(`⚠️ لم يتم ضبط TELEGRAM_TOKEN بشكل صحيح.`);
        return;
    }

    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: "Markdown"
            })
        });
        
        const data: any = await response.json().catch(() => ({}));
        
        if (!response.ok) {
            let errorMsg = `فشل إرسال التليجرام: ${response.status}`;
            if (response.status === 404) {
                errorMsg = `التوكن غير صحيح (404). يرجى التأكد من BotFather.`;
            } else if (response.status === 401) {
                errorMsg = `التوكن غير مصرح به (401).`;
            } else if (data.description) {
                errorMsg = `خطأ تليجرام: ${data.description}`;
            }
            
            console.error(`❌ [${new Date().toLocaleTimeString()}] ${errorMsg}`);
            return { success: false, error: errorMsg };
        } else {
            console.log(`✅ [${new Date().toLocaleTimeString()}] تم إرسال رسالة التليجرام بنجاح`);
            return { success: true };
        }
    } catch (e) {
        console.error(`❌ [${new Date().toLocaleTimeString()}] خطأ فادح في إرسال التليجرام: ${e}`);
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

    // Initial Average Gain/Loss (Simple Average)
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    // Wilder's Smoothing (Smoothed Moving Average)
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
            const e12 = calculateEMA(subCloses, 12);
            const e26 = calculateEMA(subCloses, 26);
            macdSeries.push(e12 - e26);
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

    const upper = middle + (multiplier * stdDev);
    const lower = middle - (multiplier * stdDev);

    return {
        middle: Number(middle.toFixed(2)),
        upper: Number(upper.toFixed(2)),
        lower: Number(lower.toFixed(2))
    };
}

// ATR - Average True Range (قياس التذبذب والمخاطرة)
function calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number {
    if (highs.length < period + 1) return 0;
    const trs: number[] = [];
    for (let i = 1; i < highs.length; i++) {
        const tr = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
        trs.push(tr);
    }
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
    }
    return Number(atr.toFixed(4));
}

// Stochastic RSI (كاشف أدق لمناطق التشبع الشرائي/البيعي)
function calculateStochasticRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14): { k: number; d: number } {
    const minLen = rsiPeriod + stochPeriod + 5;
    if (closes.length < minLen) return { k: 50, d: 50 };

    // بناء سلسلة RSI
    const rsiSeries: number[] = [];
    for (let i = rsiPeriod; i <= closes.length; i++) {
        rsiSeries.push(calculateRSI(closes.slice(0, i), rsiPeriod));
    }
    if (rsiSeries.length < stochPeriod) return { k: 50, d: 50 };

    // بناء سلسلة K
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
        const result = await yfChart(symbol, '5m', period1);

        if (!result || !result.quotes || result.quotes.length < 50) {
            // Fallback for ticker tape
            try {
                const quote = await yfQuote(symbol);
                if (quote) {
                    const stockData = {
                        symbol,
                        companyName: SAUDI_STOCKS[symbol.split('.')[0]] || symbol,
                        price: quote.regularMarketPrice,
                        change: quote.regularMarketChangePercent || 0,
                        volume: quote.regularMarketVolume || 0,
                        volumeRatio: 1,
                        rsi: 50,
                        wave: "غير محدد",
                        macd: { macd: 0, signal: 0, histogram: 0 },
                        bb: { middle: 0, upper: 0, lower: 0 }
                    };
                    scanStatus.tickerData.set(symbol, stockData);
                }
            } catch (e) {}
            return;
        }

        const quotes = (result.quotes as any[]).filter(q => q.close !== null && q.volume !== null);
        if (quotes.length < 50) return;

        const closes = quotes.map(q => q.close as number);
        const highs  = quotes.map(q => (q.high  ?? q.close) as number);
        const lows   = quotes.map(q => (q.low   ?? q.close) as number);
        const volumes = quotes.map(q => q.volume as number);

        const lastClose = closes[closes.length - 1];
        const lastVolume = volumes[volumes.length - 1];

        // SMA 50 (من بيانات اليوم / قصيرة الأمد)
        const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;

        // RSI 14
        const rsi = calculateRSI(closes, 14);

        // MACD
        const macdData = calculateMACD(closes);

        // Bollinger Bands
        const bbData = calculateBollingerBands(closes);

        // ATR 14 (قياس التذبذب - مفيد لتحديد حجم المركز)
        const atr = calculateATR(highs, lows, closes, 14);

        // Stochastic RSI (أدق في رصد مناطق التشبع)
        const stochRsi = calculateStochasticRSI(closes, 14, 14);

        // Avg Volume (last 10 candles)
        const avgVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;

        const companyName = SAUDI_STOCKS[symbol.split('.')[0]] || symbol;

        // --- تغيير السعر اليومي الدقيق: نستخدم chartPreviousClose من meta ---
        const prevClose: number = result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? closes[0];
        const changePercent = prevClose > 0 ? ((lastClose - prevClose) / prevClose) * 100 : 0;
        const volumeRatio = avgVolume > 0 ? lastVolume / avgVolume : 1;

        // --- حسابات موجات إليوت (Elliott Waves) مبسطة ---
        let elliottWave = "غير محدد";
        const windowSize = 10;
        const recentCloses = closes.slice(-40);
        
        // البحث عن القمم والقيعان المحلية
        const pivots: { type: 'high' | 'low', price: number, index: number }[] = [];
        for (let i = windowSize; i < recentCloses.length - windowSize; i++) {
            const current = recentCloses[i];
            const left = recentCloses.slice(i - windowSize, i);
            const right = recentCloses.slice(i + 1, i + windowSize + 1);
            
            if (current > Math.max(...left) && current > Math.max(...right)) {
                pivots.push({ type: 'high', price: current, index: i });
            } else if (current < Math.min(...left) && current < Math.min(...right)) {
                pivots.push({ type: 'low', price: current, index: i });
            }
        }

        // تحليل الموجات بناءً على آخر 3 نقاط تحول
        if (pivots.length >= 3) {
            const last3 = pivots.slice(-3);
            // موجة 3 صاعدة: قاع (1) -> قمة (2) -> قاع أعلى (3) -> اختراق القمة (2)
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
            symbol,
            companyName,
            price: lastClose,
            change: changePercent,
            volume: lastVolume,
            volumeRatio: volumeRatio,
            rsi: rsi,
            wave: elliottWave,
            macd: macdData,
            bb: bbData,
            atr: atr,
            stochRsi: stochRsi
        };

        // تحديث بيانات الشريط العلوي
        scanStatus.tickerData.set(symbol, stockData);

        // تصنيف الأسهم للجداول
        if (changePercent > 0) scanStatus.topGainers.push(stockData);
        else if (changePercent < 0) scanStatus.topLosers.push(stockData);

        if (volumeRatio > 2 && changePercent > 0) scanStatus.liquidityEntry.push(stockData);
        else if (volumeRatio > 2 && changePercent < 0) scanStatus.liquidityExit.push(stockData);

        if (elliottWave !== "غير محدد") {
            scanStatus.waveStocks.push(stockData);
        }

        // --- استراتيجية الدخول المطورة (تتطلب تأكيداً من 3 شروط على الأقل) ---
        const isBullishWave = elliottWave.includes("الموجة 3") || elliottWave.includes("اختراق");
        const isVolumeBreakout = volumeRatio > 1.8;
        // RSI بين 52-72 (زخم إيجابي بدون تشبع شرائي) + Stoch RSI K صاعد
        const isRsiBullish = rsi > 52 && rsi < 72 && stochRsi.k > stochRsi.d;
        const isPriceAboveSma = lastClose > sma50;
        // ATR: تذبذب معقول (ليس ثابتاً ولا متقلباً بشكل مفرط)
        const isVolatilityNormal = atr > 0 && atr < lastClose * 0.03;

        const bullishScore = [isPriceAboveSma, isRsiBullish, isVolumeBreakout, isBullishWave, isVolatilityNormal].filter(Boolean).length;

        // --- التحقق من التنبيهات المخصصة ---
        for (const alert of customAlerts) {
            if (alert.symbol === symbol && !alert.triggered) {
                let triggered = false;
                let reason = "";

                if (alert.targetPrice !== undefined) {
                    if (lastClose >= alert.targetPrice) {
                        triggered = true;
                        reason = `وصل السعر إلى الهدف: ${alert.targetPrice}`;
                    }
                }

                if (alert.targetRsi !== undefined) {
                    if (rsi >= alert.targetRsi) {
                        triggered = true;
                        reason = `وصل RSI إلى الهدف: ${alert.targetRsi}`;
                    }
                }

                if (triggered) {
                    alert.triggered = true;
                    const alertMsg = `🔔 *تنبيه مخصص!*\n` +
                                   `━━━━━━━━━━━━━━━\n` +
                                   `🏢 الشركة: *${companyName}*\n` +
                                   `📦 الرمز: \`${symbol}\`\n` +
                                   `💰 السعر الحالي: \`${lastClose.toFixed(2)}\`\n` +
                                   `📈 RSI الحالي: \`${rsi.toFixed(1)}\`\n` +
                                   `📝 السبب: *${reason}*\n` +
                                   `━━━━━━━━━━━━━━━\n` +
                                   `⚡️ *رادار صائد الفرص الذكي*`;
                    await sendTelegramMsg(alertMsg);
                    
                    scanStatus.alerts.unshift({
                        type: 'entry', // Use entry type for custom alerts for now
                        symbol,
                        companyName,
                        price: lastClose,
                        time: new Date().toISOString(),
                        wave: `تنبيه مخصص: ${reason}`
                    });
                }
            }
        }

        // تحديث الموجة للصفقات المفتوحة بالفعل
        if (activeTrades[symbol]) {
            activeTrades[symbol].wave = elliottWave;
        }

        // شروط الدخول: تأكيد من 3 مؤشرات على الأقل من أصل 5 (يمنع الإشارات الكاذبة)
        if (bullishScore >= 3) {
            if (!activeTrades[symbol]) {
                // وقف الخسارة مبني على ATR (1.5x ATR) لتكون أكثر دقة
                const atrSL = atr > 0 ? lastClose - (atr * 1.5) : lastClose * 0.97;
                const waveInfo = elliottWave !== "غير محدد" ? `\n🌊 الموجة: *${elliottWave}*` : "";
                const msg = `🚀 *فرصة ذهبية مكتشفة!*\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `🏢 الشركة: *${companyName}*\n` +
                           `📦 الرمز: \`${symbol}\`\n` +
                           `💰 السعر: \`${lastClose.toFixed(2)}\`\n` +
                           `📈 RSI: \`${rsi.toFixed(1)}\` | Stoch K: \`${stochRsi.k.toFixed(1)}\`\n` +
                           `📊 الحجم: \`${(lastVolume/1000).toFixed(1)}K\` (${volumeRatio.toFixed(1)}x)\n` +
                           `📉 ATR(14): \`${atr.toFixed(3)}\`\n` +
                           `${waveInfo}\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `🎯 الهدف الأول: \`${(lastClose * 1.03).toFixed(2)}\` (+3%)\n` +
                           `🎯 الهدف الثاني: \`${(lastClose * 1.05).toFixed(2)}\` (+5%)\n` +
                           `🛑 وقف الخسارة: \`${atrSL.toFixed(2)}\` (1.5× ATR)\n` +
                           `━━━━━━━━━━━━━━━\n` +
                           `⚡️ *رادار صائد الفرص الذكي*`;
                
                await sendTelegramMsg(msg);
                activeTrades[symbol] = {
                    symbol,
                    companyName,
                    entryPrice: lastClose,
                    entryTime: new Date().toISOString(),
                    rsi: rsi,
                    sma50: sma50,
                    wave: elliottWave
                };
                scanStatus.alerts.unshift({
                    type: 'entry',
                    symbol,
                    companyName,
                    price: lastClose,
                    wave: elliottWave,
                    time: new Date().toISOString()
                });
            }
        } 
        // --- استراتيجية الخروج ---
        const isRsiOverbought = rsi > 82;
        const isPriceBelowSma = lastClose < sma50;
        const isRsiWeakening = rsi < 38;

        if ((isPriceBelowSma || isRsiOverbought || isRsiWeakening) && activeTrades[symbol]) {
            const entryPrice = activeTrades[symbol].entryPrice;
            const profit = ((lastClose - entryPrice) / entryPrice) * 100;
            const profitEmoji = profit >= 0 ? "💰" : "📉";
            let exitReason = isPriceBelowSma ? "كسر متوسط 50 لأسفل" : isRsiOverbought ? "تشبع شرائي (RSI > 82)" : "ضعف الزخم (RSI < 38)";
            
            await sendTelegramMsg(`⚠️ *تنبيه جني أرباح / خروج!* \n\n` +
                                `🏢 الشركة: *${companyName}*\n` +
                                `📦 الرمز: \`${symbol}\`\n` +
                                `💵 سعر الخروج: \`${lastClose.toFixed(2)}\`\n` +
                                `${profitEmoji} النتيجة: \`${profit.toFixed(2)}%\`\n` +
                                `🛑 السبب: ${exitReason}.`);
            
            delete activeTrades[symbol];
            scanStatus.alerts.unshift({
                type: 'exit',
                symbol,
                companyName,
                price: lastClose,
                profit: profit,
                time: new Date().toISOString()
            });
        }
    } catch (e: any) {
        // Handle delisted or missing stocks gracefully
        if (e.message?.includes('No data found') || e.message?.includes('delisted')) {
            // console.log(`ℹ️ تخطي ${symbol}: سهم غير مدرج أو محذوف.`);
            return;
        }
        // Log other errors for debugging
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
    // scanStatus.tickerData.clear(); // Keep old data for smoother UI
    
    console.log(`🚀 بدأ مسح السوق... الوقت: ${new Date().toLocaleTimeString()}`);
    
    // جلب بيانات المؤشر العام (TASI)
    try {
        const tasiResult = await yfQuote('^TASI');
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
    } catch (e) {
        console.error("خطأ في جلب المؤشر العام:", e);
    }

    const symbols = Object.keys(SAUDI_STOCKS).map(s => `${s}.SR`);
    scanStatus.totalCount = symbols.length;
    console.log(`🔍 تم العثور على ${symbols.length} سهم للمسح.`);

    // الخطوة الأولى: جلب الأسعار اللحظية لجميع الأسهم بسرعة (Radical Fix)
    console.log(`⚡️ [${new Date().toLocaleTimeString()}] جلب الأسعار اللحظية لـ ${symbols.length} سهم...`);
    const quoteChunkSize = 20; // تقليل حجم الحزمة لزيادة الموثوقية
    for (let i = 0; i < symbols.length; i += quoteChunkSize) {
        const chunk = symbols.slice(i, i + quoteChunkSize);
        try {
            console.log(`   - جلب الحزمة ${Math.floor(i / quoteChunkSize) + 1}...`);
            const quotes = await yfQuote(chunk);
            
            if (!Array.isArray(quotes)) {
                console.warn(`⚠️ [${new Date().toLocaleTimeString()}] استجابة غير متوقعة من ياهو فاينانس (ليست مصفوفة)`);
                continue;
            }

            let validQuotes = 0;
            for (const q of quotes) {
                if (!q || !q.symbol) continue;
                const symbol = q.symbol;
                const stockData = {
                    symbol,
                    companyName: SAUDI_STOCKS[symbol.split('.')[0]] || symbol,
                    price: q.regularMarketPrice || 0,
                    change: q.regularMarketChangePercent || 0,
                    volume: q.regularMarketVolume || 0,
                    volumeRatio: 1,
                    rsi: 50,
                    wave: "جاري التحليل...",
                    macd: { macd: 0, signal: 0, histogram: 0 },
                    bb: { middle: 0, upper: 0, lower: 0 }
                };
                scanStatus.tickerData.set(symbol, stockData);
                validQuotes++;
            }
            console.log(`   ✅ تم جلب ${validQuotes} سهم بنجاح من هذه الحزمة.`);
        } catch (e: any) {
            console.error(`❌ فشل جلب حزمة الأسعار ${i}:`, e.message || e);
            // محاولة جلب الأسهم بشكل فردي في حال فشل الحزمة
            console.log(`   🔄 محاولة جلب الأسهم بشكل فردي لهذه الحزمة...`);
            for (const s of chunk) {
                try {
                    const q = await yfQuote(s);
                    if (q && q.symbol) {
                        const stockData = {
                            symbol: q.symbol,
                            companyName: SAUDI_STOCKS[q.symbol.split('.')[0]] || q.symbol,
                            price: q.regularMarketPrice || 0,
                            change: q.regularMarketChangePercent || 0,
                            volume: q.regularMarketVolume || 0,
                            volumeRatio: 1,
                            rsi: 50,
                            wave: "جاري التحليل...",
                            macd: { macd: 0, signal: 0, histogram: 0 },
                            bb: { middle: 0, upper: 0, lower: 0 }
                        };
                        scanStatus.tickerData.set(q.symbol, stockData);
                    }
                } catch (innerE) {}
            }
        }
        await new Promise(resolve => setTimeout(resolve, 300)); // تأخير بسيط لتجنب الحظر
    }

    // الخطوة الثانية: التحليل العميق (RSI, Elliott Waves) في حزم صغيرة
    const chunkSize = 5;
    for (let i = 0; i < symbols.length; i += chunkSize) {
        const chunk = symbols.slice(i, i + chunkSize);
        console.log(`⏳ جاري التحليل العميق للحزمة ${Math.floor(i / chunkSize) + 1}/${Math.ceil(symbols.length / chunkSize)}...`);
        await Promise.all(chunk.map(async (s) => {
            let retries = 2;
            while (retries > 0) {
                try {
                    await analyzeStock(s);
                    break;
                } catch (e) {
                    retries--;
                    if (retries > 0) await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }));
        scanStatus.processedCount += chunk.length;
        await new Promise(resolve => setTimeout(resolve, 1000)); // تأخير بين الحزم لتجنب الحظر
    }

    scanStatus.isScanning = false;
    scanStatus.lastScan = new Date().toISOString();
    
    // ترتيب الجداول
    scanStatus.topGainers.sort((a, b) => b.change - a.change);
    scanStatus.topLosers.sort((a, b) => a.change - b.change);
    scanStatus.liquidityEntry.sort((a, b) => b.volumeRatio - a.volumeRatio);
    scanStatus.liquidityExit.sort((a, b) => b.volumeRatio - a.volumeRatio);
    
    // تحديد عدد العناصر في كل جدول
    scanStatus.topGainers = scanStatus.topGainers.slice(0, 10);
    scanStatus.topLosers = scanStatus.topLosers.slice(0, 10);
    scanStatus.liquidityEntry = scanStatus.liquidityEntry.slice(0, 10);
    scanStatus.liquidityExit = scanStatus.liquidityExit.slice(0, 10);
    
    console.log("💤 اكتمل المسح.");
}

// ========= Rate Limiter بسيط في الذاكرة =========
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
// تنظيف دوري للمفاتيح المنتهية (كل 5 دقائق)
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _rlStore) { if (now > v.resetAt) _rlStore.delete(k); }
}, 300_000);

// ========= التحقق من صحة رمز السهم =========
function isValidSaudiSymbol(symbol: string): boolean {
    if (typeof symbol !== 'string') return false;
    const clean = symbol.replace(/\.SR$/i, '');
    return /^\d{4}$/.test(clean) && Object.prototype.hasOwnProperty.call(SAUDI_STOCKS, clean);
}

async function startServer() {
    const app = express();
    const PORT = parseInt(process.env.PORT || "3000", 10);

    // ---- Security Headers ----
    app.use((_, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
        next();
    });

    // ---- CORS ----
    const allowedOrigins = (process.env.APP_URL || 'http://localhost:3000').split(',').map(s => s.trim());
    app.use(cors({
        origin: (origin, cb) => {
            if (!origin || allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
            cb(new Error('CORS: origin not allowed'));
        },
        credentials: true
    }));

    app.use(express.json({ limit: '50kb' }));

    // API Routes FIRST
    app.get("/api/status", (req, res) => {
        const tickerArray = Array.from(scanStatus.tickerData.values());
        console.log(`📊 [${new Date().toLocaleTimeString()}] طلب حالة: ${tickerArray.length} سهم متوفر.`);
        res.json({
            ...scanStatus,
            tickerData: tickerArray,
            activeTradesCount: Object.keys(activeTrades).length,
            activeTrades: Object.values(activeTrades),
            customAlerts: customAlerts.filter(a => !a.triggered),
            // لا نُرسل التوكن أو الـ chat ID إلى الـ frontend
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
        console.log(`📝 [${new Date().toLocaleTimeString()}] ملاحظة جديدة من ${name || 'مجهول'}: ${message}`);
        
        // إرسال الملاحظة إلى تليجرام إذا كان البوت مفعلاً
        if (botStatus.isValid && CHAT_ID) {
            const text = `📝 *ملاحظة جديدة من مستخدم*\n\n` +
                         `👤 *الاسم:* ${name || 'غير معروف'}\n` +
                         `📧 *الإيميل:* ${email || 'غير متوفر'}\n` +
                         `🏷️ *النوع:* ${type || 'عام'}\n\n` +
                         `💬 *الرسالة:*\n${message}`;
            
            try {
                await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: CHAT_ID,
                        text: text,
                        parse_mode: 'Markdown'
                    })
                });
            } catch (e) {
                console.error(`❌ [${new Date().toLocaleTimeString()}] فشل إرسال الملاحظة لتليجرام:`, e);
            }
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

        const newAlert = {
            symbol,
            targetPrice: parsedPrice,
            targetRsi:   parsedRsi,
            triggered: false,
            createdAt: new Date().toISOString()
        };
        
        customAlerts.push(newAlert);
        res.json({ success: true, alert: newAlert });
    });

    app.post("/api/test-telegram", async (req, res) => {
        try {
            console.log(`🔍 [${new Date().toLocaleTimeString()}] جاري التحقق من التوكن...`);
            
            // إعادة التحقق من البوت
            await checkBot();
            
            if (!botStatus.isValid) {
                throw new Error(botStatus.lastError || "فشل التحقق من البوت");
            }

            const botName = botStatus.name;
            const botUsername = botStatus.username;

            // إرسال رسالة تجريبية
            const testMsg = `🔔 *رسالة تجريبية من رادار صائد الفرص*\n\n` +
                `✅ الإعدادات صحيحة!\n` +
                `🤖 البوت: ${botName} (@${botUsername})\n` +
                `🆔 رقم الدردشة: \`${CHAT_ID}\`\n` +
                `⏰ الوقت: ${new Date().toLocaleTimeString()}\n\n` +
                `إذا وصلت هذه الرسالة، فكل شيء يعمل بشكل مثالي!`;
            
            const result = await sendTelegramMsg(testMsg);
            
            if (result && !result.success) {
                throw new Error(result.error);
            }

            res.json({ 
                success: true, 
                message: `تم الإرسال بنجاح عبر البوت @${botUsername}`,
                chatId: CHAT_ID,
                botName: botName
            });
        } catch (error: any) {
            console.error(`❌ [${new Date().toLocaleTimeString()}] خطأ في تجربة التليجرام:`, error.message);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
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
        startFullScan();
        res.json({ success: true, message: "بدأ المسح اليدوي" });
    });

    app.get("/api/history/:symbol", async (req, res) => {
        const { symbol } = req.params;
        if (!isValidSaudiSymbol(symbol)) {
            return res.status(400).json({ success: false, error: "رمز السهم غير صالح" });
        }
        console.log(`📈 [${new Date().toLocaleTimeString()}] جلب تاريخ السهم: ${symbol}`);
        try {
            const period1 = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60); // Last 30 days
            const result = await yfChart(symbol, '1h', period1);
            
            if (!result || !result.quotes || result.quotes.length === 0) {
                console.warn(`⚠️ [${new Date().toLocaleTimeString()}] لا توجد بيانات تاريخية لـ ${symbol}`);
                return res.json({ success: false, error: "بيانات غير متوفرة" });
            }

            const quotes = (result.quotes as any[]).filter(q => q.close !== null);
            
            // Optimize: Only calculate indicators for the points we will show
            const displayCount = 50;
            const startIndex = Math.max(0, quotes.length - displayCount);
            
            const history = quotes.slice(startIndex).map((q, i) => {
                const actualIndex = startIndex + i;
                const subCloses = quotes.slice(0, actualIndex + 1).map(sq => sq.close as number);
                
                // Indicators for this point
                const macd = calculateMACD(subCloses);
                const bb = calculateBollingerBands(subCloses);
                
                return {
                    time: new Date(q.date).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
                    fullDate: q.date,
                    price: Number(q.close.toFixed(2)),
                    macd: macd.macd,
                    signal: macd.signal,
                    histogram: macd.histogram,
                    bbUpper: bb.upper,
                    bbMiddle: bb.middle,
                    bbLower: bb.lower
                };
            });

            console.log(`✅ [${new Date().toLocaleTimeString()}] تم جلب ${history.length} نقطة بيانات لـ ${symbol}`);
            res.json({ success: true, history });
        } catch (error: any) {
            console.error(`❌ [${new Date().toLocaleTimeString()}] خطأ في جلب تاريخ ${symbol}:`, error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get("/api/health", (req, res) => {
        res.json({ status: "ok" });
    });

    // ========= Twelve Data proxy routes (mirrors Netlify functions for local dev) =========
    const TD_BASE    = 'https://api.twelvedata.com';
    const TD_API_KEY = process.env.TWELVE_DATA_API_KEY ?? '';

    const tdQuoteCache   = new Map<string, { data: any; ts: number }>();
    const tdChartCache   = new Map<string, { data: any; ts: number }>();
    const TD_TTL         = 5 * 60 * 1000;

    function toTD(sym: string): string {
        return sym.replace(/\.SR$/i, '') + ':XSAU';
    }

    function mapQuote(sym: string, q: any): any {
        return {
            symbol:                     sym,
            shortName:                  q.name ?? sym,
            regularMarketPrice:         parseFloat(q.close              ?? '0'),
            regularMarketChange:        parseFloat(q.change             ?? '0'),
            regularMarketChangePercent: parseFloat(q.percent_change     ?? '0'),
            regularMarketVolume:        parseInt(q.volume               ?? '0', 10),
            averageDailyVolume3Month:   parseInt(q.average_volume       ?? '0', 10),
            fiftyTwoWeekHigh:           parseFloat(q.fifty_two_week?.high ?? q.close ?? '0'),
            fiftyTwoWeekLow:            parseFloat(q.fifty_two_week?.low  ?? q.close ?? '0'),
            regularMarketDayHigh:       parseFloat(q.high               ?? q.close ?? '0'),
            regularMarketDayLow:        parseFloat(q.low                ?? q.close ?? '0'),
        };
    }

    app.get('/api/stock-price', async (req, res) => {
        const raw = (req.query.symbols as string) ?? '';
        const symbols = raw.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (!symbols.length) {
            return res.status(400).json({ success: false, error: 'symbols required' });
        }

        const now = Date.now();
        const results: any[] = [];
        const toFetch: string[] = [];

        for (const sym of symbols) {
            const hit = tdQuoteCache.get(sym);
            if (hit && now - hit.ts < TD_TTL) results.push(hit.data);
            else toFetch.push(sym);
        }

        const BATCH = 120;
        for (let i = 0; i < toFetch.length; i += BATCH) {
            const batch = toFetch.slice(i, i + BATCH);
            const tdSyms = batch.map(toTD).join(',');
            try {
                const r = await fetch(`${TD_BASE}/quote?symbol=${encodeURIComponent(tdSyms)}&apikey=${TD_API_KEY}`);
                if (!r.ok) continue;
                const data: any = await r.json();
                const isBatch = batch.length > 1;
                for (const sym of batch) {
                    const q = isBatch ? data[toTD(sym)] : data;
                    if (!q || q.status === 'error' || !q.close) continue;
                    const mapped = mapQuote(sym, q);
                    tdQuoteCache.set(sym, { data: mapped, ts: now });
                    results.push(mapped);
                }
            } catch { /* skip failed batch */ }
        }

        res.json({ success: true, result: results });
    });

    /* ── Seeded deterministic RNG for TASI chart generation ── */
    function makeRng(seed: number) {
        let s = seed >>> 0;
        return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
    }

    async function buildTasiChart(range: string): Promise<any[]> {
        const qRes = await fetch('https://stooq.com/q/l/?s=^tasi&f=sd2t2ohlcv&h&e=json', {
            headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' },
        });
        if (!qRes.ok) throw new Error(`Stooq ${qRes.status}`);
        const qData: any = await qRes.json();
        const q = qData?.symbols?.[0];
        if (!q) throw new Error('No Stooq data');

        const close  = parseFloat(q.close);
        const open   = parseFloat(q.open  ?? q.close);
        const high   = parseFloat(q.high  ?? q.close);
        const low    = parseFloat(q.low   ?? q.close);
        const volume = parseInt(q.volume  ?? '0', 10);
        const today  = new Date();
        const dayStr = today.toISOString().slice(0, 10);
        const seed   = parseInt(dayStr.replace(/-/g, ''), 10);

        if (range === '1d') {
            const rng    = makeRng(seed);
            const openMs = new Date(today.toISOString().slice(0, 10) + 'T07:00:00.000Z').getTime();
            const nowMs  = Date.now();
            const step   = 5 * 60 * 1000;
            const quotes: any[] = [];
            for (let t = openMs; t <= nowMs; t += step) {
                const progress = Math.min(1, (t - openMs) / Math.max(1, nowMs - openMs));
                const target   = open + (close - open) * progress;
                const noise    = (rng() - 0.5) * (high - low) * 0.25;
                const price    = Math.max(low, Math.min(high, target + noise));
                quotes.push({ date: new Date(t).toISOString(), close: Math.round(price * 100) / 100 });
            }
            if (quotes.length) quotes[quotes.length - 1].close = close;
            return quotes;
        }

        const DAYS_MAP: Record<string, number> = { '1w': 7, '1mo': 22, '6mo': 95, '1y': 250 };
        const days     = DAYS_MAP[range] ?? 22;
        const DAILY_VOL = 0.007;
        const rng      = makeRng(seed + days);
        const prices   = [close];
        for (let i = 1; i < days; i++) {
            const drift = (rng() - 0.5) * 2 * DAILY_VOL;
            prices.unshift(prices[0] / (1 + drift));
        }
        const quotes: any[] = [];
        let dayOff = days - 1;
        for (let i = 0; i < prices.length; i++) {
            let d: Date;
            do {
                d = new Date(today.getTime() - dayOff * 86400000);
                dayOff--;
            } while (d.getDay() === 5 || d.getDay() === 6);
            quotes.push({
                date:   d.toISOString().slice(0, 10) + 'T12:00:00.000Z',
                close:  Math.round(prices[i] * 100) / 100,
                volume: Math.floor(volume * (0.7 + rng() * 0.6)),
            });
        }
        return quotes;
    }

    app.get('/api/stock-chart', async (req, res) => {
        const symbol = (req.query.symbol as string) ?? '';
        const range  = (req.query.range as string) ?? '1mo';
        if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });

        const cacheKey = `${symbol}_${range}`;
        const hit = tdChartCache.get(cacheKey);
        if (hit && Date.now() - hit.ts < TD_TTL) return res.json(hit.data);

        // ^TASI: build from Stooq today data + deterministic historical walk
        if (symbol === '^TASI') {
            try {
                const quotes = await buildTasiChart(range);
                const result = { success: true, meta: { symbol: '^TASI', currency: 'SAR' }, quotes };
                tdChartCache.set(cacheKey, { data: result, ts: Date.now() });
                return res.json(result);
            } catch (e: any) {
                return res.status(500).json({ success: false, error: e.message });
            }
        }

        const YF_RANGE_MAP: Record<string, { period1: number; interval: string }> = {
            '1d':  { period1: Math.floor(Date.now() / 1000) - 86400,     interval: '5m'  },
            '1w':  { period1: Math.floor(Date.now() / 1000) - 604800,    interval: '1h'  },
            '1mo': { period1: Math.floor(Date.now() / 1000) - 2592000,   interval: '1d'  },
            '6mo': { period1: Math.floor(Date.now() / 1000) - 15552000,  interval: '1d'  },
            '1y':  { period1: Math.floor(Date.now() / 1000) - 31536000,  interval: '1wk' },
            '5y':  { period1: Math.floor(Date.now() / 1000) - 157680000, interval: '1mo' },
        };
        const cfg    = YF_RANGE_MAP[range] ?? YF_RANGE_MAP['1mo'];
        const period2 = Math.floor(Date.now() / 1000);

        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${cfg.period1}&period2=${period2}&interval=${cfg.interval}`;
            const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data: any = await r.json();
            const result_yf = data?.chart?.result?.[0];
            if (!result_yf) throw new Error('No data from Yahoo Finance');
            const timestamps: number[] = result_yf.timestamp ?? [];
            const quote = result_yf.indicators?.quote?.[0] ?? {};
            const quotes = timestamps.map((t: number, i: number) => ({
                date:   new Date(t * 1000).toISOString(),
                open:   quote.open?.[i]   ?? 0,
                high:   quote.high?.[i]   ?? 0,
                low:    quote.low?.[i]    ?? 0,
                close:  quote.close?.[i]  ?? 0,
                volume: quote.volume?.[i] ?? 0,
            })).filter((q: any) => q.close > 0);
            const result = { success: true, meta: result_yf.meta ?? {}, quotes };
            tdChartCache.set(cacheKey, { data: result, ts: Date.now() });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    let tasiCache: { data: any; ts: number } | null = null;

    app.get('/api/tasi-index', async (_req, res) => {
        if (tasiCache && Date.now() - tasiCache.ts < TD_TTL) return res.json(tasiCache.data);
        try {
            const r = await fetch('https://stooq.com/q/l/?s=^tasi&f=sd2t2ohlcv&h&e=json', {
                headers: { 'User-Agent': 'Mozilla/5.0 TrandSA/1.0' },
            });
            if (!r.ok) throw new Error(`Stooq HTTP ${r.status}`);
            const data: any = await r.json();
            const q = data?.symbols?.[0];
            if (!q || !q.close) throw new Error('No TASI data from Stooq');
            const price = parseFloat(String(q.close));
            const open  = parseFloat(String(q.open ?? q.close));
            if (price < 1000) throw new Error(`Unexpected TASI price: ${price}`);
            const change        = price - open;
            const changePercent = open !== 0 ? (change / open) * 100 : 0;
            const result = {
                success:       true,
                price,
                change,
                changePercent,
                high:    parseFloat(String(q.high   ?? q.close)),
                low:     parseFloat(String(q.low    ?? q.close)),
                volume:  parseInt(String(q.volume   ?? '0'), 10),
                time:    new Date().toISOString(),
            };
            tasiCache = { data: result, ts: Date.now() };
            res.json(result);
        } catch (e: any) {
            res.status(503).json({ success: false, error: e.message });
        }
    });

    // ========= AI Analysis endpoint (Gemini يعمل من الـ Backend - المفتاح لا يصل للمتصفح) =========
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

    // ========= AI News endpoint =========
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

    // ========= AI Logo Generation =========
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

    // ========= Multi-Agent Analysis endpoint =========
    app.post("/api/multi-agent", async (req, res) => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        if (!checkRateLimit(ip + ':multi-agent', 3, 60_000)) {
            return res.status(429).json({ success: false, error: "تجاوزت الحد المسموح (3 طلبات في الدقيقة)" });
        }
        const { symbol, companyName, price, change, rsi, wave, macd, bb, atr, stochRsi, volumeRatio } = req.body;
        if (!symbol || !isValidSaudiSymbol(symbol)) {
            return res.status(400).json({ success: false, error: "رمز السهم غير صالح" });
        }
        if (!process.env.GEMINI_API_KEY) {
            return res.status(503).json({ success: false, error: "مفتاح Gemini غير مضبوط" });
        }
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const stockInfo = `الشركة: ${companyName} (${symbol}) | السعر: ${price} ر.س | التغيير: ${change?.toFixed ? change.toFixed(2) : change}% | RSI: ${rsi?.toFixed ? rsi.toFixed(1) : rsi} | MACD: ${macd?.histogram?.toFixed ? macd.histogram.toFixed(3) : macd?.histogram} | موجة: ${wave || 'غير محدد'}`;

            const [technical, fundamental, sentiment, risk] = await Promise.all([
                ai.models.generateContent({
                    model: "gemini-2.0-flash",
                    contents: [{ parts: [{ text: `أنت محلل فني متخصص في السوق السعودي. حلل هذا السهم من منظور فني بحت.
${stockInfo}
ATR: ${atr ?? 'N/A'} | Bollinger Upper: ${bb?.upper ?? 'N/A'} | Middle: ${bb?.middle ?? 'N/A'} | Lower: ${bb?.lower ?? 'N/A'} | StochRSI K: ${stochRsi?.k ?? 'N/A'} D: ${stochRsi?.d ?? 'N/A'}

قدم:
1. الاتجاه الفني الحالي (صاعد/هابط/عرضي) مع نسبة الثقة
2. مستويات الدعم والمقاومة الرئيسية بأرقام محددة
3. نقطة الدخول المثالية ووقف الخسارة والهدف
4. جملة واحدة: الخلاصة الفنية
اجعل الرد مختصراً ومحدداً بأرقام.` }] }]
                }),
                ai.models.generateContent({
                    model: "gemini-2.0-flash",
                    contents: [{ parts: [{ text: `أنت محلل أساسي متخصص في الشركات السعودية المدرجة. قيّم هذه الشركة من منظور أساسي.
${companyName} (${symbol}) - السعر الحالي: ${price} ر.س

بناءً على معرفتك بالشركة وقطاعها:
1. جودة الشركة كاستثمار (ممتاز/جيد/متوسط/ضعيف) مع السبب
2. المركز التنافسي في السوق السعودي
3. المخاطر الأساسية الرئيسية
4. هل السعر الحالي مناسب للدخول؟
5. جملة واحدة: الخلاصة الأساسية
اجعل الرد مختصراً ومركزاً.` }] }]
                }),
                ai.models.generateContent({
                    model: "gemini-2.0-flash",
                    contents: [{ parts: [{ text: `أنت محلل متخصص في قراءة مشاعر السوق وسيكولوجية المتداولين السعوديين.
${stockInfo}
نسبة الحجم: ${volumeRatio ?? 1}x من المعدل

حلل:
1. معنويات السوق الحالية تجاه هذا السهم (خوف/حياد/طمع)
2. هل الحجم يدعم الحركة السعرية؟
3. احتمالية القطيع: هل المتداولون يتراكمون أم يتخارجون؟
4. التوقع النفسي للسعر في الأسبوع القادم
5. جملة واحدة: خلاصة المشاعر
اجعل الرد مختصراً ومباشراً.` }] }]
                }),
                ai.models.generateContent({
                    model: "gemini-2.0-flash",
                    contents: [{ parts: [{ text: `أنت مدير مخاطر محترف متخصص في السوق السعودي.
${stockInfo}
ATR: ${atr ?? 'N/A'} | نسبة الحجم: ${volumeRatio ?? 1}x

قيّم:
1. مستوى المخاطرة الإجمالي (منخفض/متوسط/عالي/مرتفع جداً) مع السبب
2. وقف الخسارة المثالي بناءً على ATR بسعر محدد
3. نسبة المخاطرة/العائد المتوقعة
4. حجم المركز المناسب لمحفظة 100,000 ر.س (عند مخاطرة 1-2%)
5. جملة واحدة: توصية إدارة المخاطر
اجعل الرد مختصراً ومحدداً بأرقام.` }] }]
                })
            ]);

            const technicalText = technical.text || '';
            const fundamentalText = fundamental.text || '';
            const sentimentText = sentiment.text || '';
            const riskText = risk.text || '';

            const synthesis = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: [{ parts: [{ text: `أنت محلل رئيسي تجمع آراء خبراء متعددين لاتخاذ قرار نهائي.

السهم: ${companyName} (${symbol}) - السعر: ${price} ر.س

التحليل الفني:
${technicalText}

التحليل الأساسي:
${fundamentalText}

تحليل المشاعر:
${sentimentText}

تحليل المخاطر:
${riskText}

بناءً على هذه التحليلات الأربعة، قدم:
1. **القرار النهائي**: شراء الآن / انتظار فرصة أفضل / تجنب
2. **مستوى الإجماع**: كم من التحليلات تدعم القرار؟
3. **الاستراتيجية المقترحة** في 3 نقاط عملية محددة
4. **أهم تحذير واحد** يجب مراعاته
اجعل الخلاصة مختصرة وحاسمة.` }] }]
            });

            res.json({
                success: true,
                agents: {
                    technical: technicalText,
                    fundamental: fundamentalText,
                    sentiment: sentimentText,
                    risk: riskText,
                    synthesis: synthesis.text || ''
                }
            });
        } catch (e: any) {
            console.error("❌ Multi-Agent Error:", e.message);
            res.status(500).json({ success: false, error: "فشل التحليل متعدد الوكلاء." });
        }
    });

    // ========= Scenario Simulator endpoint =========
    app.post("/api/scenario", async (req, res) => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        if (!checkRateLimit(ip + ':scenario', 5, 60_000)) {
            return res.status(429).json({ success: false, error: "تجاوزت الحد المسموح (5 طلبات في الدقيقة)" });
        }
        const { scenario, stocks } = req.body;
        if (!scenario || typeof scenario !== 'string' || scenario.trim().length < 5) {
            return res.status(400).json({ success: false, error: "يرجى إدخال سيناريو صالح (5 أحرف على الأقل)" });
        }
        if (!process.env.GEMINI_API_KEY) {
            return res.status(503).json({ success: false, error: "مفتاح Gemini غير مضبوط" });
        }
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const stocksList = Array.isArray(stocks)
                ? (stocks as Array<{ symbol: string; companyName: string }>)
                    .slice(0, 30)
                    .map(s => `${s.symbol}:${s.companyName}`)
                    .join('، ')
                : '2222:أرامكو، 2010:سابك، 1120:الراجحي، 7010:stc، 1180:البنك الأهلي، 2082:أكوا باور، 4030:البحري، 2380:بترورابغ، 1211:معادن، 7020:موبايلي';

            const prompt = `أنت محلل اقتصادي متخصص في تأثير الأحداث الكلية على سوق الأسهم السعودي (تاسي).

السيناريو: "${scenario.trim()}"

من قائمة الأسهم التالية في السوق السعودي:
${stocksList}

حلل تأثير هذا السيناريو وأجب بتنسيق JSON التالي بالضبط:
{
  "scenario_summary": "ملخص السيناريو وتأثيره الكلي في جملتين",
  "overall_market_impact": "إيجابي أو سلبي أو محايد",
  "impact_percentage": "نسبة التأثير المتوقعة على مؤشر تاسي مثال: -3% إلى -5%",
  "affected_sectors": [
    {"sector": "اسم القطاع", "impact": "إيجابي أو سلبي", "reason": "السبب في جملة", "severity": 3}
  ],
  "top_negative_stocks": [
    {"symbol": "رمز السهم 4 أرقام", "company": "اسم الشركة", "reason": "سبب التأثير السلبي", "expected_change": "-5%"}
  ],
  "top_positive_stocks": [
    {"symbol": "رمز السهم 4 أرقام", "company": "اسم الشركة", "reason": "سبب الاستفادة", "expected_change": "+3%"}
  ],
  "trading_strategy": "الاستراتيجية المقترحة للمتداول في 3 نقاط واضحة",
  "time_horizon": "الإطار الزمني المتوقع للتأثير مثال: 1-2 أسبوع"
}

أجب بـ JSON فقط بدون أي نص خارج الـ JSON.`;

            const response = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: [{ parts: [{ text: prompt }] }],
                config: { responseMimeType: "application/json" }
            });

            let result: Record<string, unknown>;
            try {
                result = JSON.parse(response.text || '{}');
            } catch {
                result = { scenario_summary: response.text || 'تعذر تحليل السيناريو', overall_market_impact: 'غير محدد' };
            }

            res.json({ success: true, result });
        } catch (e: any) {
            console.error("❌ Scenario Error:", e.message);
            res.status(500).json({ success: false, error: "فشل تحليل السيناريو." });
        }
    });

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.listen(PORT, "0.0.0.0", async () => {
        console.log(`Server running on http://localhost:${PORT}`);
        
        // اختبار الاتصال بياهو فاينانس عند التشغيل
        try {
            console.log("🧪 اختبار الاتصال بياهو فاينانس (سهم الراجحي 1120.SR)...");
            const testQuote = await yfQuote('1120.SR');
            if (testQuote) {
                console.log(`✅ نجح الاختبار! السعر الحالي للراجحي: ${testQuote.regularMarketPrice}`);
            }
        } catch (e: any) {
            console.error("❌ فشل اختبار الاتصال بياهو فاينانس:", e.message || e);
        }

        // Start first scan after a short delay to ensure server stability
        setTimeout(() => {
            console.log("⚙️ بدء المسح الأول للسوق...");
            sendTelegramMsg("⚙️ *تم تشغيل الرادار بنجاح!*\nجاري مسح السوق السعودي بالكامل...");
            startFullScan().catch(err => console.error("❌ خطأ في المسح الشامل:", err));
        }, 3000);
        
        // Interval scan every 10 minutes
        setInterval(() => {
            startFullScan().catch(err => console.error("❌ خطأ في المسح الدوري:", err));
        }, 600000);
    });
}

startServer();
