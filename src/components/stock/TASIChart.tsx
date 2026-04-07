import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';

/* ─── Types ─── */
interface Quote    { date: string; close: number }
interface TASIData { price: number; change: number; changePercent: number; high: number; low: number }

type Range = '1d' | '1w' | '1mo' | '6mo' | '1y';

const RANGES: { key: Range; label: string }[] = [
  { key: '1d',  label: 'اليوم'  },
  { key: '1w',  label: 'أسبوع'  },
  { key: '1mo', label: 'شهر'    },
  { key: '6mo', label: '٣ أشهر' },
  { key: '1y',  label: 'سنة'    },
];

/* ─── Custom Tooltip ─── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const value: number = payload[0].value;
  return (
    <div className="bg-[#12122a] border border-white/10 rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-0.5">{label}</p>
      <p className="font-bold text-white text-sm">{value.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}</p>
    </div>
  );
}

/* ─── Format X-axis label based on range ─── */
function formatX(dateStr: string, range: Range): string {
  const d = new Date(dateStr);
  if (range === '1d') return d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (range === '1w') return d.toLocaleDateString('ar-SA', { weekday: 'short' });
  if (range === '1y') return d.toLocaleDateString('ar-SA', { month: 'short' });
  return d.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
}

/* ─── Main Component ─── */
export function TASIChart() {
  const [range, setRange]     = useState<Range>('1d');
  const [quotes, setQuotes]   = useState<Quote[]>([]);
  const [tasi, setTasi]       = useState<TASIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [chartRes, tasiRes] = await Promise.all([
        fetch(`/api/stock-chart?symbol=%5ETASI&range=${range}`),
        fetch('/api/tasi-index'),
      ]);
      const chartJson = await chartRes.json();
      const tasiJson  = await tasiRes.json();

      if (chartJson.success && chartJson.quotes?.length) {
        setQuotes(
          chartJson.quotes
            .filter((q: any) => q.close > 0)
            .map((q: any) => ({ date: q.date, close: q.close }))
        );
      } else {
        setError('تعذّر جلب بيانات الشارت');
      }
      if (tasiJson.success) setTasi(tasiJson);
    } catch {
      setError('تعذّر جلب بيانات الشارت');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const up    = (tasi?.change ?? 0) >= 0;
  const color = up ? '#00ff88' : '#ff4444';
  const minVal = quotes.length ? Math.min(...quotes.map(q => q.close)) * 0.9995 : 0;
  const maxVal = quotes.length ? Math.max(...quotes.map(q => q.close)) * 1.0005 : 0;
  const tickInterval = quotes.length > 60 ? Math.floor(quotes.length / 8) : 'preserveStartEnd';

  return (
    <div className="bg-[#1a1a2e] border border-white/[0.07] rounded-2xl overflow-hidden">

      {/* ── Header ── */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-4">

          {/* Price block */}
          <div>
            <p className="text-xs text-gray-500 mb-1">المؤشر العام — تاسي</p>
            {tasi ? (
              <motion.div key={tasi.price} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                <p className="text-3xl font-bold tracking-tight ltr text-white">
                  {tasi.price.toLocaleString('en-SA', { minimumFractionDigits: 2 })}
                </p>
                <div className={`flex items-center gap-1.5 mt-1 text-sm font-semibold ltr ${up ? 'text-[#00ff88]' : 'text-[#ff4444]'}`}>
                  {up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  <span>{up ? '+' : ''}{tasi.change.toFixed(2)}</span>
                  <span className="opacity-70">({up ? '+' : ''}{tasi.changePercent.toFixed(2)}%)</span>
                </div>
              </motion.div>
            ) : (
              <div className="h-10 w-48 bg-white/5 rounded-lg animate-pulse" />
            )}
          </div>

          {/* High / Low + Refresh */}
          <div className="flex items-center gap-4">
            {tasi && (
              <div className="text-xs text-right hidden sm:block">
                <div className="text-gray-500 mb-0.5">أعلى / أدنى</div>
                <div className="ltr font-mono font-semibold text-gray-300">
                  {tasi.high.toLocaleString('en-SA', { minimumFractionDigits: 2 })}
                  <span className="text-gray-600 mx-1">/</span>
                  {tasi.low.toLocaleString('en-SA', { minimumFractionDigits: 2 })}
                </div>
              </div>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.05] transition disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* ── Range buttons ── */}
        <div className="flex gap-1 mt-4">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                range === r.key
                  ? 'text-black font-bold'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'
              }`}
              style={range === r.key ? { background: color } : {}}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chart ── */}
      <div className="px-2 pb-4" style={{ height: 280 }}>
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="h-full flex items-center justify-center"
            >
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="w-5 h-5 text-gray-600 animate-spin" />
                <p className="text-xs text-gray-600">جاري تحميل الشارت...</p>
              </div>
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="h-full flex items-center justify-center"
            >
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-2">{error}</p>
                <button onClick={fetchData} className="text-xs text-[#00ff88] hover:underline">إعادة المحاولة</button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={range}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="h-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={quotes} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`tasiGrad-${up ? 'up' : 'dn'}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={color} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={color} stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={v => formatX(v, range)}
                    tick={{ fill: '#4b5563', fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    interval={tickInterval}
                  />
                  <YAxis
                    domain={[minVal, maxVal]}
                    tickFormatter={v => v.toLocaleString('en', { maximumFractionDigits: 0 })}
                    tick={{ fill: '#4b5563', fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    width={58} orientation="left"
                  />
                  <Tooltip content={<ChartTooltip />} />
                  {quotes[0] && (
                    <ReferenceLine y={quotes[0].close} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
                  )}
                  <Area
                    type="monotone" dataKey="close"
                    stroke={color} strokeWidth={2}
                    fill={`url(#tasiGrad-${up ? 'up' : 'dn'})`}
                    dot={false}
                    activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
                    isAnimationActive={true} animationDuration={600}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
