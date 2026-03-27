/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { 
  Radar, 
  TrendingUp, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  RefreshCw, 
  Bell, 
  History, 
  Zap, 
  Send,
  Brain,
  Calculator,
  ShieldCheck,
  Target,
  Wallet,
  TrendingDown,
  Activity,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Clock,
  PieChart,
  ExternalLink,
  MessageSquare,
  Star,
  User,
  Sun,
  Moon,
  Newspaper,
  Search,
  List as ListIcon,
  Brain
} from 'lucide-react';
import AIAdvisor from './pages/AIAdvisor';
// GoogleGenAI calls now go through /api/* backend endpoints (key stays server-side)
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import * as ReactWindow from 'react-window';
import * as AutoSizerModule from 'react-virtualized-auto-sizer';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar,
  ReferenceLine
} from 'recharts';

import {
  auth,
  db,
  loginWithGoogle,
  handleRedirectResult,
  logout,
  onAuthStateChanged,
  serverTimestamp,
  handleFirestoreError,
  OperationType,
  FirebaseUser
} from './firebase';
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  query, 
  where, 
  onSnapshot, 
  addDoc,
  getDocs,
  updateDoc
} from 'firebase/firestore';

import { SAUDI_STOCKS } from './symbols';
import {
  fetchQuotesBatch,
  fetchChart,
  fetchTASI,
  buildStockFromQuote,
  buildHistoryFromChart,
  computeIndicators,
  enrichStocksWithChartData,
  getAllSymbols,
  loadCache,
  saveCache,
  scoreStock,
  loadLastKnownTasi,
  type StockScore,
  type TASIData,
} from './marketData';

const List = (ReactWindow as any).FixedSizeList;
const AutoSizerAny = (AutoSizerModule as any).default || (AutoSizerModule as any).AutoSizer || AutoSizerModule;

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "حدث خطأ غير متوقع.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error && parsed.error.includes("Missing or insufficient permissions")) {
          errorMessage = "ليس لديك صلاحية للقيام بهذا الإجراء.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-app-bg flex items-center justify-center p-6 text-center" dir="rtl">
          <div className="bg-app-surface border border-app-border p-8 rounded-3xl max-w-md w-full space-y-4">
            <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8 text-rose-500" />
            </div>
            <h2 className="text-xl font-bold text-app-text">عذراً، حدث خطأ</h2>
            <p className="text-app-text-muted text-sm">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-app-bg hover:bg-app-surface text-app-text font-bold rounded-xl border border-app-border transition-all"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface Trade {
  symbol: string;
  companyName: string;
  entryPrice: number;
  entryTime: string;
  rsi: number;
  sma50: number;
  wave?: string;
}

interface Alert {
  type: 'entry' | 'exit';
  symbol: string;
  companyName: string;
  price: number;
  time: string;
  wave?: string;
  profit?: number;
}

interface StockStats {
  symbol: string;
  companyName: string;
  price: number;
  change: number;
  volume: number;
  volumeRatio: number;
  rsi: number;
  wave?: string;
  macd?: {
    macd: number;
    signal: number;
    histogram: number;
  };
  bb?: {
    middle: number;
    upper: number;
    lower: number;
  };
  atr?: number;
  stochRsi?: {
    k: number;
    d: number;
  };
}

interface CustomAlert {
  id: string;
  symbol: string;
  companyName: string;
  condition: 'above' | 'below';
  targetPrice: number;
  triggered: boolean;
  triggeredAt?: string;
  triggeredPrice?: number;
  createdAt: string;
}

interface MarginAccount {
  userId: string;
  balance: number;
  equity: number;
  marginUsed: number;
  maintenanceMargin: number;
  updatedAt: any;
}

interface MarginPosition {
  id: string;
  userId: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  marginRequired: number;
  status: 'open' | 'closed';
  openedAt: any;
  closedAt?: any;
}

interface Status {
  lastScan: string | null;
  isScanning: boolean;
  processedCount: number;
  totalCount: number;
  activeTradesCount: number;
  activeTrades: Trade[];
  alerts: Alert[];
  topGainers: StockStats[];
  topLosers: StockStats[];
  liquidityEntry: StockStats[];
  liquidityExit: StockStats[];
  waveStocks: StockStats[];
  tickerData: StockStats[];
  customAlerts: CustomAlert[];
  marketIndex: TASIData | null;
  telegramConnected: boolean;
  telegramBotName: string | null;
  botStatusError: string | null;
}

