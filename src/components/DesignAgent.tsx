import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Send, Loader2, Sparkles, Copy, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const CHIPS = [
  'حسّن تصميم كارت السهم',
  'أفضل ألوان للإشارات الصاعدة والهابطة',
  'كيف أجعل الأرقام أوضح في الداركمود؟',
  'تصميم modal احترافي للتحليل الفني',
  'أنيمشن لتحديث البيانات في الوقت الفعلي',
  'تحسين تجربة الموبايل لجدول الأسهم',
  'تصميم header متجاوب لمنصة التداول',
  'أفضل طريقة لعرض RSI وMACD بصرياً',
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={handle} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10" title="نسخ">
      {copied ? <Check className="w-3.5 h-3.5 text-[#00d4aa]" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
    </button>
  );
}

export default function DesignAgent() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    setError(null);

    try {
      const res = await fetch('/api/design-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setMessages([...next, { role: 'assistant', content: data.reply }]);
    } catch (e: any) {
      setError(e.message || 'فشل الاتصال');
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div
      dir="rtl"
      className="min-h-screen flex flex-col"
      style={{ background: '#060b14', fontFamily: "'IBM Plex Sans Arabic', 'Tajawal', sans-serif" }}
    >
      {/* Header */}
      <header
        style={{
          background: 'linear-gradient(135deg, #0a0e1a 0%, #0d1528 100%)',
          borderBottom: '1px solid rgba(99,179,237,0.12)',
          boxShadow: '0 1px 20px rgba(0,0,0,0.4)',
        }}
        className="sticky top-0 z-10 px-4 h-14 flex items-center gap-3"
      >
        <button
          onClick={() => navigate('/')}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-white/10"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <ArrowRight className="w-4 h-4 text-white/60" />
        </button>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg"
            style={{ background: 'rgba(0,212,170,0.15)', border: '1px solid rgba(0,212,170,0.3)' }}
          >
            <Sparkles className="w-4 h-4" style={{ color: '#00d4aa' }} />
          </div>
          <div>
            <div className="font-bold text-white text-sm leading-tight">Design Agent</div>
            <div className="text-[10px]" style={{ color: '#4a9eff' }}>مساعد تصميم ترندسا</div>
          </div>
        </div>
        <div className="mr-auto">
          <span
            className="text-[10px] font-semibold px-2 py-1 rounded-full"
            style={{ background: 'rgba(0,212,170,0.1)', border: '1px solid rgba(0,212,170,0.2)', color: '#00d4aa' }}
          >
            claude haiku
          </span>
        </div>
      </header>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-3xl w-full mx-auto">
        {/* Welcome screen */}
        {isEmpty && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center text-center pt-12 pb-8 space-y-4"
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2"
              style={{ background: 'rgba(0,212,170,0.12)', border: '1px solid rgba(0,212,170,0.25)', boxShadow: '0 0 32px rgba(0,212,170,0.15)' }}
            >
              <Sparkles className="w-8 h-8" style={{ color: '#00d4aa' }} />
            </div>
            <h1 className="text-2xl font-bold text-white">مساعد التصميم الذكي</h1>
            <p className="text-sm max-w-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
              اسألني عن تحسينات UI/UX لمنصة ترندسا — سأقدم كود Tailwind وتوصيات دقيقة جاهزة للتطبيق
            </p>
          </motion.div>
        )}

        {/* Quick chips */}
        {isEmpty && (
          <div className="flex flex-wrap gap-2 justify-center mb-8">
            {CHIPS.map(chip => (
              <motion.button
                key={chip}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => send(chip)}
                className="text-xs font-medium px-3 py-2 rounded-xl transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.75)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,212,170,0.4)';
                  (e.currentTarget as HTMLButtonElement).style.color = '#00d4aa';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.1)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.75)';
                }}
              >
                {chip}
              </motion.button>
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
              >
                {msg.role === 'user' ? (
                  <div
                    className="max-w-[80%] px-4 py-3 rounded-2xl rounded-tr-sm text-sm text-white"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    {msg.content}
                  </div>
                ) : (
                  <div
                    className="group max-w-[90%] px-4 py-3 rounded-2xl rounded-tl-sm text-sm relative"
                    style={{ background: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.2)', color: 'rgba(255,255,255,0.9)' }}
                  >
                    <div className="absolute top-2 left-2">
                      <CopyButton text={msg.content} />
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none leading-relaxed">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Loading bubble */}
          {loading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-end"
            >
              <div
                className="px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-2"
                style={{ background: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.2)' }}
              >
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#00d4aa' }} />
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>جاري التفكير...</span>
              </div>
            </motion.div>
          )}

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-xs py-2 px-4 rounded-xl mx-auto"
              style={{ background: 'rgba(255,61,90,0.1)', border: '1px solid rgba(255,61,90,0.2)', color: '#ff3d5a', maxWidth: 360 }}
            >
              ❌ {error}
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div
        className="sticky bottom-0 px-4 pb-safe"
        style={{ background: 'linear-gradient(to top, #060b14 70%, transparent)', paddingBottom: 20, paddingTop: 12 }}
      >
        <div className="max-w-3xl mx-auto">
          <div
            className="flex items-end gap-2 px-4 py-3 rounded-2xl"
            style={{ background: '#0d1421', border: '1px solid rgba(99,179,237,0.15)', boxShadow: '0 0 24px rgba(0,0,0,0.4)' }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="اسأل عن أي تحسين تصميمي..."
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm text-white placeholder-white/30 leading-relaxed"
              style={{ maxHeight: 120, minHeight: 24, fontFamily: 'inherit' }}
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
            Enter للإرسال · Shift+Enter لسطر جديد
          </p>
        </div>
      </div>
    </div>
  );
}
