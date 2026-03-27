import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Loader2, Brain, ChevronDown, ChevronUp, Save, Check } from 'lucide-react';
import Markdown from 'react-markdown';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AdvisorSettings {
  morningReport: boolean;
  instantAlerts: boolean;
  weeklyDigest: boolean;
  telegramId: string;
  email: string;
  watchedStocks: string[];
}

const DEFAULT_SETTINGS: AdvisorSettings = {
  morningReport: true,
  instantAlerts: true,
  weeklyDigest: false,
  telegramId: '',
  email: '',
  watchedStocks: ['2222', '2010', '1120'],
};

const STORAGE_KEY = 'trandsa_advisor_settings';

// ─── Data ─────────────────────────────────────────────────────────────────────

const CHIPS = [
  { icon: '🔍', label: 'حلل سهم أرامكو 2222' },
  { icon: '📊', label: 'أفضل فرص اليوم في تاسي' },
  { icon: '📰', label: 'أخبار السوق الآن' },
  { icon: '⚡', label: 'أسهم على وشك الاختراق' },
  { icon: '📅', label: 'توقعات الأسبوع القادم' },
];

const STOCK_OPTIONS = [
  { symbol: '2222', name: 'أرامكو' },
  { symbol: '2010', name: 'سابك' },
  { symbol: '1120', name: 'الراجحي' },
  { symbol: '7010', name: 'stc' },
  { symbol: '1211', name: 'معادن' },
  { symbol: '2380', name: 'بترو رابغ' },
  { symbol: '4200', name: 'دله الطب' },
  { symbol: '1180', name: 'الأهلي' },
  { symbol: '2350', name: 'سيمكو' },
  { symbol: '4030', name: 'الزامل' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200"
      style={{ background: checked ? '#00d4aa' : 'rgba(255,255,255,0.1)' }}
    >
      <span
        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
        style={{ right: checked ? 2 : 'auto', left: checked ? 'auto' : 2 }}
      />
    </button>
  );
}