const TickerTape = ({ data, marketIndex }: { data: StockStats[], marketIndex: any }) => {
  if (!data || data.length === 0) return (
    <div className="bg-app-surface border-b border-app-border h-10 flex items-center px-4 text-[10px] text-app-text-muted italic">
      جاري جلب بيانات السوق...
    </div>
  );
  
  // Create a single unit of ticker content
  const tickerItems = (
    <>
      {marketIndex && (
        <div className="flex items-center gap-3 text-xs font-bold border-l border-app-border pl-12">
          <span className="text-amber-500">TASI</span>
          <span className="font-mono text-app-text">{marketIndex.price.toLocaleString()}</span>
          <span className={`flex items-center gap-1 ${marketIndex.change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {marketIndex.change >= 0 ? '▲' : '▼'}
            {Math.abs(marketIndex.changePercent).toFixed(2)}%
          </span>
        </div>
      )}
      {data.map((item, i) => (
        <div key={i} className="flex items-center gap-3 text-xs font-bold">
          <span className="text-app-text">{item.companyName}</span>
          <span className="font-mono text-app-text-muted">{item.price.toFixed(2)}</span>
          <span className={`flex items-center gap-1 ${item.change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {item.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingUp className="w-3 h-3 rotate-180" />}
            {Math.abs(item.change).toFixed(2)}%
          </span>
        </div>
      ))}
    </>
  );

  return (
    <div className="h-10 flex items-center overflow-hidden whitespace-nowrap sticky top-0 z-[49]"
         style={{ background: 'rgba(15,17,23,0.98)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-app-bg to-transparent z-10" />
      <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-app-bg to-transparent z-10" />
      
      <motion.div
        animate={{ x: [0, -200 * (data.length + (marketIndex ? 1 : 0))] }}
        transition={{
          duration: (data.length + 1) * 3,
          repeat: Infinity,
          ease: "linear",
        }}
        className="flex gap-12 px-8"
      >
        {tickerItems}
        {tickerItems}
        {tickerItems}
      </motion.div>
    </div>
  );
};

const LogoGenerator = () => {
  const [logos, setLogos] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateLogo = async () => {
    setIsGenerating(true);
    try {
      // AI logo generation requires backend
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="p-6 bg-app-surface border border-app-border rounded-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-xl">
            <Brain className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <h3 className="font-bold text-app-text">ابتكار هوية "تريندسا"</h3>
            <p className="text-[10px] text-app-text-muted">استخدم الذكاء الاصطناعي لتصميم شعار احترافي</p>
          </div>
        </div>
        <button
          onClick={generateLogo}
          disabled={isGenerating}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
        >
          {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          ابتكار شعار
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {logos.map((url, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="aspect-square rounded-xl overflow-hidden border border-app-border bg-white group relative"
          >
            <img src={url} alt={`Logo concept ${i}`} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <button 
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                className="p-2 bg-white text-black rounded-full shadow-lg"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        ))}
        {isGenerating && (
          <div className="aspect-square rounded-xl border border-dashed border-app-border flex items-center justify-center bg-app-bg/50 animate-pulse">
            <Loader2 className="w-8 h-8 text-app-text-muted animate-spin" />
          </div>
        )}
        {logos.length === 0 && !isGenerating && (
          <div className="col-span-2 py-12 text-center text-app-text-muted italic text-xs border border-dashed border-app-border rounded-xl">
            اضغط على "ابتكار شعار" للبدء في تصميم الهوية البصرية
          </div>
        )}
      </div>
    </div>
  );
};
// ---- RSI mini-gauge ----
const RsiGauge = ({ value }: { value: number }) => {
  const pct   = Math.min(100, Math.max(0, value));
  const fill  = value > 70 ? 'var(--negative)' : value < 30 ? 'var(--positive)' : '#60a5fa';
  const txtCl = value > 70 ? 'text-negative' : value < 30 ? 'text-positive' : 'text-app-text-muted';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 bg-app-border rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: fill }} />
      </div>
      <span className={`text-[10px] num ${txtCl}`}>{value.toFixed(0)}</span>
    </div>
  );
};

// ---- Score badge (glassmorphism pill) ----
const ScoreBadge = ({ score }: { score: StockScore }) => (
  <span className={`glass-badge ${score.color}`}>
    {score.total}<span style={{ opacity: 0.5 }}>/6</span>
  </span>
);

const MiniTable = ({ title, icon: Icon, data, type, onStockClick, accent = 'emerald' }: {
  title: string;
  icon: any;
  data: any[];
  type: 'price' | 'liquidity' | 'wave';
  onStockClick: (stock: any) => void;
  accent?: 'emerald' | 'rose' | 'amber';
}) => {
  const accentCls = {
    emerald: { icon: 'bg-emerald-500/10 text-emerald-500' },
    rose:    { icon: 'bg-rose-500/10 text-rose-500'       },
    amber:   { icon: 'bg-amber-500/10 text-amber-500'     },
  }[accent];

  const metricLabel = type === 'price' ? 'التغير' : type === 'liquidity' ? 'السيولة' : 'الموجة';

  return (
    <div className="bg-app-surface border border-app-border rounded-2xl overflow-hidden flex flex-col shadow-sm" style={{ minHeight: 420 }}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-app-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-lg ${accentCls.icon}`}>
            <Icon className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold tracking-tight">{title}</h3>
        </div>
        <span className="text-[10px] text-app-text-muted border border-app-border px-2.5 py-1 rounded-full font-mono">
          {data.length > 0 ? `${data.length} سهم` : 'TOP 10'}
        </span>
      </div>

      {/* Column headers */}
      <div
        className="grid gap-x-3 px-4 py-2.5 border-b border-app-border bg-app-surface/95 backdrop-blur-sm sticky top-0 z-10"
        style={{
          gridTemplateColumns: type === 'wave' ? '1fr auto auto' : '1fr 64px auto auto',
          fontSize: 11, letterSpacing: '0.05em', fontWeight: 700,
          color: 'var(--text-muted)', textTransform: 'uppercase',
        }}
      >
        <span>الشركة</span>
        {type !== 'wave' && <span className="text-center">RSI</span>}
        <span className="text-center">{metricLabel}</span>
        <span className="text-center">قوة</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-app-text-muted">
            <Loader2 className="w-5 h-5 animate-spin opacity-40" />
            <span className="text-xs italic">جاري التحليل...</span>
          </div>
        ) : data.map((item, i) => {
          const score = scoreStock(item);
          const isPos = item.change >= 0;
          return (
            <div
              key={i}
              className="zebra-row grid gap-x-3 items-start px-4 py-3 cursor-pointer group"
              style={{ gridTemplateColumns: type === 'wave' ? '1fr auto auto' : '1fr 64px auto auto' }}
              onClick={() => onStockClick(item)}
            >
              {/* Company — full name, no truncation */}
              <div className="min-w-0 space-y-0.5">
                <div className="font-semibold leading-snug group-hover:text-[#00d4aa] transition-colors break-words"
                     style={{ fontSize: 13, color: 'var(--text)' }}>
                  {item.companyName || '---'}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-app-text-muted font-mono" style={{ fontSize: 10 }}>
                    {item.symbol?.replace('.SR', '')}
                  </span>
                  <span className="num font-bold" style={{ fontSize: 11, color: isPos ? 'var(--positive)' : 'var(--negative)' }}>
                    {item.price?.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* RSI gauge — visible when columns allow */}
              {type !== 'wave' && (
                <div className="flex justify-center pt-1">
                  <RsiGauge value={item.rsi ?? 50} />
                </div>
              )}

              {/* Primary metric */}
              <div className="text-center num font-bold pt-1" style={{ fontSize: 12 }}>
                {type === 'wave' ? (
                  <span className="text-amber-400 font-medium text-right block leading-snug" style={{ fontSize: 10 }}>
                    {item.wave || '—'}
                  </span>
                ) : type === 'price' ? (
                  <span style={{ color: isPos ? 'var(--positive)' : 'var(--negative)' }}>
                    {isPos ? '+' : ''}{item.change?.toFixed(2)}%
                  </span>
                ) : (
                  <span className="text-blue-400">{item.volumeRatio?.toFixed(1)}x</span>
                )}
              </div>

              {/* Score badge */}
              <div className="flex justify-center pt-1">
                <ScoreBadge score={score} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const StockDetailsModal = ({ stock, onClose, watchlist, onToggleWatchlist }: { 
  stock: StockStats, 
  onClose: () => void,
  watchlist: string[],
  onToggleWatchlist: (symbol: string) => void
}) => {
  const [activeTab, setActiveTab] = useState<'analysis' | 'news' | 'risk' | 'alerts'>('analysis');
  const [targetPrice, setTargetPrice] = useState<string>('');
  const [condition, setCondition] = useState<'above' | 'below'>('above');
  const [isSettingAlert, setIsSettingAlert] = useState(false);
  const [localAlerts, setLocalAlerts] = useState<CustomAlert[]>(() => {
    const all: CustomAlert[] = JSON.parse(localStorage.getItem('saudi_stock_alerts') || '[]');
    return all.filter(a => a.symbol === stock.symbol);
  });
  const [alertStatus, setAlertStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [liveIndicators, setLiveIndicators] = useState<ReturnType<typeof computeIndicators> | null>(null);

  // AI Analyst States
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  // News States
  const [news, setNews] = useState<any[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

  // Risk Calculator States
  const [capital, setCapital] = useState<string>('100000');
  const [riskPercent, setRiskPercent] = useState<string>('1');
  const [stopLossInput, setStopLossInput] = useState<string>((stock.price * 0.97).toFixed(2));

  const handleAIAnalysis = async () => {
    setIsAnalyzing(true);
    setAiAnalysis(null);
    try {
      const ind = liveIndicators;
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol:      stock.symbol,
          companyName: stock.companyName,
          price:       stock.price,
          change:      stock.change,
          rsi:         ind?.rsi      ?? stock.rsi      ?? 50,
          wave:        ind?.wave     ?? stock.wave     ?? 'غير محدد',
          macd:        ind?.macd     ?? stock.macd,
          bb:          ind?.bb       ?? stock.bb,
          atr:         ind?.atr      ?? stock.atr,
          stochRsi:    ind?.stochRsi ?? stock.stochRsi,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل التحليل');
      // data.analysis is now a structured object from Claude
      setAiAnalysis(typeof data.analysis === 'object' ? JSON.stringify(data.analysis) : data.analysis);
    } catch (e: any) {
      setAiAnalysis(`❌ ${e.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const fetchNews = async () => {
    if (news.length > 0) return;
    setLoadingNews(true);
    setNewsError(null);
    try {
      const res = await fetch('/api/ai-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: stock.symbol, companyName: stock.companyName }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'فشل جلب الأخبار');
      setNews(data.news ?? []);
    } catch (e: any) {
      setNewsError(e.message);
    } finally {
      setLoadingNews(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'news') {
      fetchNews();
    }
  }, [activeTab]);

  // Calculations for Risk Management
  const calcRisk = () => {
    const cap = parseFloat(capital) || 0;
    const riskP = parseFloat(riskPercent) || 0;
    const entry = stock.price;
    const sl = parseFloat(stopLossInput) || 0;

    if (cap <= 0 || riskP <= 0 || entry <= sl || sl <= 0) return null;

    const amountToRisk = cap * (riskP / 100);
    const riskPerShare = entry - sl;
    const shares = Math.floor(amountToRisk / riskPerShare);
    const totalValue = shares * entry;

    return {
      shares,
      totalValue,
      amountToRisk,
      riskPerShare
    };
  };

  const riskResult = calcRisk();
  // Merge live indicators (computed from chart) over the basic quote data
  const ds = liveIndicators ? { ...stock, ...liveIndicators } : stock;

  useEffect(() => {
    const loadHistory = async () => {
      setLoadingHistory(true);
      setHistoryError(null);
      try {
        const { meta, quotes } = await fetchChart(stock.symbol, '1h', '30d');
        const hist = buildHistoryFromChart(meta, quotes);
        if (hist.length > 0) {
          setHistory(hist);
          setLiveIndicators(computeIndicators(quotes));
        } else {
          setHistoryError('لا توجد بيانات متاحة لهذا السهم حالياً');
        }
      } catch (e) {
        console.error('Failed to fetch history', e);
        setHistoryError('فشل جلب البيانات من Yahoo Finance');
      } finally {
        setLoadingHistory(false);
      }
    };
    loadHistory();
  }, [stock.symbol]);

  const handleSetAlert = async () => {
    const price = parseFloat(targetPrice);
    if (!targetPrice || isNaN(price) || price <= 0) {
      setAlertStatus({ type: 'error', message: 'يرجى إدخال سعر مستهدف صحيح' });
      return;
    }

    setIsSettingAlert(true);
    try {
      const key = 'saudi_stock_alerts';
      const existing: CustomAlert[] = JSON.parse(localStorage.getItem(key) || '[]');
      const duplicate = existing.find(
        a => a.symbol === stock.symbol && a.condition === condition && !a.triggered,
      );
      if (duplicate) {
        setAlertStatus({ type: 'error', message: 'يوجد تنبيه نشط بنفس الشرط لهذا السهم' });
        setIsSettingAlert(false);
        setTimeout(() => setAlertStatus({ type: null, message: '' }), 3000);
        return;
      }
      const newAlert: CustomAlert = {
        id: Date.now().toString(),
        symbol: stock.symbol,
        companyName: stock.companyName,
        condition,
        targetPrice: price,
        triggered: false,
        createdAt: new Date().toISOString(),
      };
      existing.push(newAlert);
      localStorage.setItem(key, JSON.stringify(existing));
      setLocalAlerts(existing.filter(a => a.symbol === stock.symbol));
      setAlertStatus({ type: 'success', message: `✅ تنبيه مضبوط: ${condition === 'above' ? 'فوق' : 'تحت'} ${price.toFixed(2)} ر.س` });
      setTargetPrice('');
    } catch {
      setAlertStatus({ type: 'error', message: '❌ فشل ضبط التنبيه' });
    } finally {
      setIsSettingAlert(false);
      setTimeout(() => setAlertStatus({ type: null, message: '' }), 3000);
    }
  };

  const handleDeleteLocalAlert = (id: string) => {
    const key = 'saudi_stock_alerts';
    const all: CustomAlert[] = JSON.parse(localStorage.getItem(key) || '[]');
    const updated = all.filter(a => a.id !== id);
    localStorage.setItem(key, JSON.stringify(updated));
    setLocalAlerts(updated.filter(a => a.symbol === stock.symbol));
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="w-full max-w-lg bg-app-surface border border-app-border rounded-3xl overflow-hidden modal-shadow modal-mobile max-h-[90vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          <div className="p-6 border-b border-app-border flex items-center justify-between bg-app-surface/50">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => onToggleWatchlist(stock.symbol)}
                className={`p-2 rounded-xl transition-all ${
                  watchlist.includes(stock.symbol) 
                    ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' 
                    : 'bg-app-bg text-app-text-muted border border-app-border hover:border-app-text-muted/30'
                }`}
                title={watchlist.includes(stock.symbol) ? "إزالة من قائمتي" : "إضافة إلى قائمتي"}
              >
                <Star className={`w-5 h-5 ${watchlist.includes(stock.symbol) ? 'fill-amber-500' : ''}`} />
              </button>
              <div>
                <h2 className="text-xl font-bold text-app-text">{stock.companyName}</h2>
                <p className="text-sm text-app-text-muted font-mono">{stock.symbol}</p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-app-bg rounded-full transition-colors"
            >
              <AlertCircle className="w-6 h-6 text-app-text-muted rotate-45" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Tabs Navigation */}
            <div className="px-6 pt-4 flex items-center gap-2 border-b border-app-border sticky top-0 bg-app-surface z-10">
              <button 
                onClick={() => setActiveTab('analysis')}
                className={`pb-3 px-2 text-xs font-bold transition-all relative ${activeTab === 'analysis' ? 'text-emerald-500' : 'text-app-text-muted hover:text-app-text'}`}
              >
                التحليل الفني
                {activeTab === 'analysis' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />}
              </button>
              <button 
                onClick={() => setActiveTab('news')}
                className={`pb-3 px-2 text-xs font-bold transition-all relative ${activeTab === 'news' ? 'text-blue-500' : 'text-app-text-muted hover:text-app-text'}`}
              >
                الأخبار والتقارير
                {activeTab === 'news' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
              </button>
              <button 
                onClick={() => setActiveTab('risk')}
                className={`pb-3 px-2 text-xs font-bold transition-all relative ${activeTab === 'risk' ? 'text-amber-500' : 'text-app-text-muted hover:text-app-text'}`}
              >
                إدارة المخاطر
                {activeTab === 'risk' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />}
              </button>
              <button 
                onClick={() => setActiveTab('alerts')}
                className={`pb-3 px-2 text-xs font-bold transition-all relative ${activeTab === 'alerts' ? 'text-purple-500' : 'text-app-text-muted hover:text-app-text'}`}
              >
                التنبيهات
                {activeTab === 'alerts' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500 rounded-full" />}
              </button>
            </div>

            <div className="p-6 space-y-6">
              {activeTab === 'analysis' && (
                <>
                  {/* Price + change + score header */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-4 rounded-2xl border border-app-border col-span-1" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)' }} className="mb-1">السعر الحالي</p>
                      <p className="num font-extrabold text-app-text" style={{ fontSize: 22 }}>{stock.price.toFixed(2)}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)' }} className="mt-0.5">ريال سعودي</p>
                    </div>
                    <div className="p-4 rounded-2xl border col-span-1" style={{
                      background: stock.change >= 0 ? 'rgba(0,212,170,0.05)' : 'rgba(255,71,87,0.05)',
                      borderColor: stock.change >= 0 ? 'rgba(0,212,170,0.2)' : 'rgba(255,71,87,0.2)',
                    }}>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)' }} className="mb-1">التغيير</p>
                      <p className="num font-extrabold" style={{ fontSize: 22, color: stock.change >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                        {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}%
                      </p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)' }} className="mt-0.5">اليوم</p>
                    </div>
                    {(() => {
                      const sc = scoreStock(ds, liveIndicators ?? undefined);
                      const bg: Record<string, string> = {
                        emerald: 'bg-emerald-500/5 border-emerald-500/20',
                        amber:   'bg-amber-500/5 border-amber-500/20',
                        blue:    'bg-blue-500/5 border-blue-500/20',
                        slate:   'bg-slate-500/5 border-slate-500/20',
                      };
                      const txt: Record<string, string> = {
                        emerald: 'text-emerald-400',
                        amber:   'text-amber-400',
                        blue:    'text-blue-400',
                        slate:   'text-slate-400',
                      };
                      return (
                        <div className={`p-4 rounded-2xl border col-span-1 ${bg[sc.color]}`}>
                          <p className="text-[10px] text-app-text-muted mb-1">قوة الإشارة</p>
                          <p className={`text-2xl font-bold font-mono ${txt[sc.color]}`}>{sc.total}<span className="text-sm text-app-text-muted">/6</span></p>
                          <p className={`text-[10px] mt-0.5 ${txt[sc.color]}`}>{sc.label}</p>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Score reasons breakdown */}
                  {(() => {
                    const sc = scoreStock(ds, liveIndicators ?? undefined);
                    if (!sc.reasons.length) return null;
                    return (
                      <div className="p-3 bg-app-bg/30 rounded-xl border border-app-border space-y-1.5">
                        <p className="text-[10px] font-semibold text-app-text-muted uppercase tracking-wider mb-2">عوامل الإشارة المتوافقة</p>
                        {sc.reasons.map((r, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px]">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                            <span className="text-app-text">{r}</span>
                          </div>
                        ))}
                        {Array.from({ length: 6 - sc.reasons.length }).map((_, i) => (
                          <div key={`missing-${i}`} className="flex items-center gap-2 text-[11px] opacity-30">
                            <div className="w-3 h-3 rounded-full border border-app-border shrink-0" />
                            <span className="text-app-text-muted">غير مكتمل</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-app-text-muted uppercase tracking-wider flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-500" />
                      الرسم البياني والمؤشرات
                    </h3>
                    
                    <div className="h-[300px] min-h-[300px] w-full bg-app-bg/20 rounded-2xl border border-app-border p-4 relative">
                      {loadingHistory ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Loader2 className="w-6 h-6 text-app-text-muted animate-spin" />
                        </div>
                      ) : historyError ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-app-text-muted text-xs text-center px-4">
                          <AlertCircle className="w-8 h-8 mb-2 opacity-20" />
                          <p>{historyError}</p>
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={history}>
                            <defs>
                              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-app-border)" vertical={false} />
                            <XAxis 
                              dataKey="time" 
                              stroke="var(--color-app-text-muted)" 
                              fontSize={10} 
                              tickLine={false} 
                              axisLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis 
                              stroke="var(--color-app-text-muted)" 
                              fontSize={10} 
                              tickLine={false} 
                              axisLine={false} 
                              domain={['auto', 'auto']}
                              orientation="right"
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'var(--color-app-surface)', border: '1px solid var(--color-app-border)', fontSize: '12px', color: 'var(--color-app-text)' }}
                              itemStyle={{ color: 'var(--color-app-text)' }}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="price" 
                              stroke="#10b981" 
                              fillOpacity={1} 
                              fill="url(#colorPrice)" 
                              strokeWidth={2}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="bbUpper" 
                              stroke="#3b82f6" 
                              strokeDasharray="5 5" 
                              dot={false} 
                              strokeWidth={1}
                              opacity={0.5}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="bbLower" 
                              stroke="#3b82f6" 
                              strokeDasharray="5 5" 
                              dot={false} 
                              strokeWidth={1}
                              opacity={0.5}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    {/* MACD Chart */}
                    <div className="h-[150px] min-h-[150px] w-full bg-app-bg/20 rounded-2xl border border-app-border p-4 relative">
                      {loadingHistory ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Loader2 className="w-6 h-6 text-app-text-muted animate-spin" />
                        </div>
                      ) : historyError ? (
                        <div className="absolute inset-0 flex items-center justify-center text-app-text-muted text-[10px]">
                          لا تتوفر بيانات MACD
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={history}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-app-border)" vertical={false} />
                            <XAxis dataKey="time" hide />
                            <YAxis hide domain={['auto', 'auto']} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'var(--color-app-surface)', border: '1px solid var(--color-app-border)', fontSize: '12px', color: 'var(--color-app-text)' }}
                              itemStyle={{ color: 'var(--color-app-text)' }}
                            />
                            <Bar dataKey="histogram">
                              {history.map((entry, index) => (
                                <rect 
                                  key={`cell-${index}`} 
                                  fill={entry.histogram >= 0 ? '#10b981' : '#ef4444'} 
                                  opacity={0.8}
                                />
                              ))}
                            </Bar>
                            <Line type="monotone" dataKey="macd" stroke="#3b82f6" dot={false} strokeWidth={1} />
                            <Line type="monotone" dataKey="signal" stroke="#f59e0b" dot={false} strokeWidth={1} />
                            <ReferenceLine y={0} stroke="var(--color-app-text-muted)" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-app-text-muted uppercase tracking-wider flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-500" />
                      المؤشرات الفنية المتقدمة
                    </h3>
                    
                    <div className="grid grid-cols-1 gap-4">
                      {/* MACD */}
                      <div className="p-4 bg-app-surface/30 rounded-2xl border border-app-border">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold text-app-text">MACD (12, 26, 9)</span>
                          <span className={`text-xs font-mono ${ds.macd?.histogram && ds.macd.histogram >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {ds.macd?.histogram && ds.macd.histogram >= 0 ? 'إيجابي' : 'سلبي'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-[10px] text-app-text-muted">MACD</p>
                            <p className="text-sm font-mono text-app-text">{ds.macd?.macd || '---'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-app-text-muted">Signal</p>
                            <p className="text-sm font-mono text-app-text">{ds.macd?.signal || '---'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-app-text-muted">Hist</p>
                            <p className={`text-sm font-mono ${ds.macd?.histogram && ds.macd.histogram >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {ds.macd?.histogram || '---'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Bollinger Bands */}
                      <div className="p-4 bg-app-surface/30 rounded-2xl border border-app-border">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold text-app-text">Bollinger Bands (20, 2)</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-[10px] text-app-text-muted">Upper</p>
                            <p className="text-sm font-mono text-app-text">{ds.bb?.upper || '---'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-app-text-muted">Middle</p>
                            <p className="text-sm font-mono text-app-text">{ds.bb?.middle || '---'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-app-text-muted">Lower</p>
                            <p className="text-sm font-mono text-app-text">{ds.bb?.lower || '---'}</p>
                          </div>
                        </div>
                      </div>

                      {/* RSI full gauge */}
                      <div className="p-4 rounded-2xl border border-app-border" style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold text-app-text">RSI (14)</span>
                          <span className={`glass-badge ${ds.rsi > 70 ? 'slate' : ds.rsi < 30 ? 'emerald' : ds.rsi >= 45 ? 'blue' : 'slate'}`}
                                style={{ color: ds.rsi > 70 ? 'var(--negative)' : ds.rsi < 30 ? 'var(--positive)' : undefined }}>
                            {ds.rsi > 70 ? 'تشبع شرائي' : ds.rsi < 30 ? 'تشبع بيعي' : ds.rsi >= 45 ? 'زخم صعودي' : 'محايد'}
                          </span>
                        </div>
                        {/* Gradient gauge bar */}
                        <div className="relative mb-3 h-3">
                          <div className="absolute inset-0 rounded-full overflow-hidden" style={{
                            background: 'linear-gradient(to left, var(--negative) 0%, #f59e0b 30%, #60a5fa 60%, var(--positive) 100%)',
                            opacity: 0.25,
                          }} />
                          <div className="absolute inset-0 rounded-full" style={{
                            background: `linear-gradient(to left, transparent ${100 - ds.rsi}%, rgba(255,255,255,0.15) ${100 - ds.rsi}%)`,
                          }} />
                          <div
                            className="absolute top-1/2 -translate-y-1/2 w-3 h-4 rounded-sm bg-white shadow-lg border border-white/20 -translate-x-1/2 transition-all duration-700"
                            style={{ left: `${Math.min(98, Math.max(2, ds.rsi))}%` }}
                          />
                        </div>
                        <div className="flex justify-between" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          <span>0 — تشبع بيعي</span>
                          <span className="num font-bold text-app-text" style={{ fontSize: 16 }}>{ds.rsi.toFixed(1)}</span>
                          <span>100 — تشبع شرائي</span>
                        </div>
                      </div>

                      {/* Stoch RSI + ATR + Elliott */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-4 bg-app-surface/30 rounded-2xl border border-app-border">
                          <p className="text-[10px] text-app-text-muted mb-1">Stoch RSI</p>
                          {ds.stochRsi ? (
                            <>
                              <p className={`text-lg font-bold font-mono ${ds.stochRsi.k > 80 ? 'text-rose-500' : ds.stochRsi.k < 20 ? 'text-emerald-500' : 'text-app-text'}`}>
                                K: {ds.stochRsi.k.toFixed(1)}
                              </p>
                              <p className={`text-[10px] mt-0.5 ${ds.stochRsi.k > ds.stochRsi.d ? 'text-emerald-500' : 'text-rose-500'}`}>
                                D: {ds.stochRsi.d.toFixed(1)} {ds.stochRsi.k > ds.stochRsi.d ? '▲' : '▼'}
                              </p>
                            </>
                          ) : <p className="text-sm text-app-text-muted">---</p>}
                        </div>
                        {ds.atr && ds.atr > 0 ? (
                          <div className="p-4 bg-app-surface/30 rounded-2xl border border-app-border">
                            <p className="text-[10px] text-app-text-muted mb-1">ATR (14) — التذبذب</p>
                            <p className="text-lg font-bold font-mono text-blue-400">{ds.atr.toFixed(3)}</p>
                            <p className="text-[10px] text-app-text-muted mt-0.5">وقف ×1.5: <span className="text-rose-400 font-mono">{(stock.price - ds.atr * 1.5).toFixed(2)}</span></p>
                          </div>
                        ) : (
                          <div className="p-4 bg-app-surface/30 rounded-2xl border border-app-border opacity-50">
                            <p className="text-[10px] text-app-text-muted mb-1">ATR (14)</p>
                            <p className="text-sm text-app-text-muted">---</p>
                          </div>
                        )}
                        <div className="p-4 bg-app-surface/30 rounded-2xl border border-app-border col-span-2">
                          <p className="text-[10px] text-app-text-muted mb-2">موجة إليوت</p>
                          <p className={`text-sm font-bold ${ds.wave && ds.wave !== 'غير محدد' ? 'text-amber-400' : 'text-app-text-muted'}`}>
                            {ds.wave || 'غير محدد'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* AI Analyst Section */}
                  <div className="space-y-4 pt-4 border-t border-app-border">
                    <h3 className="text-sm font-semibold text-app-text-muted uppercase tracking-wider flex items-center gap-2">
                      <Brain className="w-4 h-4 text-purple-500" />
                      المحلل الذكي (Claude AI)
                    </h3>
                    
                    {!aiAnalysis && !isAnalyzing ? (
                      <button 
                        onClick={handleAIAnalysis}
                        className="w-full py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-purple-900/20 flex items-center justify-center gap-3 group"
                      >
                        <Brain className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        اطلب تحليل الذكاء الاصطناعي للسهم
                      </button>
                    ) : (
                      <div className="p-5 bg-app-surface/40 rounded-2xl border border-purple-500/30 relative overflow-hidden">
                        {isAnalyzing ? (
                          <div className="flex flex-col items-center justify-center py-8 space-y-4">
                            <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                            <p className="text-sm text-app-text-muted animate-pulse">جاري تحليل البيانات العميقة للسهم...</p>
                          </div>
                        ) : (() => {
                          // Try to parse as structured Claude JSON
                          let parsed: any = null;
                          try { parsed = aiAnalysis ? JSON.parse(aiAnalysis) : null; } catch { parsed = null; }

                          if (parsed && parsed.recommendation) {
                            const recColor = parsed.recommendation === 'شراء' ? 'text-emerald-400' : parsed.recommendation === 'بيع' ? 'text-rose-400' : 'text-amber-400';
                            const recBg    = parsed.recommendation === 'شراء' ? 'bg-emerald-500/10 border-emerald-500/25' : parsed.recommendation === 'بيع' ? 'bg-rose-500/10 border-rose-500/25' : 'bg-amber-500/10 border-amber-500/25';
                            return (
                              <div className="space-y-3">
                                {/* Recommendation header */}
                                <div className={`flex items-center justify-between p-3 rounded-xl border ${recBg}`}>
                                  <div>
                                    <p className="text-[10px] text-app-text-muted mb-0.5">التوصية</p>
                                    <p className={`text-xl font-extrabold ${recColor}`}>{parsed.recommendation}</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[10px] text-app-text-muted mb-0.5">الثقة</p>
                                    <p className={`text-xl font-extrabold num ${recColor}`}>{parsed.confidence}%</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[10px] text-app-text-muted mb-0.5">المخاطر</p>
                                    <p className={`text-sm font-bold ${parsed.risk === 'مرتفع' ? 'text-rose-400' : parsed.risk === 'منخفض' ? 'text-emerald-400' : 'text-amber-400'}`}>{parsed.risk}</p>
                                  </div>
                                </div>
                                {/* Summary */}
                                {parsed.summary && <p className="text-sm text-app-text leading-relaxed">{parsed.summary}</p>}
                                {/* Price targets */}
                                <div className="grid grid-cols-2 gap-2">
                                  {parsed.entry   && <div className="p-2.5 bg-app-bg rounded-xl border border-app-border"><p className="text-[10px] text-app-text-muted">دخول</p><p className="num font-bold text-app-text text-sm">{parsed.entry} ر.س</p></div>}
                                  {parsed.stopLoss && <div className="p-2.5 bg-rose-500/5 rounded-xl border border-rose-500/20"><p className="text-[10px] text-app-text-muted">وقف الخسارة</p><p className="num font-bold text-rose-400 text-sm">{parsed.stopLoss} ر.س</p></div>}
                                  {parsed.target1 && <div className="p-2.5 bg-emerald-500/5 rounded-xl border border-emerald-500/20"><p className="text-[10px] text-app-text-muted">هدف 1</p><p className="num font-bold text-emerald-400 text-sm">{parsed.target1} ر.س</p></div>}
                                  {parsed.target2 && <div className="p-2.5 bg-emerald-500/5 rounded-xl border border-emerald-500/20"><p className="text-[10px] text-app-text-muted">هدف 2</p><p className="num font-bold text-emerald-400 text-sm">{parsed.target2} ر.س</p></div>}
                                </div>
                                {/* Reasoning */}
                                {Array.isArray(parsed.reasoning) && parsed.reasoning.length > 0 && (
                                  <div className="space-y-1.5">
                                    {parsed.reasoning.map((r: string, i: number) => (
                                      <div key={i} className="flex items-start gap-2 text-[11px]">
                                        <CheckCircle2 className="w-3 h-3 text-purple-400 shrink-0 mt-0.5" />
                                        <span className="text-app-text">{r}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <button onClick={handleAIAnalysis} className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 transition-colors font-medium">
                                  <RefreshCw className="w-3 h-3" /> تحديث التحليل
                                </button>
                              </div>
                            );
                          }

                          // Fallback: render as markdown text
                          return (
                            <div className="prose prose-invert prose-sm max-w-none text-app-text leading-relaxed dark:prose-invert">
                              <Markdown>{aiAnalysis ?? ''}</Markdown>
                              <button onClick={handleAIAnalysis} className="mt-4 flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 transition-colors font-medium">
                                <RefreshCw className="w-3 h-3" /> تحديث التحليل
                              </button>
                            </div>
                          );
                        })()}
                        <div className="absolute top-0 right-0 p-2 opacity-10">
                          <Brain className="w-12 h-12 text-purple-500" />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {activeTab === 'news' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-app-text-muted uppercase tracking-wider flex items-center gap-2">
                      <Newspaper className="w-4 h-4 text-blue-500" />
                      آخر الأخبار والتقارير
                    </h3>
                    <button 
                      onClick={() => { setNews([]); setNewsError(null); fetchNews(); }}
                      className="text-[10px] font-bold text-blue-500 hover:text-blue-400 transition-colors flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingNews ? 'animate-spin' : ''}`} />
                      تحديث
                    </button>
                  </div>

                  {loadingNews ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-4">
                      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                      <p className="text-sm text-app-text-muted animate-pulse">جاري البحث عن أحدث الأخبار...</p>
                    </div>
                  ) : newsError ? (
                    <div className="p-6 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-center">
                      <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
                      <p className="text-sm text-rose-500">{newsError}</p>
                      <button 
                        onClick={fetchNews}
                        className="mt-4 text-xs font-bold text-blue-500 underline"
                      >
                        إعادة المحاولة
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {news.map((item, i) => (
                        <motion.div 
                          key={i} 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.1 }}
                          className="bg-app-surface/40 rounded-2xl border border-app-border overflow-hidden hover:border-blue-500/30 transition-all group flex flex-col"
                        >
                          {item.imageUrl && (
                            <div className="w-full h-40 overflow-hidden shrink-0">
                              <img 
                                src={item.imageUrl} 
                                alt={item.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                referrerPolicy="no-referrer"
                                onError={(e) => (e.currentTarget.style.display = 'none')}
                              />
                            </div>
                          )}
                          <div className="p-5 flex flex-col flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider bg-blue-500/10 px-2 py-0.5 rounded">
                                {item.source}
                              </span>
                              <div className="flex items-center gap-2">
                                {item.sentiment && (
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                    item.sentiment === 'إيجابي' ? 'bg-emerald-500/10 text-emerald-400' :
                                    item.sentiment === 'سلبي'   ? 'bg-rose-500/10 text-rose-400' :
                                    'bg-app-bg text-app-text-muted'
                                  }`}>
                                    {item.sentiment}
                                  </span>
                                )}
                                <span className="text-[10px] text-app-text-muted font-mono">
                                  {item.date}
                                </span>
                              </div>
                            </div>
                            <h4 className="text-sm font-bold text-app-text mb-2 group-hover:text-blue-400 transition-colors leading-snug">
                              {item.title}
                            </h4>
                            {item.summary && item.summary !== item.title && (
                              <div className="text-xs text-app-text-muted leading-relaxed mb-3 line-clamp-2">
                                {item.summary}
                              </div>
                            )}
                            <div className="mt-auto flex items-center justify-end">
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs font-bold text-app-text hover:text-blue-500 transition-colors"
                              >
                                اقرأ المزيد
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                      {news.length === 0 && !loadingNews && (
                        <div className="text-center py-12 bg-app-surface/20 rounded-2xl border border-dashed border-app-border">
                          <Newspaper className="w-8 h-8 text-app-text-muted mx-auto mb-3 opacity-20" />
                          <p className="text-app-text-muted italic">لا توجد أخبار حديثة متاحة حالياً.</p>
                        </div>
                      )}
                      <p className="text-[10px] text-app-text-muted text-center italic">
                        تم استخراج وتلخيص هذه الأخبار باستخدام الذكاء الاصطناعي من مصادر متعددة.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'risk' && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-app-text-muted uppercase tracking-wider flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-emerald-500" />
                      حاسبة إدارة المخاطر
                    </h3>

                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-app-text-muted uppercase font-bold flex items-center gap-1">
                          <Wallet className="w-3 h-3" /> رأس المال
                        </label>
                        <input 
                          type="number" 
                          value={capital}
                          onChange={(e) => setCapital(e.target.value)}
                          className="w-full bg-app-bg border border-app-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors text-app-text"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-app-text-muted uppercase font-bold flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> نسبة المخاطرة %
                        </label>
                        <input 
                          type="number" 
                          value={riskPercent}
                          onChange={(e) => setRiskPercent(e.target.value)}
                          className="w-full bg-app-bg border border-app-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors text-app-text"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-app-text-muted uppercase font-bold flex items-center gap-1">
                          <Target className="w-3 h-3" /> وقف الخسارة
                        </label>
                        <input 
                          type="number" 
                          value={stopLossInput}
                          onChange={(e) => setStopLossInput(e.target.value)}
                          className="w-full bg-app-bg border border-app-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors text-app-text"
                        />
                      </div>
                    </div>

                    {riskResult ? (
                      <div className="grid grid-cols-1 gap-3">
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                          <p className="text-[10px] text-emerald-500/70 mb-1">عدد الأسهم المقترح</p>
                          <p className="text-2xl font-bold text-emerald-500">{riskResult.shares.toLocaleString()}</p>
                        </div>
                        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                          <p className="text-[10px] text-blue-500/70 mb-1">قيمة الصفقة الإجمالية</p>
                          <p className="text-2xl font-bold text-blue-500">{riskResult.totalValue.toLocaleString()} ر.س</p>
                        </div>
                        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                          <div className="flex justify-between items-center">
                            <p className="text-[10px] text-rose-500/70">المبلغ المخاطر به (في حال ضرب الوقف)</p>
                            <p className="text-lg font-bold text-rose-500">{riskResult.amountToRisk.toLocaleString()} ر.س</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-app-bg/50 rounded-xl text-center text-xs text-app-text-muted">
                        يرجى إدخال قيم صحيحة (وقف الخسارة يجب أن يكون أقل من سعر الدخول)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'alerts' && (
                <div className="space-y-5">
                  <h3 className="text-sm font-semibold text-app-text-muted uppercase tracking-wider flex items-center gap-2">
                    <Bell className="w-4 h-4 text-purple-500" />
                    ضبط تنبيه سعري
                  </h3>

                  {/* Condition toggle */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCondition('above')}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
                        condition === 'above'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : 'bg-app-bg text-app-text-muted border border-app-border'
                      }`}
                    >
                      <ArrowUpRight className="w-4 h-4" /> فوق السعر
                    </button>
                    <button
                      onClick={() => setCondition('below')}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
                        condition === 'below'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                          : 'bg-app-bg text-app-text-muted border border-app-border'
                      }`}
                    >
                      <ArrowDownRight className="w-4 h-4" /> تحت السعر
                    </button>
                  </div>

                  {/* Price input */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-app-text-muted uppercase font-bold">
                      السعر المستهدف
                      <span className="mr-2 text-app-text-muted font-normal normal-case">
                        (الحالي: {stock.price.toFixed(2)} ر.س)
                      </span>
                    </label>
                    <input
                      type="number"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      placeholder={`مثال: ${stock.price.toFixed(2)}`}
                      className="w-full bg-app-bg border border-app-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors text-app-text"
                    />
                  </div>

                  <button
                    onClick={handleSetAlert}
                    disabled={isSettingAlert}
                    className="w-full py-3.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSettingAlert ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    تفعيل التنبيه
                  </button>

                  <AnimatePresence>
                    {alertStatus.type && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className={`text-xs text-center p-3 rounded-xl ${
                          alertStatus.type === 'success'
                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                        }`}
                      >
                        {alertStatus.message}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Existing alerts for this stock */}
                  {localAlerts.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] text-app-text-muted uppercase font-bold tracking-wider">
                        تنبيهاتك لهذا السهم
                      </p>
                      {localAlerts.map(a => (
                        <div
                          key={a.id}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm ${
                            a.triggered
                              ? 'bg-app-bg border-app-border text-app-text-muted'
                              : a.condition === 'above'
                                ? 'bg-emerald-500/8 border-emerald-500/25'
                                : 'bg-rose-500/8 border-rose-500/25'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {a.triggered ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            ) : a.condition === 'above' ? (
                              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <ArrowDownRight className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            )}
                            <span className={a.triggered ? 'line-through' : ''}>
                              {a.condition === 'above' ? 'فوق' : 'تحت'} {a.targetPrice.toFixed(2)} ر.س
                            </span>
                            {a.triggered && a.triggeredPrice && (
                              <span className="text-[10px] text-emerald-500">
                                ✓ عند {a.triggeredPrice.toFixed(2)}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteLocalAlert(a.id)}
                            className="text-app-text-muted hover:text-rose-400 transition-colors p-1"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <div className="p-6 bg-app-surface/50 border-t border-app-border">
            <button 
              onClick={onClose}
              className="w-full py-3 bg-app-text text-app-bg font-bold rounded-xl hover:opacity-90 transition-colors"
            >
              إغلاق
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const FeedbackModal = ({ onClose, user }: { onClose: () => void, user: FirebaseUser | null }) => {
  const [name, setName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [type, setType] = useState('تحسين');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message) return;

    setIsSending(true);
    try {
      await addDoc(collection(db, 'feedback'), { name, email, type, message, createdAt: serverTimestamp() });
      setStatus({ type: 'success', message: '✅ شكراً لك! تم استلام ملاحظتك بنجاح.' });
      setTimeout(onClose, 2000);
    } catch (error) {
      console.error('Feedback error:', error);
      setStatus({ type: 'error', message: '❌ فشل الإرسال، يرجى المحاولة لاحقاً.' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div 
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="bg-app-surface border border-app-border w-full max-w-md rounded-3xl overflow-hidden shadow-2xl modal-mobile"
          onClick={e => e.stopPropagation()}
        >
          <div className="p-6 border-b border-app-border flex items-center justify-between bg-app-surface/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-xl">
                <MessageSquare className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-app-text">شاركنا رأيك</h2>
                <p className="text-[10px] text-app-text-muted">نحن في المرحلة التجريبية ويهمنا رأيك</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-app-text-muted uppercase font-bold">الاسم (اختياري)</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-app-bg border border-app-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors text-app-text"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-app-text-muted uppercase font-bold">نوع الملاحظة</label>
                <select 
                  value={type}
                  onChange={e => setType(e.target.value)}
                  className="w-full bg-app-bg border border-app-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors text-app-text"
                >
                  <option value="تحسين">اقتراح تحسين</option>
                  <option value="خطأ">إبلاغ عن خطأ</option>
                  <option value="ميزة">طلب ميزة جديدة</option>
                  <option value="أخرى">أخرى</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-app-text-muted uppercase font-bold">الإيميل (اختياري)</label>
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-app-bg border border-app-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors text-left text-app-text"
                dir="ltr"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-app-text-muted uppercase font-bold">رسالتك</label>
              <textarea 
                required
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={4}
                className="w-full bg-app-bg border border-app-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none text-app-text"
                placeholder="اكتب ملاحظاتك هنا..."
              />
            </div>

            {status.type && (
              <div className={`text-xs text-center p-2 rounded-lg ${
                status.type === 'success' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
              }`}>
                {status.message}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button 
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-app-bg text-app-text-muted font-bold rounded-xl hover:bg-app-surface transition-colors"
              >
                إلغاء
              </button>
              <button 
                type="submit"
                disabled={isSending || !message}
                className="flex-[2] py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
              >
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                إرسال الملاحظة
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const MarginTrading = ({ 
  user, 
  marginAccount, 
  marginPositions, 
  tickerData, 
  onClosePosition 
}: { 
  user: FirebaseUser | null, 
  marginAccount: MarginAccount | null, 
  marginPositions: MarginPosition[], 
  tickerData: StockStats[],
  onClosePosition: (pos: MarginPosition) => void
}) => {
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
        <Wallet className="w-12 h-12 text-app-text-muted opacity-20" />
        <h3 className="text-xl font-bold text-app-text">يرجى تسجيل الدخول</h3>
        <p className="text-app-text-muted max-w-xs mx-auto">يجب تسجيل الدخول للوصول إلى ميزات التداول بالهامش.</p>
        <button 
          onClick={() => loginWithGoogle()}
          className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-500 transition-colors"
        >
          تسجيل الدخول
        </button>
      </div>
    );
  }

  if (!marginAccount) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  const marginHealth = marginAccount.marginUsed > 0 
    ? (marginAccount.equity / marginAccount.marginUsed) * 100 
    : 100;
  
  const isMarginCall = marginAccount.equity < marginAccount.maintenanceMargin;

  return (
    <div className="space-y-6 p-6" dir="rtl">
      {/* Account Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 bg-app-bg border border-app-border rounded-2xl">
          <div className="text-[10px] text-app-text-muted uppercase mb-1">الرصيد النقدي</div>
          <div className="text-xl font-bold text-app-text">{marginAccount.balance.toLocaleString()} ر.س</div>
        </div>
        <div className="p-4 bg-app-bg border border-app-border rounded-2xl">
          <div className="text-[10px] text-app-text-muted uppercase mb-1">إجمالي الملكية</div>
          <div className="text-xl font-bold text-emerald-500">{marginAccount.equity.toLocaleString()} ر.س</div>
        </div>
        <div className="p-4 bg-app-bg border border-app-border rounded-2xl">
          <div className="text-[10px] text-app-text-muted uppercase mb-1">الهامش المستخدم</div>
          <div className="text-xl font-bold text-rose-500">{marginAccount.marginUsed.toLocaleString()} ر.س</div>
        </div>
        <div className={`p-4 border rounded-2xl transition-colors ${isMarginCall ? 'bg-rose-500/10 border-rose-500/50' : 'bg-app-bg border-app-border'}`}>
          <div className="text-[10px] text-app-text-muted uppercase mb-1">صحة الهامش</div>
          <div className={`text-xl font-bold ${isMarginCall ? 'text-rose-500 animate-pulse' : 'text-emerald-500'}`}>
            {marginHealth.toFixed(1)}%
          </div>
        </div>
      </div>

      {isMarginCall && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-rose-500/20 border border-rose-500/50 rounded-2xl flex items-center gap-4"
        >
          <AlertCircle className="w-6 h-6 text-rose-500" />
          <div className="flex-1">
            <div className="text-sm font-bold text-rose-500">تنبيه نداء الهامش (Margin Call)!</div>
            <div className="text-xs text-rose-500/80">لقد انخفضت ملكيتك عن الحد الأدنى المطلوب. يرجى إيداع أموال أو إغلاق بعض المراكز فوراً.</div>
          </div>
        </motion.div>
      )}

      {/* Open Positions */}
      <div className="bg-app-surface border border-app-border rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between">
          <h3 className="font-bold text-app-text flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500" />
            المراكز المفتوحة ({marginPositions.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-app-bg/50 text-[10px] text-app-text-muted uppercase">
              <tr>
                <th className="px-6 py-3">الشركة</th>
                <th className="px-6 py-3">الكمية</th>
                <th className="px-6 py-3">سعر الدخول</th>
                <th className="px-6 py-3">السعر الحالي</th>
                <th className="px-6 py-3">الربح/الخسارة</th>
                <th className="px-6 py-3">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {marginPositions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-app-text-muted text-sm">لا توجد مراكز مفتوحة حالياً.</td>
                </tr>
              ) : (
                marginPositions.map(pos => {
                  const stock = tickerData.find(s => s.symbol === pos.symbol);
                  const currentPrice = stock?.price || pos.entryPrice;
                  const pnl = (currentPrice - pos.entryPrice) * pos.quantity;
                  const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

                  return (
                    <tr key={pos.id} className="hover:bg-app-bg/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-app-text">{SAUDI_STOCKS[pos.symbol.split('.')[0]] || pos.symbol}</div>
                        <div className="text-[10px] text-app-text-muted font-mono">{pos.symbol}</div>
                      </td>
                      <td className="px-6 py-4 font-mono text-app-text">{pos.quantity}</td>
                      <td className="px-6 py-4 font-mono text-app-text">{pos.entryPrice.toFixed(2)}</td>
                      <td className="px-6 py-4 font-mono text-app-text">{currentPrice.toFixed(2)}</td>
                      <td className={`px-6 py-4 font-mono font-bold ${pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnlPercent.toFixed(2)}%)
                      </td>
                      <td className="px-6 py-4">
                        <button 
                          onClick={() => onClosePosition(pos)}
                          className="px-3 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[10px] font-bold rounded-lg border border-rose-500/20 transition-all"
                        >
                          إغلاق المركز
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const AlertToast = ({
  alert,
  onDismiss,
}: {
  alert: CustomAlert;
  onDismiss: (id: string) => void;
}) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(alert.id), 8000);
    return () => clearTimeout(timer);
  }, [alert.id, onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className={`pointer-events-auto px-4 py-3 rounded-2xl border text-sm font-semibold shadow-xl flex items-start gap-2.5 ${
        alert.condition === 'above'
          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
          : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
      }`}
      style={{ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
    >
      <Bell className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="font-bold truncate">{alert.companyName}</div>
        <div className="text-xs opacity-80">
          {alert.condition === 'above' ? '↑ فوق' : '↓ تحت'} {alert.targetPrice.toFixed(2)} ر.س
          {alert.triggeredPrice && ` · الحالي: ${alert.triggeredPrice.toFixed(2)}`}
        </div>
      </div>
      <button
        onClick={() => onDismiss(alert.id)}
        className="opacity-50 hover:opacity-100 transition-opacity shrink-0 mr-auto"
      >
        ✕
      </button>
    </motion.div>
  );
};

const AlertsModal = ({ onClose }: { onClose: () => void }) => {
  const [allAlerts, setAllAlerts] = useState<CustomAlert[]>(() =>
    JSON.parse(localStorage.getItem('saudi_stock_alerts') || '[]'),
  );

  const active    = allAlerts.filter(a => !a.triggered);
  const triggered = allAlerts.filter(a => a.triggered);

  const deleteAlert = (id: string) => {
    const updated = allAlerts.filter(a => a.id !== id);
    localStorage.setItem('saudi_stock_alerts', JSON.stringify(updated));
    setAllAlerts(updated);
  };

  const clearTriggered = () => {
    const updated = allAlerts.filter(a => !a.triggered);
    localStorage.setItem('saudi_stock_alerts', JSON.stringify(updated));
    setAllAlerts(updated);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 16 }}
          className="w-full max-w-md bg-app-surface border border-app-border rounded-3xl overflow-hidden modal-shadow modal-mobile max-h-[85vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-app-border flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-purple-500/10">
                <Bell className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <h2 className="font-bold text-app-text">تنبيهاتي السعرية</h2>
                <p className="text-[11px] text-app-text-muted">{active.length} نشط · {triggered.length} مُشغَّل</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-app-text-muted hover:text-app-text hover:bg-app-bg transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
            {/* Active */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-muted mb-2">نشطة</p>
              {active.length === 0 ? (
                <div className="text-center py-6 text-xs text-app-text-muted italic border border-dashed border-app-border rounded-xl">
                  لا توجد تنبيهات نشطة — افتح أي سهم واضغط على تبويب التنبيهات
                </div>
              ) : active.map(a => (
                <div
                  key={a.id}
                  className={`flex items-center justify-between px-4 py-3 mb-2 rounded-xl border ${
                    a.condition === 'above'
                      ? 'bg-emerald-500/8 border-emerald-500/25'
                      : 'bg-rose-500/8 border-rose-500/25'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {a.condition === 'above'
                      ? <ArrowUpRight className="w-4 h-4 text-emerald-400 shrink-0" />
                      : <ArrowDownRight className="w-4 h-4 text-rose-400 shrink-0" />}
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{a.companyName}</div>
                      <div className="text-[11px] text-app-text-muted">
                        {a.condition === 'above' ? 'فوق' : 'تحت'}{' '}
                        <span className="font-mono font-bold">{a.targetPrice.toFixed(2)}</span> ر.س
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteAlert(a.id)}
                    className="text-app-text-muted hover:text-rose-400 transition-colors p-1.5 rounded-lg hover:bg-rose-500/10 shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Triggered */}
            {triggered.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-muted">مُشغَّلة</p>
                  <button
                    onClick={clearTriggered}
                    className="text-[10px] text-rose-400 hover:text-rose-300 transition-colors"
                  >
                    مسح الكل
                  </button>
                </div>
                {triggered.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between px-4 py-3 mb-2 rounded-xl border border-app-border bg-app-bg/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-app-text-muted truncate">{a.companyName}</div>
                        <div className="text-[11px] text-app-text-muted">
                          {a.condition === 'above' ? 'فوق' : 'تحت'} {a.targetPrice.toFixed(2)} ر.س
                          {a.triggeredPrice && (
                            <span className="text-emerald-500 mr-1">· وصل {a.triggeredPrice.toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteAlert(a.id)}
                      className="text-app-text-muted hover:text-rose-400 transition-colors p-1.5 rounded-lg hover:bg-rose-500/10 shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [tasiData, setTasiData] = useState<TASIData | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });
  const [selectedStock, setSelectedStock] = useState<StockStats | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [triggeredAlerts, setTriggeredAlerts] = useState<CustomAlert[]>([]);
  const [tasiLastUpdated, setTasiLastUpdated] = useState<Date | null>(null);
  const isScanningRef = useRef(false);
  // Tracks symbols already sent to Telegram in current session — prevents duplicate alerts
  const sentRadarAlertsRef = useRef(new Set<string>());
  // Rolling TASI price history for sparkline (last 20 data points)
  const tasiHistoryRef = useRef<number[]>([]);
  const [currentPage, setCurrentPage] = useState<'home' | 'ai-advisor'>('home');
  const [themeSpin, setThemeSpin] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : true; // Default to dark
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleTheme = () => {
    setIsDarkMode(v => !v);
    setThemeSpin(true);
    setTimeout(() => setThemeSpin(false), 400);
  };
  const [activeTab, setActiveTab] = useState<'active' | 'watchlist' | 'all' | 'margin'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [marginAccount, setMarginAccount] = useState<MarginAccount | null>(null);
  const [marginPositions, setMarginPositions] = useState<MarginPosition[]>([]);

  // Handle redirect sign-in result (fires once on page load after redirect)
  useEffect(() => {
    handleRedirectResult().catch(() => { /* no redirect in progress — ignore */ });
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthReady(true);
      
      if (firebaseUser) {
        // Check/Create User Profile
        const userRef = doc(db, 'users', firebaseUser.uid);
        try {
          const userDoc = await getDoc(userRef);
          if (!userDoc.exists()) {
            await setDoc(userRef, {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName,
              email: firebaseUser.email,
              photoURL: firebaseUser.photoURL,
              role: 'user',
              createdAt: serverTimestamp()
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Watchlist Sync
  useEffect(() => {
    if (!user) {
      // Load from local storage if not logged in
      const saved = localStorage.getItem('saudi_stock_watchlist');
      setWatchlist(saved ? JSON.parse(saved) : []);
      return;
    }

    // Sync from Firestore if logged in
    const q = query(collection(db, 'watchlists'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const symbols = snapshot.docs.map(doc => doc.data().symbol);
      setWatchlist(symbols);
      localStorage.setItem('saudi_stock_watchlist', JSON.stringify(symbols));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'watchlists');
    });

    return () => unsubscribe();
  }, [user]);

  // Margin Account Sync
  useEffect(() => {
    if (!user) {
      setMarginAccount(null);
      return;
    }

    const docRef = doc(db, 'margin_accounts', user.uid);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setMarginAccount(docSnap.data() as MarginAccount);
      } else {
        // Initialize account if not exists
        setDoc(docRef, {
          userId: user.uid,
          balance: 100000, // Starting with 100k virtual cash
          equity: 100000,
          marginUsed: 0,
          maintenanceMargin: 0,
          updatedAt: serverTimestamp()
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `margin_accounts/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user]);

  // Margin Positions Sync
  useEffect(() => {
    if (!user) {
      setMarginPositions([]);
      return;
    }

    const q = query(collection(db, 'margin_positions'), where('userId', '==', user.uid), where('status', '==', 'open'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const positions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MarginPosition));
      setMarginPositions(positions);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'margin_positions');
    });

    return () => unsubscribe();
  }, [user]);

  // Update Margin Equity when status or positions change
  useEffect(() => {
    if (!user || !marginAccount || !status) return;

    let totalPositionValue = 0;
    marginPositions.forEach(pos => {
      const stock = status.tickerData.find(s => s.symbol === pos.symbol);
      const currentPrice = stock?.price || pos.entryPrice;
      totalPositionValue += currentPrice * pos.quantity;
    });

    const newEquity = marginAccount.balance + totalPositionValue - marginAccount.marginUsed;
    const maintenanceMargin = totalPositionValue * 0.25; // 25% maintenance

    // Only update if significant change to avoid loops
    if (Math.abs(newEquity - marginAccount.equity) > 0.1 || Math.abs(maintenanceMargin - marginAccount.maintenanceMargin) > 0.1) {
      const docRef = doc(db, 'margin_accounts', user.uid);
      updateDoc(docRef, {
        equity: newEquity,
        maintenanceMargin: maintenanceMargin,
        updatedAt: serverTimestamp()
      });
    }
  }, [status, marginPositions, user]);

  const toggleWatchlist = async (symbol: string) => {
    if (!user) {
      // Local only if not logged in
      setWatchlist(prev => {
        const next = prev.includes(symbol) 
          ? prev.filter(s => s !== symbol) 
          : [...prev, symbol];
        localStorage.setItem('saudi_stock_watchlist', JSON.stringify(next));
        return next;
      });
      return;
    }

    // Firestore sync if logged in
    try {
      if (watchlist.includes(symbol)) {
        // Remove
        const q = query(collection(db, 'watchlists'), where('userId', '==', user.uid), where('symbol', '==', symbol));
        const snapshot = await getDocs(q);
        for (const doc of snapshot.docs) {
          await deleteDoc(doc.ref);
        }
      } else {
        // Add
        await addDoc(collection(db, 'watchlists'), {
          userId: user.uid,
          symbol,
          addedAt: serverTimestamp()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'watchlists');
    }
  };

  const checkUserAlerts = (stocks: StockStats[]) => {
    const key = 'saudi_stock_alerts';
    const alerts: CustomAlert[] = JSON.parse(localStorage.getItem(key) || '[]');
    const newlyTriggered: CustomAlert[] = [];
    let hasChanges = false;

    // Build a Map once for O(1) lookup instead of O(n) find per alert
    const stockMap = new Map<string, StockStats>(stocks.map(s => [s.symbol, s]));

    const updated = alerts.map(alert => {
      if (alert.triggered) return alert;
      const stock = stockMap.get(alert.symbol);
      if (!stock) return alert;
      const hit =
        (alert.condition === 'above' && stock.price >= alert.targetPrice) ||
        (alert.condition === 'below' && stock.price <= alert.targetPrice);
      if (!hit) return alert;

      hasChanges = true;
      const now = new Date();
      const triggered: CustomAlert = {
        ...alert,
        triggered: true,
        triggeredAt: now.toISOString(),
        triggeredPrice: stock.price,
      };
      newlyTriggered.push(triggered);

      const direction = alert.condition === 'above' ? 'فوق' : 'تحت';
      const timeStr = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
      const msg =
        `🔔 تنبيه سعري | ترندسا\n\n` +
        `📌 ${alert.companyName} (${alert.symbol.replace('.SR', '')})\n` +
        `💰 السعر: ${stock.price.toFixed(2)} ر.س\n` +
        `🎯 الهدف: ${direction} ${alert.targetPrice.toFixed(2)} ر.س\n` +
        `🕐 ${timeStr}`;
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      }).catch(() => { /* non-critical */ });

      return triggered;
    });

    if (hasChanges) {
      localStorage.setItem(key, JSON.stringify(updated));
      setTriggeredAlerts(prev => [...prev, ...newlyTriggered]);
    }
  };

  const buildAndSetStatus = (allStocks: StockStats[], marketIndex: any) => {
    const topGainers     = [...allStocks].sort((a, b) => b.change - a.change).slice(0, 10);
    const topLosers      = [...allStocks].sort((a, b) => a.change - b.change).slice(0, 10);
    const liquidityEntry = allStocks.filter(s => s.volumeRatio > 1.5 && s.change > 0).sort((a, b) => b.volumeRatio - a.volumeRatio).slice(0, 10);
    const liquidityExit  = allStocks.filter(s => s.volumeRatio > 1.5 && s.change < 0).sort((a, b) => b.volumeRatio - a.volumeRatio).slice(0, 10);

    // Wave stocks: volume+momentum candidates; real Elliott wave populated after chart enrichment
    const waveStocks = allStocks
      .filter(s => s.change > 0 && s.volumeRatio >= 1.8 &&
        (s.wave !== undefined && s.wave !== 'غير محدد' ? true : s.rsi >= 50))
      .sort((a, b) => b.volumeRatio - a.volumeRatio)
      .slice(0, 15);

    // Alerts: significant price moves (≥3%) or volume spikes (≥2.5×)
    const alerts: Alert[] = allStocks
      .filter(s => Math.abs(s.change) >= 3 || s.volumeRatio >= 2.5)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 30)
      .map(s => ({
        type:        s.change >= 0 ? 'entry' as const : 'exit' as const,
        symbol:      s.symbol,
        companyName: s.companyName,
        price:       s.price,
        time:        new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
        wave:        s.wave,
      }));

    // Active trades = open margin positions enriched with latest price
    const activeTrades: Trade[] = marginPositions.map(pos => ({
      symbol:      pos.symbol,
      companyName: SAUDI_STOCKS[pos.symbol.split('.')[0]] || pos.symbol,
      entryPrice:  pos.entryPrice,
      entryTime:   pos.openedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
      rsi:         allStocks.find(s => s.symbol === pos.symbol)?.rsi ?? 50,
      sma50:       allStocks.find(s => s.symbol === pos.symbol)?.price ?? pos.entryPrice,
    }));

    setStatus({
      lastScan:          new Date().toISOString(),
      isScanning:        false,
      processedCount:    allStocks.length,
      totalCount:        getAllSymbols().length,
      activeTradesCount: marginPositions.length,
      activeTrades,
      alerts,
      topGainers,
      topLosers,
      liquidityEntry,
      liquidityExit,
      waveStocks,
      tickerData:        allStocks,
      customAlerts:      [],
      marketIndex,
      telegramConnected: false,
      telegramBotName:   null,
      botStatusError:    null,
    });
  };

  const runMarketScan = async () => {
    if (isScanningRef.current) return;
    isScanningRef.current = true;
    // Reset dedup set each new scan cycle so new signals are always reported
    sentRadarAlertsRef.current.clear();

    // Show cached data instantly, then refresh in background
    const cached = loadCache();
    if (cached) {
      buildAndSetStatus(cached.stocks, cached.marketIndex);
      if (cached.marketIndex) setTasiData(cached.marketIndex);
      setFetchError(null);
    }

    setIsLoadingData(true);
    try {
      const symbols = getAllSymbols();
      const CHUNK = 20;

      // Build all batches and fire them in parallel
      const chunks: string[][] = [];
      for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));

      // Fire stocks + TASI in parallel (TASI uses dedicated endpoint)
      const [stockResults, tasiResult] = await Promise.all([
        Promise.allSettled(chunks.map(c => fetchQuotesBatch(c))),
        fetchTASI().catch(() => null),
      ]);

      const allStocks: StockStats[] = [];
      for (const r of stockResults) {
        if (r.status === 'fulfilled') {
          for (const q of r.value) if (q.regularMarketPrice) allStocks.push(buildStockFromQuote(q));
        }
      }
      if (allStocks.length === 0) {
        const firstFail = stockResults.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
        const reason = firstFail?.reason?.message ?? 'جميع الـ proxies فشلت';
        throw new Error(reason);
      }

      let marketIndex: TASIData | null = tasiResult;

      if (marketIndex) {
        setTasiData(marketIndex);
        setTasiLastUpdated(new Date());
      } else if (allStocks.length > 0) {
        // ── Fallback: estimate TASI from stock average + last known base value ──
        const base = loadLastKnownTasi();
        if (base && base.price > 0) {
          const avgChangePct = allStocks.reduce((s, st) => s + st.change, 0) / allStocks.length;
          const estimatedPrice = base.price * (1 + avgChangePct / 100);
          marketIndex = {
            price:         estimatedPrice,
            change:        estimatedPrice - base.price,
            changePercent: avgChangePct,
            high:          estimatedPrice,
            low:           estimatedPrice,
            volume:        0,
            time:          new Date().toISOString(),
          };
          setTasiData(marketIndex);
          setTasiLastUpdated(new Date());
        }
      }

      saveCache(allStocks, marketIndex);
      buildAndSetStatus(allStocks, marketIndex);
      checkUserAlerts(allStocks);
      setFetchError(null);

      // Background: enrich top stocks with real indicators from chart data.
      // Capture the last enriched snapshot, then fire radar Telegram alerts.
      let lastEnrichedSnapshot: StockStats[] = allStocks as StockStats[];
      enrichStocksWithChartData(allStocks, (enriched) => {
        lastEnrichedSnapshot = enriched as StockStats[];
        buildAndSetStatus(enriched as StockStats[], marketIndex);
      }).then(() => {
        // All enrichment batches done — now we have real RSI/MACD/Wave data
        sendRadarTelegramAlerts(lastEnrichedSnapshot);
      }).catch(() => { /* non-critical: enrichment failed, quote-level data still shown */ });
    } catch (e: any) {
      setFetchError(e.message || 'خطأ في جلب البيانات');
    } finally {
      setIsLoadingData(false);
      isScanningRef.current = false;
    }
  };

  const testTelegram = async () => {
    setIsTestingTelegram(true);
    setTelegramStatus({ type: null, message: '' });
    try {
      const res = await fetch('/api/test-telegram', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setTelegramStatus({ type: 'success', message: `✅ تم الإرسال بنجاح عبر @${data.botName || 'RadarsaudiiBot'}` });
      } else {
        setTelegramStatus({ type: 'error', message: `❌ ${data.error || 'فشل الإرسال'}` });
      }
    } catch (e: any) {
      setTelegramStatus({ type: 'error', message: `❌ ${e.message}` });
    } finally {
      setIsTestingTelegram(false);
      setTimeout(() => setTelegramStatus({ type: null, message: '' }), 6000);
    }
  };

  // Send Telegram for enriched stocks that score ≥ 4 (strong signal confluence)
  // Only sends stocks not already sent this session (sentRadarAlertsRef dedup)
  const sendRadarTelegramAlerts = async (enrichedStocks: StockStats[]) => {
    const newSignals = enrichedStocks
      .map(s => ({ s, sc: scoreStock(s) }))
      .filter(({ s, sc }) => sc.total >= 4 && s.change > 0 && !sentRadarAlertsRef.current.has(s.symbol))
      .sort((a, b) => b.sc.total - a.sc.total || b.s.volumeRatio - a.s.volumeRatio)
      .slice(0, 5);

    if (!newSignals.length) return;

    // Mark as sent before the async call to prevent races
    newSignals.forEach(({ s }) => sentRadarAlertsRef.current.add(s.symbol));

    const timeStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    const lines = newSignals.map(({ s, sc }) => {
      const reasons = sc.reasons.slice(0, 3).join(' | ');
      return (
        `🟢 *${s.companyName}*  \`${s.symbol.replace('.SR', '')}\`\n` +
        `   💰 ${s.price.toFixed(2)} ر.س  |  ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%  |  حجم ×${s.volumeRatio.toFixed(1)}\n` +
        `   📡 ${reasons}\n` +
        `   ⭐ قوة الإشارة: ${sc.total}/6 — ${sc.label}`
      );
    });

    const msg =
      `🎯 *رادار الإشارات | ترندسا*\n` +
      `🕐 ${timeStr}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      lines.join('\n\n') +
      `\n\n━━━━━━━━━━━━━━━━━━\n` +
      `📊 تقاطع ${newSignals[0]?.sc?.total ?? 4}+ مؤشرات فنية`;

    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
    } catch { /* non-critical */ }
  };

  const startScan = () => {
    runMarketScan();
  };

  useEffect(() => {
    runMarketScan();
    const interval = setInterval(runMarketScan, 15 * 60 * 1000); // refresh every 15 min
    return () => clearInterval(interval);
  }, []);

  // Dedicated TASI refresh every 5 minutes (more frequent than full scan)
  const refreshTasi = async () => {
    try {
      const data = await fetchTASI();
      setTasiData(data);
      setTasiLastUpdated(new Date());
    } catch {
      // fetchTASI already tried both endpoints; try one more: use cached base + current stocks
      if (status?.tickerData && status.tickerData.length > 0) {
        const base = loadLastKnownTasi();
        if (base && base.price > 0) {
          const avg = status.tickerData.reduce((s, st) => s + st.change, 0) / status.tickerData.length;
          const ep = base.price * (1 + avg / 100);
          setTasiData({ price: ep, change: ep - base.price, changePercent: avg, high: ep, low: ep, volume: 0, time: new Date().toISOString() });
          setTasiLastUpdated(new Date());
        }
      }
    }
  };

  useEffect(() => {
    refreshTasi();
    const interval = setInterval(refreshTasi, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Accumulate TASI prices for sparkline (max 20 points)
  useEffect(() => {
    if (tasiData && tasiData.price > 0) {
      tasiHistoryRef.current = [...tasiHistoryRef.current, tasiData.price].slice(-20);
    }
  }, [tasiData]);

  const TradeRow = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const trade = status?.activeTrades[index];
    if (!trade) return null;
    const fullStock = status?.tickerData.find(s => s.symbol === trade.symbol);
    
    return (
      <div 
        style={style} 
        className="flex items-center border-b border-app-border hover:bg-app-bg transition-colors px-6 cursor-pointer"
        onClick={() => fullStock && setSelectedStock(fullStock)}
      >
        <div className="flex-[1.5]">
          <div className="font-bold text-emerald-500">{trade.companyName}</div>
          <div className="text-[10px] text-app-text-muted font-mono">{trade.symbol}</div>
        </div>
        <div className="flex-1 font-mono">{trade.entryPrice.toFixed(2)}</div>
        <div className="flex-1 font-mono">{trade.rsi.toFixed(1)}</div>
        <div className="flex-[1.5] text-xs font-medium">
          {trade.wave && trade.wave !== "غير محدد" ? (
            <span className="bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20">
              {trade.wave}
            </span>
          ) : (
            <span className="text-app-text-muted italic opacity-50">---</span>
          )}
        </div>
        <div className="flex-1 text-sm text-app-text-muted text-left">
          {new Date(trade.entryTime).toLocaleTimeString('ar-SA')}
        </div>
      </div>
    );
  };

  const AlertRow = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const alert = status?.alerts[index];
    if (!alert) return null;
    return (
      <div style={{ ...style, paddingLeft: 8, paddingRight: 8 }} className="py-1.5">
        <div className={`p-4 rounded-xl border h-full ${
          alert.type === 'entry' 
            ? 'bg-emerald-500/5 border-emerald-500/20' 
            : 'bg-rose-500/5 border-rose-500/20'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                alert.type === 'entry' ? 'bg-emerald-500/20' : 'bg-rose-500/20'
              }`}>
                {alert.type === 'entry' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-500" />
                )}
              </div>
              <div>
                <div className="font-bold text-sm">{alert.companyName} ({alert.symbol})</div>
                <div className="text-xs text-app-text-muted">
                  {alert.type === 'entry' ? (
                    <span className="flex items-center gap-2">
                      إشارة دخول • {alert.price.toFixed(2)}
                      {alert.wave && <span className="text-amber-500 font-bold">• {alert.wave}</span>}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      إشارة خروج • {alert.price.toFixed(2)}
                      {alert.profit !== undefined && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          alert.profit >= 0 
                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                            : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                        }`}>
                          الربح: {alert.profit.toFixed(2)}%
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="text-[10px] text-app-text-muted font-mono">
              {new Date(alert.time).toLocaleTimeString('ar-SA')}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const closeMarginPosition = async (position: MarginPosition) => {
    if (!user || !marginAccount) return;

    try {
      const stock = status?.tickerData.find(s => s.symbol === position.symbol);
      const currentPrice = stock?.price || position.entryPrice;
      const proceeds = currentPrice * position.quantity;
      
      const borrowedAmount = Math.max((position.entryPrice * position.quantity) - position.marginRequired, 0);
      const realizedPnl = (currentPrice - position.entryPrice) * position.quantity;
      const balanceRelease = proceeds - borrowedAmount;

      await updateDoc(doc(db, 'margin_accounts', user.uid), {
        balance: marginAccount.balance + balanceRelease,
        marginUsed: Math.max(marginAccount.marginUsed - borrowedAmount, 0),
        updatedAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'margin_positions', position.id), {
        currentPrice,
        status: 'closed',
        closedAt: serverTimestamp()
      });

    } catch (error) {
      console.error("Error closing margin position:", error);
    }
  };

  const openMarginPosition = async (symbol: string, quantity: number, price: number) => {
    if (!user || !marginAccount) return;

    const leverage = 2;
    const cost = quantity * price;
    const marginRequirement = cost / leverage;
    const borrowedAmount = cost - marginRequirement;

    if (marginAccount.balance < marginRequirement) {
      alert("رصيد غير كافٍ لفتح هذا المركز بالهامش.");
      return;
    }

    try {
      await addDoc(collection(db, 'margin_positions'), {
        userId: user.uid,
        symbol,
        quantity,
        entryPrice: price,
        currentPrice: price,
        leverage,
        marginRequired: marginRequirement,
        status: 'open',
        openedAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'margin_accounts', user.uid), {
        balance: marginAccount.balance - marginRequirement,
        marginUsed: marginAccount.marginUsed + borrowedAmount,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error opening margin position:", error);
    }
  };

  return (
    <div className="min-h-screen bg-app-bg text-app-text font-sans selection:bg-emerald-500/30 transition-colors duration-300" dir="rtl">
      {/* Price alert toasts */}
      <div className="fixed bottom-24 left-4 z-[150] flex flex-col-reverse gap-2 pointer-events-none" style={{ maxWidth: 300 }}>
        <AnimatePresence>
          {triggeredAlerts.map(a => (
            <AlertToast
              key={a.id}
              alert={a}
              onDismiss={(id) => setTriggeredAlerts(prev => prev.filter(t => t.id !== id))}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Telegram status toast */}
      <AnimatePresence>
        {telegramStatus.type && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-[300] px-5 py-3 rounded-2xl text-sm font-bold shadow-xl border ${
              telegramStatus.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}
          >
            {telegramStatus.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top loading bar */}
      {isLoadingData && (
        <div className="fixed top-0 left-0 right-0 z-[200] h-0.5 bg-emerald-500/20 overflow-hidden">
          <motion.div
            className="h-full bg-emerald-500"
            initial={{ x: '-100%' }}
            animate={{ x: '400%' }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      )}
      <TickerTape data={status?.tickerData || []} marketIndex={status?.marketIndex} />
      
      {/* Feedback Floating Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setShowFeedback(true)}
        className="fixed bottom-6 left-6 z-[60] bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-2xl shadow-2xl shadow-blue-900/40 flex items-center gap-2 group"
      >
        <MessageSquare className="w-6 h-6" />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-500 ease-in-out whitespace-nowrap font-bold text-sm">
          أرسل ملاحظاتك
        </span>
      </motion.button>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className="header-premium sticky top-0 z-[80] safe-top overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0a0e1a 0%, #0d1528 50%, #0a1628 100%)',
          borderBottom: '1px solid rgba(99,179,237,0.15)',
          boxShadow: '0 1px 30px rgba(0,0,0,0.5)',
          height: 68,
        }}
      >
        <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between gap-3 relative z-10">

          {/* ── Logo (right in RTL) ── */}
          <div className="flex items-center gap-3 shrink-0">
            <div
              className="logo-pulse flex items-center justify-center shrink-0"
              style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(0,212,170,0.15)', border: '1px solid rgba(0,212,170,0.3)' }}
            >
              <BarChart3 className="w-5 h-5" style={{ color: '#00d4aa' }} />
            </div>
            <div>
              <div className="font-extrabold text-white leading-tight" style={{ fontSize: 18, letterSpacing: '-0.02em', fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
                trandsa <span style={{ color: 'rgba(255,255,255,0.85)' }}>ترندسا</span>
              </div>
              <div style={{ fontSize: 11, color: '#4a9eff', letterSpacing: '0.04em', fontWeight: 500 }}>
                منصة التداول الذكية
              </div>
            </div>
          </div>

          {/* ── Spacer ── */}
          <div className="flex-1" />

          {/* ── Status badges (desktop) ── */}
          <div className="hidden md:flex items-center gap-2.5">
            {/* Delay badge with pulsing dot */}
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold"
              style={{ background: 'rgba(244,162,97,0.15)', border: '1px solid rgba(244,162,97,0.3)', color: '#f4a261' }}
            >
              <span className="pulse-dot w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#f4a261', display: 'inline-block' }} />
              بيانات مؤخرة ~15 دقيقة
            </div>

            {/* Refresh button */}
            <button
              onClick={startScan}
              disabled={isLoadingData}
              title="تحديث البيانات"
              className="btn-icon disabled:opacity-40"
            >
              <RefreshCw className="w-4 h-4" style={{ color: isLoadingData ? '#00d4aa' : 'rgba(255,255,255,0.6)', animation: isLoadingData ? 'spin 1s linear infinite' : undefined }} />
            </button>

            {/* Theme toggle */}
            <button onClick={toggleTheme} title={isDarkMode ? 'الوضع الفاتح' : 'الوضع الداكن'} className="btn-icon">
              {isDarkMode
                ? <Sun className={`w-4 h-4 ${themeSpin ? 'theme-spin' : ''}`} style={{ color: 'rgba(255,255,255,0.6)' }} />
                : <Moon className={`w-4 h-4 ${themeSpin ? 'theme-spin' : ''}`} style={{ color: 'rgba(255,255,255,0.6)' }} />}
            </button>
          </div>

          {/* ── Action buttons (left in RTL) ── */}
          <div className="flex items-center gap-2 mr-2">
            {/* Bell with red dot */}
            {(() => {
              const activeCount = (JSON.parse(localStorage.getItem('saudi_stock_alerts') || '[]') as CustomAlert[]).filter(a => !a.triggered).length;
              return (
                <button
                  onClick={() => setShowAlertsModal(true)}
                  title="تنبيهاتي"
                  className="btn-icon relative"
                >
                  <Bell className="w-4 h-4" style={{ color: activeCount > 0 ? '#f87171' : 'rgba(255,255,255,0.6)' }} />
                  {activeCount > 0 && (
                    <span
                      className="absolute flex items-center justify-center text-white font-bold"
                      style={{ background: '#ef4444', borderRadius: 999, minWidth: 15, height: 15, fontSize: 8, padding: '0 3px', top: -4, right: -4, border: '1.5px solid #0d1528' }}
                    >
                      {activeCount > 9 ? '9+' : activeCount}
                    </span>
                  )}
                </button>
              );
            })()}

            {/* Telegram button */}
            <a
              href="https://t.me/RadarsaudiiBot"
              target="_blank"
              rel="noreferrer"
              className="btn-telegram flex items-center gap-2 font-bold whitespace-nowrap text-white"
              style={{ height: 36, padding: '0 16px', borderRadius: 10, fontSize: 13 }}
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">قناة التليجرام</span>
            </a>

            {/* Login / Avatar */}
            {user ? (
              <button
                onClick={() => logout()}
                className="flex items-center justify-center rounded-full overflow-hidden transition-opacity hover:opacity-75 shrink-0"
                style={{ width: 36, height: 36, border: '2px solid rgba(0,212,170,0.5)', boxShadow: '0 0 8px rgba(0,212,170,0.2)' }}
                title="تسجيل الخروج"
              >
                <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </button>
            ) : (
              <button
                onClick={() => loginWithGoogle()}
                className="flex items-center gap-2 font-bold"
                style={{ height: 36, padding: '0 14px', borderRadius: 10, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)', fontSize: 13, transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)' }}
              >
                <User className="w-4 h-4" />
                <span className="hidden sm:inline">دخول</span>
              </button>
            )}

            {/* Mobile: refresh + theme */}
            <div className="flex md:hidden items-center gap-1.5">
              <button onClick={startScan} disabled={isLoadingData} className="btn-icon disabled:opacity-40">
                <RefreshCw className="w-4 h-4" style={{ color: isLoadingData ? '#00d4aa' : 'rgba(255,255,255,0.6)', animation: isLoadingData ? 'spin 1s linear infinite' : undefined }} />
              </button>
              <button onClick={toggleTheme} className="btn-icon">
                {isDarkMode
                  ? <Sun className={`w-4 h-4 ${themeSpin ? 'theme-spin' : ''}`} style={{ color: 'rgba(255,255,255,0.6)' }} />
                  : <Moon className={`w-4 h-4 ${themeSpin ? 'theme-spin' : ''}`} style={{ color: 'rgba(255,255,255,0.6)' }} />}
              </button>
            </div>
          </div>

        </div>
      </header>

      {/* ── Page Navigation Bar ─────────────────────────────────────────── */}
      <nav
        className="sticky top-[68px] z-[70]"
        style={{ background: 'rgba(6,11,20,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(99,179,237,0.1)' }}
      >
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-1" style={{ height: 44 }}>
            <button
              onClick={() => setCurrentPage('home')}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-all relative"
              style={{ color: currentPage === 'home' ? '#00d4aa' : 'rgba(255,255,255,0.45)' }}
            >
              <BarChart3 className="w-4 h-4" />
              <span>لوحة التداول</span>
              {currentPage === 'home' && (
                <motion.div layoutId="pageTab" className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: '#00d4aa' }} />
              )}
            </button>
            <button
              onClick={() => setCurrentPage('ai-advisor')}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-all relative"
              style={{ color: currentPage === 'ai-advisor' ? '#00d4aa' : 'rgba(255,255,255,0.45)' }}
            >
              <Brain className="w-4 h-4" />
              <span>المستشار الذكي</span>
              {currentPage === 'ai-advisor' && (
                <motion.div layoutId="pageTab" className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: '#00d4aa' }} />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* ── AI Advisor Page ──────────────────────────────────────────────── */}
      {currentPage === 'ai-advisor' && <AIAdvisor />}

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8" style={{ display: currentPage === 'home' ? undefined : 'none' }}>
        {/* Inline error banner */}
        {fetchError && (
          <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-sm text-rose-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{fetchError}</span>
            <button onClick={runMarketScan} className="text-xs underline underline-offset-2 whitespace-nowrap">إعادة المحاولة</button>
          </div>
        )}
        {/* ── TASI Index Card ────────────────────────────────────────────── */}
        {(() => {
          const tickers   = status?.tickerData ?? [];
          const gainers   = tickers.filter(s => s.change > 0).length;
          const losers    = tickers.filter(s => s.change < 0).length;
          const unchanged = tickers.length - gainers - losers;
          const price     = tasiData?.price ?? 0;
          const chg       = tasiData?.change ?? 0;
          const chgPct    = tasiData?.changePercent ?? 0;
          const isUp      = chgPct >= 0;
          const hasMkt    = tickers.length > 0;
          const displayPrice  = price > 0 ? price : 0;
          const hasPrice      = displayPrice > 0;

          // Saudi market hours: Sun–Thu 10:00–15:00 AST (UTC+3)
          const nowSaudi  = new Date(Date.now() + 3 * 3600_000);
          const saudiDay  = nowSaudi.getUTCDay();   // 0=Sun … 6=Sat
          const saudiHour = nowSaudi.getUTCHours();
          const saudiMin  = nowSaudi.getUTCMinutes();
          const isWeekday = saudiDay >= 0 && saudiDay <= 4; // Sun=0, Thu=4
          const isInHours = (saudiHour > 10 || (saudiHour === 10 && saudiMin >= 0)) && saudiHour < 15;
          const isMarketOpen = isWeekday && isInHours;
          const updatedStr = tasiLastUpdated
            ? tasiLastUpdated.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
            : null;

          // ── Sparkline SVG ──
          const sparkPrices = tasiHistoryRef.current;
          const SparkLine = () => {
            if (sparkPrices.length < 2) return null;
            const W = 100, H = 44;
            const mn = Math.min(...sparkPrices), mx = Math.max(...sparkPrices);
            const range = mx - mn || 1;
            const pts = sparkPrices.map((v, i) => {
              const x = (i / (sparkPrices.length - 1)) * W;
              const y = H - ((v - mn) / range) * H;
              return `${x},${y}`;
            });
            const polyline = pts.join(' ');
            const areaPath = `M${pts[0]} L${pts.join(' L')} L${W},${H} L0,${H} Z`;
            const lineColor = isUp ? '#00c896' : '#ff3d5a';
            return (
              <svg viewBox={`0 0 ${W} ${H}`} width={100} height={44} className="tasi-sparkline" style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={areaPath} fill="url(#spark-grad)" />
                <polyline points={polyline} fill="none" stroke={lineColor} strokeWidth="2" />
              </svg>
            );
          };

          return (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              style={{
                background: 'linear-gradient(135deg, #0d1928 0%, #111f35 100%)',
                borderRadius: 16,
                border: '1px solid rgba(99,179,237,0.1)',
                borderRight: '3px solid #00d4aa',
                padding: '20px 24px',
                boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
              }}
            >
              {/* ── Title row ── */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white" style={{ fontSize: 14, fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
                    المؤشر العام - تاسي
                  </span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>TASI</span>
                  <span
                    style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: isMarketOpen ? 'rgba(0,200,150,0.15)' : 'rgba(255,255,255,0.07)',
                      border: `1px solid ${isMarketOpen ? 'rgba(0,200,150,0.35)' : 'rgba(255,255,255,0.12)'}`,
                      color: isMarketOpen ? '#00c896' : 'rgba(255,255,255,0.4)',
                    }}
                  >
                    {isMarketOpen ? '● مفتوح' : '● مغلق'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {updatedStr && (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{updatedStr}</span>
                  )}
                  <button
                    onClick={refreshTasi}
                    title="تحديث"
                    className="btn-icon"
                    style={{ width: 28, height: 28, borderRadius: 8 }}
                  >
                    <RefreshCw className="w-3 h-3" style={{ color: 'rgba(255,255,255,0.4)' }} />
                  </button>
                </div>
              </div>

              {/* ── Main content: number + sparkline ── */}
              <div className="flex items-end justify-between">
                <div>
                  {/* Big price number */}
                  <div className="mb-1">
                    {hasPrice ? (
                      <div style={{ fontSize: 36, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '-0.02em', color: 'white', lineHeight: 1 }}>
                        {displayPrice.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    ) : isLoadingData ? (
                      <div className="animate-pulse h-10 w-48 rounded-xl" style={{ background: 'rgba(255,255,255,0.06)' }} />
                    ) : (
                      <div style={{ fontSize: 36, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.25)', lineHeight: 1 }}>—</div>
                    )}
                  </div>

                  {/* Change row */}
                  {hasPrice && (
                    <div className="flex items-center gap-2.5">
                      <span
                        className="num font-bold flex items-center gap-1"
                        style={{ fontSize: 18, color: isUp ? '#00c896' : '#ff3d5a' }}
                      >
                        {isUp ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                        {chg >= 0 ? '+' : ''}{chg.toFixed(2)}
                      </span>
                      <span
                        className="num font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          fontSize: 14,
                          color: isUp ? '#00c896' : '#ff3d5a',
                          background: isUp ? 'rgba(0,200,150,0.12)' : 'rgba(255,61,90,0.12)',
                        }}
                      >
                        {chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%
                      </span>
                      {tasiData && tasiData.high > 0 && (
                        <span className="hidden sm:flex items-center gap-3 text-[11px]" style={{ color: 'rgba(255,255,255,0.35)', paddingRight: 10, borderRight: '1px solid rgba(255,255,255,0.08)', marginRight: 2 }}>
                          <span>H <span className="num text-white font-semibold">{tasiData.high.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span></span>
                          <span>L <span className="num text-white font-semibold">{tasiData.low.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span></span>
                        </span>
                      )}
                    </div>
                  )}
                  {!hasPrice && hasMkt && <div style={{ height: 28 }} />}
                </div>

                {/* Sparkline on the left (RTL: visually right side) */}
                <div className="opacity-80 mb-1">
                  <SparkLine />
                </div>
              </div>

              {/* ── Market breadth ── */}
              {hasMkt && (
                <div className="flex items-center gap-0 mt-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                  {[
                    { label: 'صاعد',  count: gainers,   color: '#00c896', bg: 'rgba(0,200,150,0.1)', dot: '🟢' },
                    { label: 'هابط',  count: losers,    color: '#ff3d5a', bg: 'rgba(255,61,90,0.1)',  dot: '🔴' },
                    { label: 'مستقر', count: unchanged, color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.06)', dot: '⚪' },
                  ].map((item, i) => (
                    <React.Fragment key={item.label}>
                      {i > 0 && <div style={{ width: 1, height: 30, background: 'rgba(255,255,255,0.07)', margin: '0 16px' }} />}
                      <div className="flex items-center gap-2 px-2 py-1 rounded-lg" style={{ background: item.bg }}>
                        <span style={{ fontSize: 12 }}>{item.dot}</span>
                        <span className="num font-bold" style={{ fontSize: 18, color: item.color, fontFamily: "'JetBrains Mono', monospace" }}>
                          {item.count}
                        </span>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{item.label}</span>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })()}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-5">
          {[
            { icon: TrendingUp, accent: 'accent-positive', label: 'الصفقات النشطة',  value: status?.activeTradesCount  || 0, iconColor: 'text-[#00d4aa]',  delay: 0   },
            { icon: Zap,        accent: 'accent-amber',    label: 'الموجات المكتشفة', value: status?.waveStocks.length  || 0, iconColor: 'text-amber-500',   delay: 0.07 },
            { icon: Bell,       accent: 'accent-blue',     label: 'إجمالي التنبيهات', value: status?.alerts.length      || 0, iconColor: 'text-blue-400',    delay: 0.14 },
            { icon: Bell,       accent: 'accent-amber',    label: 'تنبيهات مخصصة',    value: status?.customAlerts.length|| 0, iconColor: 'text-amber-400',   delay: 0.21 },
            { icon: History,    accent: 'accent-slate',    label: 'الأسهم المفحوصة',  value: status?.totalCount         || 0, iconColor: 'text-app-text-muted', delay: 0.28 },
          ].map(({ icon: Icon, accent, label, value, iconColor, delay }, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay, duration: 0.35, ease: 'easeOut' }}
              className={`stat-card ${accent}`}
            >
              <div className="flex items-start justify-between mb-5">
                <div className={`p-2.5 rounded-xl bg-white/5 border border-white/8`}>
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>
                <span style={{ fontSize: 11, letterSpacing: '0.06em' }} className="text-app-text-muted font-medium uppercase">{label}</span>
              </div>
              <div className="num text-[2.25rem] font-extrabold leading-none tracking-tight text-app-text">
                {value.toLocaleString('ar-SA')}
              </div>
            </motion.div>
          ))}
        </div>

        {/* رادار الإشارات — stocks ranked by confluence score from available data */}
        {(() => {
          const stocks = status?.tickerData ?? [];
          const radar = [...stocks]
            .map(s => ({ ...s, _score: scoreStock(s) }))
            .filter(s => s._score.total >= 2 && s.change > 0)
            .sort((a, b) => b._score.total - a._score.total || b.volumeRatio - a.volumeRatio)
            .slice(0, 8);
          if (!radar.length) return null;
          return (
            <div className="bg-app-surface border border-app-border rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3.5 border-b border-app-border flex items-center justify-between bg-gradient-to-l from-emerald-500/5 to-transparent">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                    <Radar className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">رادار الإشارات</h3>
                    <p className="text-[10px] text-app-text-muted">أعلى الأسهم تقاطعاً في المؤشرات الفنية</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-app-text-muted border border-app-border rounded-full px-3 py-1">
                  <Activity className="w-3 h-3 text-emerald-500" />
                  <span>{radar.length} إشارة</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-x-reverse divide-x divide-app-border divide-y lg:divide-y-0">
                {radar.map((s, i) => (
                  <div
                    key={i}
                    onClick={() => setSelectedStock(s)}
                    className="p-4 hover:bg-app-bg/60 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-[11px] font-bold text-app-text group-hover:text-emerald-400 transition-colors truncate max-w-[100px]">
                          {s.companyName}
                        </div>
                        <div className="text-[10px] text-app-text-muted font-mono">{s.symbol?.replace('.SR','')}</div>
                      </div>
                      <ScoreBadge score={s._score} />
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-lg font-bold font-mono text-app-text">{s.price?.toFixed(2)}</div>
                        <div className={`text-[11px] font-bold ${s.change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {s.change >= 0 ? '+' : ''}{s.change?.toFixed(2)}%
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-blue-400 font-mono">{s.volumeRatio?.toFixed(1)}x</div>
                        <div className="text-[9px] text-app-text-muted">سيولة</div>
                      </div>
                    </div>
                    <div className="mt-2 space-y-0.5">
                      {s._score.reasons.slice(0, 2).map((r: string, j: number) => (
                        <div key={j} className="text-[9px] text-emerald-500/70 flex items-center gap-1">
                          <div className="w-1 h-1 rounded-full bg-emerald-500/50 shrink-0" />
                          {r}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Market Overview Tables — Row 1: Gainers + Losers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <MiniTable title="الأكثر ارتفاعاً" icon={TrendingUp}  data={status?.topGainers    || []} type="price"     onStockClick={setSelectedStock} accent="emerald" />
          <MiniTable title="الأكثر انخفاضاً" icon={TrendingDown} data={status?.topLosers     || []} type="price"     onStockClick={setSelectedStock} accent="rose"    />
        </div>

        {/* Row 2: Liquidity Entry + Exit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <MiniTable title="دخول سيولة" icon={CheckCircle2} data={status?.liquidityEntry || []} type="liquidity" onStockClick={setSelectedStock} accent="emerald" />
          <MiniTable title="خروج سيولة" icon={AlertCircle}  data={status?.liquidityExit  || []} type="liquidity" onStockClick={setSelectedStock} accent="rose"    />
        </div>

        {/* Row 3: Elliott Waves — centered, half-width on large screens */}
        <div className="flex justify-center">
          <div className="w-full lg:w-1/2">
            <MiniTable title="موجات إليوت" icon={Zap} data={status?.waveStocks || []} type="wave" onStockClick={setSelectedStock} accent="amber" />
          </div>
        </div>

        {selectedStock && (
          <StockDetailsModal 
            stock={selectedStock} 
            onClose={() => setSelectedStock(null)} 
            watchlist={watchlist}
            onToggleWatchlist={toggleWatchlist}
          />
        )}

        {showFeedback && (
          <FeedbackModal onClose={() => setShowFeedback(false)} user={user} />
        )}

        {showAlertsModal && (
          <AlertsModal onClose={() => setShowAlertsModal(false)} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content Area */}
          <div className="lg:col-span-2 space-y-6 flex flex-col">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4 w-full md:w-auto">
                <button 
                  onClick={() => setActiveTab('active')}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    activeTab === 'active' 
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/20' 
                      : 'bg-app-surface text-app-text-muted hover:bg-app-bg border border-app-border'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    الصفقات الحالية
                  </div>
                </button>
                <button 
                  onClick={() => setActiveTab('all')}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    activeTab === 'all' 
                      ? 'bg-blue-500 text-white shadow-lg shadow-blue-900/20' 
                      : 'bg-app-surface text-app-text-muted hover:bg-app-bg border border-app-border'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ListIcon className="w-4 h-4" />
                    جميع الأسهم
                  </div>
                </button>
                <button 
                  onClick={() => setActiveTab('watchlist')}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    activeTab === 'watchlist' 
                      ? 'bg-amber-500 text-white shadow-lg shadow-amber-900/20' 
                      : 'bg-app-surface text-app-text-muted hover:bg-app-bg border border-app-border'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Star className="w-4 h-4" />
                    قائمتي ({watchlist.length})
                  </div>
                </button>
                <button 
                  onClick={() => setActiveTab('margin')}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    activeTab === 'margin' 
                      ? 'bg-rose-500 text-white shadow-lg shadow-rose-900/20' 
                      : 'bg-app-surface text-app-text-muted hover:bg-app-bg border border-app-border'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4" />
                    التداول بالهامش
                  </div>
                </button>
              </div>

              <div className="relative w-full md:w-64">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-text-muted" />
                <input 
                  type="text"
                  placeholder="بحث عن سهم أو شركة..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-app-surface border border-app-border rounded-xl pr-10 pl-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors text-app-text"
                />
              </div>
            </div>
            
            <div className="bg-app-surface border border-app-border rounded-2xl overflow-hidden flex-1 min-h-[500px] flex flex-col shadow-sm dark:shadow-none">
              {activeTab === 'margin' ? (
                <MarginTrading 
                  user={user}
                  marginAccount={marginAccount}
                  marginPositions={marginPositions}
                  tickerData={status?.tickerData || []}
                  onClosePosition={closeMarginPosition}
                />
              ) : (
                <>
                  <div className="flex items-center border-b border-app-border bg-app-surface/50 px-6 h-12">
                <div className="flex-[1.5] text-xs font-medium text-app-text-muted uppercase">الشركة</div>
                <div className="flex-1 text-xs font-medium text-app-text-muted uppercase">السعر</div>
                <div className="flex-1 text-xs font-medium text-app-text-muted uppercase">RSI</div>
                <div className="flex-[1.5] text-xs font-medium text-app-text-muted uppercase">تحليل الموجات</div>
                <div className="flex-1 text-xs font-medium text-app-text-muted uppercase text-left">التغيير</div>
              </div>
              <div className="flex-1">
                <AutoSizerAny>
                  {({ height, width }: any) => {
                    let dataToDisplay: any[] = activeTab === 'active' 
                      ? (status?.activeTrades || []) 
                      : activeTab === 'watchlist'
                        ? (status?.tickerData.filter(s => watchlist.includes(s.symbol)) || [])
                        : (status?.tickerData || []);
                    
                    if (searchQuery) {
                      const query = searchQuery.toLowerCase();
                      dataToDisplay = dataToDisplay.filter((item: any) => 
                        item.symbol.toLowerCase().includes(query) || 
                        item.companyName.toLowerCase().includes(query)
                      );
                    }
                    
                    return (
                      <List
                        height={height}
                        itemCount={dataToDisplay.length}
                        itemSize={60}
                        width={width}
                        direction="rtl"
                        className="custom-scrollbar"
                      >
                        {({ index, style }: any) => {
                          const item = dataToDisplay[index];
                          if (!item) return null;
                          
                          // Handle both Trade and StockStats types
                          const symbol = (item as any).symbol;
                          const companyName = (item as any).companyName;
                          const price = (item as any).entryPrice || (item as any).price;
                          const rsi = (item as any).rsi;
                          const wave = (item as any).wave;
                          const change = (item as any).change;
                          const fullStock = status?.tickerData.find(s => s.symbol === symbol);
 
                           return (
                             <div 
                               style={style} 
                               className="flex items-center border-b border-app-border hover:bg-app-bg transition-colors px-6 cursor-pointer"
                               onClick={() => fullStock && setSelectedStock(fullStock)}
                             >
                               <div className="flex-[1.5]">
                                 <div className="font-bold text-emerald-500">{companyName}</div>
                                 <div className="text-[10px] text-app-text-muted font-mono">{symbol}</div>
                               </div>
                               <div className="flex-1 font-mono">{price.toFixed(2)}</div>
                               <div className="flex-1 font-mono">{rsi.toFixed(1)}</div>
                               <div className="flex-[1.5] text-xs font-medium">
                                 {wave && wave !== "غير محدد" ? (
                                   <span className="bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20">
                                     {wave}
                                   </span>
                                 ) : (
                                   <span className="text-app-text-muted italic opacity-50">---</span>
                                 )}
                               </div>
                               <div className={`flex-1 text-sm font-bold text-left ${change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                 {change !== undefined ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '---'}
                               </div>
                             </div>
                           );
                         }}
                       </List>
                     );
                   }}
                 </AutoSizerAny>
                 {activeTab === 'active' && status?.activeTrades.length === 0 && (
                   <div className="absolute inset-0 flex items-center justify-center text-app-text-muted italic">
                     لا توجد صفقات نشطة حالياً
                   </div>
                 )}
                 {activeTab === 'watchlist' && watchlist.length === 0 && (
                   <div className="absolute inset-0 flex items-center justify-center text-app-text-muted italic flex-col gap-2">
                     <Star className="w-8 h-8 opacity-20" />
                     قائمتك فارغة. أضف أسهمك المفضلة لمتابعتها هنا.
                   </div>
                 )}
                 {activeTab === 'all' && status?.tickerData.length === 0 && (
                   <div className="absolute inset-0 flex items-center justify-center text-app-text-muted italic">
                     جاري تحميل بيانات السوق...
                   </div>
                 )}
                 {searchQuery && (status?.tickerData.length || 0) > 0 && (
                   <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-app-surface/80 backdrop-blur-sm border border-app-border rounded-full text-[10px] text-app-text-muted">
                     تم العثور على نتائج البحث
                   </div>
                 )}
               </div>
              </>
              )}
             </div>
           </div>
 
           {/* Recent Alerts Feed */}
           <div className="space-y-4 flex flex-col">
             {/* Telegram Join Card */}
             <motion.div 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               className="p-6 bg-gradient-to-br from-[#0088cc]/20 to-[#0088cc]/5 border border-[#0088cc]/20 rounded-2xl relative overflow-hidden group"
             >
               <div className="absolute -right-4 -top-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
                 <Send className="w-24 h-24 text-[#0088cc]" />
               </div>
               <div className="relative z-10 space-y-4">
                 <div className="flex items-center gap-3">
                   <div className="p-2 bg-[#0088cc] rounded-lg shadow-lg shadow-blue-500/20">
                     <Send className="w-5 h-5 text-white" />
                   </div>
                   <div>
                     <h3 className="font-bold text-white">قناة التليجرام الرسمية</h3>
                     <p className="text-[10px] text-blue-400 font-medium">انضم لمجتمع المتداولين</p>
                   </div>
                 </div>
                 <p className="text-xs text-app-text-muted leading-relaxed">
                   احصل على تنبيهات فورية، تحليلات يومية، ومتابعة حية مباشرة على جوالك. لا تفوت أي فرصة في السوق السعودي!
                 </p>
                 <a
                   href="https://t.me/RadarsaudiiBot"
                   target="_blank"
                   rel="noreferrer"
                   className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#0088cc] hover:bg-[#0077b5] text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-900/30 hover:shadow-blue-900/50"
                 >
                   انضم الآن مجاناً
                 </a>
               </div>
             </motion.div>
 
             <h2 className="text-lg font-semibold flex items-center gap-2">
               <Bell className="w-5 h-5 text-amber-500" />
               آخر التنبيهات
             </h2>
             <div className="bg-app-surface/50 border border-app-border rounded-2xl overflow-hidden flex-1 min-h-[500px] relative">
               <AutoSizerAny>
                 {({ height, width }: any) => (
                   <List
                     height={height}
                     itemCount={status?.alerts.length || 0}
                     itemSize={90}
                     width={width}
                     direction="rtl"
                     className="custom-scrollbar"
                   >
                     {AlertRow}
                   </List>
                 )}
               </AutoSizerAny>
               {status?.alerts.length === 0 && (
                 <div className="absolute inset-0 flex items-center justify-center text-app-text-muted italic text-sm">
                   لا توجد تنبيهات بعد
                 </div>
               )}
             </div>
           </div>
        </div>
      </main>

      {/* ── Disclaimer ─────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 pb-6 pt-2">
        <p className="text-center text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
          💡 تنبيه: المحتوى في ترندسا للاستشارة والتثقيف المالي فقط، ولا يُمثّل توصية استثمارية. استشر مستشارك المالي قبل اتخاذ أي قرار.
        </p>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--color-app-border);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--color-app-text-muted);
        }
      `}} />
    </div>
  );
}
