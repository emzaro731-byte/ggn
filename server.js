import express from 'express';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// Basic per-IP throttle to reduce accidental/public API abuse.
const buckets = new Map();
app.use((req, res, next) => {
  if (req.path !== '/api/chat' || req.method !== 'POST') return next();
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const bucket = buckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start >= 60_000) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > 20) return res.status(429).json({ error: 'Too many requests. Please wait one minute and try again.' });
  next();
});
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (_req, res) => res.json({
  service: 'Mavis Groq API',
  status: 'online',
  provider: 'Groq',
  model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  endpoints: ['/health', '/api/chat']
}));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use((req, res) => res.status(404).json({ error: 'Mavis Groq API route not found.', path: req.path, method: req.method, expectedChatEndpoint: 'POST /api/chat', expectedHealthEndpoint: 'GET /health' }));


// Multi-asset crypto market overview from Coinbase public market data, summarized by Groq.
app.get('/api/markets', async (_req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Render environment variable GROQ_API_KEY is not configured.' });
  const symbols = ['BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','ADA-USD','AVAX-USD','LINK-USD','LTC-USD','BCH-USD','DOT-USD','SHIB-USD','UNI-USD','XLM-USD'];
  try {
    const markets = await Promise.all(symbols.map(async symbol => {
      try {
        const response = await fetch('https://api.exchange.coinbase.com/products/' + symbol + '/stats', {
          headers: { 'Accept': 'application/json', 'User-Agent': 'MavisAI/1.0' },
          signal: AbortSignal.timeout(12000)
        });
        if (!response.ok) return null;
        const d = await response.json();
        const open = Number(d.open), last = Number(d.last), high = Number(d.high), low = Number(d.low), volume = Number(d.volume);
        if (![open,last,high,low].every(Number.isFinite) || open <= 0) return null;
        return { symbol: symbol.replace('-USD',''), priceUSD: last, change24hPct: Number(((last-open)/open*100).toFixed(2)), high24hUSD: high, low24hUSD: low, volume24h: Number.isFinite(volume) ? volume : null };
      } catch (_) { return null; }
    }));
    const available = markets.filter(Boolean);
    if (available.length < 3) return res.status(502).json({ error: 'Live crypto market data is temporarily unavailable.' });
    const model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.2, max_tokens: 900,
        messages: [
          { role: 'system', content: 'You are Mavis, a careful crypto market analyst. Summarize only the supplied current 24-hour market snapshot. Mention broad direction, strongest and weakest available assets, and notable volatility/risk. Do not claim this is the entire global market; it is a selected Coinbase USD crypto watchlist. Do not invent news or future prices. Clearly state that 24-hour change is not a trading signal and that no trades are placed.' },
          { role: 'user', content: JSON.stringify(available) }
        ]
      }),
      signal: AbortSignal.timeout(30000)
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(502).json({ error: 'Groq market summary failed. Check API key, model access, and account limits.' });
    const summary = payload.choices?.[0]?.message?.content;
    if (typeof summary !== 'string' || !summary.trim()) return res.status(502).json({ error: 'Groq returned no market summary.' });
    return res.json({ provider: 'Coinbase Exchange + Groq', scope: 'Selected Coinbase USD crypto markets', generatedAt: new Date().toISOString(), markets: available, summary, model: payload.model || model });
  } catch (error) {
    console.error('Markets endpoint failed:', error.message);
    return res.status(504).json({ error: 'Could not load the market overview. Please try again.' });
  }
});

