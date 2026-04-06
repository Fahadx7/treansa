import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : true;
  });
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggle = () => {
    setIsDark(v => !v);
    setSpinning(true);
    setTimeout(() => setSpinning(false), 400);
  };

  return (
    <button
      onClick={toggle}
      title={isDark ? 'الوضع الفاتح' : 'الوضع الداكن'}
      className="btn-icon"
      style={{ width: 34, height: 34, borderRadius: 8 }}
    >
      {isDark
        ? <Sun  className={`w-4 h-4 ${spinning ? 'theme-spin' : ''}`} style={{ color: 'rgba(255,255,255,0.5)' }} />
        : <Moon className={`w-4 h-4 ${spinning ? 'theme-spin' : ''}`} style={{ color: 'rgba(60,80,120,0.8)' }} />}
    </button>
  );
}
