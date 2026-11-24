// ============================================================
// 시공 사진 정리 (설정 > 시공 사진 정리, 기능 스위치 photoArchive) — 관리자만
//   사진이 계속 쌓여 저장소가 차지 않게: 기간(시공일 기준)을 골라
//   ① 대상 확인(summary) → ② 사진 받기(photos, 화면이 ZIP 파일로 묶어 내려받음) → ③ 정리(purge: 서버에서 지움)
//   지운 회차에는 언제·몇 장을 정리했는지 남김 (photosArchived) — 계약 상세에 '내려받아 정리됨'으로 보임
//   photos·purge 는 계약 몇 건씩 나눠서 호출 (사진 표는 그 계약 것만 읽음 — server/handler.js RECEIPT_CALLS)
// ============================================================
import { ApiError, authorize, nowIso, requireFeature } from './core.js';
import { ROLES } from '../auth/permissions.js';
import { fileStore, saveDb } from './runtime.js';
import { addHistory } from './views.js';
import { numberOf } from './numbering.js';
import { formatAddress } from '../utils/format.js';
import { STEP_KIND } from './stepPhotos.js';

export const ARCHIVE_BATCH = 5; // photos·purge 한 번에 계약 몇 건까지

async function admin() {
  const ctx = await authorize('contract.view');
  if (ctx.user.role !== ROLES.ADMIN) throw new ApiError('시공 사진 정리는 업체 관리자만 할 수 있습니다.', 'FORBIDDEN');
  requireFeature(ctx.db, ctx.user, 'photoArchive');
  return ctx;
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
function rangeOf({ from, to } = {}) {
  if (!isDate(from) || !isDate(to) || from > to) throw new ApiError('기간을 올바르게 골라 주세요.');
  return { from, to };
}
// 기간 안의 회차: 시공일이 기간 안 (시공일이 없는 회차는 대상 아님)
const stepsInRange = (c, { from, to }) => (c.schedules || []).map((s, i) => ({ s, i })).filter(({ s }) => s.date && s.date >= from && s.date <= to);

function pickContracts(db, user, ids) {
  const list = [].concat(ids || []).map(Number);
  if (!list.length || list.length > ARCHIVE_BATCH) throw new ApiError(`계약은 한 번에 ${ARCHIVE_BATCH}건까지 보내 주세요.`);
  return list.map((id) => {
    const c = db.contracts.find((x) => x.id === id && x.companyId === user.companyId);
    if (!c) throw new ApiError('계약을 찾을 수 없습니다.', 'NOT_FOUND');
    return c;
  });
}

export const photoArchive = {
  // ① 대상 확인: 기간 안 회차에 사진이 있는 계약과 장수 (사진 표는 읽지 않음 — 회차의 장수만)
  async summary(range) {
    const { db, user } = await admin();
    const r = rangeOf(range);
    const rows = db.contracts
      .filter((c) => c.companyId === user.companyId && !c.deletedAt)
      .map((c) => ({ c, steps: stepsInRange(c, r).filter(({ s }) => s.photoCount > 0) }))
      .filter((x) => x.steps.length)
      .map(({ c, steps }) => ({
        id: c.id,
        no: numberOf(db, c),
        customerName: c.customerName,
        site: formatAddress(c),
        category: c.category,
        steps: steps.map(({ s, i }) => ({ stepIndex: i, date: s.date, photoCount: s.photoCount })),
      }));
    return { ...r, contracts: rows, photoCount: rows.reduce((n, x) => n + x.steps.reduce((m, s) => m + s.photoCount, 0), 0) };
  },

  // ② 사진 받기: 계약 몇 건의 기간 안 회차 사진 (사진 저장소면 4시간짜리 주소로 바뀌어 감)
  async photos(contractIds, range) {
    const { db, user } = await admin();
    const r = rangeOf(range);
    return pickContracts(db, user, contractIds).map((c) => {
      const want = new Set(stepsInRange(c, r).map(({ i }) => i));
      return {
        id: c.id,
        photos: (db.paymentReceipts || [])
          .filter((p) => p.contractId === c.id && p.kind === STEP_KIND && want.has(Number(p.stepIndex)))
          .sort((a, b) => a.id - b.id)
          .map((p) => ({ id: p.id, stepIndex: Number(p.stepIndex), image: p.image, createdAt: p.createdAt })),
      };
    });
  },

  // ③ 정리: 내려받은 사진을 서버에서 지움 (사진 저장소의 파일도) — 되돌릴 수 없음
  async purge(contractIds, range) {
    const { db, user } = await admin();
    const r = rangeOf(range);
    const paths = [];
    let removed = 0;
    pickContracts(db, user, contractIds).forEach((c) => {
      const want = new Set(stepsInRange(c, r).map(({ i }) => i));
      const gone = (db.paymentReceipts || []).filter((p) => p.contractId === c.id && p.kind === STEP_KIND && want.has(Number(p.stepIndex)));
      if (!gone.length) return;
      gone.forEach((p) => String(p.image || '').startsWith('vbstore:') && paths.push(String(p.image).slice('vbstore:'.length)));
      const goneIds = new Set(gone.map((p) => p.id));
      db.paymentReceipts = db.paymentReceipts.filter((p) => !goneIds.has(p.id));
      const changes = [];
      want.forEach((i) => {
        const n = gone.filter((p) => Number(p.stepIndex) === i).length;
        if (!n) return;
        const s = c.schedules[i];
        s.photosArchived = { at: nowIso(), count: (s.photosArchived?.count || 0) + n, byName: user.name };
        s.photoCount = Math.max(0, (s.photoCount || 0) - n);
        changes.push({ label: `${i + 1}차 사진`, from: `${n}장`, to: '내려받아 정리함' });
      });
      addHistory(c, user, '시공 사진 정리', changes);
      c.updatedAt = nowIso();
      removed += gone.length;
    });
    saveDb(db);
    const store = fileStore();
    if (paths.length && store && store.configured()) await store.remove(paths).catch(() => {}); // 저장소 삭제가 실패해도 목록에서는 빠짐
    return { removed };
  },
};
