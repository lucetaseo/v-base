import React, { useEffect, useRef, useState } from 'react';
import { compressImage } from '../utils/image.js';
import { PLAN_ACCEPT, planPages } from '../utils/planFile.js';

// 시공 도면 (계약 상세 > 시공관리, 기능 drawings) — 아르떼(조명)
//   층별 도면(그림) 위에 조명 아이콘을 놓고(누르기) · 옮기고(끌기) · 지우기, 확대·축소, 범례, 계약 상품 줄과 연결
//   api: { list(), save({ drawingId, name, image, w, h, icons }), remove(drawingId) }
//   lines: 계약 상품 줄 (아이콘 ↔ 제품 연결, 범례에서 계약 수량과 비교)
//   canEdit: false 면 보기만 (아이콘을 누르면 설명)
//   renderInfo(icon, line): 보기 전용에서 아이콘을 눌렀을 때 보일 내용 (고객 화면: 제품 사진·사양 카드)
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

export default function DrawingEditor({ api, lines = [], canEdit = false, onError, renderInfo }) {
  const [list, setList] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [icons, setIcons] = useState([]); // 고치는 중인 아이콘 (저장 전)
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState(null); // 놓을 아이콘 종류 (null = 선택·옮기기)
  const [toolLine, setToolLine] = useState(''); // 새 아이콘에 연결할 상품 줄
  const [sel, setSel] = useState(null); // 고른 아이콘 id
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState('');
  const [chooser, setChooser] = useState(null); // 여러 페이지(PDF·PPT)에서 고르기 { mode: add|replace, pages, picked }
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

  // 도면 파일(그림·PDF·PPT) → 페이지들. 여러 장이면 고르는 창
  const openPlanFile = async (file) => {
    setBusy('파일 여는 중...');
    try {
      return await planPages(file);
    } catch (err) {
      onError?.(err);
      return null;
    } finally {
      setBusy('');
    }
  };

  const addPages = async (pages, askName) => {
    let name = '';
    if (askName) {
      name = window.prompt('도면 이름 (예: 1층, 2층, 거실)', `${(list?.length || 0) + 1}층`);
      if (name === null) return;
    }
    let lastId = null;
    try {
      for (let i = 0; i < pages.length; i++) {
        setBusy(`도면 올리는 중 ${pages.length > 1 ? `${i + 1}/${pages.length}` : ''}`);
        const r = await api.save({ name: name || `${(list?.length || 0) + i + 1}층`, ...(await readImage(pages[i].file)), icons: [] });
        lastId = r.drawing.id;
      }
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy('');
      await load(lastId);
    }
  };

  const replaceWith = async (page) => {
    setBusy('그림 바꾸는 중...');
    try {
      await api.save({ drawingId: active.id, ...(await readImage(page.file)), icons });
      await load(active.id);
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy('');
    }
  };

  const addDrawing = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !confirmLeave()) return;
    const pages = await openPlanFile(file);
    if (!pages) return;
    if (pages.length === 1) return addPages(pages, true);
    setChooser({ mode: 'add', pages, picked: pages.map((_, i) => i === 0) });
  };

  const replaceImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !active) return;
    const pages = await openPlanFile(file);
    if (!pages) return;
    if (pages.length === 1) return replaceWith(pages[0]);
    setChooser({ mode: 'replace', pages, picked: pages.map((_, i) => i === 0) });
  };

  const chooseDone = async () => {
    const { mode, pages, picked } = chooser;
    const sel = pages.filter((_, i) => picked[i]);
    setChooser(null);
    if (!sel.length) return;
    if (mode === 'replace') return replaceWith(sel[0]);
    return addPages(sel, sel.length === 1);
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

  const width = active?.w ? Math.min(active.w, 1100) : 900;
  const stage = useRef(null);
  // 보기 전용(고객 화면 등): 처음엔 도면이 화면 폭에 맞게
  useEffect(() => {
    if (canEdit || !active || !stage.current) return;
    const fit = (stage.current.clientWidth - 4) / width;
    if (fit > 0 && fit < 1) setZoom(Math.max(0.3, Math.floor(fit * 100) / 100));
  }, [activeId, width]); // eslint-disable-line react-hooks/exhaustive-deps

  if (list === null) return <div className="sub-text">도면 불러오는 중...</div>;

  // 범례: 종류별 개수 / 제품(상품 줄)별 개수 ↔ 계약 수량
  const byType = TYPES.map((t) => [t, icons.filter((ic) => ic.type === t).length]).filter(([, n]) => n);
  const byLine = lines.map((l, i) => ({ l, i, n: icons.filter((ic) => ic.line === i).length })).filter((x) => x.n || canEdit);

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
            <input type="file" accept={PLAN_ACCEPT} onChange={addDrawing} hidden />
          </label>
        )}
        {busy && <span className="sub-text">⏳ {busy}</span>}
      </div>

      {chooser && <PageChooser chooser={chooser} setChooser={setChooser} onDone={chooseDone} />}

      {!active ? (
        <p className="sub-text">{canEdit ? '등록된 도면이 없습니다. [+ 도면 추가]로 도면 파일(그림 jpg·png, PDF, PPT)을 올려 주세요. PPT 는 슬라이드에 붙인 도면 그림을 꺼내 오고, 도형으로 그린 도면은 PDF 로 저장해서 올리면 그대로 보입니다.' : '등록된 도면이 없습니다.'}</p>
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
                  <input type="file" accept={PLAN_ACCEPT} onChange={replaceImage} hidden />
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

          <div className="dwg-stage" ref={stage}>
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
              ) : renderInfo ? (
                renderInfo(selected, selected.line === null || selected.line === undefined ? null : lines[selected.line])
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
            {byLine.length > 0 && !renderInfo && (
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

// PDF·PPT 에서 도면으로 쓸 페이지 고르기 (추가: 여러 장 → 층마다 도면, 바꾸기: 1장)
function PageChooser({ chooser, setChooser, onDone }) {
  const [urls] = useState(() => chooser.pages.map((p) => URL.createObjectURL(p.file)));
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const multi = chooser.mode === 'add';
  const toggle = (i) => setChooser({ ...chooser, picked: chooser.picked.map((v, j) => (multi ? (j === i ? !v : v) : j === i)) });
  const n = chooser.picked.filter(Boolean).length;
  return (
    <div className="dwg-chooser">
      <div className="bold-text">{multi ? '도면으로 쓸 페이지를 고르세요 (여러 장 고르면 한 장씩 도면이 됩니다)' : '바꿀 그림을 고르세요'}</div>
      <div className="dwg-chooser-grid">
        {chooser.pages.map((p, i) => (
          <button key={i} type="button" className={chooser.picked[i] ? 'picked' : ''} onClick={() => toggle(i)}>
            <img src={urls[i]} alt={p.label} />
            <span>{chooser.picked[i] ? '✔ ' : ''}{p.label}</span>
          </button>
        ))}
      </div>
      <div className="inline-fields">
        <button type="button" className="btn-dark-sm" onClick={onDone} disabled={!n}>
          {multi ? `${n}장 도면으로 추가` : '이 그림으로 바꾸기'}
        </button>
        <button type="button" className="btn-link" onClick={() => setChooser(null)}>취소</button>
      </div>
    </div>
  );
}
