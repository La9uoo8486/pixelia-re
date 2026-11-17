// 픽셀리아 사전예약 설정 파일 (여기만 고치면 됩니다)
// SUPABASE_ANON_KEY 는 공개용 키(anon / publishable)만 넣으세요.
// service_role / secret 키, 관리자 비밀번호는 절대 넣지 마세요.
// SUPABASE_URL 을 비워두면 "데모 모드"(이 기기에만 저장)로 동작합니다.
window.PIXELIA_CONFIG = {
  SERVER_NAME: 'Pixelia Pokemon Server',

  SUPABASE_URL: 'https://qldgthjmasmclpswrexb.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_OkwtMbYsbJ55kVLjHbf-6g_WDrC285P',

  // Cloudflare Turnstile 사이트 키. 비워두면 캡차 없이 동작
  TURNSTILE_SITE_KEY: '0x4AAAAAAGFSlCb52tzpHbVS',

  // 디스코드 초대 링크
  DISCORD_URL: 'https://discord.gg/EFZH5YXpYx',

  // 추천 링크 기본 주소. 비워두면 현재 주소 기준 자동 (도메인 연결 시에만 입력, 끝에 / 포함)
  SITE_URL: '',

  // 오픈 시각 (KST)
  OPEN_AT: '2026-12-01T00:00:00+09:00',

  // 목표 게이지 보상 단계
  GOALS: [
    { count: 20, reward: '전원 경험치 조각 (라지) 5개' },
    { count: 50, reward: '전원 경험치 사탕 15개' },
    { count: 100, reward: '전원 뽑기권 5장 + 재화 10,000원' },
  ],

  // 홍보 랭킹 1위 추가 보상
  TOP_PROMOTER_REWARD: '마스터볼 1개',
};
