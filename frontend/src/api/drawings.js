// ============================================================
// 시공 도면 (기능 스위치 drawings) — 아르떼(조명): 계약마다 공간별(거실·안방·베란다 …) 도면 위에 조명 아이콘 배치
//   계약의 drawings: [{ id, name(공간 — 예: 거실), imageId, w, h, icons: [{ id, type, x, y, line, note }], updatedAt, byName }]
//     x·y 는 도면 그림 안의 위치(0~100%) — 화면 크기·확대와 상관없이 같은 자리
//     line: 계약 상품 줄 번호(0부터) — 그 아이콘이 어느 제품인지 (없으면 null)
//   shapes: [{ id, kind(rect·ellipse·line·arrow·text), x, y, x2, y2, text, color, size, fill }] — 도형·선·글자 (위치 0~100%)
//   confirmedAt·confirmedBy: 확정(기능 drawingConfirm) — 고객 화면·계약서에는 확정된 도면만. 그림·아이콘·도형을 고치면 확정이 풀림
//   도면 그림은 영수증·사진과 같은 표(paymentReceipts)에 kind 'drawing' (사진 저장소를 켜면 저장소로)
//   보기: 계약 보기 권한 · 고치기: 계약 수정 권한
// ============================================================
import { ApiError, nowIso } from './core.js';
import { hasFeature } from '../constants.js';
import { nextId } from './runtime.js';

export const DRAWING_KIND = 'drawing';
export const DRAWINGS_MAX = 20; // 계약 하나에 도면(공간) 최대
export const ICONS_MAX = 400; // 도면 하나에 아이콘 최대
const IMAGE_MAX = 4 * 1024 * 1024; // 도면 그림 1장 최대 약 4MB (화면에서 줄여서 올림)

// 조명 아이콘 종류 (화면 모양은 components/DrawingEditor.jsx 의 ICONS)
export const SHAPES_MAX = 300; // 도면 하나에 도형·선·글자 최대
export const SHAPE_KINDS = ['rect', 'ellipse', 'line', 'arrow', 'text'];
export const SHAPE_COLORS = ['#ef4444', '#2563eb', '#16a34a', '#111827', '#f59e0b', '#9333ea'];
export const ICON_TYPES = ['downlight', 'recessed', 'ceilingfan', 'pendant', 'indirect', 'track', 'wall', 'spot', 'sensor', 'switch', 'outlet', 'etc'];

const imageOf = (db, c, imageId) => (db.paymentReceipts || []).find((r) => r.id === imageId && r.contractId === c.id && r.kind === DRAWING_KIND);

// 도면 목록 (그림 포함)
export function listDrawings(db, c) {
  return (c.drawings || []).map((d) => ({ ...d, image: imageOf(db, c, d.imageId)?.image || '' }));
}

const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round((Number(v) || 0) * 100) / 100));
function cleanIcons(icons, lineCount) {
  return (Array.isArray(icons) ? icons : []).slice(0, ICONS_MAX).map((ic, i) => ({
    id: String(ic?.id || `i${i + 1}`).slice(0, 20),
    type: ICON_TYPES.includes(ic?.type) ? ic.type : 'etc',
    x: num(ic?.x, 0, 100),
    y: num(ic?.y, 0, 100),
    line: Number.isInteger(ic?.line) && ic.line >= 0 && ic.line < lineCount ? ic.line : null,
    note: String(ic?.note || '').trim().slice(0, 100),
  }));
}

// 내용 비교용 글자 — DB(JSONB)가 키 순서를 바꿔 저장하므로 키를 정렬해서 비교
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const sig = (v) => JSON.stringify(canon(v));

function cleanShapes(shapes) {
  return (Array.isArray(shapes) ? shapes : [])
    .filter((s) => SHAPE_KINDS.includes(s?.kind))
    .slice(0, SHAPES_MAX)
    .map((s, i) => ({
      id: String(s.id || `s${i + 1}`).slice(0, 20),
      kind: s.kind,
      x: num(s.x, 0, 100),
      y: num(s.y, 0, 100),
      x2: num(s.x2 ?? s.x, 0, 100),
      y2: num(s.y2 ?? s.y, 0, 100),
      text: s.kind === 'text' ? String(s.text || '').trim().slice(0, 100) : '',
      color: SHAPE_COLORS.includes(s.color) ? s.color : SHAPE_COLORS[0],
      size: Math.min(8, Math.max(1, Math.round(Number(s.size) || 3))),
      fill: !!s.fill && (s.kind === 'rect' || s.kind === 'ellipse'),
    }))
    .filter((s) => s.kind !== 'text' || s.text);
}

