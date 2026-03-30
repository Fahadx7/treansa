export async function fetchQuotesBatch(symbols: string[]): Promise<any[]> {
  const PROXIES = [
    (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${url}`,
  ];

  const results: any[] = [];

  await Promise.all(symbols.map(async (symbol) => {
    const s = symbol.replace(/\.SR$/i, '.sa');
    const targetUrl = `https://stooq.com/q/l/?s=${s}&f=sd2t2ohlcv&h&e=csv`;

    for (const proxy of PROXIES) {
      try {
        const res = await fetch(proxy(targetUrl));
        if (!res.ok) continue;

        let text = '';
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          text = json.contents ?? json;
        } else {
          text = await res.text();
        }

        const lines = text.trim().split('\n');
        if (lines.length < 2) continue;

        const values = lines[1].split(',');
        const [, , , open, high, low, close, volume] = values;
        if (!close || close.trim() === 'N/D') continue;

        const closeN  = parseFloat(close);
        const openN   = parseFloat(open);
        const change  = closeN - openN;
        const changePct = openN > 0 ? (change / openN) * 100 : 0;

        results.push({
          symbol,
          shortName:                  SAUDI_STOCKS[symbol.split('.')[0]] ?? symbol,
          regularMarketPrice:         closeN,
          regularMarketChange:        parseFloat(change.toFixed(2)),
          regularMarketChangePercent: parseFloat(changePct.toFixed(2)),
          regularMarketVolume:        parseInt(volume?.trim() ?? '0', 10),
          averageDailyVolume10Day:    0,
          regularMarketDayHigh:       parseFloat(high),
          regularMarketDayLow:        parseFloat(low),
        });
        break;
      } catch { continue; }
    }
  }));

  return results;
}
