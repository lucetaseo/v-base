// ============================================================
// 데이터 가져오기 양식 (설정 > 데이터 가져오기의 [양식 받기] · 제목 번호)
//   첫 시트: 제목 줄 + 예시 줄 (예시 줄은 지우고 채워 넣음)
//   둘째 시트 '작성 방법': 칸마다 필수 여부·설명
//   계약 양식은 예전 프로그램 파일이 없는 업체가 직접 엑셀로 옮길 때 사용 (mapSheetContractRow)
// ============================================================

import * as XLSX from 'xlsx';
import { CATEGORIES, RECEPTION_TYPES, WORK_STATUS, WORK_TYPES } from '../constants.js';

// [칸 이름, 필수 여부, 설명, 예시]
export const TEMPLATES = {
  engineers: {
    file: '기사목록_양식',
    columns: [
      ['이름', true, '기사 이름 (같은 이름이 이미 있으면 건너뜀)', '홍길동'],
      ['아이디', false, '기사모바일 로그인 아이디 (영문·숫자 3~20자)', 'hong01'],
      ['연락처', false, '휴대폰 번호', '010-1234-5678'],
      ['담당시공', false, `여러 개면 쉼표로 (${CATEGORIES.join(', ')})`, '탄성, 줄눈'],
    ],
  },
  contracts: {
    file: '계약_양식',
    columns: [
      ['번호', false, '예전 계약 번호. 같은 번호는 다시 올려도 건너뜀 (비우면 매번 새로 등록)', '1001'],
      ['계약일', true, '2026-10-22 형식', '2026-10-22'],
      ['고객명', true, '', '김고객'],
      ['연락처', true, '휴대폰 번호', '010-2345-6789'],
      ['아파트명', true, '현장 이름', '래미안 아파트'],
      ['동', false, '', '101'],
      ['호', false, '', '1203'],
      ['타입', false, '평형·타입', '34B'],
      ['브랜드', false, '비우면 업체 기본 브랜드', ''],
      ['구분', false, CATEGORIES.join(', '), '탄성'],
      ['접수형태', false, RECEPTION_TYPES.join(', '), '음성계약'],
      ['시공종류', false, WORK_TYPES.join(', '), '시공'],
      ['시공상태', false, WORK_STATUS.join(', '), '미정'],
      ['시공총액', false, '숫자만 (원)', 600000],
      ['할인', false, '숫자만 (원)', 20000],
      ['상품권', false, '숫자만 (원)', 20000],
      ['입금액', false, '이미 받은 계약금 (원)', 60000],
      ['시공예정일', false, '2026-11-05 형식', '2026-11-05'],
      ['시공시간', false, '09:00 형식', '09:00'],
      ['시공담당', false, '기사 이름 (기사관리에 없으면 자동 등록)', '홍길동'],
      ['시공내용', false, '계약서에 보이는 시공 내용', '에코그리트 베란다·세탁실'],
      ['기사전달사항', false, '기사모바일에 보이는 메모', ''],
      ['메모', false, '내부 메모', ''],
    ],
  },
  users: {
    file: '직원계정_양식',
    columns: [
      ['이름', true, '', '이실장'],
      ['아이디', true, '로그인 아이디 (이미 있으면 건너뜀)', 'lee01'],
      ['비밀번호', true, '처음 비밀번호 (4자 이상)', 'lee12345'],
      ['부서', false, '시공팀이면 기사모바일 계정, 그 외는 실장 계정', '상담팀'],
      ['직급', false, '', '실장'],
    ],
  },
};

// 양식 엑셀 파일 (frontend/public/templates/{kind}.xlsx 로 미리 만들어 둠 → 화면에서는 링크로 내려받기)
//   칸을 바꾸면: npm run templates --prefix frontend 로 파일을 다시 만듭니다
export const templateUrl = (kind) => `/templates/${kind}.xlsx`;

export function buildTemplateWorkbook(kind) {
  const t = TEMPLATES[kind];
  const sheet = XLSX.utils.aoa_to_sheet([t.columns.map((c) => c[0]), t.columns.map((c) => c[3])]);
  sheet['!cols'] = t.columns.map((c) => ({ wch: Math.max(10, c[0].length * 2 + 4, String(c[3]).length + 2) }));
  const guide = XLSX.utils.aoa_to_sheet([
    ['칸 이름', '필수', '설명'],
    ...t.columns.map(([name, req, desc]) => [name, req ? '필수' : '', desc]),
    [],
    ['※ 첫 시트의 2번째 줄(예시)은 지우고 3번째 줄부터 채워도 됩니다. 제목 줄(1번째 줄)은 지우지 마세요.'],
  ]);
  guide['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, '입력');
  XLSX.utils.book_append_sheet(wb, guide, '작성 방법');
  return wb;
}

// 엑셀 첫 시트 → 제목 줄 기준 객체 목록 (날짜 칸은 2026-10-22 글자로)
export function readSheetRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
}

const text = (v) => String(v ?? '').trim();
const money = (v) => Number(text(v).replace(/[^\d-]/g, '')) || 0;
// 2026-10-22 / 2026.10.22 / 2026/10/22 / 20261022 → 2026-10-22
export function normDate(v) {
  const m = text(v).match(/^(\d{4})[-./]?\s*(\d{1,2})[-./]?\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}
const normTime = (v) => {
  const m = text(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

// 계약 양식 한 줄 → 가져오기 입력 (예전 프로그램 파일과 같은 모양: legacyNo = 번호)
export function mapSheetContractRow(r) {
  const status = WORK_STATUS.includes(text(r['시공상태'])) ? text(r['시공상태']) : '미정';
  const contractDate = normDate(r['계약일']);
  const date = normDate(r['시공예정일']);
  const paid = money(r['입금액']);
  return {
    legacyNo: text(r['번호']),
    brand: text(r['브랜드']),
    category: text(r['구분']),
    receptionType: text(r['접수형태']),
    workType: text(r['시공종류']) || '시공',
    status,
    contractDate,
    customerName: text(r['고객명']),
    customerPhone: text(r['연락처']),
    aptName: text(r['아파트명']) || '(현장 미입력)',
    dong: text(r['동']),
    ho: text(r['호']),
    aptType: text(r['타입']),
    approval: '승인',
    totalAmount: money(r['시공총액']),
    discount: money(r['할인']),
    voucher: money(r['상품권']),
    payments: paid > 0 ? [{ date: contractDate, kind: '계약금', method: '계좌이체', amount: paid, memo: '가져오기 입금액' }] : [],
    schedules: [{ date, time: normTime(r['시공시간']), engineerName: text(r['시공담당']) }],
    completedDate: status === '시공완료' ? date || contractDate : '',
    canceledDate: status === '취소' ? contractDate : '',
    cancelReason: status === '취소' ? '가져오기: 취소된 계약' : '',
    items: text(r['시공내용']),
    engineerNote: text(r['기사전달사항']),
    memo: text(r['메모']),
  };
}
