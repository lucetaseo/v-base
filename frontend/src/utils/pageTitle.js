// ============================================================
// 화면(링크)마다 다른 이름 — 브라우저 탭 제목, 카카오톡 등 링크 미리보기 제목에 사용
//   예) /sinhwa/m → "신화탄성 기사모바일 | VerityBase"
//       /sinhwa/contracts → "신화탄성 계약관리 | VerityBase"
//   화면(App.jsx)과 서버의 링크 미리보기(api/page.js)가 같은 규칙을 씀
// ============================================================

export const APP_NAME = 'VerityBase';

// 업체 코드를 뺀 주소 → 화면 이름 (긴 주소부터 비교)
const PAGES = [
  ['/contracts/new', '계약 등록'],
  ['/contracts/trash', '휴지통'],
  ['/contracts', '계약관리'],
  ['/customers', '계약자관리'],
  ['/schedule', '일정관리'],
  ['/progress', '진행상황'],
  ['/stats/purchases', '매입관리'],
  ['/stats/stock', '재고체크'],
  ['/stats', '통계정보'],
  ['/settings/users', '사용자관리'],
  ['/settings/engineers', '기사관리'],
  ['/settings/teams', '팀관리'],
  ['/settings/products', '상품관리'],
  ['/settings/apartments', '아파트관리'],
  ['/settings/schedule', '일정관리설정'],
  ['/settings/import', '데이터 가져오기'],
  ['/settings/logs', '수정로그'],
  ['/settings', '설정'],
  ['/me', '내 정보'],
  ['/admin/alimtalk', '알림톡연결'],
  ['/admin/terms', '계약조건'],
  ['/admin', '업체/계정관리'],
  ['/engineer', '기사모바일'],
  ['/m', '기사모바일'],
  ['/c', '고객 모바일'],
];

export function pageName(path = '/') {
  if (path.startsWith('/sign/') || path === '/e') return '계약서 확인·서명';
  if (/^\/contracts\/\d+\/edit$/.test(path)) return '계약 수정';
  if (/^\/contracts\/\d+$/.test(path)) return '계약 상세';
  const hit = PAGES.find(([p]) => path === p || path.startsWith(`${p}/`));
  return hit ? hit[1] : '';
}

// base: 업체 코드(없으면 운영자 화면), companyName: 업체 이름(모르면 비움)
export function pageTitle({ base = '', path = '/' } = {}, companyName = '') {
  const page = pageName(path) || (base ? '로그인' : '운영자');
  const who = base ? companyName : '';
  return `${[who, page].filter(Boolean).join(' ')} | ${APP_NAME}`;
}
