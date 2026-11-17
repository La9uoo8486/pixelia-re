import { C, IS_DEMO, SOURCES, sourceLabel, esc, getBackend, fmtKST } from './common.js';

const api = getBackend('pixelia-admin');
const $ = id => document.getElementById(id);
if (IS_DEMO) $('demoBar').hidden = false;

let rows = [];
let sort = { key: 'id', dir: -1 };
let pie = null, bar = null;

let toastT;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- 로그인 ----------
function showLogin(msg = '') {
  $('loginView').hidden = false; $('dash').hidden = true; $('topActions').hidden = true;
  $('loginErr').textContent = msg;
}
async function boot() {
  try {
    const email = await api.sessionEmail();
    if (!email) return showLogin();
    if (!(await api.isAdmin())) { await api.signOut(); return showLogin('관리자 권한이 없는 계정이에요.'); }
    $('who').textContent = email;
    $('loginView').hidden = true; $('dash').hidden = false; $('topActions').hidden = false;
    await load();
  } catch (e) {
    console.error(e);
    showLogin('불러오기 실패: ' + (e.message || e));
  }
}
// Turnstile (사이트 키가 있고 데모가 아닐 때만). Supabase 캡차 보호가 켜져 있으면 로그인에 토큰이 필요함
const USE_CAPTCHA = !!C.TURNSTILE_SITE_KEY && !IS_DEMO;
let captchaId = null, captchaToken = '';
if (USE_CAPTCHA) {
  window.onTurnstileLoad = () => {
    captchaId = window.turnstile.render('#captcha', {
      sitekey: C.TURNSTILE_SITE_KEY, theme: 'dark', language: 'ko',
      callback: t => { captchaToken = t; },
      'expired-callback': () => { captchaToken = ''; },
      'error-callback': () => { captchaToken = ''; },
    });
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
  s.async = true; document.head.appendChild(s);
}
// 토큰은 한 번만 쓸 수 있으므로 로그인 시도마다 새로 발급
const resetCaptcha = () => { captchaToken = ''; if (captchaId !== null) window.turnstile.reset(captchaId); };

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginErr').textContent = '';
  if (USE_CAPTCHA && !captchaToken) { $('loginErr').textContent = '보안 확인(캡차)을 완료해주세요.'; return; }
  const btn = e.submitter || $('loginForm').querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await api.signIn($('email').value.trim(), $('pw').value, captchaToken);
    $('pw').value = '';
    await boot();
  } catch (err) {
    const m = err.message || String(err);
    $('loginErr').textContent = /invalid/i.test(m) ? '이메일 또는 비밀번호가 틀렸어요.'
      : /captcha/i.test(m) ? '보안 확인에 실패했어요. 캡차를 다시 완료해주세요.'
      : '로그인 실패: ' + m;
  } finally {
    resetCaptcha();
    btn.disabled = false;
  }
});
$('logoutBtn').addEventListener('click', async () => { await api.signOut(); rows = []; showLogin(); });
$('reloadBtn').addEventListener('click', () => load().then(() => toast('새로고침 완료')));

// ---------- 데이터 ----------
async function load() {
  rows = await api.list();
  renderAll();
}
function renderAll() {
  renderKpis(); renderCharts(); renderRanking(); renderRows();
}
const valid = () => rows.filter(r => !r.is_void);

function renderKpis() {
  const v = valid();
  const k = [
    ['전체 예약', rows.length],
    ['유효', v.length],
    ['무효', rows.length - v.length],
    ['추천인 입력', v.filter(r => r.referrer).length],
    ['링크 경유', v.filter(r => r.via_ref).length],
    ['보상 지급 완료', `${v.filter(r => r.reward_given).length}/${v.length}`],
  ];
  $('kpis').innerHTML = k.map(([l, n]) => `<div class="kpi"><span>${l}</span><b>${n}</b></div>`).join('');
}

