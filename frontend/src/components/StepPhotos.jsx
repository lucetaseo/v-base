import React, { useEffect, useState } from 'react';
import PhotoPickButton from './CameraButton.jsx';
import PhotoViewer from './PhotoViewer.jsx';
import { compressImage } from '../utils/image.js';

// 시공 사진 (회차 하나) — 계약 상세(사무실)·기사모바일 공통
//   api: { list(stepIndex), add(stepIndex, photos), remove(photoId), update(photoId, note) } — 사무실은 contracts, 기사는 engineerApp
//   사진마다 품목·공간·특이사항(메모)과 촬영 시각(사진 파일의 시각)을 남김
//   count: 지금 사진 장수 (사진은 [사진 보기]·올린 뒤에만 불러옴 — 목록이 무거워지지 않게)
//   canUpload: 올리기 버튼, canDelete(photo): 그 사진을 지울 수 있는지
//   archived: 설정 > 시공 사진 정리로 내려받아 서버에서 지운 기록 { at, count }
const PER_SEND = 5; // 서버가 한 번에 받는 장수 (stepPhotos.js STEP_PHOTOS_PER_SEND)

export default function StepPhotos({ api, stepIndex, label, count = 0, archived = null, canUpload = false, canDelete = () => false, onCount, onError }) {
  const [photos, setPhotos] = useState(null); // null: 아직 안 불러옴
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState(null);
  const [noteFor, setNoteFor] = useState(null); // 품목·공간·특이사항 고치는 사진 { id, item, space, memo }
  const [n, setN] = useState(count);
  useEffect(() => setN(count), [count]);

  const load = async () => {
    try {
      const list = await api.list(stepIndex);
      setPhotos(list);
      setN(list.length);
      onCount?.(list.length);
    } catch (e) {
      onError?.(e);
    }
  };
  const toggle = () => {
    if (!open && photos === null) load();
    setOpen((v) => !v);
  };

  const upload = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    try {
      const images = [];
      for (let i = 0; i < files.length; i++) {
        setBusy(`사진 줄이는 중 ${i + 1}/${files.length}`);
        const takenAt = files[i].lastModified ? new Date(files[i].lastModified).toISOString() : undefined; // 촬영(파일) 시각
        images.push({ image: await compressImage(files[i]), takenAt });
      }
      for (let i = 0; i < images.length; i += PER_SEND) {
        setBusy(`올리는 중 ${Math.min(i + PER_SEND, images.length)}/${images.length}`);
        const r = await api.add(stepIndex, images.slice(i, i + PER_SEND));
        setN(r.photoCount);
      }
      setOpen(true);
      await load();
    } catch (err) {
      onError?.(err);
      load();
    } finally {
      setBusy('');
    }
  };

  const saveNote = async (e) => {
    e.preventDefault();
    try {
      await api.update(noteFor.id, { item: noteFor.item, space: noteFor.space, memo: noteFor.memo });
      setNoteFor(null);
      await load();
    } catch (err) {
      onError?.(err);
    }
  };

  const remove = async (p) => {
    if (!window.confirm('이 사진을 지울까요?')) return;
    try {
      await api.remove(p.id);
      await load();
    } catch (err) {
      onError?.(err);
    }
  };

  return (
    <div className="step-photos">
      <div className="step-photos-head">
        <strong>📷 {label} 시공 사진</strong>
        <span className="sub-text">{n}장</span>
        {archived?.count > 0 && (
          <span className="sub-text archived-note">
            (사진 {archived.count}장은 {String(archived.at || '').slice(0, 10)}에 내려받아 정리됨)
          </span>
        )}
        {n > 0 && (
          <button type="button" className="btn-link" onClick={toggle}>
            {open ? '접기' : '사진 보기'}
          </button>
        )}
        {canUpload && (
          <PhotoPickButton className="btn-pay-photo" title="시공 사진 올리기 (여러 장 한 번에)" onChange={upload} disabled={!!busy}>
            {busy || '+ 사진 올리기'}
          </PhotoPickButton>
        )}
      </div>
      {open && photos === null && <div className="sub-text">불러오는 중...</div>}
      {open && photos && photos.length > 0 && (
        <div className="step-photo-grid">
          {photos.map((p, i) => (
            <div key={p.id} className="step-photo">
              <button type="button" className="step-photo-thumb" onClick={() => setView(i)} title={`${p.byName || ''} ${p.createdAt ? new Date(p.createdAt).toLocaleString('ko-KR') : ''}`.trim()}>
                <img src={p.image} alt={`${label} 시공 사진 ${i + 1}`} loading="lazy" />
              </button>
              {canDelete(p) && (
                <button type="button" className="step-photo-del" onClick={() => remove(p)} title="사진 지우기">
                  ×
                </button>
              )}
              <div className="step-photo-cap">
                {[p.space, p.item].filter(Boolean).join(' · ') || <span className="sub-text">품목·공간 없음</span>}
                {p.memo && <div className="step-photo-memo" title={p.memo}>⚠ {p.memo}</div>}
                <div className="sub-text">{(p.takenAt || p.createdAt || '').slice(5, 16).replace('T', ' ')}</div>
                {canDelete(p) && api.update && (
                  <button type="button" className="btn-link" onClick={() => setNoteFor({ id: p.id, item: p.item || '', space: p.space || '', memo: p.memo || '' })}>
                    ✎ 품목·메모
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {noteFor && (
        <form className="step-photo-note" onSubmit={saveNote}>
          <input className="input-text" value={noteFor.space} onChange={(e) => setNoteFor({ ...noteFor, space: e.target.value })} placeholder="공간 (예: 거실)" maxLength={30} />
          <input className="input-text" value={noteFor.item} onChange={(e) => setNoteFor({ ...noteFor, item: e.target.value })} placeholder="품목 (예: 다운라이트 3인치)" maxLength={50} />
          <textarea className="input-text full" rows={2} value={noteFor.memo} onChange={(e) => setNoteFor({ ...noteFor, memo: e.target.value })} placeholder="특이사항 (추가 작업·파손·현장 변경·미시공 사유 등)" maxLength={500} />
          <div className="inline-fields">
            <button type="submit" className="btn-dark-sm">저장</button>
            <button type="button" className="btn-link" onClick={() => setNoteFor(null)}>취소</button>
          </div>
        </form>
      )}
      {view != null && photos && <PhotoViewer images={photos.map((p) => p.image)} start={view} title={`${label} 시공 사진`} onClose={() => setView(null)} />}
    </div>
  );
}
