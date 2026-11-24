import React, { useEffect, useRef, useState } from 'react';
import { compressImage } from '../utils/image.js';
import { PLAN_ACCEPT, planPages } from '../utils/planFile.js';

// 시공 도면 (계약 상세 > 시공관리, 기능 drawings) — 아르떼(조명)
//   층별 도면(그림) 위에 조명 아이콘을 놓고(누르기) · 옮기고(끌기) · 지우기, 확대·축소, 범례, 계약 상품 줄과 연결
//   api: { list(), save({ drawingId, name, image, w, h, icons, shapes }), remove(drawingId) }
//   도형·선·글자(shapes): 사각형·원·선·화살표·글자 — 끌어서 그리고, 고르면 양 끝 손잡이로 크기 조절, 끌어서 옮김
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

// 도형·선·글자 (api/drawings.js SHAPE_KINDS·SHAPE_COLORS 와 같게)
export const SHAPES = {
  rect: { label: '사각형', mark: '▭' },
  ellipse: { label: '원', mark: '◯' },
  line: { label: '선', mark: '／' },
  arrow: { label: '화살표', mark: '→' },
  text: { label: '글자', mark: 'T' },
};
const SHAPE_COLORS = ['#ef4444', '#2563eb', '#16a34a', '#111827', '#f59e0b', '#9333ea'];
const isShapeTool = (t) => typeof t === 'string' && t.startsWith('shape:');

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
  const [shapes, setShapes] = useState([]); // 고치는 중인 도형·선·글자 (저장 전)
  const [pen, setPen] = useState({ color: SHAPE_COLORS[0], size: 3 }); // 새 도형 색·굵기
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
      setShapes(l.find((d) => d.id === id)?.shapes || []);
      setDirty(false);
      setSel(null);
    } catch (e) {
      onError?.(e);
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmLeave = () => !dirty || window.confirm('저장하지 않은 변경(아이콘·도형)이 있습니다. 버리고 넘어갈까요?');
  const pick = (d) => {
    if (d.id === activeId || !confirmLeave()) return;
    setActiveId(d.id);
    setIcons(d.icons || []);
    setShapes(d.shapes || []);
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
        const r = await api.save({ name: name || `${(list?.length || 0) + i + 1}층`, ...(await readImage(pages[i].file)), icons: [], shapes: [] });
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
      await api.save({ drawingId: active.id, ...(await readImage(page.file)), icons, shapes });
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
      await api.save({ drawingId: active.id, name, icons, shapes });
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
      await api.save({ drawingId: active.id, icons, shapes });
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

  const changeShapes = (next) => {
    setShapes(next);
    setDirty(true);
  };

  const onBoardClick = (e) => {
    if (!canEdit || !tool || drag.current?.moved) return;
    if (e.target.closest('.dwg-icon') || e.target.closest('.dwg-shape')) return;
    if (tool === 'shape:text') {
      const text = window.prompt('넣을 글자 (예: 거실, 높이 2.4m)', '');
      if (!text || !text.trim()) return;
      const p = posOf(e);
      const sh = { id: newId(), kind: 'text', x: p.x, y: p.y, x2: p.x, y2: p.y, text: text.trim().slice(0, 100), color: pen.color, size: pen.size, fill: false };
      changeShapes([...shapes, sh]);
      setSel(sh.id);
      return;
    }
    if (isShapeTool(tool)) return; // 도형은 끌어서 그림 (onBoardDown)
    const ic = { id: newId(), type: tool, ...posOf(e), line: toolLine === '' ? null : Number(toolLine), note: '' };
    change([...icons, ic]);
    setSel(ic.id);
  };

  // 도형 그리기: 누른 자리에서 끈 자리까지
  const onBoardDown = (e) => {
    if (!canEdit || !isShapeTool(tool) || tool === 'shape:text') return;
    if (e.target.closest('.dwg-icon') || e.target.closest('.dwg-shape')) return;
    e.preventDefault();
    const p = posOf(e);
    const sh = { id: newId(), kind: tool.slice(6), x: p.x, y: p.y, x2: p.x, y2: p.y, text: '', color: pen.color, size: pen.size, fill: false };
    setShapes((prev) => [...prev, sh]);
    setSel(sh.id);
    board.current.setPointerCapture?.(e.pointerId);
    drag.current = { draw: sh.id, moved: false };
  };

  const onIconDown = (e, ic) => {
    e.stopPropagation();
    setSel(ic.id);
    if (!canEdit) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: ic.id, moved: false };
  };
  // 도형 옮기기(handle 없음) · 끝점 옮기기(handle 1: 시작, 2: 끝)
  const onShapeDown = (e, sh, handle = 0) => {
    e.stopPropagation();
    setSel(sh.id);
    if (!canEdit) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { shape: sh.id, handle, start: posOf(e), orig: sh, moved: false };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = posOf(e);
    d.moved = true;
    if (d.draw) return setShapes((prev) => prev.map((sh) => (sh.id === d.draw ? { ...sh, x2: x, y2: y } : sh)));
    if (d.shape) {
      const o = d.orig;
      const clamp = (v) => Math.min(100, Math.max(0, Math.round(v * 100) / 100));
      let next;
      if (d.handle === 1) next = { x, y };
      else if (d.handle === 2) next = { x2: x, y2: y };
      else {
        const dx = x - d.start.x;
        const dy = y - d.start.y;
        next = { x: clamp(o.x + dx), y: clamp(o.y + dy), x2: clamp(o.x2 + dx), y2: clamp(o.y2 + dy) };
      }
      return setShapes((prev) => prev.map((sh) => (sh.id === d.shape ? { ...sh, ...next } : sh)));
    }
    setIcons((prev) => prev.map((ic) => (ic.id === d.id ? { ...ic, x, y } : ic)));
  };
  const onUp = () => {
    const d = drag.current;
    if (d?.draw) {
      // 거의 안 끌었으면 기본 크기로
      setShapes((prev) =>
        prev.map((sh) => {
          if (sh.id !== d.draw || Math.abs(sh.x2 - sh.x) + Math.abs(sh.y2 - sh.y) > 1.5) return sh;
          return { ...sh, x2: Math.min(100, sh.x + 10), y2: sh.kind === 'line' || sh.kind === 'arrow' ? sh.y : Math.min(100, sh.y + 7) };
        }),
      );
      setDirty(true);
    } else if (d?.moved) setDirty(true);
    setTimeout(() => (drag.current = null), 0);
  };

  const selected = icons.find((ic) => ic.id === sel) || null;
  const selShape = shapes.find((sh) => sh.id === sel) || null;
  const setSelected = (patch) => change(icons.map((ic) => (ic.id === sel ? { ...ic, ...patch } : ic)));
  const setSelShape = (patch) => {
    changeShapes(shapes.map((sh) => (sh.id === sel ? { ...sh, ...patch } : sh)));
    if (patch.color || patch.size) setPen((p) => ({ ...p, ...(patch.color ? { color: patch.color } : {}), ...(patch.size ? { size: patch.size } : {}) }));
  };
  const removeSelected = () => {
    if (selShape) changeShapes(shapes.filter((sh) => sh.id !== sel));
    else change(icons.filter((ic) => ic.id !== sel));
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
              <div className="dwg-palette dwg-shape-tools">
                <span className="sub-text">도형·글자</span>
                {Object.entries(SHAPES).map(([k, v]) => (
                  <button key={k} type="button" className={`dwg-tool ${tool === `shape:${k}` ? 'active' : ''}`} onClick={() => setTool(`shape:${k}`)} title={k === 'text' ? '글자 넣기: 도면을 누르세요' : `${v.label} 그리기: 도면에서 끌어서 그리세요`}>
                    <span className="dwg-shape-mark" style={{ color: pen.color }}>{v.mark}</span> {v.label}
                  </button>
                ))}
                <span className="dwg-colors">
                  {SHAPE_COLORS.map((c) => (
                    <button key={c} type="button" className={pen.color === c ? 'on' : ''} style={{ background: c }} onClick={() => (selShape ? setSelShape({ color: c }) : setPen({ ...pen, color: c }))} title="색" />
                  ))}
                </span>
                <select className="input-text" value={pen.size} onChange={(e) => (selShape ? setSelShape({ size: Number(e.target.value) }) : setPen({ ...pen, size: Number(e.target.value) }))} title="굵기·글자 크기">
                  {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                    <option key={n} value={n}>굵기 {n}</option>
                  ))}
                </select>
              </div>
              <div className="inline-fields">
                {tool && !isShapeTool(tool) && (
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
                  {dirty ? '💾 저장' : '저장됨'}
                </button>
                <button type="button" className="btn-link" onClick={rename}>이름 바꾸기</button>
                <label className="btn-link">
                  그림 바꾸기
                  <input type="file" accept={PLAN_ACCEPT} onChange={replaceImage} hidden />
                </label>
                <button type="button" className="btn-text-danger" onClick={removeActive}>도면 삭제</button>
              </div>
              <div className="sub-text">
                {tool === 'shape:text' ? '도면을 누르면 그 자리에 글자를 넣습니다.' : isShapeTool(tool) ? `도면에서 끌면 [${SHAPES[tool.slice(6)].label}]이(가) 그려집니다. 고른 도형은 양 끝 손잡이로 크기 조절, 끌어서 옮김.` : tool ? `도면을 누르면 [${ICONS[tool].label}] 아이콘이 놓입니다.` : '아이콘을 누르면 선택, 끌면 옮겨집니다. 선택한 아이콘은 아래에서 제품 연결·메모·삭제 (Delete 키로도 삭제).'}
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
              onPointerDown={onBoardDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <img src={active.image} alt={active.name} draggable={false} />
              <ShapeLayer w={active.w || 1000} h={active.h || 700} shapes={shapes} sel={sel} canEdit={canEdit} onDown={onShapeDown} />
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

          {selShape && canEdit && (
            <div className="dwg-selected">
              <span className="dwg-shape-mark" style={{ color: selShape.color }}>{SHAPES[selShape.kind]?.mark}</span> <b>{SHAPES[selShape.kind]?.label}</b>
              {selShape.kind === 'text' && (
                <input className="input-text" value={selShape.text} onChange={(e) => setSelShape({ text: e.target.value })} maxLength={100} placeholder="글자" />
              )}
              <span className="dwg-colors">
                {SHAPE_COLORS.map((c) => (
                  <button key={c} type="button" className={selShape.color === c ? 'on' : ''} style={{ background: c }} onClick={() => setSelShape({ color: c })} title="색" />
                ))}
              </span>
              <select className="input-text" value={selShape.size} onChange={(e) => setSelShape({ size: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                  <option key={n} value={n}>{selShape.kind === 'text' ? '크기' : '굵기'} {n}</option>
                ))}
              </select>
              {(selShape.kind === 'rect' || selShape.kind === 'ellipse') && (
                <label className="sub-text">
                  <input type="checkbox" checked={!!selShape.fill} onChange={(e) => setSelShape({ fill: e.target.checked })} /> 안을 연하게 칠하기
                </label>
              )}
              <button type="button" className="btn-text-danger" onClick={removeSelected}>지우기</button>
              <button type="button" className="btn-link" onClick={() => setSel(null)}>닫기</button>
            </div>
          )}
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

// 도형·선·글자 그리기 (도면 그림 위 SVG) — 좌표는 도면 그림 크기(w×h) 기준이라 확대해도 비율 그대로
function ShapeLayer({ w, h, shapes, sel, canEdit, onDown }) {
  if (!shapes.length) return null;
  const X = (v) => (v * w) / 100;
  const Y = (v) => (v * h) / 100;
  const sw = (s) => Math.max(1, w * 0.001 * s.size); // 선 굵기
  const handle = Math.max(4, w * 0.006);
  return (
    <svg className="dwg-shapes" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        {SHAPE_COLORS.map((c) => (
          <marker key={c} id={`dwg-arrow-${c.slice(1)}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={c} />
          </marker>
        ))}
      </defs>
      {shapes.map((s) => {
        const on = s.id === sel && canEdit;
        const common = { stroke: s.color, strokeWidth: sw(s), fill: s.fill ? s.color : 'none', fillOpacity: s.fill ? 0.15 : undefined };
        const ev = canEdit ? { onPointerDown: (e) => onDown(e, s) } : {};
        const x1 = Math.min(s.x, s.x2), y1 = Math.min(s.y, s.y2);
        let el;
        if (s.kind === 'rect') el = <rect x={X(x1)} y={Y(y1)} width={X(Math.abs(s.x2 - s.x))} height={Y(Math.abs(s.y2 - s.y))} {...common} />;
        else if (s.kind === 'ellipse') el = <ellipse cx={X((s.x + s.x2) / 2)} cy={Y((s.y + s.y2) / 2)} rx={X(Math.abs(s.x2 - s.x) / 2)} ry={Y(Math.abs(s.y2 - s.y) / 2)} {...common} />;
        else if (s.kind === 'line' || s.kind === 'arrow')
          el = <line x1={X(s.x)} y1={Y(s.y)} x2={X(s.x2)} y2={Y(s.y2)} stroke={s.color} strokeWidth={sw(s)} strokeLinecap="round" markerEnd={s.kind === 'arrow' ? `url(#dwg-arrow-${s.color.slice(1)})` : undefined} />;
        else
          el = (
            <text x={X(s.x)} y={Y(s.y)} fill={s.color} fontSize={w * 0.006 * s.size + 6} fontWeight="700" dominantBaseline="middle" stroke="#fff" strokeWidth={w * 0.0015 * s.size} paintOrder="stroke">
              {s.text}
            </text>
          );
        // 잡기 쉬운 넓은 투명 테두리 (도형 안쪽은 비워 둠 — 아래 아이콘·도면을 누를 수 있게)
        const hitW = Math.max(sw(s) * 3, w * 0.008);
        let hit = null;
        if (canEdit) {
          if (s.kind === 'rect') hit = <rect x={X(x1)} y={Y(y1)} width={X(Math.abs(s.x2 - s.x))} height={Y(Math.abs(s.y2 - s.y))} fill="none" stroke="transparent" strokeWidth={hitW} />;
          else if (s.kind === 'ellipse') hit = <ellipse cx={X((s.x + s.x2) / 2)} cy={Y((s.y + s.y2) / 2)} rx={X(Math.abs(s.x2 - s.x) / 2)} ry={Y(Math.abs(s.y2 - s.y) / 2)} fill="none" stroke="transparent" strokeWidth={hitW} />;
          else if (s.kind !== 'text') hit = <line x1={X(s.x)} y1={Y(s.y)} x2={X(s.x2)} y2={Y(s.y2)} stroke="transparent" strokeWidth={hitW} />;
        }
        return (
          <g key={s.id} className={`dwg-shape ${on ? 'on' : ''}`} {...ev}>
            {el}
            {hit}
            {on && s.kind !== 'text' && (
              <>
                <circle className="dwg-handle" cx={X(s.x)} cy={Y(s.y)} r={handle} onPointerDown={(e) => onDown(e, s, 1)} />
                <circle className="dwg-handle" cx={X(s.x2)} cy={Y(s.y2)} r={handle} onPointerDown={(e) => onDown(e, s, 2)} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
