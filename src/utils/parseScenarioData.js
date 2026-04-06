// ✅ FIX: raw.slice is not a function
// استبدل كل raw.slice() بـ parseScenarioData(raw)

export function parseScenarioData(raw) {
  if (!raw) return [];
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(data)) return data;
    if (data?.chart?.result?.[0]) {
      const result = data.chart.result[0];
      const closes = result.indicators?.quote?.[0]?.close || [];
      const timestamps = result.timestamp || [];
      return closes.map((close, i) => ({
        date: new Date((timestamps[i] || 0) * 1000),
        close: close ?? null,
        open: result.indicators?.quote?.[0]?.open?.[i] ?? null,
        high: result.indicators?.quote?.[0]?.high?.[i] ?? null,
        low: result.indicators?.quote?.[0]?.low?.[i] ?? null,
        volume: result.indicators?.quote?.[0]?.volume?.[i] ?? 0,
      })).filter(d => d.close !== null);
    }
    if (data?.results || data?.data) {
      const arr = data.results || data.data;
      return Array.isArray(arr) ? arr : Object.values(arr);
    }
    return Object.values(data);
  } catch {
    return [];
  }
}

export function safeSlice(raw, start, end) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.slice(start, end);
  if (typeof raw === 'object') return Object.values(raw).slice(start, end);
  return [];
}

export function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}
