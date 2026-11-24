import React, { useState } from 'react';
import { backdrop } from '../utils/backdrop.js';
import { formatAddress, won } from '../utils/format.js';
import { calcAmounts } from '../utils/contract.js';
import { today } from '../utils/date.js';

// 거래명세서 (기능 statement) — 계약 상세 > [거래명세서] → 인쇄 / PDF 저장
//   공급자: 업체 정보(상호·대표·사업자번호·주소·업태·종목·전화 — 운영자 업체/계정관리에서 입력)
//   공급받는자: 계약자 · 품목: 계약 상품 줄(이름·내용·수량·단가) · 할인은 빼는 줄로
//   부가세: 기본은 '금액에 부가세 포함'(공급가액 = 금액 ÷ 1.1) — 면세·간이과세면 끄기
//   ※ 기본 틀입니다. 아르떼 양식 샘플을 받으면 칸·문구를 맞춥니다 (docs/ARTE.md)
const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL = ['', '십', '백', '천'];
const BIG = ['', '만', '억', '조'];
export function koreanWon(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (!n) return '영';
  let out = '';
  for (let g = 0; n > 0; g++, n = Math.floor(n / 10000)) {
    const part = n % 10000;
    if (!part) continue;
    let s = '';
    String(part)
      .padStart(4, '0')
      .split('')
      .forEach((d, i) => {
        if (d !== '0') s += (d === '1' && i < 3 ? '' : DIGITS[d]) + SMALL[3 - i];
      });
    out = s + BIG[g] + out;
  }
  return out;
}

export default function StatementModal({ contract: c, company, onClose }) {
  const [date, setDate] = useState(today());
  const [vatIncluded, setVatIncluded] = useState(true);
  const a = calcAmounts(c);
  const rows = (c.lineItems || []).length
    ? c.lineItems.map((l) => ({ name: l.name, spec: l.detail || '', qty: Number(l.qty) || 0, price: Number(l.unitPrice) || 0 }))
    : [{ name: `${c.category || ''} 시공`, spec: c.items || '', qty: 1, price: a.total }];
  if (a.discount + a.voucher > 0) rows.push({ name: '할인', spec: c.discountReason || '', qty: 1, price: -(a.discount + a.voucher) });
  const line = (r) => {
    const amount = r.qty * r.price;
    const supply = vatIncluded ? Math.round(amount / 1.1) : amount;
    return { amount, supply, tax: amount - supply };
  };
  const sum = rows.reduce((t, r) => {
    const v = line(r);
    return { supply: t.supply + v.supply, tax: t.tax + v.tax, amount: t.amount + v.amount };
  }, { supply: 0, tax: 0, amount: 0 });
  const paid = a.paid - a.refund;

  return (
    <div className="modal-overlay" {...backdrop(onClose)}>
      <div className="customer-reg-modal wide printable" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-top-bar no-print">
          <h3>&gt; 거래명세서</h3>
          <button type="button" className="modal-close-x" onClick={onClose}>&times;</button>
        </div>
        <div className="inline-fields no-print stmt-opts">
          <label className="sub-text">
            작성일 <input type="date" className="input-text" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="sub-text">
            <input type="checkbox" checked={vatIncluded} onChange={(e) => setVatIncluded(e.target.checked)} /> 금액에 부가세 포함 (면세·간이과세면 끄기)
          </label>
        </div>

        <div className="stmt">
          <h1 className="stmt-title">거 래 명 세 서</h1>
          <div className="stmt-meta">
            <span>작성일 {date}</span>
            <span>No. {c.no || c.id}</span>
          </div>
          <div className="stmt-parties">
            <table className="stmt-box">
              <tbody>
                <tr><th rowSpan={4} className="stmt-side">공급받는자</th><th>성명</th><td><b>{c.customerName}</b> 귀하</td></tr>
                <tr><th>연락처</th><td>{c.customerPhone}</td></tr>
                <tr><th>현장</th><td>{formatAddress(c)}</td></tr>
                <tr><th>계약일</th><td>{c.contractDate}</td></tr>
              </tbody>
            </table>
            <table className="stmt-box">
              <tbody>
                <tr><th rowSpan={5} className="stmt-side">공급자</th><th>등록번호</th><td colSpan={3}>{company?.bizNo}</td></tr>
                <tr><th>상호</th><td>{company?.name}</td><th>대표</th><td>{company?.ceo}</td></tr>
                <tr><th>주소</th><td colSpan={3}>{company?.address}</td></tr>
                <tr><th>업태</th><td>{company?.bizType}</td><th>종목</th><td>{company?.bizItem}</td></tr>
                <tr><th>전화</th><td colSpan={3}>{company?.csPhone || company?.mobile}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="stmt-total">
            합계금액 <b>일금 {koreanWon(sum.amount)}원정</b> (₩{won(sum.amount)}) {vatIncluded ? '· 부가세 포함' : ''}
          </div>
          <table className="stmt-items">
            <thead>
              <tr><th>No</th><th>품목</th><th>규격·내용</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const v = line(r);
                return (
                  <tr key={i}>
                    <td className="c">{i + 1}</td>
                    <td>{r.name}</td>
                    <td className="stmt-spec">{r.spec}</td>
                    <td className="r">{r.qty}</td>
                    <td className="r">{won(r.price)}</td>
                    <td className="r">{won(v.supply)}</td>
                    <td className="r">{won(v.tax)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><th colSpan={5}>합계</th><td className="r">{won(sum.supply)}</td><td className="r">{won(sum.tax)}</td></tr>
              <tr><th colSpan={5}>입금액 / 잔액</th><td colSpan={2} className="r">{won(paid)} / {won(a.balance)}</td></tr>
            </tfoot>
          </table>
          <p className="stmt-foot">위 금액을 정히 청구(영수)합니다.</p>
        </div>

        <div className="form-bottom-btns no-print">
          <button type="button" className="btn-dark-lg" onClick={() => window.print()}>인쇄 / PDF 저장</button>
          <button type="button" className="btn-dark-lg cancel" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
