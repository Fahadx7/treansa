/**
 * كاشف النماذج الفنية للشارت
 * يعمل على مصفوفة أسعار الإغلاق
 */

/** إيجاد القمم المحلية */
function findPeaks(prices, window = 3) {
  const peaks = [];
  for (let i = window; i < prices.length - window; i++) {
    const left  = prices.slice(i - window, i);
    const right = prices.slice(i + 1, i + window + 1);
    if (prices[i] > Math.max(...left) && prices[i] > Math.max(...right)) {
      peaks.push({ index: i, price: prices[i] });
    }
  }
  return peaks;
}

/** إيجاد القيعان المحلية */
function findTroughs(prices, window = 3) {
  const troughs = [];
  for (let i = window; i < prices.length - window; i++) {
    const left  = prices.slice(i - window, i);
    const right = prices.slice(i + 1, i + window + 1);
    if (prices[i] < Math.min(...left) && prices[i] < Math.min(...right)) {
      troughs.push({ index: i, price: prices[i] });
    }
  }
  return troughs;
}

/** قمة مزدوجة */
function detectDoubleTop(prices) {
  const peaks = findPeaks(prices, 4);
  if (peaks.length < 2) return null;
  const [p1, p2] = peaks.slice(-2);
  const priceDiff = Math.abs(p1.price - p2.price) / p1.price;
  const gapEnough = (p2.index - p1.index) >= 5;
  if (priceDiff < 0.03 && gapEnough) {
    return {
      name: 'قمة مزدوجة',
      nameEn: 'Double Top',
      bias: 'bearish',
      confidence: Math.round(70 + (1 - priceDiff / 0.03) * 15),
      note: 'السعر اختبر نفس المقاومة مرتين وفشل في الاختراق — إشارة هبوطية.',
      invalidation: `اختراق وإغلاق فوق ${Math.max(p1.price, p2.price).toFixed(2)}`,
      emoji: '🔻',
    };
  }
  return null;
}

/** قاع مزدوج */
function detectDoubleBottom(prices) {
  const troughs = findTroughs(prices, 4);
  if (troughs.length < 2) return null;
  const [t1, t2] = troughs.slice(-2);
  const priceDiff = Math.abs(t1.price - t2.price) / t1.price;
  const gapEnough = (t2.index - t1.index) >= 5;
  if (priceDiff < 0.03 && gapEnough) {
    return {
      name: 'قاع مزدوج',
      nameEn: 'Double Bottom',
      bias: 'bullish',
      confidence: Math.round(70 + (1 - priceDiff / 0.03) * 15),
      note: 'السعر دعمته نفس المنطقة مرتين — إشارة صعودية للارتداد.',
      invalidation: `كسر وإغلاق تحت ${Math.min(t1.price, t2.price).toFixed(2)}`,
      emoji: '🔺',
    };
  }
  return null;
}

/** رأس وكتفين */
function detectHeadAndShoulders(prices) {
  const peaks = findPeaks(prices, 3);
  if (peaks.length < 3) return null;
  const [left, head, right] = peaks.slice(-3);
  const isHead = head.price > left.price * 1.02 && head.price > right.price * 1.02;
  const shouldersMatch = Math.abs(left.price - right.price) / left.price < 0.04;
  if (isHead && shouldersMatch) {
    return {
      name: 'رأس وكتفين',
      nameEn: 'Head & Shoulders',
      bias: 'bearish',
      confidence: Math.round(72 + shouldersMatch * 10),
      note: 'نموذج انعكاسي هبوطي كلاسيكي — الكتف الأيمن أكمل النموذج.',
      invalidation: `صعود فوق الرأس ${head.price.toFixed(2)}`,
      emoji: '👤',
    };
  }
  return null;
}

/** مثلث متماثل */
function detectSymmetricalTriangle(prices) {
  if (prices.length < 15) return null;
  const recent = prices.slice(-15);
  const peaks   = findPeaks(recent, 2);
  const troughs = findTroughs(recent, 2);
  if (peaks.length < 2 || troughs.length < 2) return null;
  const [p1, p2] = peaks.slice(-2);
  const [t1, t2] = troughs.slice(-2);
  const topDescending    = p2.price < p1.price * 0.99;
  const bottomAscending  = t2.price > t1.price * 1.01;
  if (topDescending && bottomAscending) {
    return {
      name: 'مثلث متماثل',
      nameEn: 'Symmetrical Triangle',
      bias: 'neutral',
      confidence: 65,
      note: 'انضغاط سعري بين دعم صاعد ومقاومة هابطة — ترقب اختراق اتجاهي.',
      invalidation: 'اختراق حد المثلث في أي اتجاه',
      emoji: '🔷',
    };
  }
  return null;
}

/** كوب وعروة */
function detectCupAndHandle(prices) {
  if (prices.length < 20) return null;
  const n      = prices.length;
  const mid    = Math.floor(n / 2);
  const left   = prices.slice(0, mid);
  const right  = prices.slice(mid);
  const leftMax  = Math.max(...left);
  const rightMax = Math.max(...right);
  const cupMin   = Math.min(...prices);
  const depth    = (Math.min(leftMax, rightMax) - cupMin) / Math.min(leftMax, rightMax);
  const sidesMatch = Math.abs(leftMax - rightMax) / leftMax < 0.05;
  const lastHandle = prices.slice(-5);
  const handleDip  = (rightMax - Math.min(...lastHandle)) / rightMax;
  if (depth > 0.08 && depth < 0.35 && sidesMatch && handleDip < 0.08) {
    return {
      name: 'كوب وعروة',
      nameEn: 'Cup & Handle',
      bias: 'bullish',
      confidence: Math.round(68 + (1 - handleDip / 0.08) * 12),
      note: 'نموذج صعودي — الكوب اكتمل والعروة تمثل فرصة دخول قبل الاختراق.',
      invalidation: `كسر قاع العروة ${Math.min(...lastHandle).toFixed(2)}`,
      emoji: '☕',
    };
  }
  return null;
}

/**
 * الدالة الرئيسية — تشغّل كل المكتشفات وتعيد النتائج مرتبة بالثقة
 * @param {number[]} prices - مصفوفة أسعار الإغلاق
 * @returns {{ name, nameEn, bias, confidence, note, invalidation, emoji }[]}
 */
export function detectPatterns(prices) {
  if (!Array.isArray(prices) || prices.length < 10) return [];
  const clean = prices.filter(p => typeof p === 'number' && !Number.isNaN(p) && p > 0);
  if (clean.length < 10) return [];

  const detectors = [
    detectDoubleTop,
    detectDoubleBottom,
    detectHeadAndShoulders,
    detectSymmetricalTriangle,
    detectCupAndHandle,
  ];

  return detectors
    .map(fn => { try { return fn(clean); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);
}

/** ألوان الـ bias */
export const BIAS_COLORS = {
  bullish: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', text: 'text-emerald-400', badge: 'صاعد' },
  bearish: { bg: 'bg-rose-500/10',    border: 'border-rose-500/25',    text: 'text-rose-400',    badge: 'هابط' },
  neutral: { bg: 'bg-amber-500/10',   border: 'border-amber-500/25',   text: 'text-amber-400',   badge: 'محايد' },
};
