// 시공 도면 → 그림 파일(PNG) 한 장: 도면 그림 위에 도형·선·글자와 조명 아이콘을 그려 넣음
//   고객 확인 페이지 [📄 문서 내려받기]에서 사용 (화면의 DrawingEditor / ShapeLayer 와 같은 크기 비율)
import { ICONS } from '../components/DrawingEditor.jsx';

function loadImage(src) {
  return new Promise((ok, fail) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'; // 사진 저장소 주소: 그림 파일로 만들 수 있게
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('도면 그림을 불러오지 못했습니다.'));
    img.src = src;
  });
}

export async function drawingToBlob(d) {
  const img = await loadImage(d.image);
  const w = img.naturalWidth || d.w || 1000;
  const h = img.naturalHeight || d.h || 700;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const X = (v) => (v * w) / 100;
  const Y = (v) => (v * h) / 100;

  for (const s of d.shapes || []) {
    const lw = Math.max(1, w * 0.001 * s.size);
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    const x1 = X(Math.min(s.x, s.x2));
    const y1 = Y(Math.min(s.y, s.y2));
    const bw = X(Math.abs(s.x2 - s.x));
    const bh = Y(Math.abs(s.y2 - s.y));
    if (s.kind === 'rect' || s.kind === 'ellipse') {
      ctx.beginPath();
      if (s.kind === 'rect') ctx.rect(x1, y1, bw, bh);
      else ctx.ellipse(x1 + bw / 2, y1 + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      if (s.fill) {
        ctx.globalAlpha = 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.stroke();
    } else if (s.kind === 'line' || s.kind === 'arrow') {
      const ax = X(s.x);
      const ay = Y(s.y);
      const bx = X(s.x2);
      const by = Y(s.y2);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      if (s.kind === 'arrow') {
        const a = Math.atan2(by - ay, bx - ax);
        const head = lw * 4;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a) * lw, by + Math.sin(a) * lw);
        ctx.lineTo(bx - Math.cos(a - 0.5) * head, by - Math.sin(a - 0.5) * head);
        ctx.lineTo(bx - Math.cos(a + 0.5) * head, by - Math.sin(a + 0.5) * head);
        ctx.closePath();
        ctx.fill();
      }
    } else if (s.kind === 'text' && s.text) {
      ctx.font = `bold ${w * 0.006 * s.size + 6}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = w * 0.0015 * s.size;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(s.text, X(s.x), Y(s.y));
      ctx.fillText(s.text, X(s.x), Y(s.y));
    }
  }

  const r = Math.max(12, w * 0.012); // 아이콘 반지름
  for (const ic of d.icons || []) {
    const t = ICONS[ic.type] || ICONS.etc;
    const cx = X(ic.x);
    const cy = Y(ic.y);
    const half = t.wide ? r * 1.7 : r;
    ctx.beginPath();
    if (t.wide) ctx.roundRect(cx - half, cy - r * 0.8, half * 2, r * 1.6, r * 0.4);
    else ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = t.color;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.15);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${r * (t.short.length > 2 ? 0.6 : 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.short, cx, cy);
    ctx.textAlign = 'start';
  }

  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('그림 파일을 만들지 못했습니다.'))), 'image/png'));
}

// 내려받기 (파일 이름: 도면 이름.png)
export async function downloadDrawing(d, prefix = '시공도면') {
  const blob = await drawingToBlob(d);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${prefix}_${String(d.name || '도면').replace(/[\\/:*?"<>|]/g, '_')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
