import React from 'react';
import { FixedSizeList } from 'react-window';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  MessageSquare, 
  Star, 
  User, 
  Moon, 
  Newspaper, 
  Search, 
  List as ListIcon, 
  Maximize2, 
  Minimize2 
} from 'lucide-react';

// استيراد المكونات الأخرى إذا كانت موجودة في مشروعك
// import AIAdvisor from './pages/AIAdvisor';
// import IntelligenceEngine from './pages/IntelligenceEngine';

/**
 * مكون AutoSizer بسيط لحساب أبعاد الحاوية تلقائياً
 */
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
    <div ref={ref} style={{ width: '100%', height: '100%', minHeight: '200px' }}>
      {size.width > 0 && children(size)}
    </div>
  );
};

function App() {
  // هنا تضع المنطق الخاص بك (State, Messages, etc.)
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* الهيدر أو القائمة الجانبية */}
      <header className="p-4 border-b dark:border-zinc-800 flex justify-between items-center">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-blue-500" />
          Trandsa AI
        </h1>
        <div className="flex gap-4">
          <Moon className="w-5 h-5 cursor-pointer" />
          <User className="w-5 h-5 cursor-pointer" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 h-[calc(100-80px)]">
        {/* مثال لاستخدام FixedSizeList التي كانت تسبب الخطأ */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border dark:border-zinc-800 h-[500px]">
          <AutoSizer>
            {({ width, height }) => (
              <FixedSizeList
                height={height}
                itemCount={100}
                itemSize={50}
                width={width}
              >
                {({ index, style }) => (
                  <div style={style} className="px-4 border-b dark:border-zinc-800 flex items-center">
                    Message #{index + 1} from AI Assistant
                  </div>
                )}
              </FixedSizeList>
            )}
          </AutoSizer>
        </div>

        {/* منطقة إدخال النص */}
        <div className="mt-4 flex gap-2">
          <input 
            type="text" 
            placeholder="اسأل رادار السوق السعودي..."
            className="flex-1 p-3 rounded-lg border dark:border-zinc-800 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg transition-colors">
            <Send className="w-5 h-5" />
          </button>
        </div>
      </main>
    </div>
  );
}

export default App;