function SettingsRow({ label, subLabel, checked, onChange }: {
  label: string; subLabel: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white">{label}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{subLabel}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AIAdvisor() {
  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Settings state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AdvisorSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const next: Message[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setLoading(true);
    setChatError(null);
    try {
      const res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setMessages([...next, { role: 'assistant', content: data.reply }]);
    } catch (e: any) {
      setChatError(e.message || 'فشل الاتصال بالمستشار');
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const toggleStock = (symbol: string) => {
    setSettings(s => ({
      ...s,
      watchedStocks: s.watchedStocks.includes(symbol)
        ? s.watchedStocks.filter(x => x !== symbol)
        : [...s.watchedStocks, symbol],
    }));
  };

  const saveSettings = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2500);
  };

  const isEmpty = messages.length === 0;

  return (
    <div
      dir="rtl"
      className="max-w-3xl mx-auto px-4 py-6 space-y-6"
      style={{ fontFamily: "'IBM Plex Sans Arabic', 'Tajawal', sans-serif" }}
    >

      {/* ── Section 1: Chat ───────────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: '#111927',
          border: '1px solid rgba(0,212,170,0.15)',
          minHeight: 480,
          boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Chat header */}
        <div
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ background: 'linear-gradient(135deg,#0a0e1a,#0d1528)', borderBottom: '1px solid rgba(0,212,170,0.12)' }}
        >
          <div
            className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
            style={{ background: 'rgba(0,212,170,0.15)', border: '1px solid rgba(0,212,170,0.3)', boxShadow: '0 0 16px rgba(0,212,170,0.15)' }}
          >
            <Brain className="w-5 h-5" style={{ color: '#00d4aa' }} />
          </div>
          <div className="flex-1">
            <div className="font-bold text-white text-sm leading-tight">المستشار الذكي</div>
            <div className="text-[10px]" style={{ color: '#4a9eff' }}>محلل سوق تداول · Claude Haiku</div>
          </div>
          <span
            className="text-[10px] font-semibold px-2 py-1 rounded-full"
            style={{ background: 'rgba(0,212,170,0.1)', border: '1px solid rgba(0,212,170,0.2)', color: '#00d4aa' }}
          >
            ● متصل
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ minHeight: 300 }}>
          {isEmpty && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center text-center pt-8 pb-4 space-y-4"
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(0,212,170,0.1)', border: '1px solid rgba(0,212,170,0.2)', boxShadow: '0 0 28px rgba(0,212,170,0.12)' }}
              >
                <Brain className="w-8 h-8" style={{ color: '#00d4aa' }} />
              </div>
              <div>
                <p className="font-bold text-white">مرحباً، أنا مستشارك الذكي</p>
                <p className="text-xs mt-1 max-w-xs mx-auto" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  أحلل أسهم تاسي تقنياً بناءً على RSI وMACD وموجات إليوت
                </p>
              </div>
              {/* Quick chips */}
              <div className="flex flex-wrap gap-2 justify-center pt-1">
                {CHIPS.map(chip => (
                  <motion.button
                    key={chip.label}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => send(chip.label)}
                    className="text-xs px-3 py-2 rounded-xl font-medium transition-colors"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.75)',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,212,170,0.4)';
                      (e.currentTarget as HTMLElement).style.color = '#00d4aa';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)';
                      (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.75)';
                    }}
                  >
                    {chip.icon} {chip.label}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
              >
                {msg.role === 'user' ? (
                  <div
                    className="max-w-[82%] px-4 py-3 rounded-2xl rounded-tr-sm text-sm text-white leading-relaxed"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    {msg.content}
                  </div>
                ) : (
                  <div
                    className="max-w-[88%] px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed"
                    style={{ background: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.2)', color: 'rgba(255,255,255,0.9)' }}
                  >
                    <div className="prose prose-invert prose-sm max-w-none">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {loading && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
              <div
                className="px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-2"
                style={{ background: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.2)' }}
              >
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#00d4aa' }} />
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>يحلل السوق...</span>
              </div>
            </motion.div>
          )}

          {chatError && (
            <div
              className="text-center text-xs py-2 px-4 rounded-xl mx-auto"
              style={{ background: 'rgba(255,61,90,0.1)', border: '1px solid rgba(255,61,90,0.2)', color: '#ff3d5a', maxWidth: 340 }}
            >
              ❌ {chatError}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div
          className="shrink-0 px-4 pb-4 pt-2"
          style={{ background: 'linear-gradient(to top, #111927 70%, transparent)' }}
        >
          <div
            className="flex items-end gap-2 px-4 py-3 rounded-2xl"
            style={{ background: '#0d1421', border: '1px solid rgba(99,179,237,0.15)', boxShadow: '0 0 20px rgba(0,0,0,0.3)' }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="اسأل عن أي سهم أو فرصة في السوق..."
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm text-white placeholder-white/30 leading-relaxed"
              style={{ maxHeight: 120, minHeight: 24, fontFamily: 'inherit', fontSize: 14 }}
              onInput={e => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl transition-all disabled:opacity-30"
              style={{ background: input.trim() && !loading ? '#00d4aa' : 'rgba(0,212,170,0.2)' }}
            >
              <Send className="w-4 h-4" style={{ color: input.trim() && !loading ? '#060b14' : '#00d4aa' }} />
            </button>
          </div>
          <p className="text-center text-[10px] mt-2" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Enter للإرسال · Shift+Enter سطر جديد
          </p>
        </div>
      </div>

      {/* ── Section 2: Report Settings ────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: '#111927', border: '1px solid rgba(0,212,170,0.15)', boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
      >
        {/* Collapsible header */}
        <button
          onClick={() => setSettingsOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 transition-colors hover:bg-white/[0.03]"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">⚙️</span>
            <div className="text-right">
              <div className="font-bold text-white text-sm">إعدادات التقارير التلقائية</div>
              <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                تخصيص التنبيهات والتقارير الدورية
              </div>
            </div>
          </div>
          <div
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
            style={{ background: 'rgba(0,212,170,0.1)', border: '1px solid rgba(0,212,170,0.2)' }}
          >
            {settingsOpen
              ? <ChevronUp className="w-4 h-4" style={{ color: '#00d4aa' }} />
              : <ChevronDown className="w-4 h-4" style={{ color: '#00d4aa' }} />
            }
          </div>
        </button>

        <AnimatePresence initial={false}>
          {settingsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              style={{ overflow: 'hidden', borderTop: '1px solid rgba(0,212,170,0.1)' }}
            >
              <div className="px-5 py-4 space-y-4">

                {/* Toggles */}
                <div>
                  <SettingsRow
                    label="تفعيل التقرير الصباحي"
                    subLabel="يُرسل 9:30 صباحاً قبل افتتاح السوق"
                    checked={settings.morningReport}
                    onChange={v => setSettings(s => ({ ...s, morningReport: v }))}
                  />
                  <SettingsRow
                    label="تنبيهات فورية عند الإشارات"
                    subLabel="إشعار لحظي عند تكوّن إشارة قوية"
                    checked={settings.instantAlerts}
                    onChange={v => setSettings(s => ({ ...s, instantAlerts: v }))}
                  />
                  <SettingsRow
                    label="ملخص أسبوعي كل خميس"
                    subLabel="تقرير شامل لأداء السوق أسبوعياً"
                    checked={settings.weeklyDigest}
                    onChange={v => setSettings(s => ({ ...s, weeklyDigest: v }))}
                  />
                </div>

                {/* Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      معرف تيليجرام أو رقم القناة
                    </label>
                    <input
                      type="text"
                      value={settings.telegramId}
                      onChange={e => setSettings(s => ({ ...s, telegramId: e.target.value }))}
                      placeholder="مثال: @mychannel أو -100123456"
                      dir="ltr"
                      className="w-full text-sm text-white outline-none rounded-xl px-3 py-2.5 placeholder-white/25 transition-colors"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        fontFamily: 'inherit',
                      }}
                      onFocus={e => (e.currentTarget.style.borderColor = 'rgba(0,212,170,0.5)')}
                      onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      البريد الإلكتروني
                    </label>
                    <input
                      type="email"
                      value={settings.email}
                      onChange={e => setSettings(s => ({ ...s, email: e.target.value }))}
                      placeholder="example@email.com"
                      dir="ltr"
                      className="w-full text-sm text-white outline-none rounded-xl px-3 py-2.5 placeholder-white/25 transition-colors"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        fontFamily: 'inherit',
                      }}
                      onFocus={e => (e.currentTarget.style.borderColor = 'rgba(0,212,170,0.5)')}
                      onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
                    />
                  </div>
                </div>

                {/* Stock multi-select */}
                <div className="space-y-2 pt-1">
                  <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    اختر أسهمك المفضلة للتنبيهات
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {STOCK_OPTIONS.map(stock => {
                      const selected = settings.watchedStocks.includes(stock.symbol);
                      return (
                        <button
                          key={stock.symbol}
                          onClick={() => toggleStock(stock.symbol)}
                          className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-all"
                          style={{
                            background: selected ? 'rgba(0,212,170,0.15)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${selected ? 'rgba(0,212,170,0.5)' : 'rgba(255,255,255,0.1)'}`,
                            color: selected ? '#00d4aa' : 'rgba(255,255,255,0.6)',
                          }}
                        >
                          {selected && '✓ '}{stock.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Save button */}
                <div className="pt-2">
                  <button
                    onClick={saveSettings}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all"
                    style={{
                      background: saveStatus === 'saved' ? 'rgba(0,212,170,0.15)' : '#00d4aa',
                      color: saveStatus === 'saved' ? '#00d4aa' : '#060b14',
                      border: saveStatus === 'saved' ? '1px solid rgba(0,212,170,0.4)' : 'none',
                    }}
                  >
                    {saveStatus === 'saved'
                      ? <><Check className="w-4 h-4" /> تم الحفظ</>
                      : <><Save className="w-4 h-4" /> 💾 حفظ الإعدادات</>
                    }
                  </button>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
