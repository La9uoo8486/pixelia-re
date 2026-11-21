import { C, IS_DEMO, SOURCES, normalizeNick, validNick, esc, ls, getBackend } from './common.js';

const api = getBackend('pixelia-public');
const $ = id => document.getElementById(id);
const LS_REF = 'pixelia_ref';    // 처음 들어온 추천인
const LS_DONE = 'pixelia_done';  // 이 기기의 예약 정보 {nickname, position}

if (IS_DEMO) $('demoBar').hidden = false;

// ---------- 링크 ----------
const baseUrl = () => (C.SITE_URL || (location.origin + location.pathname.replace(/[^/]*$/, ''))).replace(/\/?$/, '/');
const refLink = nick => baseUrl() + 'r/' + encodeURIComponent(nick);

for (const a of [$('discordBtn'), $('discordFoot')]) {
  if (C.DISCORD_URL) a.href = C.DISCORD_URL; else a.hidden = true;
}

// ---------- 추천 ref 저장 (처음 들어온 값 유지) ----------
function captureRef() {
  const params = new URLSearchParams(location.search);
  if (params.has('ref')) {
    const r = normalizeNick(params.get('ref'));
    if (validNick(r) && !ls.get(LS_REF)) ls.set(LS_REF, r);
    params.delete('ref');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  }
  const saved = ls.get(LS_REF);
  return saved && validNick(saved) ? saved : null;
}
const REF = captureRef();

// ---------- 토스트 ----------
let toastT;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- 사전예약 보상 ----------
{
  const r = C.PREREG_REWARD || {};
  const items = (r.items || []).filter(Boolean);
  if (items.length) {
    $('preRewardList').innerHTML = items.map(t => `<li>${esc(t)}</li>`).join('');
    $('preRewardNote').textContent = r.note ? '📬 ' + r.note : '';
    $('preReward').hidden = false;
  }
}

// ---------- 카운트다운 ----------
const OPEN = Date.parse(C.OPEN_AT || '2026-12-01T00:00:00+09:00');
$('openDate').textContent = new Date(OPEN).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}) + ' 오픈 (한국시간)';
const pad = n => String(n).padStart(2, '0');
function tick() {
  const left = Math.max(0, OPEN - Date.now());
  if (left === 0) {
    $('countdown').innerHTML = '<p class="open-now">🎉 서버 오픈! 지금 접속하세요</p>';
    clearInterval(cdTimer);
    return;
  }
  const s = Math.floor(left / 1000);
  $('cdD').textContent = Math.floor(s / 86400);
  $('cdH').textContent = pad(Math.floor(s / 3600) % 24);
  $('cdM').textContent = pad(Math.floor(s / 60) % 60);
  $('cdS').textContent = pad(s % 60);
}
const cdTimer = setInterval(tick, 1000); tick();

// ---------- 목표 게이지 ----------
const GOALS = (C.GOALS || []).slice().sort((a, b) => a.count - b.count);
const MAX = GOALS.length ? GOALS[GOALS.length - 1].count : 100;
$('gauge').setAttribute('aria-valuemax', MAX);
$('gaugeMarks').innerHTML = GOALS.map(g =>
  `<span class="mark" style="left:${(g.count / MAX) * 100}%"><i></i><em>${g.count}</em></span>`).join('');

function renderGauge(total) {
  $('total').textContent = total.toLocaleString('ko-KR');
  $('gaugeFill').style.width = Math.min(100, (total / MAX) * 100) + '%';
  $('gauge').setAttribute('aria-valuenow', total);
  $('goalList').innerHTML = GOALS.map(g => {
    const ok = total >= g.count;
    return `<li class="${ok ? 'ok' : ''}"><span class="goal-n">${g.count}명</span><span class="goal-r">${esc(g.reward)}</span><span class="goal-s">${ok ? '달성!' : `${g.count - total}명 남음`}</span></li>`;
  }).join('');
}

// ---------- 랭킹 ----------
$('topReward').textContent = C.TOP_PROMOTER_REWARD ? ` (${C.TOP_PROMOTER_REWARD})` : '';
function renderRanking(list) {
  if (!list.length) { $('ranking').innerHTML = '<li class="muted empty">아직 랭킹이 없어요. 첫 1위의 주인공이 되어보세요!</li>'; return; }
  let rank = 0, prev = null;
  $('ranking').innerHTML = list.map((r, i) => {
    if (r.referrals !== prev) { rank = i + 1; prev = r.referrals; }
    const cls = rank === 1 ? 'top1' : rank <= 3 ? 'top3' : '';
    return `<li class="${cls}"><span class="rk">${rank === 1 ? '<span class="crown" aria-label="1위">👑</span>' : rank}</span>` +
      `<span class="nm">${esc(r.nickname)}</span><span class="ct">${r.referrals}명</span></li>`;
  }).join('');
}

