// 공통: 설정, 검증, 백엔드(Supabase / 데모)
export const C = window.PIXELIA_CONFIG || {};
export const IS_DEMO = !C.SUPABASE_URL || !C.SUPABASE_ANON_KEY;

// 닉네임: 3~16자, 영문/숫자/밑줄/공백 (앞뒤 공백·연속 공백 불가) - DB 제약과 동일
export const NICK_RE = /^[A-Za-z0-9_ ]{3,16}$/;
export const normalizeNick = s => String(s ?? '').trim().replace(/\s+/g, ' ');
export const validNick = s => NICK_RE.test(s) && s === s.trim() && !s.includes('  ');

export const SOURCES = [
  { id: 'youtube', label: '유튜브' },
  { id: 'tiktok', label: '틱톡' },
  { id: 'discord', label: '디스코드' },
  { id: 'friend', label: '친구 추천' },
  { id: 'etc', label: '기타' },
];
export const sourceLabel = id => SOURCES.find(s => s.id === id)?.label ?? id;

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
  json(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
};

export class AppError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

// ---------------- Supabase ----------------
let sbPromise = null;
function getClient(storageKey) {
  if (!sbPromise) {
    sbPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm')
      .then(({ createClient }) => createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
        auth: { storageKey, persistSession: true, autoRefreshToken: true },
      }));
  }
  return sbPromise;
}

function sbBackend(storageKey) {
  const sb = () => getClient(storageKey);
  return {
    async stats() {
      const { data, error } = await (await sb()).rpc('get_public_stats');
      if (error) throw error;
      return data;
    },
    async ranking() {
      const { data, error } = await (await sb()).rpc('get_promoter_ranking');
      if (error) throw error;
      return data || [];
    },
    async myPosition() {
      const c = await sb();
      const { data: { session } } = await c.auth.getSession();
      if (!session) return null;
      const { data, error } = await c.rpc('my_position');
      if (error) throw error;
      return data;
    },
    async register(row, captchaToken) {
      const c = await sb();
      let { data: { session } } = await c.auth.getSession();
      if (!session) {
        const { error } = await c.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
        if (error) {
          if (/captcha/i.test(error.message)) throw new AppError('CAPTCHA');
          if (/anonymous/i.test(error.message)) throw new AppError('ANON_OFF');
          if (error.status === 429) throw new AppError('RATE');
          throw error;
        }
      }
      const { error } = await c.from('preregistrations').insert(row);
      if (error) {
        const t = `${error.message} ${error.details || ''}`;
        if (error.code === '23505' && t.includes('nickname_key')) throw new AppError('DUP_NICK');
        if (error.code === '23505' && t.includes('user_id')) throw new AppError('ALREADY');
        if (error.code === '23514') throw new AppError('INVALID');
        if (t.includes('IP_ALREADY_REGISTERED') || (error.code === '23505' && t.includes('prereg_ip_locks'))) throw new AppError('IP_USED');
        throw error;
      }
      return this.myPosition();
    },

    // 관리자
    async signIn(email, password, captchaToken) {
      const { error } = await (await sb()).auth.signInWithPassword({
        email, password, ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      if (error) throw error;
    },
    async signOut() { await (await sb()).auth.signOut(); },
    async sessionEmail() {
      const { data: { session } } = await (await sb()).auth.getSession();
      return session && !session.user.is_anonymous ? session.user.email : null;
    },
    async isAdmin() {
      const { data, error } = await (await sb()).rpc('is_admin');
      if (error) throw error;
      return !!data;
    },
    async list() {
      const c = await sb();
      const all = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await c.from('preregistrations').select('*').order('id').range(from, from + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) break;
      }
      return all;
    },
    async update(id, patch) {
      const { error } = await (await sb()).from('preregistrations').update(patch).eq('id', id);
      if (error) throw error;
    },
    async remove(id) {
      const { error } = await (await sb()).from('preregistrations').delete().eq('id', id);
      if (error) throw error;
    },
  };
}

// ---------------- 데모 (이 기기 localStorage) ----------------
const DEMO_KEY = 'pixelia_demo_rows';
function demoRows() {
  let rows = ls.json(DEMO_KEY);
  if (!Array.isArray(rows)) {
    const now = Date.now();
    const seed = [
      ['Steve01', 'youtube'], ['PikaKing', 'friend', 'Steve01', true], ['Blue Fire', 'friend', 'Steve01', true],
      ['ash_red', 'tiktok'], ['MewTwo99', 'friend', 'PikaKing', true], ['Dragonite', 'discord'],
      ['Gengar 7', 'friend', 'Steve01', false], ['eevee_lv5', 'etc', null, false, '카페 글'], ['Snorlax', 'friend', 'PikaKing', false],
      ['Lucario', 'youtube'],
    ];
    rows = seed.map(([nickname, source, referrer = null, via_ref = false, source_etc = null], i) => ({
      id: i + 1, nickname, source, source_etc, referrer, via_ref,
      created_at: new Date(now - (seed.length - i) * 7.3 * 3600e3).toISOString(),
      is_void: false, reward_given: false, top_reward_given: false,
    }));
    ls.set(DEMO_KEY, JSON.stringify(rows));
  }
  return rows;
}
const demoSave = rows => ls.set(DEMO_KEY, JSON.stringify(rows));
function demoRanking(rows) {
  const valid = rows.filter(r => !r.is_void);
  const byKey = new Map(valid.map(r => [r.nickname.toLowerCase(), r]));
  const cnt = new Map();
  for (const r of valid) {
    if (!r.referrer) continue;
    const p = byKey.get(r.referrer.toLowerCase());
    if (p) cnt.set(p, (cnt.get(p) || 0) + 1);
  }
  return [...cnt].sort((a, b) => b[1] - a[1] || a[0].id - b[0].id).slice(0, 10)
    .map(([p, n]) => ({ nickname: p.nickname, referrals: n }));
}

function demoBackend() {
  const wait = () => new Promise(r => setTimeout(r, 250));
  return {
    async stats() { return { total: demoRows().filter(r => !r.is_void).length }; },
    async ranking() { return demoRanking(demoRows()); },
    async myPosition() {
      const me = ls.get('pixelia_demo_me'); if (!me) return null;
      const rows = demoRows(); const mine = rows.find(r => r.id === +me);
      if (!mine) return null;
      return { nickname: mine.nickname, position: rows.filter(r => r.id <= mine.id && !r.is_void).length };
    },
    async register(row) {
      await wait();
      const rows = demoRows();
      if (rows.some(r => r.nickname.toLowerCase() === row.nickname.toLowerCase())) throw new AppError('DUP_NICK');
      const id = Math.max(0, ...rows.map(r => r.id)) + 1;
      rows.push({ id, ...row, created_at: new Date().toISOString(), is_void: false, reward_given: false, top_reward_given: false });
      demoSave(rows);
      ls.set('pixelia_demo_me', String(id));
      return this.myPosition();
    },
    async signIn() { ls.set('pixelia_demo_admin', '1'); },
    async signOut() { ls.del('pixelia_demo_admin'); },
    async sessionEmail() { return ls.get('pixelia_demo_admin') ? 'demo@local' : null; },
    async isAdmin() { return true; },
    async list() { return demoRows(); },
    async update(id, patch) { demoSave(demoRows().map(r => r.id === id ? { ...r, ...patch } : r)); },
    async remove(id) { demoSave(demoRows().filter(r => r.id !== id)); },
  };
}

export const getBackend = storageKey => IS_DEMO ? demoBackend() : sbBackend(storageKey);

export const fmtKST = iso => new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
