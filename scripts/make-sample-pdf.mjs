/**
 * Собирает тестовый двухстраничный PDF с вымышленными данными.
 * Запуск: node scripts/make-sample-pdf.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, '..', 'fixtures', 'sample-2pages.pdf');

function build() {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let byteCount = 0;
  const write = v => {
    const b = typeof v === 'string' ? enc.encode(v) : v;
    chunks.push(b);
    byteCount += b.length;
  };
  const obj = (id, body) => {
    offsets[id] = byteCount;
    write(`${id} 0 obj\n`);
    write(body);
    write('\nendobj\n');
  };

  write('%PDF-1.4\n%\xC2\xA5\xC2\xB1\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [ 3 0 R 4 0 R ] /Count 2 >>');

  const page1 = [
    'BT',
    '/F1 18 Tf',
    '50 780 Td',
    '(Bez lichnogo - test page 1) Tj',
    '0 -28 Td',
    '(Fictional data only. No real personal data.) Tj',
    '0 -28 Td',
    '(Name: Testova Anna) Tj',
    '0 -28 Td',
    '(Email: anna.test@example.com) Tj',
    '0 -28 Td',
    '(Phone: +7 (900) 000-00-01) Tj',
    'ET'
  ].join('\n');
  const page2 = [
    'BT',
    '/F1 18 Tf',
    '50 780 Td',
    '(Bez lichnogo - test page 2) Tj',
    '0 -28 Td',
    '(Second page for multipage checks.) Tj',
    '0 -28 Td',
    '(Name: Testov Ivan) Tj',
    '0 -28 Td',
    '(Code: DEMO-002) Tj',
    'ET'
  ].join('\n');

  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>');
  obj(4, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>');
  obj(5, `<< /Length ${enc.encode(page1).length} >>\nstream\n${page1}\nendstream`);
  obj(6, `<< /Length ${enc.encode(page2).length} >>\nstream\n${page2}\nendstream`);
  obj(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const xref = byteCount;
  write(`xref\n0 8\n0000000000 65535 f \n`);
  for (let i = 1; i <= 7; i++) write(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return Buffer.concat(chunks.map(c => Buffer.from(c)));
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, build());
console.log('Записан', out, `(${fs.statSync(out).size} байт)`);