// 도면 저장: drawingId 가 없으면 새 도면(그림 필수), 있으면 이름·아이콘(·그림 바꾸기)
export function saveDrawing(db, user, c, { drawingId, name, image, w, h, icons, shapes } = {}) {
  c.drawings = c.drawings || [];
  let d = drawingId ? c.drawings.find((x) => x.id === Number(drawingId)) : null;
  if (drawingId && !d) throw new ApiError('도면을 찾을 수 없습니다.', 'NOT_FOUND');
  if (!d && c.drawings.length >= DRAWINGS_MAX) throw new ApiError(`도면은 계약 1건당 ${DRAWINGS_MAX}장까지 둘 수 있습니다.`);
  if (!d && !image) throw new ApiError('도면 그림(사진·이미지 파일)을 올려 주세요.');
  if (image) {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(image))) throw new ApiError('도면은 그림 파일(jpg, png)로 올려 주세요. PDF 는 그림으로 저장해서 올려 주세요.');
    if (image.length > IMAGE_MAX) throw new ApiError('도면 그림이 너무 큽니다.');
  }
  if (!d) {
    const ids = c.drawings.map((x) => x.id);
    d = { id: (ids.length ? Math.max(...ids) : 0) + 1, name: '', imageId: null, icons: [] };
    c.drawings.push(d);
  }
  if (image) {
    db.paymentReceipts = db.paymentReceipts || [];
    if (d.imageId) db.paymentReceipts = db.paymentReceipts.filter((r) => !(r.id === d.imageId && r.contractId === c.id && r.kind === DRAWING_KIND));
    const row = { id: nextId(db, 'paymentReceipts'), companyId: c.companyId, contractId: c.id, paymentId: null, kind: DRAWING_KIND, image, createdAt: nowIso() };
    db.paymentReceipts.push(row);
    d.imageId = row.id;
    d.w = Math.max(1, Math.round(Number(w) || 0)) || null; // 그림 원래 크기 (가로·세로 비율용)
    d.h = Math.max(1, Math.round(Number(h) || 0)) || null;
  }
  d.name = String(name ?? d.name ?? '').trim().slice(0, 30) || `도면 ${c.drawings.indexOf(d) + 1}`;
  const before = sig([d.imageId, d.icons || [], d.shapes || []]);
  if (icons !== undefined) d.icons = cleanIcons(icons, (c.lineItems || []).length);
  if (shapes !== undefined) d.shapes = cleanShapes(shapes);
  // 확정된 도면의 내용(그림·아이콘·도형)이 바뀌면 확정을 풂 → 다시 확정해야 고객에게 보임
  if (d.confirmedAt && sig([d.imageId, d.icons || [], d.shapes || []]) !== before) {
    d.confirmedAt = null;
    d.confirmedBy = '';
  }
  d.updatedAt = nowIso();
  d.byName = user.name || '';
  c.updatedAt = nowIso();
  return d;
}

// 확정 / 확정 취소
export function confirmDrawing(user, c, drawingId, on = true) {
  const d = (c.drawings || []).find((x) => x.id === Number(drawingId));
  if (!d) throw new ApiError('도면을 찾을 수 없습니다.', 'NOT_FOUND');
  d.confirmedAt = on ? nowIso() : null;
  d.confirmedBy = on ? user.name || '' : '';
  c.updatedAt = nowIso();
  return d;
}

// 고객에게 보여 줄 도면 — 확정 기능(drawingConfirm)을 켠 업체는 확정된 것만
export function customerDrawingList(db, c) {
  const company = db.companies.find((x) => x.id === c.companyId);
  const all = c.drawings || [];
  return hasFeature(company, 'drawingConfirm') ? all.filter((d) => d.confirmedAt) : all;
}

export function removeDrawing(db, c, drawingId) {
  const d = (c.drawings || []).find((x) => x.id === Number(drawingId));
  if (!d) throw new ApiError('도면을 찾을 수 없습니다.', 'NOT_FOUND');
  db.paymentReceipts = (db.paymentReceipts || []).filter((r) => !(r.id === d.imageId && r.contractId === c.id && r.kind === DRAWING_KIND));
  c.drawings = c.drawings.filter((x) => x !== d);
  c.updatedAt = nowIso();
  return d;
}
