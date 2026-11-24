import React, { useEffect, useState } from 'react';
import PhotoPickButton from './CameraButton.jsx';
import PhotoViewer from './PhotoViewer.jsx';
import { compressImage } from '../utils/image.js';

// 시공 사진 (회차 하나) — 계약 상세(사무실)·기사모바일 공통
//   api: { list(stepIndex), add(stepIndex, photos), remove(photoId) } — 사무실은 contracts, 기사는 engineerApp
//   count: 지금 사진 장수 (사진은 [사진 보기]·올린 뒤에만 불러옴 — 목록이 무거워지지 않게)
//   canUpload: 올리기 버튼, canDelete(photo): 그 사진을 지울 수 있는지
const PER_SEND = 5; // 서버가 한 번에 받는 장수 (stepPhotos.js STEP_PHOTOS_PER_SEND)

export default function StepPhotos({ api, stepIndex, label, count = 0, canUpload = false, canDelete = () => false, onCount, onError }) {
  const [photos, setPhotos] = useState(null); // null: 아직 안 불러옴
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState(null);
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
        images.push(await compressImage(files[i]));
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
            </div>
          ))}
        </div>
      )}
      {view != null && photos && <PhotoViewer images={photos.map((p) => p.image)} start={view} title={`${label} 시공 사진`} onClose={() => setView(null)} />}
    </div>
  );
}
