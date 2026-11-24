import React, { useState } from 'react';
import { zipSync } from 'fflate';
import { photoArchive } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { addDays, today } from '../../utils/date.js';

// 설정 > 시공 사진 정리 (관리자, 기능 photoArchive)
//   ① 기간(시공일 기준) 고르기 → [대상 확인]
//   ② [사진 내려받기]: 계약별·회차별 폴더로 묶은 ZIP 파일 (크면 여러 개로 나눠 받음) — PC 에서 하는 것을 권장
//   ③ [서버에서 정리하기]: 내려받기가 끝난 뒤에만 — 서버(사진 저장소)에서 지움, 되돌릴 수 없음
const BATCH = 5; // 서버에 한 번에 보내는 계약 수 (photoArchive.js ARCHIVE_BATCH)
const PART_BYTES = 300 * 1024 * 1024; // ZIP 한 개 최대 약 300MB (브라우저 메모리)
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

async function imageBytes(src) {
  if (src.startsWith('data:')) {
    const b64 = src.slice(src.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const r = await fetch(src);
  if (!r.ok) throw new Error(`사진을 받지 못했습니다 (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
const extOf = (src, bytes) => (src.startsWith('data:image/png') || (bytes[0] === 0x89 && bytes[1] === 0x50) ? 'png' : 'jpg');

function saveZip(files, name) {
  const zipped = zipSync(files, { level: 0 }); // 사진은 이미 압축돼 있어 다시 압축하지 않음 (빠르게)
  const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function PhotoArchivePage() {
  const { handleError } = useAuth();
  const [range, setRange] = useState(() => ({ from: addDays(today(), -365), to: addDays(today(), -183) }));
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [done, setDone] = useState('');

  const check = async () => {
    setBusy('확인하는 중...');
    setDownloaded(false);
    setDone('');
    try {
      setInfo(await photoArchive.summary(range));
    } catch (e) {
      handleError(e);
    } finally {
      setBusy('');
    }
  };

  const download = async () => {
    const list = info.contracts;
    const label = `시공사진_${info.from}_${info.to}`;
    let files = {};
    let size = 0;
    let part = 1;
    let got = 0;
    try {
      for (let i = 0; i < list.length; i += BATCH) {
        const batch = list.slice(i, i + BATCH);
        const res = await photoArchive.photos(batch.map((c) => c.id), { from: info.from, to: info.to });
        for (const r of res) {
          const c = batch.find((x) => x.id === r.id);
          const folder = safe(`No.${c.no ?? c.id}_${c.customerName}_${c.site}_${c.category}`);
          const counter = {};
          for (const p of r.photos) {
            got += 1;
            setBusy(`사진 받는 중 ${got}/${info.photoCount}`);
            const bytes = await imageBytes(p.image);
            const step = c.steps.find((s) => s.stepIndex === p.stepIndex);
            const sub = `${p.stepIndex + 1}차_${step?.date || ''}`;
            counter[sub] = (counter[sub] || 0) + 1;
            files[`${label}/${folder}/${sub}/${String(counter[sub]).padStart(2, '0')}.${extOf(p.image, bytes)}`] = bytes;
            size += bytes.length;
            if (size >= PART_BYTES) {
              setBusy(`ZIP 파일 만드는 중 (${part}번째)`);
              saveZip(files, `${label}_${part}.zip`);
              files = {};
              size = 0;
              part += 1;
            }
          }
        }
      }
      if (Object.keys(files).length) saveZip(files, part === 1 ? `${label}.zip` : `${label}_${part}.zip`);
      setDownloaded(true);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy('');
    }
  };

  const purge = async () => {
    if (!window.confirm(`내려받은 ZIP 파일을 열어 사진이 다 들어 있는지 확인하셨나요?\n\n[확인]을 누르면 ${info.from} ~ ${info.to} 시공 사진 ${info.photoCount}장을 서버에서 지웁니다. 되돌릴 수 없습니다.`)) return;
    let removed = 0;
    try {
      for (let i = 0; i < info.contracts.length; i += BATCH) {
        setBusy(`정리하는 중 ${Math.min(i + BATCH, info.contracts.length)}/${info.contracts.length}건`);
        const r = await photoArchive.purge(info.contracts.slice(i, i + BATCH).map((c) => c.id), { from: info.from, to: info.to });
        removed += r.removed;
      }
      setDone(`${removed}장을 정리했습니다. 계약 상세에는 '내려받아 정리됨'으로 표시됩니다.`);
      setInfo(null);
      setDownloaded(false);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page-card photo-archive">
      <h2>시공 사진 정리</h2>
      <ul className="notice-list">
        <li>시공 사진이 계속 쌓여 저장 공간이 차지 않도록, 지난 기간의 사진을 <b>파일(ZIP)로 내려받아 보관</b>한 뒤 서버에서 지웁니다.</li>
        <li>예) 6개월마다 6개월~1년 전 시공분을 정리. 기간은 <b>시공일</b> 기준입니다.</li>
        <li>내려받은 ZIP 은 계약별 폴더(번호_고객_현장) 안에 회차별 폴더(1차_날짜)로 나뉘어 있습니다. 사진이 많으면 약 300MB 씩 여러 파일로 나눠 받습니다.</li>
        <li>사진이 많을 수 있으니 <b>PC 에서</b> 하시고, 받은 파일은 외장하드·클라우드 등에 보관해 주세요.</li>
      </ul>

      <div className="filter-row">
        <input type="date" className="input-date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span>~</span>
        <input type="date" className="input-date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <button type="button" className="btn-dark-lg sm" onClick={check} disabled={!!busy}>
          ① 대상 확인
        </button>
      </div>

      {busy && <p className="archive-busy">⏳ {busy}</p>}
      {done && <p className="archive-done">✅ {done}</p>}

      {info && (
        <div className="archive-box">
          <p>
            {info.from} ~ {info.to} 시공분: 계약 <b>{info.contracts.length}건</b>, 사진 <b>{info.photoCount}장</b> (약 {Math.max(1, Math.round((info.photoCount * 0.25) / 1))}MB)
          </p>
          {info.photoCount === 0 ? (
            <p className="sub-text">이 기간에 정리할 시공 사진이 없습니다.</p>
          ) : (
            <div className="archive-actions">
              <button type="button" className="btn-dark-lg sm" onClick={download} disabled={!!busy}>
                ② 사진 내려받기 (ZIP)
              </button>
              <button type="button" className="btn-danger-lg sm" onClick={purge} disabled={!!busy || !downloaded} title={downloaded ? '' : '먼저 사진을 내려받아 주세요'}>
                ③ 서버에서 정리하기
              </button>
              {!downloaded && <span className="sub-text">내려받기가 끝나야 정리할 수 있습니다.</span>}
            </div>
          )}
          {info.contracts.length > 0 && (
            <details>
              <summary>대상 계약 보기</summary>
              <ul className="archive-list">
                {info.contracts.map((c) => (
                  <li key={c.id}>
                    No.{c.no ?? '-'} {c.customerName} · {c.site} · {c.category} —{' '}
                    {c.steps.map((s) => `${s.stepIndex + 1}차 ${s.photoCount}장`).join(', ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