// ---------- 차트 ----------
const COLORS = ['#ef4b4b', '#ffffff', '#5865f2', '#ffcb3b', '#4ade80'];
function renderCharts() {
  if (!window.Chart) { setTimeout(renderCharts, 300); return; }
  const v = valid();
  Chart.defaults.color = '#9aa0d0';
  Chart.defaults.font.family = "'Galmuri11', system-ui, sans-serif";

  const counts = SOURCES.map(s => v.filter(r => r.source === s.id).length);
  const pieData = { labels: SOURCES.map(s => s.label), datasets: [{ data: counts, backgroundColor: COLORS, borderColor: '#1b1f40', borderWidth: 3 }] };
  if (pie) { pie.data = pieData; pie.update(); }
  else pie = new Chart($('pie'), { type: 'pie', data: pieData, options: {
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: {
      label: c => { const t = counts.reduce((a, b) => a + b, 0) || 1; return ` ${c.label}: ${c.raw}명 (${Math.round(c.raw / t * 100)}%)`; },
    } } },
  } });

  // 일별 (KST)
  const day = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const map = new Map();
  for (const r of v) { const d = day(r.created_at); map.set(d, (map.get(d) || 0) + 1); }
  const days = [];
  if (map.size) {
    const keys = [...map.keys()].sort();
    for (let d = new Date(keys[0] + 'T00:00:00Z'), end = new Date(keys.at(-1) + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1))
      days.push(d.toISOString().slice(0, 10));
  }
  const barData = { labels: days.map(d => d.slice(5).replace('-', '/')), datasets: [{ label: '예약 수', data: days.map(d => map.get(d) || 0), backgroundColor: '#4ade80' }] };
  const barOpts = { maintainAspectRatio: false, plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#2a2f5c' } }, x: { grid: { display: false } } } };
  if (bar) { bar.data = barData; bar.update(); }
  else bar = new Chart($('bar'), { type: 'bar', data: barData, options: barOpts });
}

// ---------- 홍보자 랭킹 ----------
function promoters() {
  const v = valid();
  const own = new Map(v.map(r => [r.nickname.toLowerCase(), r]));
  const map = new Map();
  for (const r of v) {
    if (!r.referrer) continue;
    const key = r.referrer.toLowerCase();
    const p = map.get(key) || { key, name: own.get(key)?.nickname || r.referrer, row: own.get(key) || null, total: 0, viaRef: 0, direct: 0 };
    p.total++; if (r.via_ref) p.viaRef++; else p.direct++;
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || (a.row?.id ?? 1e12) - (b.row?.id ?? 1e12));
}
function renderRanking() {
  const list = promoters();
  if (!list.length) { $('rankBody').innerHTML = '<tr><td colspan="6" class="muted">아직 추천 기록이 없어요.</td></tr>'; return; }
  let rank = 0, prev = null;
  $('rankBody').innerHTML = list.map((p, i) => {
    if (p.total !== prev) { rank = i + 1; prev = p.total; }
    const chk = p.row
      ? `<input type="checkbox" data-id="${p.row.id}" data-field="top_reward_given" ${p.row.top_reward_given ? 'checked' : ''} aria-label="${esc(p.name)} 1위 보상 지급">`
      : '<span class="muted">-</span>';
    return `<tr><td>${rank === 1 ? '👑 1' : rank}</td><td>${esc(p.name)}${p.row ? '' : '<span class="tag">미예약</span>'}</td>` +
      `<td class="num">${p.total}</td><td class="num">${p.viaRef}</td><td class="num">${p.direct}</td><td class="chk">${chk}</td></tr>`;
  }).join('');
}

