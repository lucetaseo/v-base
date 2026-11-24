import React, { useEffect, useState } from 'react';
import { usePageTitle } from '../utils/title.js';
import { companies as companyApi, customerApp } from '../api/index.js';
import { timeLabel } from '../utils/contract.js';
import { formatPhone, won } from '../utils/format.js';
import { formatKoreanDate } from '../utils/date.js';
import { navigate } from '../router.js';
import DrawingEditor, { ICONS } from '../components/DrawingEditor.jsx';
import StatementModal from '../components/StatementModal.jsx';
import { downloadDrawing } from '../utils/drawingImage.js';

// 고객모바일 (/{업체}/c, 알림톡 링크 /{업체}/c/{고유값})
//   - 링크로 들어오면 입력 없이 바로 로그인
//   - 직접 들어오면 이름 + 휴대폰번호 (아이디저장 / 자동로그인은 이 기기에만 저장)
const CIRCLED = ['①', '②', '③', '④'];
const memKey = (code) => `vb.customer.${code}`;
const readMem = (code) => {
  try {
    return JSON.parse(localStorage.getItem(memKey(code)) || '{}');
  } catch {
    return {};
  }
};
const writeMem = (code, v) => {
  try {
    if (v) localStorage.setItem(memKey(code), JSON.stringify(v));
    else localStorage.removeItem(memKey(code));
  } catch {
    /* 저장 안 되는 브라우저는 무시 */
  }
};

