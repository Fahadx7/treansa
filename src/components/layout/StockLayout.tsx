import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp, Wallet, Eye, Newspaper,
  Bell, Search, Menu, X, Moon, Sun, User, LogOut,
  BarChart3, Brain, Zap,
} from 'lucide-react';
import { auth, loginWithGoogle, logout, onAuthStateChanged } from '../../firebase';
import type { User as FirebaseUser } from 'firebase/auth';

/* ─── ثابت: بيانات الـ ticker (استبدلها ببيانات حقيقية لاحقاً) ─── */
const TICKER_DATA = [
  { label: 'تاسي',  value: '11,262.62', change: '+0.08%', up: true  },
  { label: 'نمو',   value: '928.19',    change: '-0.13%', up: false },
  { label: 'MTX30', value: '1,520.45',  change: '+0.45%', up: true  },
];

const NAV_ITEMS = [
  { path: '/',             label: 'السوق',           icon: TrendingUp },
  { path: '/radar',        label: 'لوحة التداول',    icon: BarChart3  },
  { path: '/ai-advisor',   label: 'المستشار الذكي',  icon: Brain      },
  { path: '/intelligence', label: 'محرك الاستخبارات', icon: Zap       },
];

interface StockLayoutProps {
  children: ReactNode;
  marketOpen?: boolean;
}

export function StockLayout({ children, marketOpen = true }: StockLayoutProps) {
  const location          = useLocation();
  const [dark, setDark]   = useState(true);
  const [menu, setMenu]   = useState(false);
  const [user, setUser]   = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u));
    return unsub;
  }, []);

  const handleAuth = async () => {
    if (user) {
      await logout();
    } else {
      try {
        setAuthLoading(true);
        await loginWithGoogle();
      } finally {
        setAuthLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-['Tajawal',sans-serif] direction-rtl">

      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#0a0a0f]/95 backdrop-blur-lg">

        {/* ── Ticker Bar ── */}
        <div className="border-b border-white/[0.05] px-4 flex items-center justify-between h-9 text-xs">
          <div className="flex items-center gap-5">
            {/* نبضة السوق */}
            <div className="flex items-center gap-2 text-gray-400">
              <span className={`w-2 h-2 rounded-full ${marketOpen ? 'bg-[#00ff88] animate-pulse' : 'bg-red-500'}`} />
              <span>{marketOpen ? 'السوق مفتوح' : 'السوق مغلق'}</span>
            </div>
            {/* الأرقام */}
            {TICKER_DATA.map(t => (
              <span key={t.label} className="hidden md:inline text-gray-400">
                {t.label}:{' '}
                <span className={t.up ? 'text-[#00ff88] font-semibold' : 'text-[#ff4444] font-semibold'}>
                  {t.value} {t.change}
                </span>
              </span>
            ))}
          </div>
          <span className="text-gray-500">
            {new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </div>

        {/* ── Main Nav Row ── */}
        <div className="px-4 flex items-center justify-between h-14 gap-4">

          {/* شعار */}
          <Link to="/" className="flex items-center gap-3 shrink-0">
            <div className="relative w-9 h-9 bg-gradient-to-br from-[#00ff88] to-[#0d9488] rounded-xl flex items-center justify-center shadow-lg shadow-[#00ff88]/20">
              <TrendingUp className="w-5 h-5 text-black" />
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[#00ff88] rounded-full animate-pulse border-2 border-[#0a0a0f]" />
            </div>
            <div>
              <p className="text-base font-bold bg-gradient-to-l from-[#00ff88] to-teal-400 bg-clip-text text-transparent leading-none">
                تريندسا
              </p>
              <p className="text-[10px] text-gray-500 leading-none mt-0.5">منصة التداول الذكي</p>
            </div>
          </Link>

          {/* بحث — desktop */}
          <div className="hidden lg:flex flex-1 max-w-sm relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              placeholder="ابحث عن سهم أو رمز..."
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pr-9 pl-4 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#00ff88]/40 transition text-right"
            />
          </div>

          {/* Nav links — desktop */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map(item => {
              const Icon   = item.icon;
              const active = location.pathname === item.path;
              return (
                <Link key={item.path} to={item.path}>
                  <button
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? 'bg-gradient-to-l from-[#00ff88]/20 to-teal-500/10 text-[#00ff88] border border-[#00ff88]/20'
                        : 'text-gray-400 hover:text-white hover:bg-white/[0.05]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </button>
                </Link>
              );
            })}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button className="relative w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.05] transition">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#ff4444] rounded-full" />
            </button>
            <button
              onClick={() => setDark(!dark)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.05] transition"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={handleAuth}
              disabled={authLoading}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.05] transition text-sm disabled:opacity-50"
              title={user ? 'تسجيل الخروج' : 'دخول'}
            >
              {user?.photoURL
                ? <img src={user.photoURL} className="w-6 h-6 rounded-full" alt="avatar" />
                : <User className="w-4 h-4" />}
              <span className="hidden sm:inline">{user ? user.displayName?.split(' ')[0] : 'دخول'}</span>
              {user && <LogOut className="w-3.5 h-3.5 opacity-60" />}
            </button>
            {/* Mobile menu toggle */}
            <button
              className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.05] transition"
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* ── Mobile menu ── */}
        <AnimatePresence>
          {menu && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="md:hidden border-t border-white/[0.05] bg-[#0d0d14] overflow-hidden"
            >
              <div className="px-4 py-4 space-y-2">
                <div className="relative mb-4">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                  <input
                    placeholder="ابحث عن سهم..."
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pr-9 pl-4 py-2.5 text-sm placeholder:text-gray-600 focus:outline-none text-right"
                  />
                </div>
                {NAV_ITEMS.map(item => {
                  const Icon   = item.icon;
                  const active = location.pathname === item.path;
                  return (
                    <Link key={item.path} to={item.path} onClick={() => setMenu(false)}>
                      <button
                        className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-right transition ${
                          active
                            ? 'bg-[#00ff88]/10 text-[#00ff88]'
                            : 'text-gray-400 hover:bg-white/[0.05] hover:text-white'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {item.label}
                      </button>
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ═══ CONTENT ═══ */}
      <main className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
        {children}
      </main>

      {/* ═══ FOOTER ═══ */}
      <footer className="mt-16 border-t border-white/[0.05] bg-[#0d0d14]">
        <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-gray-500 max-w-7xl mx-auto">
          <p>© 2026 تريندسا — منصة التداول الذكي | جميع الحقوق محفوظة</p>
          <div className="flex gap-5">
            {['الشروط والأحكام', 'سياسة الخصوصية', 'الدعم'].map(t => (
              <a key={t} href="#" className="hover:text-[#00ff88] transition">{t}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
