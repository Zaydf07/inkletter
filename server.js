/* ═══════════════════════════════════════════════
   Inkletter — AI newsletter studio server
   AI newsletter generation + design editor only.
═══════════════════════════════════════════════ */
require('dotenv').config();

const express = require('express');
const path    = require('path');
const cors    = require('cors');
const multer  = require('multer');
const cheerio = require('cheerio');

const app = express();
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3010;

/* ── CORS ── */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || !ALLOWED_ORIGINS.length) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || /\.(netlify\.app|onrender\.com|up\.railway\.app)$/.test(origin)) {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'apikey'],
  credentials: true,
}));

/* ── SECURITY HEADERS ── */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

/* ── RATE LIMITING (in-memory, per IP) ── */
const buckets = new Map();
function rateLimit(maxPerMinute) {
  return (req, res, next) => {
    const key = `${req.ip}:${maxPerMinute}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > 60_000) { b = { start: now, count: 0 }; buckets.set(key, b); }
    b.count++;
    if (b.count > maxPerMinute) {
      return res.status(429).json({ error: 'Too many requests — please wait a moment.' });
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.start > 120_000) buckets.delete(k);
}, 60_000);

const generalLimit = rateLimit(60);
const aiLimit      = rateLimit(10);

/* ── AUTH (Supabase JWT, dev pass-through when unconfigured) ── */
async function requireAuth(req, res, next) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) { req.userId = 'dev-user'; return next(); }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return res.status(401).json({ error: 'Invalid or expired session — please sign in again' });
    const user = await r.json();
    req.userId    = user.id;
    req.userToken = token;
    next();
  } catch (e) {
    console.error('[auth]', e.message);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

/* ── BODY PARSING + UPLOADS ── */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
const upload = multer({ storage: multer.memoryStorage() });

function fileToDataUrl(file) {
  if (!file || !file.buffer) return null;
  const mime = file.mimetype || 'image/png';
  return `data:${mime};base64,${file.buffer.toString('base64')}`;
}

/* ── FRONTEND CONFIG ── */
app.get('/js/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.STREAMINK_CONFIG=${JSON.stringify({
    supabaseUrl:     process.env.SUPABASE_URL      || '',
    supabaseKey:     process.env.SUPABASE_ANON_KEY || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  })};`);
});

/* ── STATIC ── */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/email-editor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'email-editor.html')));
app.get('/library', (req, res) => res.sendFile(path.join(__dirname, 'public', 'library.html')));
app.get('/my-newsletters', (req, res) => res.sendFile(path.join(__dirname, 'public', 'library.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pricing.html')));
app.get('/teams', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teams.html')));

/* ── HELPERS ── */
async function fetchSiteData(url) {
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const html = await res.text();
    const $    = cheerio.load(html);
    $('script, style').remove();
    const title = $('title').text().trim();
    const h1    = $('h1').first().text().trim();
    const text  = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 4000);
    return { practice_name: h1 || title, text };
  } catch {
    return {};
  }
}

async function callGroq(prompt, maxTokens = 4096, temperature = 0.7) {
  const apiUrl = process.env.GROQ_API_URL;
  const apiKey = process.env.GROQ_API_KEY;
  const model  = process.env.GROQ_MODEL;

  if (!apiUrl || !apiKey || !model) {
    throw new Error('Groq API not configured — set GROQ_API_URL, GROQ_API_KEY, and GROQ_MODEL in your .env file');
  }

  const attempt = async () => {
    const res = await fetch(apiUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  maxTokens,
        temperature,
      }),
    });
    if (res.status === 429) return { retry: true };
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Groq ${res.status}: ${body.substring(0, 300)}`);
    }
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content?.trim() || '' };
  };

  let result = await attempt();
  if (result.retry) {
    await new Promise(r => setTimeout(r, 4000));
    result = await attempt();
  }
  if (result.retry) throw new Error('Groq rate limit exceeded — please wait a moment and try again');
  return result.content;
}

/* ─────────────────────────────────────
   API: Generate newsletter
   Body (multipart): topic, url, subject,
   sections, tone, length, images[]
───────────────────────────────────── */
app.post('/api/email/generate', requireAuth, aiLimit, upload.any(), async (req, res) => {
  try {
    const { topic, url, subject, sections, tone, length } = req.body;

    const site     = url ? await fetchSiteData(url) : {};
    const practice = site.practice_name || '';
    const pageText = site.text || '';

    const lengthMap = {
      short:  'Keep it brief (200-300 words total).',
      medium: 'Write a medium newsletter (400-500 words).',
      long:   'Write a detailed newsletter (600-800 words).',
    };

    const sectionList = sections
      ? (Array.isArray(sections) ? sections : sections.split('\n')).filter(Boolean).map(s => `- ${s.trim()}`).join('\n')
      : '';

    const prompt = `
