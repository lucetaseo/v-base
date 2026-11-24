// ============================================================
// 고객 공개 문서 (기능 customerDocs) — 계약마다 고객이 내려받을 수 있는 문서를 사무실이 고름
//   계약의 customerDocs: { contract, drawings, statement, fileIds } — 계약서 · 확정 도면 · 거래명세서 · 올린 파일(골라서)
//   계약의 contractFiles: [{ id, name, size, type, path, ready, byName, createdAt }] — 견적서·사양서 등
//     파일 자체는 파일 저장소(Supabase Storage)에 — 화면이 저장소로 직접 올림 (회사 자료 백업과 같은 방식)
//     올리기: [addFile] 자리 + 올릴 주소 → 화면이 저장소에 올림 → [confirmFile] 완료
//   저장소 연결은 runtime.fileStore() — 서버에서만 (브라우저 데모 모드는 파일 올리기 불가, 나머지는 됨)
// ============================================================
import { ApiError, nowIso } from './core.js';
import { fileStore } from './runtime.js';

export const CONTRACT_FILE_MAX_MB = 50;
const FILE_MAX = CONTRACT_FILE_MAX_MB * 1024 * 1024;
const FILES_PER_CONTRACT = 20;
const PENDING_HOURS = 6; // 올리다 멈춘 자리는 이 시간 뒤 정리

const readyFiles = (c) => (c.contractFiles || []).filter((f) => f.ready);

export function customerDocsOf(c) {
  const d = c.customerDocs || {};
  const ids = new Set(readyFiles(c).map((f) => f.id));
  return { contract: !!d.contract, drawings: !!d.drawings, statement: !!d.statement, fileIds: (d.fileIds || []).filter((id) => ids.has(id)) };
}

export function setCustomerDocs(c, docs = {}) {
  const ids = new Set(readyFiles(c).map((f) => f.id));
  const fileIds = [...new Set((Array.isArray(docs.fileIds) ? docs.fileIds : []).map(Number))].filter((id) => ids.has(id));
  c.customerDocs = { contract: !!docs.contract, drawings: !!docs.drawings, statement: !!docs.statement, fileIds };
  c.updatedAt = nowIso();
}

function store() {
  const s = fileStore();
  if (!s || !s.configured()) throw new ApiError('파일 저장소가 연결되어 있지 않습니다. 운영자에게 문의해 주세요.');
  return s;
}

const fileView = (f) => ({ id: f.id, name: f.name, size: f.size, type: f.type, byName: f.byName || '', createdAt: f.createdAt });

// 올린 파일 목록 + 내려받기 주소 (only: 이 번호들만)
export async function contractFileList(c, only = null) {
  const list = readyFiles(c).filter((f) => !only || only.includes(f.id)).sort((a, b) => a.id - b.id);
  const s = fileStore();
  const urls = s && s.configured() && list.length ? await s.downloadUrls(list.map((f) => ({ path: f.path, name: f.name }))) : {};
  return list.map((f) => ({ ...fileView(f), url: urls[f.path] || '' }));
}

// 올릴 자리 만들기 → { fileId, uploadUrl }
export async function addContractFile(user, c, { name, size, type } = {}) {
  const s = store();
  const fileName = String(name || '').trim().replace(/[\\/]/g, '_').slice(0, 200);
  const bytes = Number(size) || 0;
  if (!fileName) throw new ApiError('파일 이름이 없습니다.');
  if (bytes <= 0) throw new ApiError('빈 파일은 올릴 수 없습니다.');
  if (bytes > FILE_MAX) throw new ApiError(`파일은 ${CONTRACT_FILE_MAX_MB}MB 까지 올릴 수 있습니다. (${fileName})`);
  const cutoff = Date.now() - PENDING_HOURS * 3600 * 1000;
  const files = (c.contractFiles || []).filter((f) => f.ready || new Date(f.createdAt).getTime() > cutoff);
  if (files.length >= FILES_PER_CONTRACT) throw new ApiError(`파일은 계약 1건당 ${FILES_PER_CONTRACT}개까지 둘 수 있습니다.`);
  const id = files.reduce((m, f) => Math.max(m, f.id), c.contractFilesSeq || 0) + 1;
  const ext = (/\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1] || 'bin').toLowerCase();
  const path = `cfiles/${c.companyId}/${c.id}/${id}-${Math.random().toString(36).slice(2, 10)}.${ext}`; // 저장소 경로는 영문만 (한글 이름은 목록에)
  c.contractFiles = [...files, { id, name: fileName, size: bytes, type: String(type || '').slice(0, 100), path, ready: false, byName: user.name || '', createdAt: nowIso() }];
  c.contractFilesSeq = id;
  return { fileId: id, uploadUrl: await s.uploadUrl(path) };
}

export function confirmContractFile(c, fileId) {
  const f = (c.contractFiles || []).find((x) => x.id === Number(fileId));
  if (!f) throw new ApiError('파일을 찾을 수 없습니다.', 'NOT_FOUND');
  f.ready = true;
  c.updatedAt = nowIso();
  return f;
}

export async function removeContractFile(c, fileId) {
  const f = (c.contractFiles || []).find((x) => x.id === Number(fileId));
  if (!f) throw new ApiError('파일을 찾을 수 없습니다.', 'NOT_FOUND');
  c.contractFiles = c.contractFiles.filter((x) => x !== f);
  if (c.customerDocs?.fileIds) c.customerDocs.fileIds = c.customerDocs.fileIds.filter((id) => id !== f.id);
  c.updatedAt = nowIso();
  const s = fileStore();
  if (s && s.configured()) await s.remove([f.path]).catch(() => {}); // 저장소 삭제가 실패해도 목록에서는 빠짐
  return f;
}
