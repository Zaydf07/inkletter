/* DocStore — async dual-mode: Supabase when available, localStorage fallback */
const DocStore = (() => {
  const LS_KEY = 'StreamInk_Docs';

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function now() { return new Date().toISOString(); }

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  }

  function lsWrite(docs) {
    localStorage.setItem(LS_KEY, JSON.stringify(docs));
  }

  function isUUID(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
  }

  function toClient(row) {
    return {
      id:           row.id,
      title:        row.title,
      category:     row.category,
      template:     row.template,
      content:      row.content,
      canvasStyles: row.canvas_styles,
      createdAt:    row.created_at,
      updatedAt:    row.updated_at,
    };
  }

  async function sbUser() {
    if (!_supabase) return null;
    const { data: { user } } = await _supabase.auth.getUser();
    return user;
  }

  async function getAll() {
    if (_supabase) {
      const user = await sbUser();
      if (!user) return [];
      const { data, error } = await _supabase
        .from('documents')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (error) { console.error('DocStore.getAll:', error); return []; }
      return (data || []).map(toClient);
    }
    return lsRead().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  async function get(id) {
    if (!id) return null;
    if (_supabase && isUUID(id)) {
      const user = await sbUser();
      if (!user) return null;
      const { data, error } = await _supabase
        .from('documents')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();
      if (error) { console.error('DocStore.get:', error); return null; }
      return data ? toClient(data) : null;
    }
    return lsRead().find(d => d.id === id) || null;
  }

  async function save(doc) {
    if (_supabase) {
      const user = await sbUser();
      if (!user) return null;
      const row = {
        user_id:      user.id,
        title:        doc.title        || 'Untitled',
        category:     doc.category     || 'blog',
        template:     doc.template     || '',
        content:      doc.content      || '',
        canvas_styles: doc.canvasStyles || '',
        updated_at:   now(),
      };
      if (doc.id && isUUID(doc.id)) {
        const { data, error } = await _supabase
          .from('documents')
          .update(row)
          .eq('id', doc.id)
          .eq('user_id', user.id)
          .select('id')
          .single();
        if (error) { console.error('DocStore.save update:', error); return null; }
        return data?.id || null;
      }
      row.created_at = now();
      const { data, error } = await _supabase
        .from('documents')
        .insert(row)
        .select('id')
        .single();
      if (error) { console.error('DocStore.save insert:', error); return null; }
      return data?.id || null;
    }
    /* localStorage */
    const docs = lsRead();
    const ts   = now();
    if (doc.id) {
      const idx = docs.findIndex(d => d.id === doc.id);
      if (idx !== -1) {
        docs[idx] = { ...docs[idx], ...doc, updatedAt: ts };
        lsWrite(docs);
        return doc.id;
      }
    }
    const newDoc = {
      id:           uid(),
      title:        doc.title        || 'Untitled',
      category:     doc.category     || 'blog',
      template:     doc.template     || '',
      content:      doc.content      || '',
      canvasStyles: doc.canvasStyles || '',
      createdAt:    ts,
      updatedAt:    ts,
    };
    docs.unshift(newDoc);
    lsWrite(docs);
    return newDoc.id;
  }

  async function del(id) {
    if (!id) return;
    if (_supabase && isUUID(id)) {
      const user = await sbUser();
      if (!user) return;
      const { error } = await _supabase
        .from('documents')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) console.error('DocStore.delete:', error);
      return;
    }
    lsWrite(lsRead().filter(d => d.id !== id));
  }

  async function stats() {
    const docs = await getAll();
    let bytes = 0;
    if (!_supabase) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        bytes += (localStorage.getItem(k) || '').length * 2;
      }
    } else {
      bytes = new TextEncoder().encode(JSON.stringify(docs)).length;
    }
    return { count: docs.length, bytes };
  }

  return { getAll, get, save, delete: del, stats };
})();

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
