// 데이터 가져오기 양식 엑셀을 public/templates 에 만듭니다 (칸 정의: src/utils/importTemplates.js)
//   실행: npm run templates (frontend 폴더)
import { mkdirSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { TEMPLATES, buildTemplateWorkbook } from '../src/utils/importTemplates.js';

const dir = new URL('../public/templates/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const kind of Object.keys(TEMPLATES)) {
  const file = new URL(`${kind}.xlsx`, dir).pathname;
  XLSX.writeFile(buildTemplateWorkbook(kind), file, { compression: true });
  console.log(`✔ ${file}`);
}
