(function () {
  var kit, cfg;
  try { kit = JSON.parse(localStorage.getItem('StreamInk_BrandKit') || '{}'); } catch { kit = {}; }
  try { cfg = JSON.parse(localStorage.getItem('StreamInk_Settings') || '{}'); } catch { cfg = {}; }

  var eng      = kit.engines || {};
  var globalOn = cfg.autoFill !== false;

  // per-engine: true unless explicitly set false
  function on(key) { return globalOn && eng[key] !== false; }

  var tone   = kit.tone || cfg.defaultTone || '';
  var length = cfg.defaultLength || '';
  var style  = cfg.defaultStyle  || '';

  function set(id, val)   { if (!val) return; var el = document.getElementById(id); if (el && !el.value) el.value = val; }
  function force(id, val) { if (!val) return; var el = document.getElementById(id); if (el) el.value = val; }
  function fire(el, ev)   { if (el) el.dispatchEvent(new Event(ev, { bubbles: true })); }

  /* ── BLOG ENGINE ── */
  if (document.getElementById('be-tone')) {
    force('be-tone',   tone);
    force('be-length', length);
    if (on('blog')) {
      set('be-url',   kit.url);
      set('be-topic', kit.name);
    }
  }

  /* ── ARTICLE ENGINE ── */
  if (document.getElementById('ae-tone')) {
    force('ae-tone',   tone);
    force('ae-length', length);
    force('ae-style',  style);
    if (on('article')) set('ae-url', kit.url);
  }

  /* ── EMAIL EDITOR ── */
  if (document.getElementById('em-tone')) {
    force('em-tone',   tone);
    force('em-length', length);
    if (on('email')) {
      set('em-brand', kit.name);
      set('em-url',   kit.url);
      if (kit.primary) { var g1 = document.getElementById('emGrad1'); if (g1) { g1.value = kit.primary; fire(g1,'input'); } }
      if (kit.accent)  { var g2 = document.getElementById('emGrad2'); if (g2) { g2.value = kit.accent;  fire(g2,'input'); } }
      if (kit.logo) {
        setTimeout(function () {
          var s = document.querySelectorAll('.em-section');
          if (!s.length || s[0].querySelector('.em-kit-logo')) return;
          var img = document.createElement('img');
          img.src = kit.logo; img.className = 'em-kit-logo';
          img.style.cssText = 'max-height:48px;max-width:160px;object-fit:contain;display:block;margin:0 auto 8px;pointer-events:none';
          s[0].insertBefore(img, s[0].firstChild);
        }, 400);
      }
    }
  }

  /* ── SOCIAL EDITOR ── */
  if (document.getElementById('sp-tone')) {
    force('sp-tone', tone);
    if (on('social')) {
      if (kit.name) set('sp-brief', kit.name + (kit.tagline ? ' — ' + kit.tagline : ''));
      if (kit.primary || kit.accent) {
        setTimeout(function () {
          var bg = document.getElementById('spBgLayer');
          if (!bg) return;
          var c1 = kit.primary || '#4B43C4', c2 = kit.accent || '#2E8EAC';
          var e1 = document.getElementById('spGrad1'), e2 = document.getElementById('spGrad2');
          if (e1) e1.value = c1; if (e2) e2.value = c2;
          bg.style.background = 'linear-gradient(135deg,' + c1 + ',' + c2 + ')';
          document.querySelectorAll('.sp-swatch').forEach(function(s){ s.classList.remove('active'); });
        }, 300);
      }
      if (kit.logo) {
        setTimeout(function () {
          var c = document.getElementById('spCanvas');
          if (!c || c.querySelector('.sp-kit-logo')) return;
          var img = document.createElement('img');
          img.src = kit.logo; img.className = 'sp-kit-logo';
          img.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);max-height:36px;max-width:120px;object-fit:contain;z-index:20;pointer-events:none';
          c.appendChild(img);
        }, 400);
      }
    }
  }

  /* ── SCRIPT WRITER ── */
  if (on('script') && tone && typeof window.SCRIPT !== 'undefined') {
    var tEl = document.getElementById('toneSelect');
    if (tEl && tEl.querySelector('option[value="' + tone + '"]')) { tEl.value = tone; window.SCRIPT.tone = tone; }
  }

  /* ── BOOK WRITER ── */
  if (on('book') && tone && typeof window.BOOK !== 'undefined') {
    var bEl = document.getElementById('toneSelect');
    if (bEl && bEl.querySelector('option[value="' + tone + '"]')) { bEl.value = tone; window.BOOK.tone = tone; }
  }

})();