Write a professional email newsletter in clean HTML.

CRITICAL RULES:
- Output ONLY HTML, no markdown, no preamble, no explanation
- Use ONLY: h1, h2, h3, p, ul, li, strong, em, a tags
- Do NOT add inline styles
- Make it scannable

BRAND: ${practice || topic}
SUBJECT: ${subject || topic}
TOPIC: ${topic}
TONE: ${tone || 'professional'}
LENGTH: ${lengthMap[length] || lengthMap.medium}
${sectionList ? `REQUIRED SECTIONS:\n${sectionList}` : ''}
${pageText ? `BRAND CONTEXT: ${pageText.substring(0, 2000)}` : ''}

STRUCTURE:
1. <h1> matching the subject
2. Short intro <p>
3. 2-3 <h2> sections with <p> each
4. CTA <p> with an <a> link
5. Brief sign-off <p>
`;

    let html = await callGroq(prompt, 2048);
    html = html.replace(/```html?\n?/gi, '').replace(/```/g, '').trim();
    res.json({ html });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────
   API: Refine selected text
───────────────────────────────────── */
app.post('/api/refine', requireAuth, aiLimit, async (req, res) => {
  try {
    const { text, instruction, tone } = req.body;
    if (!text || !instruction) return res.status(400).json({ error: 'Missing text or instruction' });

    const prompt = `Rewrite the following text. Instruction: ${instruction}${tone ? ` Tone: ${tone}.` : ''}

TEXT:
${text}

RULES:
- Return ONLY the rewritten text, nothing else — no preamble, no explanation, no quotes
- Preserve any HTML tags present in the original
- Match the approximate length unless the instruction says otherwise`;

    const refined = await callGroq(prompt, 1024);
    res.json({ refined: refined.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────
   API: GIF / sticker search (Tenor → Giphy)
───────────────────────────────────── */
app.get('/api/media/search', generalLimit, async (req, res) => {
  const { q, type = 'gif' } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });
  const limit = 12;

  const tenorKey = process.env.TENOR_API_KEY;
  if (tenorKey) {
    try {
      const endpoint = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}${type === 'sticker' ? '+sticker' : ''}&key=${tenorKey}&limit=${limit}&contentfilter=medium&media_filter=gif,tinygif`;
      const r    = await fetch(endpoint);
      const data = await r.json();
      if (data.results?.length) {
        const results = data.results.map(item => {
          const gif  = item.media_formats?.gif || item.media_formats?.tinygif;
          const tiny = item.media_formats?.tinygif || gif;
          return { url: gif?.url, preview: tiny?.url, title: item.content_description };
        }).filter(r => r.url);
        return res.json({ results, source: 'tenor' });
      }
    } catch (e) { console.warn('Tenor error:', e.message); }
  }

  res.json({ results: [], note: 'Add TENOR_API_KEY to .env for GIF search' });
});

