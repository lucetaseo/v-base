import React, { useEffect, useRef, useState } from 'react';
import { compressImage } from '../utils/image.js';

// 시공 도면 (계약 상세 > 시공관리, 기능 drawings) — 아르떼(조명)
//   층별 도면(그림) 위에 조명 아이콘을 놓고(누르기) · 옮기고(끌기) · 지우기, 확대·축소, 범례, 계약 상품 줄과 연결
//   api: { list(), save({ drawingId, name, image, w, h, icons }), remove(drawingId) }
//   lines: 계약 상품 줄 (아이콘 ↔ 제품 연결, 범례에서 계약 수량과 비교)
//   canEdit: false 면 보기만 (아이콘을 누르면 설명)
export const ICONS = {
  downlight: { label: '다운라이트', short: 'DL', color: '#f59e0b' },
  recessed: { label: '우물·매입등', short: '매입', color: '#d97706' },
  ceilingfan: { label: '실링팬', short: '팬', color: '#0ea5e9' },
  pendant: { label: '펜던트', short: '펜', color: '#8b5cf6' },
  indirect: { label: '간접조명', short: '간접', color: '#10b981', wide: true },
  track: { label: '레일등', short: '레일', color: '#64748b', wide: true },
  wall: { label: '벽등', short: '벽', color: '#ec4899' },
  spot: { label: '스포트', short: '스팟', color: '#ef4444' },
  sensor: { label: '센서등', short: '센서', color: '#14b8a6' },
  switch: { label: '스위치', short: 'S', color: '#334155' },
  outlet: { label: '콘센트', short: '콘', color: '#475569' },
  etc: { label: '기타', short: '?', color: '#94a3b8' },
};
const TYPES = Object.keys(ICONS);

export function DrawingIcon({ type, selected, title, onPointerDown, onClick, style }) {
  const ic = ICONS[type] || ICONS.etc;
  return (
    <button
      type="button"
      className={`dwg-icon ${ic.wide ? 'wide' : ''} ${selected ? 'selected' : ''}`}
      style={{ background: ic.color, ...style }}
      title={title || ic.label}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {ic.short}
    </button>
  );
}