// ---------- 주기 갱신 (30초, 화면 숨김 시 중지) ----------
async function refresh() {
  try {
    const [s, r] = await Promise.all([api.stats(), api.ranking()]);
    renderGauge(s?.total ?? 0);
    renderRanking(r);
  } catch (e) {
    console.error(e);
    if ($('total').textContent === '-') $('ranking').innerHTML = '<li class="muted">불러오지 못했어요. 잠시 후 다시 시도해주세요.</li>';
  }
}
let pollT = null;
function startPoll() { if (!pollT) pollT = setInterval(refresh, 30000); }
function stopPoll() { clearInterval(pollT); pollT = null; }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPoll(); else { refresh(); startPoll(); }
});
refresh(); startPoll();

// ---------- 폼 ----------
let source = null;
$('sources').innerHTML = SOURCES.map(s =>
  `<button type="button" class="chip" data-id="${s.id}" aria-pressed="false">${s.label}</button>`).join('');
function setSource(id) {
  source = id;
  for (const b of $('sources').children) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  $('sourceEtc').hidden = id !== 'etc';
  if (id === 'etc') $('sourceEtc').focus();
}
$('sources').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) setSource(b.dataset.id); });

if (REF) {
  $('referrer').value = REF;
  setSource('friend');
  $('refHint').hidden = false;
  $('refHint').innerHTML = `🎁 <b>${esc(REF)}</b> 님의 추천 링크로 들어왔어요`;
}

// Turnstile (사이트 키가 있을 때만)
let captchaId = null, captchaToken = '';
if (C.TURNSTILE_SITE_KEY) {
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
} else {
  $('captcha').hidden = true;
}
const resetCaptcha = () => { if (captchaId !== null) { window.turnstile.reset(captchaId); captchaToken = ''; } };

const ERR = {
  DUP_NICK: '이미 사전예약된 닉네임이에요.',
  ALREADY: '이 기기는 이미 사전예약했어요.',
  IP_USED: '이 인터넷(와이파이)에서는 이미 사전예약했어요. 한 사람당 한 번만 가능해요. 가족·친구와 같은 와이파이라면 디스코드로 문의해주세요.',
  CAPTCHA: '보안 확인에 실패했어요. 다시 시도해주세요.',
  RATE: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.',
  INVALID: '입력값을 다시 확인해주세요.',
  ANON_OFF: '서버 설정 오류예요. (관리자: Supabase 익명 로그인을 켜주세요)',
};
const showErr = msg => { $('formError').textContent = msg; };

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  showErr('');
  const nickname = normalizeNick($('nick').value);
  const referrer = normalizeNick($('referrer').value);
  const etc = $('sourceEtc').value.trim();
  $('nick').value = nickname; $('referrer').value = referrer;

  if (!validNick(nickname)) { $('nick').focus(); return showErr('닉네임은 3~16자의 영문, 숫자, 밑줄(_), 공백만 쓸 수 있어요.'); }
  if (!source) return showErr('어디서 보고 오셨는지 골라주세요.');
  if (source === 'etc' && !etc) { $('sourceEtc').focus(); return showErr('기타 내용을 적어주세요.'); }
  if (referrer && !validNick(referrer)) { $('referrer').focus(); return showErr('추천인 닉네임 형식이 올바르지 않아요.'); }
  if (referrer && referrer.toLowerCase() === nickname.toLowerCase()) return showErr('본인을 추천인으로 입력할 수 없어요.');
  if (C.TURNSTILE_SITE_KEY && !captchaToken) return showErr('보안 확인(캡차)을 완료해주세요.');

  const row = {
    nickname,
    source,
    source_etc: source === 'etc' ? etc.slice(0, 50) : null,
    referrer: referrer || null,
    via_ref: !!(REF && referrer && referrer.toLowerCase() === REF.toLowerCase()),
  };

  const btn = $('submit');
  btn.disabled = true; btn.textContent = '저장 중...';
  try {
    const me = await api.register(row, captchaToken);
    finish(me?.nickname || nickname, me?.position);
    refresh();
  } catch (err) {
    console.error(err);
    if (err.code === 'ALREADY') {
      const me = await api.myPosition().catch(() => null);
      if (me) { finish(me.nickname, me.position); return; }
    }
    showErr(ERR[err.code] || '저장하지 못했어요. 잠시 후 다시 시도해주세요.');
    resetCaptcha();
  } finally {
    btn.disabled = false; btn.textContent = '사전예약 완료하기 ▶';
  }
});

// ---------- 완료 화면 ----------
function finish(nickname, position) {
  ls.set(LS_DONE, JSON.stringify({ nickname, position: position ?? null }));
  showDone(nickname, position);
  $('donePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function showDone(nickname, position) {
  $('formPanel').hidden = true;
  $('donePanel').hidden = false;
  $('doneNick').textContent = nickname;
  $('donePos').textContent = position ? Number(position).toLocaleString('ko-KR') : '-';
  $('myLink').value = refLink(nickname);
}

$('copyBtn').addEventListener('click', async () => {
  const v = $('myLink').value;
  try { await navigator.clipboard.writeText(v); }
  catch { $('myLink').select(); document.execCommand('copy'); }
  toast('추천 링크를 복사했어요!');
});

// 이미 예약한 기기
const done = ls.json(LS_DONE);
if (done?.nickname) {
  showDone(done.nickname, done.position);
  api.myPosition().then(me => {
    if (me?.position) { showDone(me.nickname, me.position); ls.set(LS_DONE, JSON.stringify(me)); }
  }).catch(() => {});
}
