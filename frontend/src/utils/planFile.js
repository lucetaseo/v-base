// 도면 파일 → 그림 페이지들 (시공 도면 편집에 올릴 바탕 그림)
//   그림(jpg·png 등): 그대로 1장
//   PDF: 페이지마다 그림으로 바꿈 (pdf.js — 도면을 올릴 때만 불러옴)
//   PPT(pptx): 파일 안에 들어 있는 그림(슬라이드에 붙인 도면 이미지)을 슬라이드 순서대로 꺼냄
//     ※ PPT 도형·선으로 직접 그린 도면은 그림이 아니라 꺼낼 수 없음 → PowerPoint 에서 PDF 로 저장해서 올리면 그대로 보임
//   돌려주는 값: [{ label, file }] — file 은 그림 파일(Blob/File), 화면에서 compressImage 로 줄여서 올림
export const PLAN_ACCEPT = 'image/*,.pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.ppt';
export const PLAN_PAGES_MAX = 20; // 한 파일에서 꺼내는 최대 페이지

const ext = (name) => String(name || '').toLowerCase().split('.').pop();

export async function planPages(file) {
  const e = ext(file.name);
  if (file.type.startsWith('image/') && !/emf|wmf|tiff?$/.test(e)) return [{ label: file.name, file }];
  if (e === 'pdf' || file.type === 'application/pdf') return pdfPages(file);
  if (e === 'pptx') return pptxPages(file);
  if (e === 'ppt') throw new Error('예전 PPT(.ppt) 파일은 열 수 없습니다. PowerPoint 에서 [다른 이름으로 저장] → PDF 또는 .pptx 로 저장해서 올려 주세요.');
  throw new Error('도면은 그림(jpg·png), PDF, PPT(pptx) 파일로 올려 주세요.');
}

// PDF 페이지 → 그림 (긴 변 약 2400px)
async function pdfPages(file) {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, PLAN_PAGES_MAX); i++) {
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(4, 2400 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
    out.push({ label: `${i}쪽`, file: new File([blob], `page${i}.png`, { type: 'image/png' }) });
  }
  doc.destroy();
  if (!out.length) throw new Error('PDF 에 페이지가 없습니다.');
  return out;
}

// PPTX: 슬라이드마다 붙어 있는 그림 (슬라이드 순서 → 그 슬라이드의 그림 순서)
const IMG_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
async function pptxPages(file) {
  const { unzipSync, strFromU8 } = await import('fflate');
  let zip;
  try {
    zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('PPT 파일을 열 수 없습니다. PowerPoint 에서 PDF 로 저장해서 올려 주세요.');
  }
  const text = (p) => (zip[p] ? strFromU8(zip[p]) : '');
  // 슬라이드 순서: presentation.xml 의 sldId → presentation.xml.rels 의 대상 파일
  const presRels = Object.fromEntries([...text('ppt/_rels/presentation.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  let slides = [...text('ppt/presentation.xml').matchAll(/<p:sldId\b[^>]*>/g)].map((m) => presRels[attr(m[0], 'r:id')]).filter(Boolean).map((t) => `ppt/${t.replace(/^\/?ppt\//, '')}`);
  if (!slides.length) slides = Object.keys(zip).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b));
  const out = [];
  const seen = new Set();
  slides.forEach((slide, si) => {
    const relsPath = slide.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
    const rels = Object.fromEntries([...text(relsPath).matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
    // 슬라이드에 나오는 순서대로 (r:embed="rId3")
    const ids = [...text(slide).matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]);
    let n = 0;
    ids.forEach((id) => {
      const target = rels[id];
      if (!target) return;
      const path = resolve(slide, target);
      const type = IMG_TYPES[ext(path)];
      if (!type || !zip[path] || seen.has(path) || zip[path].length < 2048) return; // 아주 작은 그림(아이콘·로고)은 빼고
      seen.add(path);
      n += 1;
      out.push({ label: `슬라이드 ${si + 1}${n > 1 ? `-${n}` : ''}`, file: new File([zip[path]], path.split('/').pop(), { type }) });
    });
  });
  if (!out.length) {
    throw new Error('PPT 안에서 도면 그림을 찾지 못했습니다. 도형으로 그린 도면이면 PowerPoint 에서 [다른 이름으로 저장] → PDF 로 저장해서 올려 주세요.');
  }
  return out.slice(0, PLAN_PAGES_MAX);
}

const attr = (tag, name) => (tag.match(new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`)) || [])[1] || '';
const num = (p) => Number((p.match(/(\d+)\.xml$/) || [])[1] || 0);
// 슬라이드 기준 상대 경로(../media/image1.png) → zip 안의 경로
function resolve(from, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
