/**
 * محرك الاستخبارات - Intelligence Engine
 * مستوحى من MiroFish: تحليل متعدد الوكلاء + محاكاة السيناريوهات + ذاكرة السوق
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Brain,
  Zap,
  GitBranch,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  BarChart2,
  MessageSquare,
  ChevronDown,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Trash2,
  Search,
  BookOpen,
  Lightbulb,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StockLike {
  symbol: string;
  companyName: string;
  price: number;
  change: number;
  volumeRatio: number;
  rsi?: number;
  wave?: string;
  macd?: { macd: number; signal: number; histogram: number };
  bb?: { middle: number; upper: number; lower: number };
  atr?: number;
  stochRsi?: { k: number; d: number };
}

interface AgentResult {
  technical: string;
  fundamental: string;
  sentiment: string;
  risk: string;
  synthesis: string;
}

interface AgentStatus {
  technical: 'idle' | 'loading' | 'done' | 'error';
  fundamental: 'idle' | 'loading' | 'done' | 'error';
  sentiment: 'idle' | 'loading' | 'done' | 'error';
  risk: 'idle' | 'loading' | 'done' | 'error';
  synthesis: 'idle' | 'loading' | 'done' | 'error';
}

interface ScenarioResult {
  scenario_summary: string;
  overall_market_impact: string;
  impact_percentage: string;
  affected_sectors: Array<{
    sector: string;
    impact: string;
    reason: string;
    severity: number;
  }>;
  top_negative_stocks: Array<{
    symbol: string;
    company: string;
    reason: string;
    expected_change: string;
  }>;
  top_positive_stocks: Array<{
    symbol: string;
    company: string;
    reason: string;
    expected_change: string;
  }>;
  trading_strategy: string;
  time_horizon: string;
}

interface MemoryEntry {
  id: string;
  type: 'multi-agent' | 'scenario';
  title: string;
  summary: string;
  timestamp: number;
  data: AgentResult | ScenarioResult;
}

const MEMORY_KEY = 'treansa_intelligence_memory';
const MAX_MEMORY_ENTRIES = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadMemory(): MemoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(MEMORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveMemory(entries: MemoryEntry[]): void {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(entries.slice(0, MAX_MEMORY_ENTRIES)));
}

function addMemoryEntry(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): void {
  const entries = loadMemory();
  entries.unshift({ ...entry, id: crypto.randomUUID(), timestamp: Date.now() });
  saveMemory(entries);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'الآن';
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  return `منذ ${Math.floor(h / 24)} يوم`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const AgentCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  accent: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  content?: string;
  delay?: number;
}> = ({ icon, title, accent, status, content, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.3 }}
    className="bg-app-surface border border-app-border rounded-2xl overflow-hidden flex flex-col"
  >
    <div className={`flex items-center gap-2.5 px-4 py-3 border-b border-app-border bg-gradient-to-l ${accent} to-transparent`}>
      <div className="p-1.5 rounded-lg bg-white/5">{icon}</div>
      <span className="text-sm font-bold text-app-text">{title}</span>
      <div className="mr-auto">
        {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-app-text-muted" />}
        {status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
        {status === 'error' && <AlertCircle className="w-4 h-4 text-rose-500" />}
      </div>
    </div>
    <div className="p-4 flex-1 text-sm text-app-text-muted leading-relaxed min-h-[100px]">
      {status === 'idle' && <span className="text-app-text-muted/50">في انتظار بدء التحليل...</span>}
      {status === 'loading' && (
        <div className="flex flex-col gap-2">
          {[80, 60, 70].map((w, i) => (
            <div key={i} className="h-3 rounded-full bg-white/5 animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      {status === 'error' && <span className="text-rose-400">تعذر الحصول على التحليل</span>}
      {status === 'done' && content && (
        <div className="prose prose-invert prose-sm max-w-none text-app-text-muted">
          <Markdown>{content}</Markdown>
        </div>
      )}
    </div>
  </motion.div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  stocks: StockLike[];
}

type Tab = 'multi-agent' | 'scenario' | 'memory';

const IntelligenceEngine: React.FC<Props> = ({ stocks }) => {
  const [activeTab, setActiveTab] = useState<Tab>('multi-agent');

  // Multi-agent state
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    technical: 'idle', fundamental: 'idle', sentiment: 'idle', risk: 'idle', synthesis: 'idle'
  });
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [stockSearch, setStockSearch] = useState('');

  // Scenario state
  const [scenarioInput, setScenarioInput] = useState('');
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  // Memory state
  const [memory, setMemory] = useState<MemoryEntry[]>(loadMemory);

  const scenarioExamples = [
    'انخفاض أسعار النفط 15% في أسبوع واحد',
    'رفع الفائدة الأمريكية 0.5% بشكل مفاجئ',
    'توترات جيوسياسية في منطقة الخليج',
    'ارتفاع التضخم السعودي فوق 5%',
    'انهيار بنك أمريكي كبير',
    'موجة صعود قوية في سوق الأسهم الأمريكية',
  ];

  const filteredStocks = stocks.filter(s =>
    !stockSearch ||
    s.symbol.includes(stockSearch) ||
    s.companyName.includes(stockSearch)
  ).slice(0, 50);

  const selectedStock = stocks.find(s => s.symbol === selectedSymbol);

  // ── Multi-agent analysis ──────────────────────────────────────────────────
  const runMultiAgent = useCallback(async () => {
    if (!selectedStock) return;
    setAgentLoading(true);
    setAgentError(null);
    setAgentResult(null);
    setAgentStatus({ technical: 'loading', fundamental: 'loading', sentiment: 'loading', risk: 'loading', synthesis: 'idle' });

    try {
      const res = await fetch('/api/multi-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedStock.symbol,
          companyName: selectedStock.companyName,
          price: selectedStock.price,
          change: selectedStock.change,
          rsi: selectedStock.rsi,
          wave: selectedStock.wave,
          macd: selectedStock.macd,
          bb: selectedStock.bb,
          atr: selectedStock.atr,
          stochRsi: selectedStock.stochRsi,
          volumeRatio: selectedStock.volumeRatio,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل التحليل');
      }

      setAgentStatus({ technical: 'done', fundamental: 'done', sentiment: 'done', risk: 'done', synthesis: 'done' });
      setAgentResult(data.agents);

      addMemoryEntry({
        type: 'multi-agent',
        title: `تحليل ${selectedStock.companyName} (${selectedStock.symbol})`,
        summary: data.agents.synthesis?.slice(0, 120) || '',
        data: data.agents,
      });
      setMemory(loadMemory());
    } catch (e: any) {
      setAgentStatus({ technical: 'error', fundamental: 'error', sentiment: 'error', risk: 'error', synthesis: 'error' });
      setAgentError(e.message || 'حدث خطأ غير متوقع');
    } finally {
      setAgentLoading(false);
    }
  }, [selectedStock]);

  // ── Scenario simulation ───────────────────────────────────────────────────
  const runScenario = useCallback(async () => {
    const trimmed = scenarioInput.trim();
    if (!trimmed) return;
    setScenarioLoading(true);
    setScenarioError(null);
    setScenarioResult(null);

    try {
      const res = await fetch('/api/scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: trimmed,
          stocks: stocks.slice(0, 30).map(s => ({ symbol: s.symbol, companyName: s.companyName })),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'فشل تحليل السيناريو');

      setScenarioResult(data.result);

      addMemoryEntry({
        type: 'scenario',
        title: `سيناريو: ${trimmed.slice(0, 50)}`,
        summary: data.result.scenario_summary?.slice(0, 120) || '',
        data: data.result,
      });
      setMemory(loadMemory());
    } catch (e: any) {
      setScenarioError(e.message || 'حدث خطأ غير متوقع');
    } finally {
      setScenarioLoading(false);
    }
  }, [scenarioInput, stocks]);

  // ── Memory helpers ────────────────────────────────────────────────────────
  const deleteMemoryEntry = (id: string) => {
    const updated = memory.filter(e => e.id !== id);
    saveMemory(updated);
    setMemory(updated);
  };

  const clearAllMemory = () => {
    saveMemory([]);
    setMemory([]);
  };

  const loadFromMemory = (entry: MemoryEntry) => {
    if (entry.type === 'multi-agent') {
      setAgentResult(entry.data as AgentResult);
      setAgentStatus({ technical: 'done', fundamental: 'done', sentiment: 'done', risk: 'done', synthesis: 'done' });
      setActiveTab('multi-agent');
    } else {
      setScenarioResult(entry.data as ScenarioResult);
      setActiveTab('scenario');
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <Brain className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-app-text">محرك الاستخبارات</h1>
            <p className="text-xs text-app-text-muted">تحليل متعدد الوكلاء · محاكاة السيناريوهات · ذاكرة السوق</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-app-text-muted bg-app-surface border border-app-border rounded-full px-3 py-1.5">
          <Zap className="w-3 h-3 text-violet-400" />
          <span>مستوحى من MiroFish</span>
        </div>
      </motion.div>

      {/* Tab bar */}
      <div className="flex gap-2 bg-app-surface border border-app-border rounded-2xl p-1.5">
        {([
          { id: 'multi-agent', label: 'تحليل متعدد الوكلاء', icon: <GitBranch className="w-4 h-4" /> },
          { id: 'scenario',    label: 'محاكي السيناريوهات',  icon: <Lightbulb className="w-4 h-4" /> },
          { id: 'memory',      label: `ذاكرة السوق (${memory.length})`, icon: <BookOpen className="w-4 h-4" /> },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all ${
              activeTab === tab.id
                ? 'bg-violet-600 text-white shadow-lg shadow-violet-900/30'
                : 'text-app-text-muted hover:text-app-text hover:bg-app-bg'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ── TAB 1: Multi-Agent ─────────────────────────────────────────── */}
        {activeTab === 'multi-agent' && (
          <motion.div
            key="multi-agent"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-5"
          >
            {/* Stock selector */}
            <div className="bg-app-surface border border-app-border rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-bold text-app-text flex items-center gap-2">
                <Search className="w-4 h-4 text-violet-400" />
                اختر السهم للتحليل
              </h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-text-muted pointer-events-none" />
                  <input
                    type="text"
                    placeholder="ابحث باسم الشركة أو الرمز..."
                    value={stockSearch}
                    onChange={e => setStockSearch(e.target.value)}
                    className="w-full bg-app-bg border border-app-border rounded-xl pr-10 pl-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition-colors text-app-text"
                  />
                </div>
                <div className="relative sm:w-64">
                  <select
                    value={selectedSymbol}
                    onChange={e => setSelectedSymbol(e.target.value)}
                    className="w-full appearance-none bg-app-bg border border-app-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition-colors text-app-text pr-4 pl-8"
                  >
                    <option value="">-- اختر سهماً --</option>
                    {filteredStocks.map(s => (
                      <option key={s.symbol} value={s.symbol}>
                        {s.symbol} · {s.companyName} · {s.price?.toFixed(2)} ر.س
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-text-muted pointer-events-none" />
                </div>
              </div>

              {selectedStock && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="flex flex-wrap gap-3 p-3 bg-app-bg rounded-xl border border-app-border text-xs text-app-text-muted"
                >
                  <span className="font-mono font-bold text-app-text">{selectedStock.symbol}</span>
                  <span>{selectedStock.companyName}</span>
                  <span>السعر: <b className="text-app-text">{selectedStock.price?.toFixed(2)}</b> ر.س</span>
                  <span className={selectedStock.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {selectedStock.change >= 0 ? '+' : ''}{selectedStock.change?.toFixed(2)}%
                  </span>
                  {selectedStock.rsi !== undefined && <span>RSI: <b className="text-app-text">{selectedStock.rsi.toFixed(1)}</b></span>}
                  {selectedStock.wave && <span>موجة: <b className="text-app-text">{selectedStock.wave}</b></span>}
                </motion.div>
              )}

              <button
                onClick={runMultiAgent}
                disabled={!selectedSymbol || agentLoading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-900/20"
              >
                {agentLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />جاري تشغيل الوكلاء الأربعة...</>
                ) : (
                  <><GitBranch className="w-4 h-4" />تحليل متعدد الوكلاء</>
                )}
              </button>

              {agentError && (
                <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {agentError}
                </div>
              )}
            </div>

            {/* Agent cards */}
            {(agentLoading || agentResult) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AgentCard
                  icon={<BarChart2 className="w-4 h-4 text-blue-400" />}
                  title="المحلل الفني"
                  accent="from-blue-500/8"
                  status={agentStatus.technical}
                  content={agentResult?.technical}
                  delay={0}
                />
                <AgentCard
                  icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
                  title="المحلل الأساسي"
                  accent="from-emerald-500/8"
                  status={agentStatus.fundamental}
                  content={agentResult?.fundamental}
                  delay={0.05}
                />
                <AgentCard
                  icon={<MessageSquare className="w-4 h-4 text-amber-400" />}
                  title="محلل المشاعر"
                  accent="from-amber-500/8"
                  status={agentStatus.sentiment}
                  content={agentResult?.sentiment}
                  delay={0.1}
                />
                <AgentCard
                  icon={<ShieldAlert className="w-4 h-4 text-rose-400" />}
                  title="مدير المخاطر"
                  accent="from-rose-500/8"
                  status={agentStatus.risk}
                  content={agentResult?.risk}
                  delay={0.15}
                />
              </div>
            )}

            {/* Synthesis */}
            {agentResult?.synthesis && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-br from-violet-500/10 to-app-surface border border-violet-500/25 rounded-2xl overflow-hidden"
              >
                <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-violet-500/15">
                  <div className="p-1.5 rounded-lg bg-violet-500/10">
                    <Brain className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-app-text">حكم المحلل الرئيسي</h3>
                    <p className="text-[10px] text-app-text-muted">تجميع نتائج الوكلاء الأربعة</p>
                  </div>
                  <div className="mr-auto flex items-center gap-1.5 text-[10px] text-violet-400 bg-violet-500/10 rounded-full px-3 py-1">
                    <Zap className="w-3 h-3" />
                    <span>إجماع الخبراء</span>
                  </div>
                </div>
                <div className="p-5 text-sm leading-relaxed prose prose-invert prose-sm max-w-none text-app-text">
                  <Markdown>{agentResult.synthesis}</Markdown>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ── TAB 2: Scenario Simulator ──────────────────────────────────── */}
        {activeTab === 'scenario' && (
          <motion.div
            key="scenario"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-5"
          >
            {/* Input panel */}
            <div className="bg-app-surface border border-app-border rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-bold text-app-text flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-400" />
                صف السيناريو الذي تريد محاكاته
              </h2>

              <textarea
                value={scenarioInput}
                onChange={e => setScenarioInput(e.target.value)}
                placeholder="مثال: انخفاض أسعار النفط بشكل حاد إلى 60 دولار للبرميل..."
                rows={3}
                className="w-full bg-app-bg border border-app-border rounded-xl p-4 text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-amber-500 transition-colors resize-none leading-relaxed"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runScenario(); }
                }}
              />

              {/* Example chips */}
              <div className="flex flex-wrap gap-2">
                {scenarioExamples.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => setScenarioInput(ex)}
                    className="text-xs px-3 py-1.5 rounded-full bg-app-bg border border-app-border text-app-text-muted hover:text-app-text hover:border-amber-500/50 transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>

              <button
                onClick={runScenario}
                disabled={!scenarioInput.trim() || scenarioLoading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-amber-900/20"
              >
                {scenarioLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />جاري تحليل السيناريو...</>
                ) : (
                  <><Lightbulb className="w-4 h-4" />محاكاة السيناريو</>
                )}
              </button>

              {scenarioError && (
                <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {scenarioError}
                </div>
              )}
            </div>

            {/* Scenario result */}
            {scenarioResult && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                {/* Summary banner */}
                <div className={`p-4 rounded-2xl border ${
                  scenarioResult.overall_market_impact === 'إيجابي'
                    ? 'bg-emerald-500/8 border-emerald-500/25'
                    : scenarioResult.overall_market_impact === 'سلبي'
                    ? 'bg-rose-500/8 border-rose-500/25'
                    : 'bg-app-surface border-app-border'
                }`}>
                  <div className="flex items-start gap-3">
                    {scenarioResult.overall_market_impact === 'إيجابي'
                      ? <TrendingUp className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                      : <TrendingDown className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          scenarioResult.overall_market_impact === 'إيجابي'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-rose-500/15 text-rose-400'
                        }`}>
                          تأثير {scenarioResult.overall_market_impact}
                        </span>
                        <span className="text-xs text-app-text-muted">{scenarioResult.impact_percentage}</span>
                        <span className="text-xs text-app-text-muted mr-auto">{scenarioResult.time_horizon}</span>
                      </div>
                      <p className="text-sm text-app-text leading-relaxed">{scenarioResult.scenario_summary}</p>
                    </div>
                  </div>
                </div>

                {/* Positive & Negative stocks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Positive */}
                  {scenarioResult.top_positive_stocks?.length > 0 && (
                    <div className="bg-app-surface border border-emerald-500/20 rounded-2xl overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3 border-b border-emerald-500/15 bg-emerald-500/5">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-bold text-emerald-400">الأسهم المستفيدة</span>
                      </div>
                      <div className="divide-y divide-app-border">
                        {scenarioResult.top_positive_stocks.map((s, i) => (
                          <div key={i} className="flex items-start gap-3 p-3 hover:bg-app-bg/50 transition-colors">
                            <span className="font-mono text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-lg shrink-0">{s.symbol}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-app-text truncate">{s.company}</span>
                                <span className="text-xs font-mono text-emerald-400 shrink-0">{s.expected_change}</span>
                              </div>
                              <p className="text-[11px] text-app-text-muted mt-0.5 leading-relaxed">{s.reason}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Negative */}
                  {scenarioResult.top_negative_stocks?.length > 0 && (
                    <div className="bg-app-surface border border-rose-500/20 rounded-2xl overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3 border-b border-rose-500/15 bg-rose-500/5">
                        <TrendingDown className="w-4 h-4 text-rose-400" />
                        <span className="text-sm font-bold text-rose-400">الأسهم الأكثر تضرراً</span>
                      </div>
                      <div className="divide-y divide-app-border">
                        {scenarioResult.top_negative_stocks.map((s, i) => (
                          <div key={i} className="flex items-start gap-3 p-3 hover:bg-app-bg/50 transition-colors">
                            <span className="font-mono text-xs bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded-lg shrink-0">{s.symbol}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-app-text truncate">{s.company}</span>
                                <span className="text-xs font-mono text-rose-400 shrink-0">{s.expected_change}</span>
                              </div>
                              <p className="text-[11px] text-app-text-muted mt-0.5 leading-relaxed">{s.reason}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Affected sectors */}
                {scenarioResult.affected_sectors?.length > 0 && (
                  <div className="bg-app-surface border border-app-border rounded-2xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-app-border">
                      <BarChart2 className="w-4 h-4 text-app-text-muted" />
                      <span className="text-sm font-bold text-app-text">القطاعات المتأثرة</span>
                    </div>
                    <div className="p-4 flex flex-wrap gap-2">
                      {scenarioResult.affected_sectors.map((sec, i) => (
                        <div
                          key={i}
                          title={sec.reason}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs ${
                            sec.impact === 'إيجابي'
                              ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-400'
                              : 'bg-rose-500/8 border-rose-500/20 text-rose-400'
                          }`}
                        >
                          <span className="font-bold">{sec.sector}</span>
                          <span className="opacity-60">{'▮'.repeat(Math.min(sec.severity || 1, 5))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Trading strategy */}
                {scenarioResult.trading_strategy && (
                  <div className="bg-gradient-to-br from-amber-500/8 to-app-surface border border-amber-500/20 rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Lightbulb className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-bold text-app-text">استراتيجية التداول المقترحة</span>
                    </div>
                    <p className="text-sm text-app-text-muted leading-relaxed whitespace-pre-line">
                      {scenarioResult.trading_strategy}
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ── TAB 3: Memory ─────────────────────────────────────────────── */}
        {activeTab === 'memory' && (
          <motion.div
            key="memory"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-app-text-muted">
                {memory.length > 0
                  ? `${memory.length} تحليل محفوظ — يُخزّن محلياً على جهازك`
                  : 'لا توجد تحليلات محفوظة بعد'}
              </p>
              {memory.length > 0 && (
                <button
                  onClick={clearAllMemory}
                  className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  مسح الكل
                </button>
              )}
            </div>

            {memory.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-app-text-muted">
                <BookOpen className="w-10 h-10 opacity-30" />
                <div className="text-center">
                  <p className="text-sm font-medium">ذاكرة السوق فارغة</p>
                  <p className="text-xs mt-1 opacity-70">قم بتشغيل تحليل أو سيناريو ليُحفظ هنا</p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {memory.map(entry => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-app-surface border border-app-border rounded-2xl p-4 hover:border-violet-500/30 transition-colors cursor-pointer group"
                  onClick={() => loadFromMemory(entry)}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${
                      entry.type === 'multi-agent'
                        ? 'bg-violet-500/10 border border-violet-500/20'
                        : 'bg-amber-500/10 border border-amber-500/20'
                    }`}>
                      {entry.type === 'multi-agent'
                        ? <GitBranch className="w-4 h-4 text-violet-400" />
                        : <Lightbulb className="w-4 h-4 text-amber-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-app-text truncate">{entry.title}</span>
                        <button
                          onClick={e => { e.stopPropagation(); deleteMemoryEntry(entry.id); }}
                          className="p-1 rounded-lg text-app-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-app-text-muted mt-1 leading-relaxed line-clamp-2">{entry.summary}</p>
                      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-app-text-muted">
                        <Clock className="w-3 h-3" />
                        <span>{timeAgo(entry.timestamp)}</span>
                        <span className={`mr-1.5 px-1.5 py-0.5 rounded-full ${
                          entry.type === 'multi-agent'
                            ? 'bg-violet-500/10 text-violet-400'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {entry.type === 'multi-agent' ? 'متعدد الوكلاء' : 'سيناريو'}
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default IntelligenceEngine;