export default function CustomerApp({ companyCode, token }) {
  const [data, setData] = useState(null);
  const [checking, setChecking] = useState(true);
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    companyApi
      .publicInfo(companyCode)
      .then((c) => setCompanyName(c?.name || ''))
      .catch(() => {});
  }, [companyCode]);

  useEffect(() => {
    let alive = true;
    const done = (d) => alive && (setData(d), setChecking(false));
    const fail = (e) => alive && (setError(e?.message || ''), setChecking(false));
    (async () => {
      if (token) {
        try {
          const d = await customerApp.linkLogin(token);
          navigate('/c', { replace: true }); // 주소창에 고유값이 남지 않게
          return done(d);
        } catch (e) {
          navigate('/c', { replace: true });
          return fail(e);
        }
      }
      try {
        return done(await customerApp.me());
      } catch {
        const mem = readMem(companyCode);
        if (mem.auto && mem.name && mem.phone) {
          try {
            return done(await customerApp.login(companyCode, mem.name, mem.phone));
          } catch {
            /* 자동로그인 실패 → 입력 화면 */
          }
        }
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [companyCode, token]);

  const logout = async () => {
    await customerApp.logout().catch(() => {});
    const mem = readMem(companyCode);
    writeMem(companyCode, mem.saveName ? { saveName: true, name: mem.name } : null);
    setData(null);
  };

  const title = companyName || data?.company.name || '';
  usePageTitle(`내 계약 확인 · ${title || 'VerityBase'}`, title ? `${title} 내 계약` : '내 계약');
  if (checking) return <div className="page-loading">불러오는 중...</div>;
  return (
    <div className="cust-app">
      <header className="cust-head">
        <span className="logo-box">VB</span>
        <div>
          <strong>{title}</strong>
          <div>고객모바일</div>
        </div>
        {data && (
          <button type="button" className="btn-logout" onClick={logout}>
            로그아웃
          </button>
        )}
      </header>
      {data ? <MyContracts data={data} /> : <CustomerLogin companyCode={companyCode} notice={error} onLogin={setData} />}
      <footer className="cust-foot">ⓒ VerityBase. ALL RIGHTS RESERVED</footer>
    </div>
  );
}

function CustomerLogin({ companyCode, notice, onLogin }) {
  const mem = readMem(companyCode);
  const [name, setName] = useState(mem.saveName || mem.auto ? mem.name || '' : '');
  const [phone, setPhone] = useState('');
  const [saveName, setSaveName] = useState(!!mem.saveName);
  const [auto, setAuto] = useState(!!mem.auto);
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await customerApp.login(companyCode, name, phone);
      writeMem(companyCode, auto ? { auto: true, saveName, name, phone } : saveName ? { saveName: true, name } : null);
      onLogin(d);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="cust-login" onSubmit={submit}>
      <input className="input-text" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      <input
        className="input-text"
        placeholder="휴대폰번호"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(formatPhone(e.target.value))}
        autoComplete="tel"
        required
      />
      <div className="cust-checks">
        <label>
          <input type="checkbox" checked={saveName} onChange={(e) => setSaveName(e.target.checked)} /> 아이디저장
        </label>
        <label>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 자동로그인
        </label>
      </div>
      {error && <p className="login-error">{error}</p>}
      <button type="submit" className="btn-confirm big" disabled={busy}>
        {busy ? '확인 중...' : '로그인'}
      </button>
      <p className="sub-text">계약하신 분의 이름과 휴대폰번호로 확인합니다. 카카오 알림톡의 버튼을 누르면 입력 없이 바로 들어옵니다.</p>
    </form>
  );
}

const STEP_LABEL = (c) => (c.status === '취소' ? '취소' : c.status === '시공완료' ? '시공완료' : c.schedules.some((s) => s.assigneeName) ? '기사배정' : '접수');

function MyContracts({ data }) {
  if (!data.contracts.length) return <p className="no-data">확인할 계약이 없습니다.</p>;
  return (
    <div className="cust-body">
      <p className="cust-hello">
        <b>{data.customer.name}</b>님의 계약 {data.contracts.length}건
      </p>
      {data.company.help && <CustCalendar contracts={data.contracts} />}
      {data.contracts.map((c) => (
        <section key={c.id} className="cust-card">
          <div className="cust-card-top">
            <span className="status-chip st-blue">{c.category}{c.workType && c.workType !== '시공' ? ` · ${c.workType}` : ''}</span>
            <span className="sub-text">{c.brand} · 계약일 {c.contractDate}</span>
            <span className={`cust-step ${c.status === '취소' ? 'canceled' : c.status === '시공완료' ? 'done' : ''}`}>{STEP_LABEL(c)}</span>
          </div>
          <div className="bold-text">{c.address}</div>

          <table className="cust-table">
            <tbody>
              {c.schedules.map((s, i) => (
                <tr key={i}>
                  <th>{CIRCLED[i] || `${i + 1}`} 시공</th>
                  <td>
                    {s.date ? `${formatKoreanDate(s.date)} ${timeLabel(s) || ''}` : '일정 협의 중'}
                    {s.assigneeName && <div className="sub-text">담당 기사 {s.assigneeName}</div>}
                  </td>
                  <td className="nowrap">{s.done ? <span className="text-done">완료</span> : ''}</td>
                </tr>
              ))}
              <tr>
                <th>시공 내용</th>
                <td colSpan={2}>
                  {c.lineItems.map((l, i) => (
                    <div key={i}>
                      {l.name}
                      {l.qty > 1 && ` x${l.qty}`}
                    </div>
                  ))}
                  {c.items && <div className="pre-wrap sub-text">{c.items}</div>}
                </td>
              </tr>
              <tr>
                <th>계약금액</th>
                <td colSpan={2}>
                  <b>{won(c.amounts.actual)}원</b>
                  {c.amounts.discount > 0 && <span className="sub-text"> (할인 {won(c.amounts.discount)}원)</span>}
                </td>
              </tr>
              <tr>
                <th>결제</th>
                <td colSpan={2}>
                  {c.amounts.deposit > 0 && <div>계약금 {won(c.amounts.deposit)}원</div>}
                  <div className={c.amounts.balance > 0 ? 'text-red bold-text' : 'text-done'}>
                    {c.amounts.balance > 0 ? `남은 잔금 ${won(c.amounts.balance)}원` : '완납'}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {c.customerNote && (
            <div className="doc-customer-note">
              <h4>안내사항</h4>
              <p className="pre-wrap">{c.customerNote}</p>
            </div>
          )}

          {c.drawingCount > 0 && <CustDrawings contractId={c.id} count={c.drawingCount} />}
          {c.docCount > 0 && <CustDocs contractId={c.id} count={c.docCount} />}

          <div className="cust-actions">
            {c.esign.token ? (
              <a className={`btn-confirm ${c.esign.status === '서명완료' ? 'outline' : ''}`} href={`/sign/${c.esign.token}`}>
                {c.esign.status === '서명완료' ? '계약서 보기 (서명완료)' : '✍ 계약서 확인 · 서명하기'}
              </a>
            ) : (
              <span className="sub-text">계약서는 준비되면 알림톡으로 보내드립니다.</span>
            )}
          </div>
        </section>
      ))}
      {data.company.help && <CustHelp help={data.company.help} />}
    </div>
  );
}

// 문서 내려받기 (기능 customerDocs): 업체가 고른 것만 — 계약서(PDF 저장) · 확정 도면(그림 파일) · 거래명세서 · 파일
function CustDocs({ contractId, count }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [statement, setStatement] = useState(false);
  const toggle = async () => {
    if (!open && !data) {
      try {
        setError('');
        setData(await customerApp.documents(contractId));
      } catch (e) {
        setError(e.message || '문서를 불러오지 못했습니다.');
        return;
      }
    }
    setOpen((v) => !v);
  };
  const saveDrawing = async (d) => {
    try {
      setBusy(d.name);
      await downloadDrawing(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="cust-docs">
      <button type="button" className="btn-confirm outline" onClick={toggle}>
        {open ? '문서 접기' : `📄 문서 내려받기 (${count})`}
      </button>
      {error && <p className="login-error">{error}</p>}
      {open && data && (
        <ul className="cust-doc-list">
          {data.contract && (
            <li>
              <span>📝 계약서{data.contract.signed ? ' (서명 완료)' : ''}</span>
              <a className="btn-link" href={`/sign/${data.contract.token}`} target="_blank" rel="noreferrer">열기 → [인쇄 / PDF 저장]</a>
            </li>
          )}
          {data.drawings.map((d) => (
            <li key={`d${d.id}`}>
              <span>🗺 시공 도면 — {d.name}</span>
              <button type="button" className="btn-link" onClick={() => saveDrawing(d)} disabled={!!busy}>{busy === d.name ? '만드는 중...' : '그림 파일 받기'}</button>
            </li>
          ))}
          {data.statement && (
            <li>
              <span>🧾 거래명세서</span>
              <button type="button" className="btn-link" onClick={() => setStatement(true)}>열기 → [인쇄 / PDF 저장]</button>
            </li>
          )}
          {data.files.map((f) => (
            <li key={`f${f.id}`}>
              <span>📎 {f.name}</span>
              <a className="btn-link" href={f.url} target="_blank" rel="noreferrer" download={f.name}>받기</a>
            </li>
          ))}
        </ul>
      )}
      {statement && data?.statement && <StatementModal contract={data.statement.contract} company={data.statement.company} onClose={() => setStatement(false)} />}
    </div>
  );
}

// 시공 도면 (기능 drawings + customerDrawings): 보기 전용 — 아이콘을 누르면 그 제품의 사진·사양
function CustDrawings({ contractId, count }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const toggle = async () => {
    if (!open && !data) {
      try {
        setError('');
        setData(await customerApp.drawings(contractId));
      } catch (e) {
        setError(e.message || '도면을 불러오지 못했습니다.');
        return;
      }
    }
    setOpen((v) => !v);
  };
  return (
    <div className="cust-drawings">
      <button type="button" className="btn-confirm outline" onClick={toggle}>
        {open ? '도면 접기' : `🗺 시공 도면 보기 (${count}장)`}
      </button>
      {error && <p className="login-error">{error}</p>}
      {open && data && (
        <>
          <p className="sub-text">도면의 아이콘을 누르면 어떤 제품이 설치되는지 볼 수 있습니다.</p>
          <DrawingEditor
            api={{ list: async () => data.drawings }}
            lines={data.lines}
            canEdit={false}
            onError={(e) => setError(e.message)}
            renderInfo={(icon, line) => <ProductCard icon={icon} line={line} />}
          />
        </>
      )}
    </div>
  );
}

function ProductCard({ icon, line }) {
  const [big, setBig] = useState(false);
  return (
    <div className="cust-product">
      {line?.photo && <img className={big ? 'big' : ''} src={line.photo} alt={line.name} onClick={() => setBig((v) => !v)} />}
      <div>
        <div className="bold-text">{line ? line.name : ICONS[icon.type]?.label}</div>
        <div className="sub-text">{ICONS[icon.type]?.label}{line?.qty > 1 ? ` · 이 제품 ${line.qty}개 시공` : ''}</div>
        {line?.detail && <div className="pre-wrap">{line.detail}</div>}
        {line?.spec && <div className="pre-wrap cust-product-spec">{line.spec}</div>}
        {!line && <div className="sub-text">제품 설명이 아직 등록되지 않았습니다.</div>}
      </div>
    </div>
  );
}

// 시공 일정 달력 (기능 customerHelp): 내 계약들의 시공일을 달력에 표시 — 처음엔 다가오는 시공일이 있는 달
function CustCalendar({ contracts }) {
  const days = contracts.flatMap((c) =>
    c.status === '취소' ? [] : c.schedules.map((s, i) => (s.date ? { date: s.date, label: `${c.category} ${i + 1}차`, done: s.done, time: timeLabel(s) || '' } : null)).filter(Boolean),
  );
  const t = new Date();
  const todayKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const next = days.map((d) => d.date).filter((d) => d >= todayKey).sort()[0] || todayKey;
  const [ym, setYm] = useState(() => next.slice(0, 7));
  const [y, m] = ym.split('-').map(Number);
  const move = (d) => {
    const dt = new Date(y, m - 1 + d, 1);
    setYm(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  };
  const first = new Date(y, m - 1, 1).getDay();
  const last = new Date(y, m, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: last }, (_, i) => i + 1)];
  const keyOf = (d) => `${ym}-${String(d).padStart(2, '0')}`;
  const inMonth = days.filter((d) => d.date.startsWith(ym)).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section className="cust-card cust-calendar">
      <div className="cust-cal-head">
        <button type="button" onClick={() => move(-1)} aria-label="이전 달">‹</button>
        <strong>
          {y}년 {m}월 시공 일정
        </strong>
        <button type="button" onClick={() => move(1)} aria-label="다음 달">›</button>
      </div>
      <div className="cust-cal-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
          <div key={w} className="cust-cal-w">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const hit = days.filter((x) => x.date === keyOf(d));
          return (
            <div key={i} className={`cust-cal-d ${hit.length ? (hit.every((x) => x.done) ? 'done' : 'has') : ''} ${keyOf(d) === todayKey ? 'today' : ''}`}>
              {d}
            </div>
          );
        })}
      </div>
      {inMonth.length ? (
        <ul className="cust-cal-list">
          {inMonth.map((d, i) => (
            <li key={i}>
              {formatKoreanDate(d.date)} {d.time} — {d.label} {d.done ? <span className="text-done">완료</span> : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sub-text">이 달에는 시공 일정이 없습니다.</p>
      )}
    </section>
  );
}

// 고객센터 연결 (기능 customerHelp): 전화 상담 · 카카오톡 상담 · 상담 시간
function CustHelp({ help }) {
  if (!help.csPhone && !help.kakaoUrl) return null;
  return (
    <section className="cust-card cust-help">
      <h4>문의가 있으신가요?</h4>
      <div className="cust-help-btns">
        {help.csPhone && (
          <a className="btn-confirm outline" href={`tel:${help.csPhone.replace(/[^\d+]/g, '')}`}>
            📞 전화 상담 ({help.csPhone})
          </a>
        )}
        {help.kakaoUrl && /^https?:\/\//i.test(help.kakaoUrl) && (
          <a className="btn-confirm kakao" href={help.kakaoUrl} target="_blank" rel="noreferrer noopener">
            💬 카카오톡 상담
          </a>
        )}
      </div>
      {help.csHours && <p className="sub-text">상담 시간: {help.csHours}</p>}
    </section>
  );
}
