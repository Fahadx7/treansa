import React from 'react';
import { FixedSizeList } from 'react-window';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  MessageSquare, 
  User, 
  Moon, 
  Search 
} from 'lucide-react';

const AutoSizer = ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height: '100%', minHeight: '300px' }}>
      {size.width > 0 && children(size)}
    </div>
  );
};

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="p-4 border-b dark:border-zinc-800 flex justify-between items-center bg-white dark:bg-zinc-900">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-blue-500" />
          Trandsa AI
        </h1>
        <div className="flex gap-4">
          <Moon className="w-5 h-5 cursor-pointer" />
          <User className="w-5 h-5 cursor-pointer" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border dark:border-zinc-800 h-[500px] overflow-hidden">
          <AutoSizer>
            {({ width, height }) => (
              <FixedSizeList
                height={height}
                itemCount={50}
                itemSize={60}
                width={width}
              >
                {({ index, style }) => (
                  <div style={style} className="px-4 border-b dark:border-zinc-800 flex items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-blue-600">AI Assistant</span>
                      <span className="text-sm text-zinc-500">تحليل السوق للرسالة رقم {index + 1}...</span>
                    </div>
                  </div>
                )}
              </FixedSizeList>
            )}
          </AutoSizer>
        </div>

        <div className="mt-4 flex gap-2">
          <input 
            type="text" 
            placeholder="اسأل رادار السوق السعودي..."
            className="flex-1 p-4 rounded-xl border dark:border-zinc-800 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 rounded-xl transition-all shadow-lg shadow-blue-500/20">
            <Send className="w-5 h-5" />
          </button>
        </div>
      </main>
    </div>
  );
}
