import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { TASIChart } from './TASIChart';
import {
  TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight,
  RefreshCw, Filter,
  DollarSign, Star, Newspaper,
  Activity, BarChart3, Flame, Wallet, Eye,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

/* ═══════════════════════════════════════════
   بيانات تجريبية — استبدلها بجلب حقيقي
════════════════════════════════════════════ */
const MARKET_INDICES = [
  { name: 'تاسي',  value: '11,262.62', change: '+0.08%', up: true  },
  { name: 'نمو',   value: '928.19',    change: '-0.13%', up: false },
  { name: 'MTX30', value: '1,520.45',  change: '+0.45%', up: true  },
];

const TOP_GAINERS = [
  { symbol: 'مسك',      name: 'مسك',       price: 28.74, percent: 4.90 },
  { symbol: 'بتروبراغ', name: 'بتروبراغ',  price: 18.92, percent: 4.10 },
  { symbol: 'سلامكو',   name: 'سلامكو',    price: 11.63, percent: 3.93 },
  { symbol: 'كيميائل',  name: 'كيميائل',   price:  9.15, percent: 3.64 },
];

const TOP_LOSERS = [
  { symbol: 'عذيب',   name: 'عذيب',   price:  8.21, percent: -5.95 },
  { symbol: 'الباحة', name: 'الباحة', price: 29.30, percent: -3.96 },
  { symbol: 'أليف',   name: 'أليف',   price: 15.55, percent: -3.42 },
  { symbol: 'قمص',    name: 'قمص',    price: 14.78, percent: -3.21 },
];

const MOST_ACTIVE = [
  { symbol: 'أرامكو',    name: 'أرامكو السعودية', price: 27.85, volume: '45.2M', change:  0.25 },
  { symbol: 'الراجحي',   name: 'مصرف الراجحي',    price: 89.40, volume: '12.8M', change: -0.15 },
  { symbol: 'سابك',      name: 'سابك',             price: 82.60, volume: '8.5M',  change:  0.50 },
  { symbol: 'الاتصالات', name: 'اتصالات السعودية', price: 54.20, volume: '6.3M',  change: -0.30 },
];

const SECTORS = [
  { name: 'البنوك',      value: 35, color: '#00ff88' },
  { name: 'الطاقة',      value: 25, color: '#3b82f6' },
  { name: 'الصناعة',     value: 20, color: '#8b5cf6' },
  { name: 'الاتصالات',   value: 12, color: '#ffd700' },
  { name: 'أخرى',        value:  8, color: '#4b5563' },
];

const TASI_CHART = [
  { t: '09:30', v: 11180 }, { t: '10:00', v: 11200 },
  { t: '10:30', v: 11185 }, { t: '11:00', v: 11220 },
  { t: '11:30', v: 11240 }, { t: '12:00', v: 11230 },
  { t: '12:30', v: 11250 }, { t: '13:00', v: 11262 },
];

type TabKey = 'gainers' | 'losers' | 'active';

/* ═══════════════════════════════════════════
   Helper: رمز السهم (أوّل حرفين)
════════════════════════════════════════════ */
function StockAvatar({ symbol, variant }: { symbol: string; variant: 'up' | 'down' | 'blue' }) {
  const bg =
    variant === 'up'   ? 'from-[#00ff88]/80 to-teal-500'   :
    variant === 'down' ? 'from-[#ff4444]/80 to-rose-600'   :
                         'from-blue-500      to-cyan-600';
  return (
    <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${bg} flex items-center justify-center text-xs font-bold text-black shrink-0`}>
      {symbol.substring(0, 2)}
    </div>
  );
}

/* ═══════════════════════════════════════════
   المكوّن الرئيسي
════════════════════════════════════════════ */
export function StockDashboard() {
  const [tab, setTab] = useState<TabKey>('gainers');

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'gainers', label: 'الأكثر ارتفاعاً' },
    { key: 'losers',  label: 'الأكثر انخفاضاً' },
    { key: 'active',  label: 'الأكثر نشاطاً'   },
  ];

  /* ── بيانات التاب الحالي ── */
  const tabData = tab === 'gainers' ? TOP_GAINERS : tab === 'losers' ? TOP_LOSERS : MOST_ACTIVE;

  return (
    <div className="space-y-5 rtl" dir="rtl">

      {/* ════════════ HERO ════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#064e3b] via-[#115e59] to-[#0e7490] p-6 md:p-10"
      >
        {/* طبقة ظل */}
        <div className="absolute inset-0 bg-black/15 pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-8">

          {/* نص ────────────────── */}
          <div className="flex-1 space-y-4">
            <div className="inline-flex items-center gap-1.5 bg-white/15 rounded-full px-3 py-1 text-xs text-white">
              <Flame className="w-3 h-3" /> تحديث مباشر
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white">
              مرحباً في منصة تريندسا! 👋
            </h1>
            <p className="text-white/80 text-base md:text-lg">
              تابع السوق لحظة بلحظة واتخذ قرارات استثمارية ذكية
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/portfolio">
                <button className="flex items-center gap-2 bg-white text-[#059669] font-bold px-5 py-2.5 rounded-xl text-sm shadow-xl hover:bg-white/90 transition">
                  <Wallet className="w-4 h-4" /> محفظتي
                </button>
              </Link>
              <Link to="/watchlist">
                <button className="flex items-center gap-2 bg-white/10 text-white border border-white/25 px-5 py-2.5 rounded-xl text-sm hover:bg-white/20 transition">
                  <Eye className="w-4 h-4" /> قائمة المراقبة
                </button>
              </Link>
            </div>
          </div>

          {/* Mini chart TASI ────── */}
          <div className="hidden lg:block w-72 h-40 bg-white/10 backdrop-blur border border-white/15 rounded-2xl p-4 shrink-0">
            <p className="text-white/60 text-xs mb-2">تاسي اليوم</p>
            <ResponsiveContainer width="100%" height="85%">
              <AreaChart data={TASI_CHART} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#00ff88" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#00ff88" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke="#00ff88" strokeWidth={2} fill="url(#heroGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </motion.div>

      {/* ════════════ TASI CHART ════════════ */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <TASIChart />
      </motion.div>

      {/* ════════════ MARKET INDICES ════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {MARKET_INDICES.map((idx, i) => (
          <motion.div
            key={idx.name}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 + 0.2 }}
          >
            <div className="bg-[#1a1a2e] border border-white/[0.07] rounded-2xl p-5 hover:border-[#00ff88]/30 transition-all duration-300">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-gray-400 text-xs mb-1.5">{idx.name}</p>
                  <p className="text-2xl font-bold tracking-tight ltr">{idx.value}</p>
                  <p className={`flex items-center gap-1 text-sm mt-2 ltr ${idx.up ? 'text-[#00ff88]' : 'text-[#ff4444]'}`}>
                    {idx.up ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    {idx.change}
                    <span className="text-gray-500 text-xs mr-1">اليوم</span>
                  </p>
                </div>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${idx.up ? 'bg-[#00ff88]/10' : 'bg-[#ff4444]/10'}`}>
                  {idx.up
                    ? <TrendingUp  className="w-5 h-5 text-[#00ff88]" />
                    : <TrendingDown className="w-5 h-5 text-[#ff4444]" />}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ════════════ MAIN GRID ════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Market Movers (Tabs) ── */}
        <motion.div
          className="lg:col-span-2"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <div className="bg-[#1a1a2e] border border-white/[0.07] rounded-2xl overflow-hidden">
            {/* header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#00ff88]">
                <Activity className="w-4 h-4" />
                حركة السوق
              </div>
              <div className="flex gap-1">
                <button className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.05] transition">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.05] transition">
                  <Filter className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Tab bar */}
            <div className="flex bg-black/20 mx-4 mt-4 rounded-xl p-1">
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                    tab === t.key
                      ? 'bg-[#1a1a2e] text-white shadow'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Stock rows */}
            <div className="p-4 space-y-2">
              {tabData.map((stock: any, i: number) => {
                const up = (stock.percent ?? stock.change) >= 0;
                return (
                  <Link key={stock.symbol} to={`/stock/${stock.symbol}`}>
                    <motion.div
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                      className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-white/[0.04] transition cursor-pointer group"
                    >
                      <div className="flex items-center gap-3">
                        <StockAvatar
                          symbol={stock.symbol}
                          variant={tab === 'active' ? 'blue' : up ? 'up' : 'down'}
                        />
                        <div>
                          <p className="text-sm font-semibold group-hover:text-[#00ff88] transition">
                            {stock.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {tab === 'active' ? `حجم: ${stock.volume}` : stock.symbol}
                          </p>
                        </div>
                      </div>
                      <div className="text-left ltr">
                        <p className="text-sm font-bold">{stock.price.toFixed(2)}</p>
                        <p className={`text-xs flex items-center gap-0.5 justify-end ${up ? 'text-[#00ff88]' : 'text-[#ff4444]'}`}>
                          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {Math.abs(stock.percent ?? stock.change).toFixed(2)}%
                        </p>
                      </div>
                    </motion.div>
                  </Link>
                );
              })}
            </div>
          </div>
        </motion.div>

        {/* ── Sidebar ── */}
        <div className="flex flex-col gap-5">

          {/* Sector Donut */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.55 }}
            className="bg-[#1a1a2e] border border-white/[0.07] rounded-2xl overflow-hidden"
          >
            <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.05] text-sm font-semibold text-[#00ff88]">
              <BarChart3 className="w-4 h-4" /> أداء القطاعات
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={SECTORS}
                    cx="50%" cy="50%"
                    innerRadius={52} outerRadius={72}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {SECTORS.map((s, i) => (
                      <Cell key={i} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12 }}
                    formatter={(v: number) => [`${v}%`, '']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-1">
                {SECTORS.map(s => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className="text-gray-400">{s.name}</span>
                    </div>
                    <span className="font-semibold text-white">{s.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Market Insights */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.65 }}
            className="bg-gradient-to-br from-[#064e3b]/60 to-[#115e59]/60 border border-[#00ff88]/20 rounded-2xl p-4"
          >
            <p className="text-[#00ff88] text-sm font-semibold mb-3">💡 رؤى السوق</p>
            {[
              { icon: '📈', text: 'القطاع البنكي يتصدر بـ', em: '+2.3%' },
              { icon: '🔥', text: 'حجم التداول:', em: '8.5 مليار ريال' },
              { icon: '⚡', text: '', em: '15 سهم', after: 'بأعلى مستوى في 52 أسبوع' },
            ].map((ins, i) => (
              <div key={i} className="bg-white/5 rounded-xl px-3 py-2.5 mb-2 last:mb-0 text-xs leading-relaxed">
                {ins.icon} {ins.text}{' '}
                <span className="text-[#00ff88] font-bold">{ins.em}</span>
                {ins.after && ` ${ins.after}`}
              </div>
            ))}
          </motion.div>

          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.75 }}
            className="bg-[#1a1a2e] border border-white/[0.07] rounded-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-white/[0.05] text-sm font-semibold">
              إجراءات سريعة
            </div>
            <div className="p-3 space-y-2">
              {[
                { to: '/portfolio', icon: DollarSign, label: 'عرض المحفظة'     },
                { to: '/watchlist', icon: Star,        label: 'إضافة للمراقبة' },
                { to: '/news',      icon: Newspaper,   label: 'آخر الأخبار'    },
              ].map(a => (
                <Link key={a.to} to={a.to}>
                  <button className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-gray-300 text-sm hover:bg-white/[0.07] hover:text-white transition">
                    <a.icon className="w-4 h-4 text-[#00ff88]" />
                    {a.label}
                  </button>
                </Link>
              ))}
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