/* ─────────────────────────────────────
   API: AI image generation (Pollinations, free)
───────────────────────────────────── */
app.post('/api/ai-image/generate', requireAuth, aiLimit, async (req, res) => {
  try {
    const { prompt, width = 1024, height = 1024, style = 'photo' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const modelMap = { photo: 'flux', '2d': 'flux-anime', '3d': 'flux-3d', sticker: 'flux' };
    const model    = modelMap[style] || 'flux';
    const encoded  = encodeURIComponent(prompt);
    const seed     = Math.floor(Math.random() * 99999);
    const url = `https://image.pollinations.ai/prompt/${encoded}?model=${model}&width=${width}&height=${height}&nologo=true&seed=${seed}`;

    try {
      const imageRes = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (imageRes.ok) {
        const buf = Buffer.from(await imageRes.arrayBuffer());
        return res.json({ imageUrl: `data:image/jpeg;base64,${buf.toString('base64')}` });
      }
    } catch (e) {
      console.warn('[AI Image] Pollinations fetch failed, returning URL direct:', e.message);
    }
    res.json({ imageUrl: url });
  } catch (err) {
    console.error('[AI Image]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────
   API: Send newsletter (Resend)
───────────────────────────────────── */
app.post('/api/email/send', requireAuth, generalLimit, async (req, res) => {
  const { to, subject, html } = req.body;
  if (!to || !subject || !html) return res.status(400).json({ error: 'to, subject and html are required' });

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(501).json({ error: 'Email sending requires RESEND_API_KEY in .env — get a free key at resend.com' });

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Inkletter <onboarding@resend.dev>',
        to:   Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Resend error');
    res.json({ success: true, id: data.id });
  } catch (e) {
    console.error('[email/send]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ─────────────────────────────────────
   SocketLabs — send via Injection API
   Body: { serverId, apiKey, from, to, subject, html }
───────────────────────────────────── */
app.post('/api/socketlabs/send', generalLimit, async (req, res) => {
  const { serverId, apiKey, from, to, subject, html } = req.body;
  if (!serverId || !apiKey || !from || !to || !subject || !html) {
    return res.status(400).json({ error: 'serverId, apiKey, from, to, subject and html are all required' });
  }
  const recipients = (Array.isArray(to) ? to : String(to).split(/[\s,;]+/))
    .map(e => e.trim()).filter(Boolean).map(e => ({ emailAddress: e }));
  if (!recipients.length) return res.status(400).json({ error: 'No valid recipients' });

  try {
    const r = await fetch('https://inject.socketlabs.com/api/v1/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: Number(serverId),
        apiKey,
        messages: [{
          to: recipients,
          from: { emailAddress: from },
          subject,
          htmlBody: html,
        }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    // SocketLabs returns { ErrorCode: "Success", ... } on success
    if (data.ErrorCode && data.ErrorCode !== 'Success') {
      throw new Error(`SocketLabs: ${data.ErrorCode}${data.MessageResults && data.MessageResults[0] ? ' — ' + data.MessageResults[0].ErrorCode : ''}`);
    }
    if (!r.ok && !data.ErrorCode) throw new Error(`SocketLabs HTTP ${r.status}`);
    res.json({ success: true, sent: recipients.length });
  } catch (e) {
    console.error('[socketlabs]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ─────────────────────────────────────
   WordPress / MailPoet — via the Inkletter Bridge plugin
   Body: { siteUrl, apiKey, subject, html, mode }
   Proxies to the user's WP site to avoid browser CORS.
───────────────────────────────────── */
app.post('/api/wordpress/send', generalLimit, async (req, res) => {
  const { siteUrl, apiKey, subject, html, mode = 'auto' } = req.body;
  if (!siteUrl || !apiKey || !html) {
    return res.status(400).json({ error: 'siteUrl, apiKey and html are required' });
  }
  const endpoint = String(siteUrl).replace(/\/+$/, '') + '/wp-json/inkletter/v1/newsletter';
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Inkletter-Key': apiKey },
      body: JSON.stringify({ subject: subject || 'Newsletter', html, mode }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error(data.error || `WordPress responded ${r.status}. Is the Inkletter Bridge plugin active?`);
    res.json({ success: true, target: data.target, message: data.message, editLink: data.edit_link || null });
  } catch (e) {
    console.error('[wordpress]', e.message);
    res.status(500).json({ error: e.message.includes('fetch') ? 'Could not reach your WordPress site — check the URL and that the Inkletter Bridge plugin is installed.' : e.message });
  }
});

/* ── 404 ── */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

/* ── GLOBAL ERROR HANDLER ── */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  console.error(`[${status}] ${req.method} ${req.path} —`, message);
  res.status(status).json({ error: message });
});

/* ── START ── */
function startServer(port, retryLimit = 10) {
  const server = app.listen(port, () => {
    console.log(`✒  Inkletter running at http://localhost:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retryLimit > 0) {
      console.warn(`Port ${port} in use, trying ${port + 1}…`);
      setTimeout(() => startServer(port + 1, retryLimit - 1), 100);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

if (require.main === module) {
  startServer(DEFAULT_PORT);
}

module.exports = app;