// ---------- 예약자 표 ----------
function filtered() {
  const q = $('search').value.trim().toLowerCase();
  const f = $('filter').value;
  return rows.filter(r => {
    if (f === 'valid' && r.is_void) return false;
    if (f === 'void' && !r.is_void) return false;
    if (f === 'unpaid' && (r.is_void || r.reward_given)) return false;
    if (!q) return true;
    return r.nickname.toLowerCase().includes(q) || (r.referrer || '').toLowerCase().includes(q) || (r.source_etc || '').toLowerCase().includes(q);
  }).sort((a, b) => {
    const k = sort.key;
    let x = a[k], y = b[k];
    if (k === 'source') { x = sourceLabel(x); y = sourceLabel(y); }
    if (typeof x === 'string' || typeof y === 'string') return (x || '').localeCompare(y || '', 'ko', { sensitivity: 'base' }) * sort.dir;
    return ((x === y) ? 0 : (x > y ? 1 : -1)) * sort.dir || (a.id - b.id);
  });
}
function renderRows() {
  const list = filtered();
  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.querySelector('.arrow')?.remove();
    if (th.dataset.sort === sort.key) th.insertAdjacentHTML('beforeend', `<span class="arrow"> ${sort.dir > 0 ? '▲' : '▼'}</span>`);
  }
  $('rowsBody').innerHTML = list.map(r => `
    <tr class="${r.is_void ? 'void' : ''}">
      <td class="num">${r.id}</td>
      <td>${esc(r.nickname)}</td>
      <td>${esc(sourceLabel(r.source))}${r.source_etc ? ` <span class="muted">(${esc(r.source_etc)})</span>` : ''}</td>
      <td>${r.referrer ? esc(r.referrer) : '<span class="muted">-</span>'}</td>
      <td>${r.via_ref ? '<span class="tag yes">링크</span>' : (r.referrer ? '<span class="tag">직접</span>' : '<span class="muted">-</span>')}</td>
      <td>${fmtKST(r.created_at)}</td>
      <td class="chk"><input type="checkbox" data-id="${r.id}" data-field="reward_given" ${r.reward_given ? 'checked' : ''} aria-label="${esc(r.nickname)} 보상 지급"></td>
      <td class="chk"><input type="checkbox" data-id="${r.id}" data-field="top_reward_given" ${r.top_reward_given ? 'checked' : ''} aria-label="${esc(r.nickname)} 1위 보상 지급"></td>
      <td class="act">
        <button type="button" data-act="void" data-id="${r.id}">${r.is_void ? '복구' : '무효'}</button>
        <button type="button" data-act="del" data-id="${r.id}" class="del">삭제</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">결과 없음</td></tr>';
  $('rowCount').textContent = `${list.length}건 표시 / 전체 ${rows.length}건`;
}
$('search').addEventListener('input', renderRows);
$('filter').addEventListener('change', renderRows);
for (const th of document.querySelectorAll('th[data-sort]')) {
  th.addEventListener('click', () => {
    const k = th.dataset.sort;
    sort = sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: k === 'created_at' || k === 'id' ? -1 : 1 };
    renderRows();
  });
}

// ---------- 수정 ----------
async function patch(id, data, okMsg) {
  try {
    await api.update(id, data);
    const r = rows.find(x => x.id === id); Object.assign(r, data);
    renderAll();
    if (okMsg) toast(okMsg);
  } catch (e) {
    console.error(e); toast('저장 실패: ' + (e.message || e)); renderAll();
  }
}
document.addEventListener('change', e => {
  const c = e.target;
  if (c.matches('input[type=checkbox][data-field]')) patch(+c.dataset.id, { [c.dataset.field]: c.checked }, '저장됨');
});
$('rowsBody').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = +b.dataset.id; const r = rows.find(x => x.id === id);
  if (b.dataset.act === 'void') {
    patch(id, { is_void: !r.is_void }, r.is_void ? '복구했어요' : '무효 처리했어요 (랭킹·카운트에서 제외)');
  } else if (confirm(`"${r.nickname}" 예약을 완전히 삭제할까요? 되돌릴 수 없어요.\n(기록을 남기려면 '무효'를 쓰세요)`)) {
    try { await api.remove(id); rows = rows.filter(x => x.id !== id); renderAll(); toast('삭제했어요'); }
    catch (err) { toast('삭제 실패: ' + (err.message || err)); }
  }
});

// ---------- CSV ----------
$('csvBtn').addEventListener('click', () => {
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 엑셀 수식 실행 방지
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['번호', '닉네임', '유입경로', '기타내용', '홍보자', 'ref경유', '예약시각(KST)', '무효', '보상지급', '1위보상지급'];
  const yn = b => b ? 'O' : '';
  const lines = rows.slice().sort((a, b) => a.id - b.id).map(r => [
    r.id, r.nickname, sourceLabel(r.source), r.source_etc, r.referrer, yn(r.via_ref),
    new Date(r.created_at).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }), yn(r.is_void), yn(r.reward_given), yn(r.top_reward_given),
  ].map(cell).join(','));
  const csv = '﻿' + [head.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `pixelia-preregister-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

boot();
