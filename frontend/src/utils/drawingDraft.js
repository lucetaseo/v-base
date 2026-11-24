// 계약 등록·수정 화면의 시공 도면 — 계약 [저장] 때 함께 저장 (그 전까지는 화면에만 보관)
//   DrawingEditor 에 넘기는 api 와 같은 모양 { list, save, remove } — 서버 대신 이 보관함에 씀
//   새 계약은 계약 번호가 없으니 도면은 임시 번호(음수)로 두고, 계약을 저장한 뒤 commit(계약번호)으로 서버에 올림
import { contracts as contractApi } from '../api/index.js';

const DRAWINGS_MAX = 20; // api/drawings.js 와 같게

export function createDrawingDraft(contractId) {
  let items = null; // [{ id, name, image, w, h, icons, shapes, _new, _dirty, _image }]
  const removed = [];
  let seq = 0;
  let changed = false;
  const copy = (d) => ({ ...d, icons: [...(d.icons || [])], shapes: [...(d.shapes || [])] });

  const api = {
    async list() {
      if (!items) items = contractId ? (await contractApi.drawings(contractId)).map(copy) : [];
      return items.map(copy);
    },
    async save({ drawingId, name, image, w, h, icons, shapes } = {}) {
      if (!items) await api.list();
      let d = drawingId ? items.find((x) => x.id === drawingId) : null;
      if (!d) {
        if (items.length >= DRAWINGS_MAX) throw new Error(`도면은 계약 1건당 ${DRAWINGS_MAX}장까지 둘 수 있습니다.`);
        if (!image) throw new Error('도면 그림을 올려 주세요.');
        d = { id: -++seq, name: '', image: '', icons: [], shapes: [], _new: true };
        items.push(d);
      }
      if (name !== undefined) d.name = String(name).trim().slice(0, 30) || `도면 ${items.indexOf(d) + 1}`;
      if (image) Object.assign(d, { image, w, h, _image: true });
      if (icons !== undefined) d.icons = [...icons];
      if (shapes !== undefined) d.shapes = [...shapes];
      d._dirty = true;
      changed = true;
      return { drawing: copy(d) };
    },
    async remove(drawingId) {
      if (!items) await api.list();
      const d = items.find((x) => x.id === drawingId);
      if (!d) return { ok: true };
      items = items.filter((x) => x !== d);
      if (!d._new) removed.push(d.id);
      changed = true;
      return { ok: true };
    },
  };

  return {
    api,
    hasChanges: () => changed,
    // 계약 저장 뒤: 지운 도면 → 새 도면 → 고친 도면 순서로 서버에 올림 (오류는 모아서 돌려줌)
    async commit(id) {
      const errors = [];
      for (const did of removed) await contractApi.removeDrawing(id, did).catch((e) => errors.push(e.message));
      for (const d of items || []) {
        if (!d._dirty) continue;
        const data = { name: d.name, icons: d.icons, shapes: d.shapes, ...(d._image || d._new ? { image: d.image, w: d.w, h: d.h } : {}) };
        await contractApi.saveDrawing(id, d._new ? data : { drawingId: d.id, ...data }).catch((e) => errors.push(`${d.name}: ${e.message}`));
      }
      return errors;
    },
  };
}
