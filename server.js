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
  service: 'Mavis Grok API',
  status: 'online',
  endpoints: ['/health', '/api/chat']
}));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Render environment variable XAI_API_KEY is not configured.' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'A message is required.' });
  if (message.length > 12000) return res.status(413).json({ error: 'Message is too long. Limit is 12,000 characters.' });

  const instructions = `You are Mavis, an AI assistant powered by Grok. Be clear, helpful, and honest. You are not a broker and never execute trades.
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
    const upstream = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.XAI_MODEL || 'grok-4.7',
        instructions,
        input: message,
        max_output_tokens: 1200
      }),
      signal: AbortSignal.timeout(85000)
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error('xAI API error:', upstream.status, JSON.stringify(payload).slice(0, 1200));
      return res.status(502).json({ error: 'Grok API request failed. Check your xAI API key, model access, and account credits.' });
    }
    let answer = typeof payload.output_text === 'string' ? payload.output_text : '';
    if (!answer && Array.isArray(payload.output)) {
      answer = payload.output.flatMap(item => Array.isArray(item.content) ? item.content : [])
        .filter(item => item.type === 'output_text' && typeof item.text === 'string')
        .map(item => item.text).join('\n');
    }
    if (!answer.trim()) return res.status(502).json({ error: 'Grok returned no text. Please try again.' });
    return res.json({ answer, model: payload.model || process.env.XAI_MODEL || 'grok-4.7' });
  } catch (error) {
    console.error('Grok request failed:', error.message);
    return res.status(504).json({ error: 'Grok timed out or could not be reached. Try again.' });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`Mavis Grok API listening on ${port}`));
