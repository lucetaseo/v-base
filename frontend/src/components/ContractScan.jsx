import React, { useEffect, useState } from 'react';
import PhotoPickButton from './CameraButton.jsx';
import { contracts as contractApi } from '../api/index.js';
import { compressImage } from '../utils/image.js';
import { won } from '../utils/format.js';

// 계약서 스캔 (기능 contractScan) — 계약 등록 화면 맨 위
//   종이 계약서 사진 → AI 가 읽은 값을 보여 주고, 사람이 확인·고친 뒤 [양식에 넣기]
//   확실하지 않은 칸(uncertain)은 노란색 '확인 필요' — 저장은 평소처럼 [저장] 버튼
//   onApply(values, image): 넣을 값과 계약서 사진(종이 계약서 사진으로 함께 올림)
const FIELDS = [
  ['customerName', '계약자'],
  ['customerPhone', '연락처'],
  ['customerPhone2', '연락처②'],
  ['aptName', '주소(아파트)'],
  ['dong', '동'],
  ['ho', '호'],
  ['contractDate', '계약일'],
  ['moveInDate', '입주일'],
  ['totalAmount', '총 금액'],
  ['discount', '할인'],
  ['memo', '메모'],
];

export default function ContractScan({ onApply, onError }) {
  const [status, setStatus] = useState(null); // null: 확인 중, { configured }
  const [busy, setBusy] = useState('');
  const [image, setImage] = useState('');
  const [result, setResult] = useState(null);
  const [attach, setAttach] = useState(true);

  useEffect(() => {
    contractApi.scanStatus().then(setStatus, () => setStatus({ configured: false }));
  }, []);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setBusy('사진 줄이는 중...');
      // 글씨가 보이게 크게 (긴 변 2000px, 약 1.5MB)
      const img = await compressImage(file, { maxSize: 2000, quality: 0.85, maxBytes: 1500 * 1024 });
      setImage(img);
      setBusy('AI 가 계약서를 읽는 중... (10~30초)');
      setResult(await contractApi.scanPaper(img));
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy('');
    }
  };

  const set = (k, v) => setResult((r) => ({ ...r, [k]: v, uncertain: r.uncertain.filter((x) => x !== k) }));
  const setLine = (i, patch) => setResult((r) => ({ ...r, lineItems: r.lineItems.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const apply = () => {
    onApply(result, attach ? image : '');
    setResult(null);
    setImage('');
  };

  if (status && !status.configured) {
    return <p className="info-guide">ⓘ 계약서 스캔: 아직 연결되지 않았습니다. (운영자가 서버에 AI 키를 넣으면 사용할 수 있습니다)</p>;
  }
  const unsure = (k) => result?.uncertain?.includes(k);
  return (
    <div className="scan-box">
      <div className="inline-fields">
        <PhotoPickButton className="btn-outline-action" title="종이 계약서를 찍거나 사진을 고르세요" onChange={pick} disabled={!status || !!busy}>
          📷 종이 계약서 스캔으로 채우기
        </PhotoPickButton>
        {busy ? <span className="sub-text">⏳ {busy}</span> : <span className="sub-text">계약서 전체가 보이게 밝은 곳에서 찍어 주세요. AI 가 읽은 값은 꼭 확인 후 넣어 주세요.</span>}
      </div>
      {result && (
        <div className="scan-result">
          <div className="scan-cols">
            {image && <img className="scan-photo" src={image} alt="계약서 사진" />}
            <div className="scan-fields">
              {FIELDS.map(([k, label]) => (
                <label key={k} className={`scan-field ${unsure(k) ? 'unsure' : ''}`}>
                  <span>
                    {label}
                    {unsure(k) && <b className="scan-check"> 확인 필요</b>}
                  </span>
                  {k === 'memo' ? (
                    <textarea className="input-text" rows={2} value={result[k]} onChange={(e) => set(k, e.target.value)} />
                  ) : (
                    <input className="input-text" value={result[k]} onChange={(e) => set(k, k === 'totalAmount' || k === 'discount' ? Number(e.target.value.replace(/[^\d]/g, '')) || 0 : e.target.value)} />
                  )}
                </label>
              ))}
              <div className="scan-field">
                <span>품목 {unsure('lineItems') && <b className="scan-check"> 확인 필요</b>}</span>
                <div>
                  {result.lineItems.length === 0 && <span className="sub-text">읽은 품목 없음</span>}
                  {result.lineItems.map((l, i) => (
                    <div key={i} className="inline-fields">
                      <input className="input-text" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} />
                      <input className="input-text scan-num" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value.replace(/[^\d]/g, '')) || 1 })} title="수량" />
                      <input className="input-text scan-num" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value.replace(/[^\d]/g, '')) || 0 })} title="단가" />
                      <span className="sub-text">{won(l.qty * l.unitPrice)}원</span>
                      <button type="button" className="btn-link" onClick={() => setResult((r) => ({ ...r, lineItems: r.lineItems.filter((_, j) => j !== i) }))}>빼기</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="inline-fields">
            <label className="sub-text">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> 이 사진을 '종이 계약서 사진'으로 함께 올리기
            </label>
            <button type="button" className="btn-dark-sm" onClick={apply}>양식에 넣기</button>
            <button type="button" className="btn-link" onClick={() => setResult(null)}>취소</button>
          </div>
          <p className="sub-text">빈 칸은 넣지 않습니다. 넣은 뒤에도 아래 양식에서 다시 확인하고 [저장]해 주세요.</p>
        </div>
      )}
    </div>
  );
}
