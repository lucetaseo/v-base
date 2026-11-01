// Vercel 서버 함수: 링크 미리보기용 페이지 (카카오톡·문자·SNS 가 링크를 읽을 때만 — vercel.json 의 rewrites)
//   미리보기 프로그램은 화면 스크립트를 실행하지 않아 모든 링크가 같은 제목으로 보이므로,
//   주소마다 다른 제목(예: "신화탄성 기사모바일 | VerityBase")을 담은 짧은 HTML 을 돌려줌
//   사람이 여는 링크는 이 함수를 거치지 않고 원래 화면(index.html)으로 감
import { getPool } from '../server/pg.js';
import { APP_NAME, pageName, pageTitle } from '../frontend/src/utils/pageTitle.js';

// 업체 코드가 아닌 첫 주소 단어 (frontend/src/router.js 의 PAGES 와 같음)
const PAGES = ['c', 'e', 'm', 'contracts', 'customers', 'schedule', 'progress', 'stats', 'admin', 'settings', 'me', 'engineer', 'sign', 'api', 'assets'];

function split(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const [first, ...rest] = clean.split('/').filter(Boolean);
  if (first && !PAGES.includes(first)) return { base: first.toLowerCase(), path: `/${rest.join('/')}` };
  return { base: '', path: clean };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

async function companyName(code) {
  if (!code || !process.env.DATABASE_URL) return '';
  try {
    const r = await getPool().query(`SELECT data->>'name' AS name FROM companies WHERE data->>'code' = $1 LIMIT 1`, [code]);
    return r.rows[0]?.name || '';
  } catch {
    return ''; // DB 가 안 되어도 미리보기는 기본 제목으로
  }
}

function descriptionOf(route) {
  const page = pageName(route.path);
  if (page === '기사모바일') return '시공기사 전용 · 내 일정 확인과 완료 보고';
  if (page === '고객 모바일') return '내 계약서와 시공 일정 확인';
  if (page === '계약서 확인·서명') return '계약 내용을 확인하고 전자서명해 주세요.';
  return '전자계약 · 시공일정 관리';
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.searchParams.get('path') || url.pathname;
  const route = split(pathname.startsWith('/') ? pathname : `/${pathname}`);
  const title = pageTitle(route, await companyName(route.base));
  const desc = descriptionOf(route);
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const link = `https://${host}${pathname}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).send(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${APP_NAME}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(link)}" />
<meta property="og:image" content="https://${esc(host)}/icon-512.png" />
</head>
<body><a href="${esc(link)}">${esc(title)}</a></body>
</html>`);
}