// Live BTCUSD analysis endpoint. Uses Coinbase public candles, then asks Groq
// to interpret calculated indicators. It never places orders.
app.get('/api/signal', async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Render environment variable GROQ_API_KEY is not configured.' });
  const allowed = new Set(['5m', '15m', '1h']);
  const timeframe = String(req.query.timeframe || '15m');
  if (!allowed.has(timeframe)) return res.status(400).json({ error: 'timeframe must be 5m, 15m, or 1h' });
  const granularity = ({ '5m': 300, '15m': 900, '1h': 3600 })[timeframe];
  try {
    const response = await fetch(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${granularity}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'MavisAI/1.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return res.status(502).json({ error: 'Live market data provider is unavailable.' });
    const raw = await response.json();
    if (!Array.isArray(raw) || raw.length < 55) return res.status(502).json({ error: 'Not enough candle data to calculate a signal.' });
    // Coinbase candles are [time, low, high, open, close, volume], newest first.
    const candles = raw.slice().reverse().map(x => ({ time: x[0], low: +x[1], high: +x[2], open: +x[3], close: +x[4], volume: +x[5] }));
    const closes = candles.map(x => x.close);
    const ema = (values, period) => {
      const k = 2 / (period + 1);
      let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (const price of values.slice(period)) value = price * k + value * (1 - k);
      return value;
    };
    const changes = closes.slice(1).map((v, i) => v - closes[i]);
    const recent = changes.slice(-14);
    const gains = recent.reduce((s, v) => s + Math.max(v, 0), 0) / 14;
    const losses = recent.reduce((s, v) => s + Math.max(-v, 0), 0) / 14;
    const rsi = losses === 0 ? 100 : 100 - (100 / (1 + gains / losses));
    const latest = candles[candles.length - 1];
    const indicators = {
      symbol: 'BTC-USD',
      timeframe,
      provider: 'Coinbase Exchange public candles',
      candleTimeUTC: new Date(latest.time * 1000).toISOString(),
      currentPriceUSD: latest.close,
      ema20: Number(ema(closes.slice(-60), 20).toFixed(2)),
      ema50: Number(ema(closes.slice(-60), 50).toFixed(2)),
      rsi14: Number(rsi.toFixed(2)),
      recentCandles: candles.slice(-5).map(x => ({ timeUTC: new Date(x.time * 1000).toISOString(), open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume }))
    };
    const model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: 'system', content: 'You are Mavis, a cautious trading-analysis assistant. Analyze only the supplied live candle data and indicators. Return a concise JSON object with keys signal (BUY, SELL, or WAIT), timeframe, reason, entry, stopLoss, takeProfit, confidence (low/medium/high), and riskNote. Use WAIT if indicators conflict or evidence is weak. Do not guarantee profits. Entry/stopLoss/takeProfit must be numeric USD levels or null. This is analysis only; never place trades.' },
          { role: 'user', content: JSON.stringify(indicators) }
        ]
      }),
      signal: AbortSignal.timeout(30000)
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(502).json({ error: 'Groq signal analysis failed. Check the API key, model access, and account limits.' });
    const answer = payload.choices?.[0]?.message?.content;
    if (!answer) return res.status(502).json({ error: 'Groq returned no signal.' });
    let analysis;
    try {
      const cleaned = answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      analysis = JSON.parse(cleaned);
    } catch {
      analysis = { signal: 'WAIT', reason: 'The AI response could not be safely parsed. Review the raw analysis.', rawAnalysis: answer, confidence: 'low', entry: null, stopLoss: null, takeProfit: null };
    }
    if (!['BUY', 'SELL', 'WAIT'].includes(String(analysis.signal).toUpperCase())) analysis.signal = 'WAIT';
    analysis.signal = String(analysis.signal).toUpperCase();
    return res.json({ ...analysis, market: indicators, generatedAt: new Date().toISOString(), model: payload.model || model, automatedTrading: false });
  } catch (error) {
    console.error('Signal endpoint failed:', error.message);
    return res.status(504).json({ error: 'Could not retrieve live market data or complete analysis. Try again shortly.' });
  }
});

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Render environment variable GROQ_API_KEY is not configured.' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'A message is required.' });
  if (message.length > 12000) return res.status(413).json({ error: 'Message is too long. Limit is 12,000 characters.' });

  const instructions = `You are Mavis, an AI assistant powered by Groq using the configured language model. Be clear, helpful, and honest. You are not a broker and never execute trades.
For trading questions, give educational analysis, not a guarantee. Never claim you have live prices, candles, indicators, or access to the user's screen unless the user actually supplied that information or a connected data tool provided it. If essential market data is missing, respond WAIT — NOT ENOUGH DATA and ask for the symbol, timeframe, current price, and chart/candle or indicator information.
When data is sufficient, structure the answer as:
SIGNAL: BUY / SELL / WAIT
SYMBOL & TIMEFRAME:
REASON:
POSSIBLE ENTRY:
STOP-LOSS:
TAKE-PROFIT:
CONFIDENCE: low / medium / high, with a short explanation
INVALIDATION:
Use WAIT when the evidence is unclear or contradictory. Do not promise profits, invent exact prices, or encourage excessive leverage. The app provides alerts and analysis only; it must not place trades automatically.`;

  try {
    const model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: message }
        ],
        temperature: 0.4,
        max_tokens: 1200
      }),
      signal: AbortSignal.timeout(85000)
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error('Groq API error:', upstream.status, JSON.stringify(payload).slice(0, 1200));
      return res.status(502).json({ error: 'Groq API request failed. Check GROQ_API_KEY, GROQ_MODEL access, and your Groq account limits.' });
    }
    const answer = payload.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) {
      return res.status(502).json({ error: 'Groq returned no text. Please try again.' });
    }
    return res.json({ answer, model: payload.model || model, provider: 'Groq' });
  } catch (error) {
    console.error('Groq request failed:', error.message);
    return res.status(504).json({ error: 'Groq timed out or could not be reached. Try again.' });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`Mavis Groq API listening on ${port}`));
