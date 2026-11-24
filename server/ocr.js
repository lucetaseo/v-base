// ============================================================
// 계약서 스캔(OCR) — 종이 계약서 사진을 AI(Claude)가 읽어 계약 등록 칸을 채울 값으로 돌려줌
//   켜는 법: Vercel 환경변수 ANTHROPIC_API_KEY (키가 없으면 '연결 안 됨' — 화면에서 버튼이 안내만 함)
//   업체별 기능 스위치 contractScan (기본 꺼짐) — 운영자가 업체마다 켬
//   저장하지 않음: 돌려준 값은 화면에서 사람이 확인·고친 뒤 [양식에 넣기] → 평소처럼 저장
//   시험(OCR_FAKE=1)은 정해진 가짜 값
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const MODEL = 'claude-opus-5-5';

export const ocrConfigured = () => process.env.OCR_FAKE === '1' || !!process.env.ANTHROPIC_API_KEY;

// 읽어 올 칸 (계약 등록 화면의 칸 이름과 같게) — 못 읽은 칸은 빈 값
const ContractScan = z.object({
  customerName: z.string().describe('계약자(고객) 이름'),
  customerPhone: z.string().describe('계약자 휴대폰 번호 (010-0000-0000 형식)'),
  customerPhone2: z.string().describe('두 번째 연락처 (없으면 빈 값)'),
  address: z.string().describe('시공 주소 — 아파트·건물 이름 또는 도로명 주소 (동·호는 빼고)'),
  dong: z.string().describe('동 (숫자만, 없으면 빈 값)'),
  ho: z.string().describe('호 (숫자만, 없으면 빈 값)'),
  contractDate: z.string().describe('계약일 YYYY-MM-DD (없으면 빈 값)'),
  moveInDate: z.string().describe('입주일·시공 희망일 YYYY-MM-DD (없으면 빈 값)'),
  lineItems: z
    .array(
      z.object({
        name: z.string().describe('품목·제품 이름'),
        qty: z.number().describe('수량 (없으면 1)'),
        unitPrice: z.number().describe('단가 (원, 숫자만 — 없으면 0)'),
      }),
    )
    .describe('계약 품목 줄'),
  totalAmount: z.number().describe('총 계약 금액 (원, 숫자만 — 없으면 0)'),
  discount: z.number().describe('할인 금액 (원 — 없으면 0)'),
  memo: z.string().describe('위 칸에 들어가지 않는 특이사항·메모 (짧게)'),
  uncertain: z.array(z.string()).describe('글씨가 흐리거나 확실하지 않은 칸 이름들 (위 칸 이름 그대로)'),
});

const PROMPT = `이 사진은 한국 조명·인테리어 시공 업체의 종이 계약서입니다.
계약서에 적힌 내용만 정해진 칸에 옮겨 주세요.
- 적혀 있지 않거나 읽을 수 없는 칸은 빈 값(숫자는 0)으로 두고, 추측해서 채우지 마세요.
- 손글씨라 확실하지 않은 칸은 가장 그럴듯하게 읽되 uncertain 에 그 칸 이름을 넣어 주세요.
- 금액은 '원', 쉼표를 빼고 숫자로. '만원' 단위로 적혀 있으면 원으로 바꿔 주세요.
- 날짜는 YYYY-MM-DD. 연도가 없으면 올해(${new Date().getFullYear()})로.`;

const FAKE = {
  customerName: '스캔고객',
  customerPhone: '010-1234-5678',
  customerPhone2: '',
  address: '래미안 아파트',
  dong: '101',
  ho: '1203',
  contractDate: '2026-11-20',
  moveInDate: '',
  lineItems: [{ name: '다운라이트 3인치', qty: 12, unitPrice: 25000 }],
  totalAmount: 300000,
  discount: 0,
  memo: '',
  uncertain: ['customerPhone'],
};

let client = null;

// image: data:image/jpeg;base64,... → 칸 값 (못 읽으면 오류)
export async function readContract(image) {
  if (process.env.OCR_FAKE === '1') return { ...FAKE };
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('계약서 스캔이 아직 연결되지 않았습니다. (운영자: ANTHROPIC_API_KEY 설정)');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(image || ''));
  if (!m) throw new Error('계약서 사진(jpg, png)을 올려 주세요.');
  client ||= new Anthropic({ timeout: 50_000, maxRetries: 0 }); // Vercel 요청 한도(60초) 안에서 끝나게
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // 안전 판정으로 거절되면 서버가 다른 모델로 다시 시도
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: betaZodOutputFormat(ContractScan) },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });
  if (res.stop_reason === 'refusal') throw new Error('이 사진은 읽을 수 없습니다. 다른 사진으로 다시 시도해 주세요.');
  if (!res.parsed_output) throw new Error('계약서를 읽지 못했습니다. 밝은 곳에서 계약서 전체가 보이게 다시 찍어 주세요.');
  return res.parsed_output;
}
