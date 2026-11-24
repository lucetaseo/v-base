import React, { useEffect, useRef, useState } from 'react';
import { API_MODE, contracts as contractApi } from '../api/index.js';
import { CONTRACT_FILE_MAX_MB } from '../api/customerDocs.js';
import { ESIGN_STATUS, currentHasFeature } from '../constants.js';

// 고객 공개 문서 (계약 상세 > 계약정보, 기능 customerDocs)
//   고객 확인 페이지 [📄 문서 내려받기]에 무엇을 보여 줄지 고름: 계약서 · 확정 도면 · 거래명세서 · 올린 파일(견적서·사양서 등)
//   파일은 파일 저장소에 직접 올림 (회사 자료 백업과 같은 방식) — 브라우저 데모 모드에서는 파일 올리기 불가
const sizeText = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

function putFile(url, file, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.floor((e.loaded / e.total) * 100));
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.send(file);
  });
}

export default function CustomerDocsPanel({ contract: c, drawings = [], canEdit, onError }) {
  const [data, setData] = useState(null); // { docs, files }
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const inputRef = useRef(null);

  const load = async () => {
    try {
      const r = await contractApi.customerDocs(c.id);
      setData(r);
      setDocs(r.docs);
      setDirty(false);
    } catch (e) {
      onError?.(e);
    }
  };
  useEffect(() => {
    load();
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !docs) return null;
  const signReady = c.esign?.status === ESIGN_STATUS.WAITING || c.esign?.status === ESIGN_STATUS.SIGNED;
  const confirmedCount = drawings.filter((d) => !currentHasFeature('drawingConfirm') || d.confirmedAt).length;
  const set = (patch) => {
    setDocs((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const toggleFile = (id) => set({ fileIds: docs.fileIds.includes(id) ? docs.fileIds.filter((x) => x !== id) : [...docs.fileIds, id] });

  const save = async () => {
    try {
      setBusy('저장하는 중...');
      await contractApi.setCustomerDocs(c.id, docs);
      await load();
    } catch (e) {
      onError?.(e);
    } finally {
      setBusy('');
    }
  };

  const upload = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const label = `${f.name} 올리는 중${files.length > 1 ? ` (${i + 1}/${files.length})` : ''}`;
        setBusy(label);
        const { fileId, uploadUrl } = await contractApi.addFile(c.id, { name: f.name, size: f.size, type: f.type });
        const r = await putFile(uploadUrl, f, (pct) => setBusy(`${label} · ${pct}%`));
        if (!r.ok) {
          await contractApi.removeFile(c.id, fileId).catch(() => {});
          throw new Error(`${f.name} 을(를) 올리지 못했습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.`);
        }
        await contractApi.confirmFile(c.id, fileId);
      }
      const keep = docs;
      const r = await contractApi.customerDocs(c.id);
      setData(r);
      setDocs({ ...keep, fileIds: keep.fileIds.filter((id) => r.files.some((f) => f.id === id)) });
    } catch (err) {
      if (err.code) onError?.(err);
      else window.alert(err.message);
    } finally {
      setBusy('');
    }
  };

  const remove = async (f) => {
    if (!window.confirm(`[${f.name}] 파일을 지울까요? 고객도 더 이상 받을 수 없습니다.`)) return;
    try {
      await contractApi.removeFile(c.id, f.id);
      await load();
    } catch (err) {
      onError?.(err);
    }
  };

  const shown = (docs.contract && signReady ? 1 : 0) + (docs.drawings ? confirmedCount : 0) + (docs.statement && currentHasFeature('statement') ? 1 : 0) + docs.fileIds.length;
  return (
    <>
      <h3 className="form-section-title">&gt; 고객 공개 문서 <span className="sub-text">— 고객 확인 페이지 [📄 문서 내려받기]에 보일 것 (지금 {shown}개)</span></h3>
      <div className="cdocs">
        <label className={`cdocs-row ${signReady ? '' : 'off'}`}>
          <input type="checkbox" checked={docs.contract} disabled={!canEdit} onChange={(e) => set({ contract: e.target.checked })} /> 계약서
          <span className="sub-text">{signReady ? (c.esign.status === ESIGN_STATUS.SIGNED ? '서명 완료 계약서 (PDF 저장 가능)' : '서명 요청 중인 계약서') : '서명 요청을 보낸 뒤 공개됩니다'}</span>
        </label>
        {currentHasFeature('drawings') && (
          <label className={`cdocs-row ${confirmedCount ? '' : 'off'}`}>
            <input type="checkbox" checked={docs.drawings} disabled={!canEdit} onChange={(e) => set({ drawings: e.target.checked })} /> 시공 도면
            <span className="sub-text">{confirmedCount ? `확정된 도면 ${confirmedCount}장 (그림 파일로 받음)` : '확정된 도면이 없습니다 — 도면을 [✔ 확정]하면 공개됩니다'}</span>
          </label>
        )}
        {currentHasFeature('statement') && (
          <label className="cdocs-row">
            <input type="checkbox" checked={docs.statement} disabled={!canEdit} onChange={(e) => set({ statement: e.target.checked })} /> 거래명세서
            <span className="sub-text">고객이 직접 인쇄 / PDF 저장</span>
          </label>
        )}
        <div className="cdocs-files">
          <b>파일</b> <span className="sub-text">견적서·사양서·보증서 등 — 체크한 파일만 고객에게</span>
          {data.files.length === 0 && <div className="sub-text">올린 파일이 없습니다.</div>}
          {data.files.map((f) => (
            <div key={f.id} className="cdocs-row">
              <input type="checkbox" checked={docs.fileIds.includes(f.id)} disabled={!canEdit} onChange={() => toggleFile(f.id)} />
              <a href={f.url || undefined} target="_blank" rel="noreferrer">{f.name}</a>
              <span className="sub-text">{sizeText(f.size)} · {f.byName}</span>
              {canEdit && <button type="button" className="btn-link" onClick={() => remove(f)}>지우기</button>}
            </div>
          ))}
          {canEdit &&
            (API_MODE === 'server' ? (
              <div>
                <button type="button" className="btn-link" onClick={() => inputRef.current?.click()} disabled={!!busy}>+ 파일 올리기</button>
                <span className="sub-text"> (한 파일 {CONTRACT_FILE_MAX_MB}MB, 계약당 20개까지)</span>
                <input ref={inputRef} type="file" multiple hidden onChange={upload} />
              </div>
            ) : (
              <div className="sub-text">파일 올리기는 실제 서버에서만 됩니다. (데모 화면에서는 안 됨)</div>
            ))}
        </div>
        {canEdit && (
          <div className="inline-fields">
            <button type="button" className="btn-dark-sm" onClick={save} disabled={!dirty || !!busy}>{dirty ? '💾 공개 문서 저장' : '저장됨'}</button>
            {busy && <span className="sub-text">⏳ {busy}</span>}
          </div>
        )}
      </div>
    </>
  );
}
