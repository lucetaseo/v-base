// ============================================================
// 시공 사진 (회차별, 기능 스위치 stepPhotos) — 아르떼(조명): 시공 1~4차마다 10장 안팎
//   영수증·AS 사진과 같은 표(paymentReceipts)에 kind 'stepPhoto', stepIndex(몇 번째 회차, 0부터)로 저장
//   사진 저장소를 켠 업체는 저장할 때 DB 대신 사진 저장소로 (server/pg.js)
//   회차에는 사진 장수만(photoCount) 남기고, 사진은 볼 때만 읽음
//   사무실(계약 수정 권한)과 그 회차에 배정된 기사가 올림 — 고객 화면에는 나오지 않음
// ============================================================
import { ApiError, nowIso } from './core.js';
import { nextId } from './runtime.js';

export const STEP_KIND = 'stepPhoto';
export const STEP_PHOTOS_MAX = 30; // 회차 하나 최대 (평균 10장 — 넉넉하게)
export const STEP_PHOTOS_PER_SEND = 5; // 한 번에 보내는 장수 (요청 용량 한도)
const IMAGE_MAX = 3 * 1024 * 1024; // 1장 최대 약 3MB (화면에서 줄여서 올림)

const rowsOf = (db, c, stepIndex) =>
  (db.paymentReceipts || []).filter((r) => r.contractId === c.id && r.kind === STEP_KIND && (stepIndex === null || Number(r.stepIndex) === stepIndex));

export function stepIndexOf(c, stepIndex) {
  const i = Number(stepIndex);
  if (!Number.isInteger(i) || i < 0 || !c.schedules?.[i]) throw new ApiError('시공 회차를 찾을 수 없습니다.', 'NOT_FOUND');
  return i;
}

// 사진 목록 (stepIndex 가 없으면 모든 회차)
export function listStepPhotos(db, c, stepIndex = null) {
  const want = stepIndex === null || stepIndex === undefined ? null : Number(stepIndex);
  return rowsOf(db, c, want)
    .sort((a, b) => a.id - b.id)
    .map((r) => ({
      id: r.id,
      image: r.image,
      stepIndex: Number(r.stepIndex),
      byName: r.byName || '',
      byEngineerId: r.byEngineerId || null,
      createdAt: r.createdAt,
      takenAt: r.takenAt || '', // 촬영 시각 (사진 파일의 시각 — 없으면 빈 값)
      item: r.item || '', // 품목 (예: 거실 다운라이트)
      space: r.space || '', // 공간 (예: 거실)
      memo: r.memo || '', // 특이사항 (추가 작업·파손·현장 변경·미시공 사유 등)
    }));
}

// 사진 추가 → 그 회차의 사진 장수
//   photos: data URL 들, 또는 { image, takenAt, item, space, memo } 들
export function addStepPhotos(db, user, c, stepIndex, photos) {
  const i = stepIndexOf(c, stepIndex);
  const list = (Array.isArray(photos) ? photos : []).filter(Boolean).map((p) => (typeof p === 'string' ? { image: p } : p));
  if (!list.length) return c.schedules[i].photoCount || 0;
  if (list.length > STEP_PHOTOS_PER_SEND) throw new ApiError(`시공 사진은 한 번에 ${STEP_PHOTOS_PER_SEND}장씩 보내 주세요. (나머지는 이어서 올라갑니다)`);
  list.forEach(({ image: img }) => {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(img))) throw new ApiError('사진 파일(jpg, png)만 올릴 수 있습니다.');
    if (img.length > IMAGE_MAX) throw new ApiError('사진이 너무 큽니다. 다시 찍거나 작은 사진으로 올려 주세요.');
  });
  db.paymentReceipts = db.paymentReceipts || [];
  const now = rowsOf(db, c, i).length;
  if (now + list.length > STEP_PHOTOS_MAX) throw new ApiError(`시공 사진은 회차마다 ${STEP_PHOTOS_MAX}장까지 올릴 수 있습니다. (지금 ${now}장)`);
  list.forEach((p) =>
    db.paymentReceipts.push({
      id: nextId(db, 'paymentReceipts'),
      companyId: c.companyId,
      contractId: c.id,
      paymentId: null,
      kind: STEP_KIND,
      stepIndex: i,
      image: p.image,
      ...noteOf(p),
      ...(isIso(p.takenAt) ? { takenAt: p.takenAt } : {}),
      byName: user.name || '',
      byEngineerId: user.engineerId || null,
      createdAt: nowIso(),
    }),
  );
  c.schedules[i].photoCount = now + list.length;
  c.updatedAt = nowIso();
  return c.schedules[i].photoCount;
}

const isIso = (v) => /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(String(v || ''));
const noteOf = (p) => ({ item: String(p?.item || '').trim().slice(0, 50), space: String(p?.space || '').trim().slice(0, 30), memo: String(p?.memo || '').trim().slice(0, 500) });

// 사진의 품목·공간·특이사항 고치기 — onlyMine: 기사는 본인이 올린 사진만
export function updateStepPhoto(db, user, c, photoId, note, { onlyMine = false } = {}) {
  const row = (db.paymentReceipts || []).find((r) => r.id === Number(photoId) && r.contractId === c.id && r.kind === STEP_KIND);
  if (!row) throw new ApiError('사진을 찾을 수 없습니다.', 'NOT_FOUND');
  if (onlyMine && row.byEngineerId !== user.engineerId) throw new ApiError('본인이 올린 사진만 고칠 수 있습니다.', 'FORBIDDEN');
  Object.assign(row, noteOf(note));
  return row;
}

// 사진 지우기 — onlyMine: 기사는 본인이 올린 사진만
export function removeStepPhoto(db, user, c, photoId, { onlyMine = false } = {}) {
  const row = (db.paymentReceipts || []).find((r) => r.id === Number(photoId) && r.contractId === c.id && r.kind === STEP_KIND);
  if (!row) throw new ApiError('사진을 찾을 수 없습니다.', 'NOT_FOUND');
  if (onlyMine && row.byEngineerId !== user.engineerId) throw new ApiError('본인이 올린 사진만 지울 수 있습니다.', 'FORBIDDEN');
  db.paymentReceipts = db.paymentReceipts.filter((r) => r !== row);
  const i = Number(row.stepIndex);
  if (c.schedules?.[i]) c.schedules[i].photoCount = rowsOf(db, c, i).length;
  c.updatedAt = nowIso();
  return i;
}
