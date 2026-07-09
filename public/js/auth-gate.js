/**
 * auth-gate.js — universal auth interceptor + credit meter
 * Include in every app/engine page. No dependencies.
 *
 * What it does:
 *  1. Patches window.fetch — if any /api/* call returns 401, shows the auth modal
 *  2. On DOMContentLoaded, injects a credit meter into known sidebar footer selectors
 *  3. Exposes window.AuthGate.open() for manual triggers
 */
(function () {
  'use strict';

  /* ── helpers ─────────────────────────────────────────── */
  const cfg = () => window.STREAMINK_CONFIG || {};

  async function getSession() {
    const c = cfg();
    if (!c.supabaseUrl || !c.supabaseAnonKey) return null;
    // try supabase-js global first
    if (window.supabase) {
      try { const { data } = await window.supabase.auth.getSession(); return data?.session || null; } catch { return null; }
    }
    // fallback: check localStorage for sb token
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return null;
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  async function isLoggedIn() {
    const s = await getSession();
    return !!s;
  }

  /* ── get stored access token ─────────────────────────── */
  function getStoredToken() {
    try {
      // supabase-js v2 stores under sb-<ref>-auth-token
      const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      if (!key) return null;
      const data = JSON.parse(localStorage.getItem(key));
      return data?.access_token || data?.session?.access_token || null;
    } catch { return null; }
  }

  /* ── fetch interceptor ────────────────────────────────── */
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (url, opts) {
    // Auto-inject auth token for all /api/ requests
    if (typeof url === 'string' && url.startsWith('/api/')) {
      const token = getStoredToken();
      if (token) {
        opts = opts ? { ...opts } : {};
        // Don't override if caller already set Authorization
        if (opts.headers instanceof Headers) {
          if (!opts.headers.has('Authorization')) opts.headers.set('Authorization', 'Bearer ' + token);
        } else {
          opts.headers = opts.headers || {};
          if (!opts.headers['Authorization']) opts.headers['Authorization'] = 'Bearer ' + token;
        }
      }
    }

    const res = await _fetch(url, opts);

    // 401 = not logged in → show signup/login modal
    if (res.status === 401 && typeof url === 'string' && url.startsWith('/api/')) {
      const cloned = res.clone();
      AuthGate.open('You need an account to generate content. It\'s free.');
      return cloned;
    }

    // 402 = credit limit reached → show upgrade modal (not signup)
    if (res.status === 402 && typeof url === 'string' && url.startsWith('/api/')) {
      const cloned = res.clone();
      try {
        const d = await res.clone().json();
        AuthGate.showUpgrade(d.plan, d.creditsUsed, d.creditsLimit);
      } catch { AuthGate.showUpgrade(); }
      return cloned;
    }

    return res;
  };

  /* ── modal HTML ───────────────────────────────────────── */
  function buildModal() {
    if (document.getElementById('ag-overlay')) return;

    const el = document.createElement('div');
    el.id = 'ag-overlay';
    el.innerHTML = `
<style>
#ag-overlay{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;padding:16px;
  background:rgba(33,28,20,.55);backdrop-filter:blur(6px)}
#ag-overlay.open{display:flex}
#ag-modal{background:#FFFFFF;border-radius:20px;width:min(440px,100%);box-shadow:0 32px 80px -20px rgba(33,28,20,.35),0 0 0 1px rgba(33,28,20,.06);overflow:hidden;animation:agIn .22s cubic-bezier(.34,1.2,.64,1) both}
@keyframes agIn{from{opacity:0;transform:translateY(24px) scale(.97)}}
#ag-brand{background:linear-gradient(162deg,#181428,#221D40);padding:28px 32px 22px;text-align:center;color:#fff}
#ag-brand .ag-logo{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:8px}
#ag-brand .ag-logo strong{display:block;font-family:'Hanken Grotesk',system-ui,sans-serif;font-size:22px;font-weight:800;color:#fff;letter-spacing:0;margin-bottom:4px}
#ag-brand p{font-size:13px;color:#B9B5E3;line-height:1.55;max-width:320px;margin:0 auto}
#ag-body{padding:28px 32px 32px}
.ag-tabs{display:flex;gap:4px;background:#F1ECE1;border-radius:10px;padding:4px;margin-bottom:22px}
.ag-tab{flex:1;border:none;background:none;padding:9px;border-radius:8px;font-family:'Hanken Grotesk',system-ui,sans-serif;font-size:13.5px;font-weight:600;color:#6E6557;cursor:pointer;transition:.15s}
.ag-tab.on{background:#fff;color:#211C14;box-shadow:0 1px 4px rgba(33,28,20,.1)}
.ag-form{display:none}
.ag-form.on{display:block}
.ag-label{font-size:11.5px;font-weight:700;color:#A89E8C;letter-spacing:.08em;text-transform:uppercase;display:block;margin-bottom:6px;font-family:'JetBrains Mono',ui-monospace,monospace}
.ag-input{width:100%;padding:11px 14px;border:1.5px solid #E3DACA;border-radius:9px;font-size:14px;font-family:'Hanken Grotesk',system-ui,sans-serif;color:#211C14;background:#FBF7EF;outline:none;transition:.15s;margin-bottom:14px}
.ag-input:focus{border-color:#4B43C4;background:#fff}
.ag-btn{width:100%;padding:13px;border:none;border-radius:999px;background:linear-gradient(165deg,#5750D8,#3F37AC);color:#fff;font-family:'Hanken Grotesk',system-ui,sans-serif;font-weight:700;font-size:14.5px;cursor:pointer;transition:.15s;margin-top:4px}
.ag-btn:hover{opacity:.9}
.ag-btn:disabled{opacity:.5;cursor:not-allowed}
.ag-divider{text-align:center;font-size:12px;color:#A89E8C;margin:16px 0;position:relative}
.ag-divider::before{content:'';position:absolute;left:0;right:0;top:50%;height:1px;background:#E3DACA}
.ag-divider span{position:relative;background:#fff;padding:0 10px}
.ag-oauth{display:flex;gap:10px;margin-bottom:16px}
.ag-oauth-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:10px;border:1.5px solid #E3DACA;border-radius:9px;background:#fff;font-family:'Hanken Grotesk',system-ui,sans-serif;font-size:13px;font-weight:600;color:#211C14;cursor:pointer;transition:.15s;text-decoration:none}
.ag-oauth-btn:hover{border-color:#4B43C4;background:#FBF7EF}
.ag-err{font-size:12px;color:#B65334;margin-top:-8px;margin-bottom:10px;display:none}
.ag-foot{text-align:center;font-size:12px;color:#A89E8C;margin-top:16px}
.ag-foot a{color:#4B43C4;text-decoration:none;font-weight:600}
.ag-close{position:absolute;top:14px;right:16px;background:rgba(255,255,255,.1);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:.15s}
.ag-close:hover{background:rgba(255,255,255,.2)}
#ag-brand{position:relative}
.ag-success{text-align:center;padding:20px 0 8px;display:none}
.ag-success .ag-s-icon{font-size:48px;margin-bottom:12px}
.ag-success h3{font-size:18px;font-weight:700;color:#2E8E6A;margin-bottom:6px;font-family:'Hanken Grotesk',system-ui,sans-serif}
.ag-success p{font-size:13px;color:#6E6557}
</style>

<div id="ag-modal">
  <div id="ag-brand">
    <button class="ag-close" onclick="AuthGate.close()">✕</button>
    <div class="ag-logo"><strong>Inkletter</strong>AI Newsletter Studio</div>
    <p id="ag-tagline">Create your free account to start generating content.</p>
  </div>
  <div id="ag-body">
    <div class="ag-tabs">
      <button class="ag-tab on" onclick="AuthGate.tab('signup',this)">Create account</button>
      <button class="ag-tab" onclick="AuthGate.tab('signin',this)">Sign in</button>
    </div>

    <!-- SIGN UP -->
    <div class="ag-form on" id="ag-form-signup">
      <div class="ag-oauth">
        <button class="ag-oauth-btn" onclick="AuthGate.oauthSignIn('google')">
          <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Google
        </button>
        <button class="ag-oauth-btn" onclick="AuthGate.oauthSignIn('github')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
          GitHub
        </button>
      </div>
      <div class="ag-divider"><span>or email</span></div>
      <label class="ag-label">Email</label>
      <input class="ag-input" type="email" id="ag-su-email" placeholder="you@example.com" autocomplete="email">
      <label class="ag-label">Password</label>
      <input class="ag-input" type="password" id="ag-su-pass" placeholder="At least 8 characters" autocomplete="new-password">
      <p class="ag-err" id="ag-su-err"></p>
      <button class="ag-btn" id="ag-su-btn" onclick="AuthGate.signup()">Create free account →</button>
      <p class="ag-foot">By signing up you agree to our <a href="/terms.html">Terms</a> &amp; <a href="/privacy.html">Privacy Policy</a></p>
    </div>

    <!-- SIGN IN -->
    <div class="ag-form" id="ag-form-signin">
      <div class="ag-oauth">
        <button class="ag-oauth-btn" onclick="AuthGate.oauthSignIn('google')">
          <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Google
        </button>
        <button class="ag-oauth-btn" onclick="AuthGate.oauthSignIn('github')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
          GitHub
        </button>
      </div>
      <div class="ag-divider"><span>or email</span></div>
      <label class="ag-label">Email</label>
      <input class="ag-input" type="email" id="ag-si-email" placeholder="you@example.com" autocomplete="email">
      <label class="ag-label">Password</label>
      <input class="ag-input" type="password" id="ag-si-pass" placeholder="Password" autocomplete="current-password">
      <p class="ag-err" id="ag-si-err"></p>
      <button class="ag-btn" id="ag-si-btn" onclick="AuthGate.signin()">Sign in →</button>
      <p class="ag-foot"><a href="/forgot-password">Forgot password?</a></p>
    </div>

    <!-- SUCCESS -->
    <div class="ag-success" id="ag-success">
      <div class="ag-s-icon">🎉</div>
      <h3>You're in!</h3>
      <p>Your account is ready. Reloading the page…</p>
    </div>
  </div>
</div>`;

    document.body.appendChild(el);

    // close on backdrop click
    el.addEventListener('click', e => { if (e.target === el) AuthGate.close(); });

    // enter key submits
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const active = document.querySelector('.ag-form.on');
      if (!active) return;
      if (active.id === 'ag-form-signup') AuthGate.signup();
      else AuthGate.signin();
    });
  }

  /* ── credit meter injection ───────────────────────────── */
  function buildCreditMeter() {
    // find the sidebar footer in common layouts
    const targets = [
      document.querySelector('.side-foot'),
      document.querySelector('.st-nav-bottom'),
      document.querySelector('.si-nav-bottom'),
    ].filter(Boolean);

    if (!targets.length) return;
    if (document.getElementById('ag-credit-meter')) return;

    const meter = document.createElement('div');
    meter.id = 'ag-credit-meter';
    meter.style.cssText = 'padding:10px 9px 0;margin-bottom:6px';
    meter.innerHTML = `
<style>
#ag-credit-meter{font-family:'Hanken Grotesk',system-ui,sans-serif}
.agcm-label{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--faint,#A89E8C);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}
.agcm-track{height:5px;background:var(--line,#E3DACA);border-radius:999px;overflow:hidden;margin-bottom:5px}
.agcm-fill{height:100%;border-radius:999px;transition:width .5s,background .3s;background:linear-gradient(90deg,#4B43C4,#7B41C9)}
.agcm-fill.warn{background:linear-gradient(90deg,#D4883A,#B65334)}
.agcm-fill.full{background:#B65334}
.agcm-sub{font-size:10.5px;color:var(--faint,#A89E8C);line-height:1.4}
.agcm-upgrade{display:inline-block;margin-top:6px;padding:5px 12px;border-radius:999px;background:linear-gradient(165deg,#5750D8,#3F37AC);color:#fff;font-size:10.5px;font-weight:700;text-decoration:none;letter-spacing:.02em}
.agcm-upgrade:hover{opacity:.9}
</style>
<div class="agcm-label">
  <span>Credits</span>
  <span id="agcm-nums">—</span>
</div>
<div class="agcm-track"><div class="agcm-fill" id="agcm-fill" style="width:0%"></div></div>
<div class="agcm-sub" id="agcm-sub">Loading usage…</div>`;

    targets[0].prepend(meter);
    loadCreditMeter();
  }

  async function loadCreditMeter() {
    const c = cfg();
    if (!c.supabaseUrl) {
      const el = document.getElementById('agcm-sub');
      if (el) el.textContent = 'Connect Supabase to track credits';
      return;
    }
    const session = await getSession();
    if (!session) {
      const el = document.getElementById('agcm-sub');
      if (el) el.textContent = 'Sign in to see credit usage';
      return;
    }
    try {
      const token = session.access_token || (session.session && session.session.access_token);
      if (!token) return;
      const r = await fetch(`${c.supabaseUrl}/rest/v1/subscriptions?select=plan,credits_limit,credits_used&user_id=eq.${session.user?.id}`, {
        headers: { 'apikey': c.supabaseAnonKey, 'Authorization': `Bearer ${token}` }
      });
      if (!r.ok) return;
      const rows = await r.json();
      const sub = rows[0];
      if (!sub) return;

      const used  = sub.credits_used  || 0;
      const limit = sub.credits_limit || 100;
      const pct   = limit < 0 ? 0 : Math.min(used / limit * 100, 100);
      const plan  = sub.plan || 'free';

      const fill = document.getElementById('agcm-fill');
      const nums = document.getElementById('agcm-nums');
      const sub2 = document.getElementById('agcm-sub');
      const meter= document.getElementById('ag-credit-meter');

      if (fill) {
        fill.style.width = (limit < 0 ? 0 : pct) + '%';
        fill.classList.toggle('warn', pct >= 70 && pct < 90);
        fill.classList.toggle('full', pct >= 90);
      }
      if (nums) nums.textContent = limit < 0 ? `∞ / ∞` : `${used} / ${limit}`;
      if (sub2) sub2.textContent = limit < 0 ? 'Unlimited (Agency)' : `${Math.max(0, limit - used)} credits remaining`;

      if (pct >= 90 && plan === 'free' && meter) {
        if (!meter.querySelector('.agcm-upgrade')) {
          const a = document.createElement('a');
          a.className = 'agcm-upgrade';
          a.href = '/pricing.html';
          a.textContent = '⚡ Upgrade plan';
          meter.appendChild(a);
        }
      }
    } catch (e) {
      console.warn('[auth-gate] credit meter:', e.message);
    }
  }

  /* ── AuthGate public API ──────────────────────────────── */
  window.AuthGate = {
    open(msg) {
      buildModal();
      if (msg) document.getElementById('ag-tagline').textContent = msg;
      document.getElementById('ag-overlay').classList.add('open');
      setTimeout(() => {
        const f = document.getElementById('ag-su-email');
        if (f) f.focus();
      }, 220);
    },

    close() {
      const o = document.getElementById('ag-overlay');
      if (o) o.classList.remove('open');
    },

    tab(name, btn) {
      document.querySelectorAll('.ag-tab').forEach(t => t.classList.remove('on'));
      document.querySelectorAll('.ag-form').forEach(f => f.classList.remove('on'));
      btn.classList.add('on');
      const form = document.getElementById('ag-form-' + name);
      if (form) form.classList.add('on');
    },

    async signup() {
      const email = document.getElementById('ag-su-email').value.trim();
      const pass  = document.getElementById('ag-su-pass').value;
      const errEl = document.getElementById('ag-su-err');
      const btn   = document.getElementById('ag-su-btn');

      errEl.style.display = 'none';
      if (!email || !email.includes('@')) { errEl.textContent = 'Enter a valid email.'; errEl.style.display='block'; return; }
      if (pass.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; errEl.style.display='block'; return; }

      btn.disabled = true; btn.textContent = 'Creating account…';

      try {
        const c = cfg();
        if (!c.supabaseUrl) throw new Error('Supabase not configured — use the login page instead.');
        const res = await fetch(`${c.supabaseUrl}/auth/v1/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': c.supabaseAnonKey },
          body: JSON.stringify({ email, password: pass })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || data.error_description || 'Sign up failed');
        this._showSuccess();
      } catch (e) {
        errEl.textContent = e.message; errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Create free account →';
      }
    },

    async signin() {
      const email = document.getElementById('ag-si-email').value.trim();
      const pass  = document.getElementById('ag-si-pass').value;
      const errEl = document.getElementById('ag-si-err');
      const btn   = document.getElementById('ag-si-btn');

      errEl.style.display = 'none';
      if (!email || !pass) { errEl.textContent = 'Enter your email and password.'; errEl.style.display='block'; return; }

      btn.disabled = true; btn.textContent = 'Signing in…';

      try {
        const c = cfg();
        if (!c.supabaseUrl) throw new Error('Supabase not configured — use the login page instead.');
        const res = await fetch(`${c.supabaseUrl}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': c.supabaseAnonKey },
          body: JSON.stringify({ email, password: pass })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign in failed');
        // store session
        const key = `sb-${new URL(c.supabaseUrl).hostname.split('.')[0]}-auth-token`;
        localStorage.setItem(key, JSON.stringify(data));
        this._showSuccess();
      } catch (e) {
        errEl.textContent = e.message; errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Sign in →';
      }
    },

    async oauthSignIn(provider) {
      const c = cfg();
      if (!c.supabaseUrl) {
        window.location.href = '/login.html';
        return;
      }
      try {
        // Use Supabase JS client if available
        if (window.supabase && window._supabase) {
          const { error } = await window._supabase.auth.signInWithOAuth({
            provider,
            options: { redirectTo: window.location.origin + '/dashboard' }
          });
          if (error) throw error;
          return;
        }
        // Fallback: direct Supabase OAuth URL
        const redirectTo = encodeURIComponent(window.location.origin + '/dashboard');
        window.location.href = `${c.supabaseUrl}/auth/v1/authorize?provider=${provider}&redirect_to=${redirectTo}`;
      } catch (e) {
        const errEl = document.getElementById('ag-su-err') || document.getElementById('ag-si-err');
        if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
      }
    },

    _showSuccess() {
      document.querySelectorAll('.ag-form').forEach(f => f.style.display = 'none');
      document.querySelector('.ag-tabs').style.display = 'none';
      document.getElementById('ag-success').style.display = 'block';
      setTimeout(() => location.reload(), 1800);
    },

    showUpgrade(plan, used, limit) {
      buildModal();
      const overlay = document.getElementById('ag-overlay');
      const body    = document.getElementById('ag-body');
      if (!overlay || !body) return;
      body.innerHTML = `
        <div style="text-align:center;padding:12px 0 8px">
          <div style="font-size:42px;margin-bottom:14px">⚡</div>
          <h3 style="font-size:18px;font-weight:700;color:#211C14;margin-bottom:8px">You've used all your credits</h3>
          <p style="font-size:13.5px;color:#6E6557;line-height:1.6;margin-bottom:20px">
            ${used && limit ? `${used} / ${limit} credits used this month on your <strong>${plan||'free'}</strong> plan.` : 'Your monthly credit limit has been reached.'}
            <br>Upgrade to keep generating content.
          </p>
          <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
            <a href="/pricing.html" style="display:block;padding:13px;background:linear-gradient(165deg,#5750D8,#3F37AC);color:#fff;border-radius:999px;font-weight:700;font-size:14.5px;text-decoration:none">
              Upgrade to Pro — $29/mo →
            </a>
            <a href="/pricing.html" style="display:block;padding:11px;border:1.5px solid #E3DACA;border-radius:999px;color:#211C14;font-weight:600;font-size:13px;text-decoration:none">
              See all plans
            </a>
          </div>
          <p style="font-size:11.5px;color:#A89E8C">Credits reset on the 1st of each month</p>
        </div>`;
      overlay.classList.add('open');
    }
  };

  /* ── init on DOM ready ────────────────────────────────── */
  function init() {
    buildModal();
    buildCreditMeter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
