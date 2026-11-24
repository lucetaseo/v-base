import React, { useEffect, useState } from 'react';
import { DrawingView } from './DrawingEditor.jsx';

// 계약서에 함께 넣는 시공 도면 (기능 drawings + drawingsInContract)
//   load(): [{ contractId, category, lines, drawings: [{ id, name, image, w, h, icons, shapes }] }] 를 돌려주는 함수
//   계약서 보기(사무실)·고객 서명 화면 공통 — 인쇄 / PDF 저장에도 함께 나옴 (도면마다 새 쪽에서 시작)
export default function ContractDrawings({ load }) {
  const [groups, setGroups] = useState(null);
  useEffect(() => {
    let alive = true;
    load().then(
      (g) => alive && setGroups(g || []),
      () => alive && setGroups([]),
    );
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!groups) return <p className="sub-text no-print">시공 도면 불러오는 중...</p>;
  const shown = groups.filter((g) => g.drawings?.length);
  if (!shown.length) return null;
  const many = shown.length > 1;
  return (
    <section className="contract-drawings">
      {shown.map((g) =>
        g.drawings.map((d) => (
          <div key={`${g.contractId}-${d.id}`} className="contract-drawing">
            <h3 className="contract-drawing-title">
              시공 도면 — {d.name}
              {many && <span className="sub-text"> ({g.category})</span>}
            </h3>
            <DrawingView drawing={d} lines={g.lines || []} />
          </div>
        )),
      )}
    </section>
  );
}