const lineLabel = (lines, i) => (i === null || i === undefined || !lines[i] ? '' : `${lines[i].name}${lines[i].qty > 1 ? ` (계약 ${lines[i].qty}개)` : ''}`);
const newId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function DrawingEditor({ api, lines = [], canEdit = false, onError }) {
  const [list, setList] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [icons, setIcons] = useState([]); // 고치는 중인 아이콘 (저장 전)
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState(null); // 놓을 아이콘 종류 (null = 선택·옮기기)
  const [toolLine, setToolLine] = useState(''); // 새 아이콘에 연결할 상품 줄
  const [sel, setSel] = useState(null); // 고른 아이콘 id
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState('');
  const board = useRef(null);
  const drag = useRef(null);

  const active = list?.find((d) => d.id === activeId) || null;

  const load = async (keep) => {
    try {
      const l = await api.list();
      setList(l);
      const id = keep && l.some((d) => d.id === keep) ? keep : l[0]?.id ?? null;
      setActiveId(id);
      setIcons(l.find((d) => d.id === id)?.icons || []);
      setDirty(false);
      setSel(null);
    } catch (e) {
      onError?.(e);
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmLeave = () => !dirty || window.confirm('저장하지 않은 아이콘 변경이 있습니다. 버리고 넘어갈까요?');
  const pick = (d) => {
    if (d.id === activeId || !confirmLeave()) return;
    setActiveId(d.id);
    setIcons(d.icons || []);
    setDirty(false);
    setSel(null);
    setZoom(1);
  };

  // 도면 그림 고르기 → 줄여서 { image, w, h }
  const readImage = async (file) => {
    const image = await compressImage(file, { maxSize: 2400, quality: 0.85, maxBytes: 1500 * 1024 });
    const size = await new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => ok({ w: 0, h: 0 });
      img.src = image;
    });
    return { image, ...size };
  };

  const addDrawing = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !confirmLeave()) return;
    const name = window.prompt('도면 이름 (예: 1층, 2층, 거실)', `${(list?.length || 0) + 1}층`);
    if (name === null) return;
    setBusy('도면 올리는 중...');
    try {
      const r = await api.save({ name, ...(await readImage(file)), icons: [] });
      await load(r.drawing.id);
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy('');
    }
  };

  const replaceImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !active) return;
    setBusy('그림 바꾸는 중...');
    try {
      await api.save({ drawingId: active.id, ...(await readImage(file)), icons });
      await load(active.id);
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy('');
    }
  };

  const rename = async () => {
    const name = window.prompt('도면 이름', active.name);
    if (name === null || !name.trim()) return;
    try {
      await api.save({ drawingId: active.id, name, icons });
      await load(active.id);
    } catch (err) {
      onError?.(err);
    }
  };

  const removeActive = async () => {
    if (!window.confirm(`[${active.name}] 도면과 아이콘을 모두 지울까요?`)) return;
    try {
      await api.remove(active.id);
      await load();
    } catch (err) {
      onError?.(err);
    }
  };

  const save = async () => {
    setBusy('저장하는 중...');
    try {
      await api.save({ drawingId: active.id, icons });
      await load(active.id);
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy('');
    }
  };

  // 도면 위 위치(%) — 누른 자리
  const posOf = (e) => {
    const r = board.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    return { x: Math.min(100, Math.max(0, Math.round(x * 100) / 100)), y: Math.min(100, Math.max(0, Math.round(y * 100) / 100)) };
  };
  const change = (next) => {
    setIcons(next);
    setDirty(true);
  };

  const onBoardClick = (e) => {
    if (!canEdit || !tool || drag.current?.moved) return;
    if (e.target.closest('.dwg-icon')) return;
    const ic = { id: newId(), type: tool, ...posOf(e), line: toolLine === '' ? null : Number(toolLine), note: '' };
    change([...icons, ic]);
    setSel(ic.id);
  };

  const onIconDown = (e, ic) => {
    e.stopPropagation();
    setSel(ic.id);
    if (!canEdit) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: ic.id, moved: false };
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const { x, y } = posOf(e);
    drag.current.moved = true;
    setIcons((prev) => prev.map((ic) => (ic.id === drag.current.id ? { ...ic, x, y } : ic)));
  };
  const onUp = () => {
    if (drag.current?.moved) setDirty(true);
    setTimeout(() => (drag.current = null), 0);
  };

  const selected = icons.find((ic) => ic.id === sel) || null;
  const setSelected = (patch) => change(icons.map((ic) => (ic.id === sel ? { ...ic, ...patch } : ic)));
  const removeSelected = () => {
    change(icons.filter((ic) => ic.id !== sel));
    setSel(null);
  };
  useEffect(() => {
    const key = (e) => {
      if (!canEdit || !sel || !['Delete', 'Backspace'].includes(e.key) || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      removeSelected();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (list === null) return <div className="sub-text">도면 불러오는 중...</div>;

  // 범례: 종류별 개수 / 제품(상품 줄)별 개수 ↔ 계약 수량
  const byType = TYPES.map((t) => [t, icons.filter((ic) => ic.type === t).length]).filter(([, n]) => n);
  const byLine = lines.map((l, i) => ({ l, i, n: icons.filter((ic) => ic.line === i).length })).filter((x) => x.n || canEdit);
  const width = active?.w ? Math.min(active.w, 1100) : 900;

  return (
    <div className="dwg">
      <div className="dwg-tabs">
        {list.map((d) => (
          <button key={d.id} type="button" className={d.id === activeId ? 'active' : ''} onClick={() => pick(d)}>
            {d.name} <span className="sub-text">({(d.id === activeId ? icons : d.icons || []).length})</span>
          </button>
        ))}
        {canEdit && (
          <label className="dwg-add">
            + 도면 추가
            <input type="file" accept="image/*" onChange={addDrawing} hidden />
          </label>
        )}
        {busy && <span className="sub-text">⏳ {busy}</span>}
      </div>

      {!active ? (
        <p className="sub-text">{canEdit ? '등록된 도면이 없습니다. [+ 도면 추가]로 도면 그림(사진·이미지)을 올려 주세요. (PDF 는 그림으로 저장해서 올려 주세요)' : '등록된 도면이 없습니다.'}</p>
      ) : (
        <>
          {canEdit && (
            <div className="dwg-toolbar">
              <div className="dwg-palette">
                <button type="button" className={`dwg-tool ${tool === null ? 'active' : ''}`} onClick={() => setTool(null)} title="아이콘을 누르면 선택, 끌면 옮김">
                  ✋ 선택·옮기기
                </button>
                {TYPES.map((t) => (
                  <button key={t} type="button" className={`dwg-tool ${tool === t ? 'active' : ''}`} onClick={() => setTool(t)} title={`${ICONS[t].label} 놓기: 도면을 누르세요`}>
                    <DrawingIcon type={t} style={{ position: 'static', transform: 'none', pointerEvents: 'none' }} /> {ICONS[t].label}
                  </button>
                ))}
              </div>
              <div className="inline-fields">
                {tool && (
                  <label className="sub-text">
                    놓을 아이콘의 제품{' '}
                    <select className="input-text" value={toolLine} onChange={(e) => setToolLine(e.target.value)}>
                      <option value="">연결 안 함</option>
                      {lines.map((l, i) => (
                        <option key={i} value={i}>{lineLabel(lines, i)}</option>
                      ))}
                    </select>
                  </label>
                )}
                <span className="dwg-zoom">
                  <button type="button" onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.2) * 10) / 10))}>－</button>
                  <button type="button" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
                  <button type="button" onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.2) * 10) / 10))}>＋</button>
                </span>
                <button type="button" className="btn-dark-sm" onClick={save} disabled={!dirty || !!busy}>
                  {dirty ? '💾 아이콘 저장' : '저장됨'}
                </button>
                <button type="button" className="btn-link" onClick={rename}>이름 바꾸기</button>
                <label className="btn-link">
                  그림 바꾸기
                  <input type="file" accept="image/*" onChange={replaceImage} hidden />
                </label>
                <button type="button" className="btn-text-danger" onClick={removeActive}>도면 삭제</button>
              </div>
              <div className="sub-text">
                {tool ? `도면을 누르면 [${ICONS[tool].label}] 아이콘이 놓입니다.` : '아이콘을 누르면 선택, 끌면 옮겨집니다. 선택한 아이콘은 아래에서 제품 연결·메모·삭제 (Delete 키로도 삭제).'}
              </div>
            </div>
          )}
          {!canEdit && (
            <div className="dwg-zoom">
              <button type="button" onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.2) * 10) / 10))}>－</button>
              <button type="button" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.2) * 10) / 10))}>＋</button>
            </div>
          )}

          <div className="dwg-stage">
            <div
              ref={board}
              className={`dwg-board ${canEdit && tool ? 'placing' : ''}`}
              style={{ width: width * zoom }}
              onClick={onBoardClick}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <img src={active.image} alt={active.name} draggable={false} />
              {icons.map((ic) => (
                <DrawingIcon
                  key={ic.id}
                  type={ic.type}
                  selected={ic.id === sel}
                  title={[ICONS[ic.type]?.label, lineLabel(lines, ic.line), ic.note].filter(Boolean).join(' · ')}
                  style={{ left: `${ic.x}%`, top: `${ic.y}%` }}
                  onPointerDown={(e) => onIconDown(e, ic)}
                />
              ))}
            </div>
          </div>

          {selected && (
            <div className="dwg-selected">
              <DrawingIcon type={selected.type} style={{ position: 'static', transform: 'none' }} />
              {canEdit ? (
                <>
                  <select className="input-text" value={selected.type} onChange={(e) => setSelected({ type: e.target.value })}>
                    {TYPES.map((t) => (
                      <option key={t} value={t}>{ICONS[t].label}</option>
                    ))}
                  </select>
                  <select className="input-text" value={selected.line ?? ''} onChange={(e) => setSelected({ line: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">제품 연결 안 함</option>
                    {lines.map((l, i) => (
                      <option key={i} value={i}>{lineLabel(lines, i)}</option>
                    ))}
                  </select>
                  <input className="input-text" value={selected.note} onChange={(e) => setSelected({ note: e.target.value })} placeholder="메모 (예: 거실 중앙, 높이 2.4m)" maxLength={100} />
                  <button type="button" className="btn-text-danger" onClick={removeSelected}>아이콘 삭제</button>
                </>
              ) : (
                <span>
                  <b>{ICONS[selected.type]?.label}</b> {lineLabel(lines, selected.line)} {selected.note && `· ${selected.note}`}
                </span>
              )}
              <button type="button" className="btn-link" onClick={() => setSel(null)}>닫기</button>
            </div>
          )}

          <div className="dwg-legend">
            <div>
              <b>범례</b>{' '}
              {byType.length === 0 && <span className="sub-text">아이콘 없음</span>}
              {byType.map(([t, n]) => (
                <span key={t} className="dwg-legend-item">
                  <DrawingIcon type={t} style={{ position: 'static', transform: 'none', pointerEvents: 'none' }} /> {ICONS[t].label} {n}개
                </span>
              ))}
            </div>
            {byLine.length > 0 && (
              <div className="dwg-legend-lines">
                <b>제품별</b>
                {byLine.map(({ l, i, n }) => (
                  <span key={i} className={`dwg-legend-item ${l.qty && n !== Number(l.qty) ? 'mismatch' : ''}`} title="도면 아이콘 수 / 계약 수량">
                    {l.name}: 도면 {n}개{l.qty ? ` / 계약 ${l.qty}개` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
