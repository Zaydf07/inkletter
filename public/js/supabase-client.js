/* global Supabase client — null when not configured (local mode) */
const _supabase = (() => {
  const cfg = window.STREAMINK_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey) return null;
  try {
    return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  } catch (e) {
    console.warn('Supabase init failed:', e.message);
    return null;
  }
})();
