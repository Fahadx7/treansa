export async function onRequest() {
  const PROXIES = [
    'https://api.allorigins.win/get?url=',
    'https://corsproxy.io/?',
  ];
  const target = encodeURIComponent('https://stooq.com/q/l/?s=^tasi.sa&f=sd2t2ohlcv&h&e=csv');

  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy + target);
      if (!res.ok) continue;
      const json = await res.json();
      const text = json.contents ?? '';
      const lines = text.trim().split('\n');
      if (lines.length < 2) continue;
      const [, , , open, high, low, close, volume] = lines[1].split(',');
      if (!close || close.trim() === 'N/D') continue;
      const price = parseFloat(close);
      const openN = parseFloat(open);
      if (price < 1000) continue;
      const change = price - openN;
      const changePercent = (change / openN) * 100;
      return new Response(JSON.stringify({
        success: true,
        price,
        change: parseFloat(change.toFixed(2)),
        changePercent: parseFloat(changePercent.toFixed(2)),
        high: parseFloat(high),
        low: parseFloat(low),
        volume: parseInt(volume ?? '0', 10),
        time: new Date().toISOString(),
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch { continue; }
  }

  return new Response(JSON.stringify({ success: false, error: 'فشل جلب مؤشر تاسي' }), {
    status: 503, headers: { 'Content-Type': 'application/json' }
  });
}
