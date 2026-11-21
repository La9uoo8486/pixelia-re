# Pixelia Pokemon Server 사전예약 사이트

정적 사이트(HTML/CSS/JS, 빌드 없음) + Supabase. GitHub Pages로 배포합니다.

| 주소 | 내용 |
|---|---|
| `https://la9uoo8486.github.io/pixelia-re/` | 사전예약 페이지 (폼, 카운트다운, 목표 게이지, 홍보 랭킹) |
| `…/pixelia-re/admin.html` | 관리자 페이지 |
| `…/pixelia-re/r/닉네임` | 짧은 추천 링크 (`?ref=닉네임` 으로 자동 이동) |

`config.js` 의 `SUPABASE_URL` 이 비어 있으면 **데모 모드**로 동작합니다 (이 기기에만 저장, 화면 위에 노란 띠 표시). 설정 전에 디자인 확인용으로 쓰면 됩니다.

## 파일 구조
```
index.html            사전예약 페이지
admin.html            관리자 페이지
404.html              /r/닉네임 짧은 링크 처리 
config.js             설정값 (Supabase, 캡차, 디스코드, 오픈 시각, 보상 문구)
css/style.css         디자인
js/common.js          검증·Supabase·데모 모드 공통 코드
js/app.js             사전예약 페이지 동작
js/admin.js           관리자 페이지 동작
supabase/schema.sql   테이블, RLS, 함수
```
저장소 최상위의 `/404.html` 이 실제로 `/r/` 링크를 처리합니다 (GitHub Pages는 최상위 404.html만 사용).

---

## 1. Supabase 설정 (약 10분)

1. https://supabase.com 로그인 → **New project** (무료). 포켓배틀 노트와 섞이지 않게 **새 프로젝트**를 권장합니다. Region은 `Northeast Asia (Seoul)`.
2. 왼쪽 **SQL Editor** → `supabase/schema.sql` 내용을 전부 붙여넣고 **Run**.
3. **Authentication → Sign In / Providers**
   - **Allow anonymous sign-ins** 켜기 (방문자가 예약할 때 필요)
   - **Allow new users to sign up** 은 켜둔 상태 유지 (꺼도 관리자 권한은 안 생기니 안전합니다)
4. **Authentication → Users → Add user → Create new user**
   - 관리자 이메일과 비밀번호 입력, **Auto Confirm User** 체크 → 생성
5. 다시 **SQL Editor** 에서 아래 한 줄 실행 (이메일만 바꾸기). 이 표에 있는 계정만 관리자 페이지를 볼 수 있습니다.
   ```sql
   insert into public.admins (user_id, note)
   select id, email from auth.users where email = '내관리자이메일@example.com'
   on conflict do nothing;
   ```
6. **Project Settings → API Keys** 에서
   - Project URL → `config.js` 의 `SUPABASE_URL`
   - `anon` 또는 `publishable` 키 → `SUPABASE_ANON_KEY`
   - ⚠️ `service_role` / `secret` 키는 **절대** 넣지 마세요.

## 2. Cloudflare Turnstile 캡차 (선택)

봇 도배를 막습니다. 안 쓰려면 이 단계는 건너뛰세요 (두 곳 모두 비워둔 상태).

1. https://dash.cloudflare.com → **Turnstile → Add widget**
   - Hostname: `la9uoo8486.github.io` (도메인을 연결했다면 그 도메인)
   - Widget mode: Managed
2. **사이트 키** → `config.js` 의 `TURNSTILE_SITE_KEY`
3. **비밀 키** → Supabase **Authentication → Attack Protection** → **Enable Captcha protection** 켜기 → Provider `Turnstile` → Secret key 붙여넣기 → Save

> 캡차 검증은 Supabase 서버가 직접 합니다. 두 곳 중 **Supabase 쪽만 켜고 사이트 키를 비우면 예약이 실패**하니 꼭 둘 다 넣거나 둘 다 비우세요.

## 3. config.js 나머지 값

| 항목 | 설명 |
|---|---|
| `DISCORD_URL` | 디스코드 초대 링크. 비우면 버튼 숨김 |
| `OPEN_AT` | 오픈 시각 (기본 `2026-12-01T00:00:00+09:00`) |
| `GOALS` | 목표 인원과 보상 문구 (지금은 예시 문구) |
| `TOP_PROMOTER_REWARD` | 홍보 1위 추가 보상 문구 |
| `SITE_URL` | 커스텀 도메인 쓸 때만. 예: `https://pixelia.kr/` |

