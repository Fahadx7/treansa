import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark';
  });
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = () => {
    setSpinning(true);
    setTheme(t => t === 'dark' ? 'light' : 'dark');
    setTimeout(() => setSpinning(false), 400);
  };

  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'التحويل للثيم الفاتح' : 'التحويل للثيم الداكن'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '34px',
        height: '34px',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        background: 'transparent',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: '16px',
        transition: 'all 0.15s',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.background = 'var(--bg-hover)';
        btn.style.color = 'var(--text)';
        btn.style.borderColor = 'var(--border-strong)';
      }}
      onMouseLeave={e => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-muted)';
        btn.style.borderColor = 'var(--border)';
      }}
    >
      <span className={spinning ? 'theme-spin' : ''} style={{ display: 'flex' }}>
        {theme === 'dark' ? '🌞' : '🌙'}
      </span>
    </button>
  );
}