아이패드에서는 GitHub 웹에서 `config.js` → 연필 아이콘 → 수정 → **Commit changes** 로 바꾸면 됩니다.

## 4. GitHub Pages 배포

1. 저장소 **Settings → Pages** → Source: **Deploy from a branch**, Branch: `main` / `(root)` → Save (이미 켜져 있으면 생략)
2. 1~2분 뒤 접속
   - 사전예약: `https://la9uoo8486.github.io/pixelia-re/`
   - 관리자: `https://la9uoo8486.github.io/pixelia-re/admin.html`
   - 추천 링크 예: `https://la9uoo8486.github.io/pixelia-re/r/Steve01`


## 5. 확인 순서

1. 사전예약 페이지에서 테스트 닉네임으로 예약 → "1번째 사전예약자" 확인
2. 완료 화면의 추천 링크를 **다른 브라우저/시크릿 창**에서 열기 → 추천인 자동 입력, "친구 추천" 자동 선택 확인 → 예약
3. 랭킹에 첫 번째 닉네임이 1명으로 뜨는지 확인
4. 관리자 페이지 로그인 → 표, 그래프, 랭킹, CSV 확인
5. 테스트 데이터는 관리자 페이지에서 **삭제**

---

## 동작 방식 / 정책

- **중복 방지**: 기기당 1회(localStorage) + DB에서 닉네임 대소문자 무시 UNIQUE + 익명 계정당 1건. 브라우저 데이터를 지우면 같은 기기에서도 다시 예약할 수는 있지만, 같은 닉네임은 불가.
- **IP당 1회**: 같은 인터넷(공인 IP)에서는 1건만 예약 가능. DB 트리거가 서버에서 검사하므로 프론트를 고쳐도 우회 불가.
  - IP 원문은 저장하지 않고 `HMAC-SHA256(IP, 비밀 salt)` 해시만 `prereg_ip_locks` 표에 저장 (API로 조회 불가). IPv6는 /64 단위.
  - 관리자 페이지에서 **삭제**하면 그 IP는 다시 예약 가능, **무효**는 계속 막힘.
  - 같은 와이파이(가족·기숙사·학교·PC방)나 일부 모바일 데이터 사용자는 서로 막힐 수 있음 → Supabase **Table Editor**에서 직접 행을 추가하면 제한 없이 등록됨.
  - 끄기: SQL Editor에서 `update public.app_config set value = 'off' where name = 'ip_limit';` (켜기는 `'on'`)
  - 기존 예약자는 IP 기록이 없어서 제한 대상이 아님 (적용 이후 예약부터).
- **추천 링크**: `?ref=` 또는 `/r/` 로 처음 들어온 추천인을 기기에 저장해서 새로고침해도 유지. 추천인 칸이 그 링크의 닉네임과 같으면 `ref 경유`로 기록, 직접 바꾸면 `직접 입력`.
- **공개 랭킹**: 무효 처리된 예약은 제외. 추천인 **본인도 사전예약한 경우에만** 공개 랭킹에 표시 (오타·가짜 닉네임 방지). 관리자 랭킹에는 미예약 추천인도 "미예약" 표시로 보입니다.
- **무효 vs 삭제**: 무효는 기록은 남기고 카운트·랭킹에서만 제외 (복구 가능). 삭제는 영구 삭제.
- **실시간 카운트**: 30초마다 갱신 (탭을 안 보고 있을 땐 멈춤).

## 보안

- RLS: 방문자는 **INSERT만** 가능 (그것도 닉네임·유입경로·추천인 칸만). 조회·수정·삭제는 `admins` 표에 있는 계정만.
- 공개 페이지는 개인 정보가 없는 함수(`get_public_stats`, `get_promoter_ranking`)로만 숫자와 랭킹을 받습니다.
- 닉네임 형식, 자기 추천 금지, 유입 경로 값 등은 DB 제약으로 서버에서 한 번 더 검사합니다.
- 프론트 코드에는 공개용 anon 키만 들어갑니다.
