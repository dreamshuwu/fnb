// 零依赖导出器:CSV / XLSX / 打印友好 HTML。
// XLSX 用最小组件手工打包 —— 手写 ZIP(STORED,不压缩)+ CRC32 + SpreadsheetML,
// 不引入 exceljs/xlsx 等第三方包,便于共享主机直接部署。
import zlib from 'zlib';

// ---------------------------------------------------------------- 工具

const XML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => XML_ESCAPE[c]);
const htmlEsc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 单元格取值。
 *   money → 两位小数
 *   qty   → 三位小数(库存数量:kg/L 这类计量单位不是整数,用 int 会被四舍五入)
 *   int   → 整数
 *   其余  → 原样
 */
export function cellValue(raw, kind) {
  if (raw == null || raw === '') return '';
  if (kind === 'money' || kind === 'int' || kind === 'qty') {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      if (kind === 'money') return Math.round(n * 100) / 100;
      if (kind === 'qty') return Math.round(n * 1000) / 1000;
      return Math.round(n);
    }
  }
  return raw;
}

/** 展示用字符串(CSV / HTML 表格共用)。 */
export function displayValue(raw, kind) {
  const v = cellValue(raw, kind);
  if (v === '') return '';
  if (kind === 'money') return Number(v).toFixed(2);
  // 数量去掉无意义的尾随零:12.5 而不是 12.500,3 而不是 3.000
  if (kind === 'qty') return String(Number(v));
  if (kind === 'date') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleString('en-GB', { hour12: false });
  }
  return String(v);
}

/** A1 列名:0->A, 25->Z, 26->AA */
export function colName(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---------------------------------------------------------------- CSV

/**
 * 生成 CSV(BOM + CRLF,Excel 中文不乱码)。
 * @param {{key:string,label:string,kind?:string}[]} columns
 * @param {object[]} rows
 */
export function buildCsv(columns, rows, meta = {}) {
  const out = [];
  for (const [k, v] of Object.entries(meta)) out.push(`${csvCell(k)},${csvCell(v)}`);
  if (Object.keys(meta).length) out.push('');
  out.push(columns.map((c) => csvCell(c.label)).join(','));
  for (const row of rows) out.push(columns.map((c) => csvCell(displayValue(row[c.key], c.kind))).join(','));
  return '\uFEFF' + out.join('\r\n') + '\r\n';
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------- ZIP (STORED)

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(buf) {
  const t = crcTable();
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ t[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/**
 * 打包 ZIP。默认 DEFLATE 压缩(内置 zlib),压缩后更大时自动回退 STORED。
 * @param {{name:string, data:Buffer|string}[]} files
 */
export function zipFiles(files) {
  const { time, date } = dosDateTime();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra len
    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);               // version made by
    cd.writeUInt16LE(20, 6);               // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);               // extra
    cd.writeUInt16LE(0, 32);               // comment
    cd.writeUInt16LE(0, 34);               // disk start
    cd.writeUInt16LE(0, 36);               // internal attrs
    cd.writeUInt32LE(0, 38);               // external attrs
    cd.writeUInt32LE(offset, 42);          // local header offset
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

// ---------------------------------------------------------------- XLSX

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WB_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// 样式:0=默认 1=标题(粗体16) 2=表头(粗体+底纹) 3=金额(两位小数) 4=整数 5=数量(三位小数)
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.###"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E5F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function inlineStrCell(ref, styleIdx, text) {
  return `<c r="${ref}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}
function numberCell(ref, styleIdx, num) {
  return `<c r="${ref}" s="${styleIdx}"><v>${num}</v></c>`;
}

/**
 * 生成 XLSX Buffer。
 * @param {string} sheetName
 * @param {{key:string,label:string,kind?:string}[]} columns
 * @param {object[]} rows
 * @param {{title?:string, subtitle?:string}} meta
 */
export function buildXlsx(sheetName, columns, rows, meta = {}) {
  const safeSheet = String(sheetName || 'Report').replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) || 'Report';
  const lines = [];
  let rowNo = 1;

  const headerText = meta.title ? String(meta.title) : safeSheet;
  lines.push(`<row r="${rowNo}">${inlineStrCell(`A${rowNo}`, 1, headerText)}</row>`);
  rowNo++;
  if (meta.subtitle) {
    lines.push(`<row r="${rowNo}">${inlineStrCell(`A${rowNo}`, 0, String(meta.subtitle))}</row>`);
    rowNo++;
  }
  lines.push(`<row r="${rowNo}"/>`);
  rowNo++;

  const headRow = rowNo;
  lines.push(`<row r="${headRow}">${columns.map((c, i) => inlineStrCell(`${colName(i)}${headRow}`, 2, c.label)).join('')}</row>`);
  rowNo++;

  for (const row of rows) {
    const cells = columns.map((c, i) => {
      const ref = `${colName(i)}${rowNo}`;
      const kind = c.kind;
      const val = cellValue(row[c.key], kind);
      if (val === '') return inlineStrCell(ref, 0, '');
      if (kind === 'money') return numberCell(ref, 3, Number(val));
      if (kind === 'int') return numberCell(ref, 4, Number(val));
      if (kind === 'qty') return numberCell(ref, 5, Number(val));
      if (kind === 'date') return inlineStrCell(ref, 0, displayValue(row[c.key], kind));
      return inlineStrCell(ref, 0, String(val));
    });
    lines.push(`<row r="${rowNo}">${cells.join('')}</row>`);
    rowNo++;
  }

  const widths = columns.map((c, i) => {
    const maxLen = Math.max(
      c.label.length,
      ...rows.slice(0, 200).map((r) => displayValue(r[c.key], c.kind).length)
    );
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.max(maxLen + 3, 10), 42)}" customWidth="1"/>`;
  }).join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths}</cols><sheetData>${lines.join('')}</sheetData></worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(safeSheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  return zipFiles([
    { name: '[Content_Types].xml', data: CT },
    { name: '_rels/.rels', data: RELS },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: WB_RELS },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

// ---------------------------------------------------------------- 打印友好 HTML

/**
 * 生成可直接打印/另存为 PDF 的独立 HTML 页面(自带样式与自动打印脚本)。
 */
export function buildPrintHtml({ title, subtitle, columns, rows, meta = [], totals = null }) {
  const head = columns.map((c) => `<th>${htmlEsc(c.label)}</th>`).join('');
  const body = rows.map((r) => `<tr>${columns.map((c) => {
    const kind = c.kind;
    const cls = kind === 'money' || kind === 'int' || kind === 'qty' ? 'num' : '';
    return `<td class="${cls}">${htmlEsc(displayValue(r[c.key], kind))}</td>`;
  }).join('')}</tr>`).join('');
  const metaHtml = meta.map(([k, v]) => `<div><span>${htmlEsc(k)}</span><b>${htmlEsc(v)}</b></div>`).join('');
  const totalHtml = totals
    ? `<tfoot><tr>${columns.map((c, i) => `<td class="${c.kind === 'money' || c.kind === 'int' || c.kind === 'qty' ? 'num' : ''}">${i === 0 ? htmlEsc(totals.label || 'TOTAL') : htmlEsc(totals.values?.[c.key] ?? '')}</td>`).join('')}</tr></tfoot>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>${htmlEsc(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font:12px/1.45 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#14202a;margin:0;padding:24px;background:#fff}
  h1{font-size:19px;margin:0 0 4px}
  .sub{color:#5b6b78;font-size:12px;margin-bottom:14px}
  .meta{display:flex;flex-wrap:wrap;gap:10px 26px;margin:0 0 16px;padding:10px 14px;background:#f4f7f9;border:1px solid #dde5ea;border-radius:8px}
  .meta div{display:flex;gap:8px;align-items:baseline}
  .meta span{color:#5b6b78}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#1f4e5f;color:#fff;text-align:left;padding:8px 10px;font-weight:600;white-space:nowrap}
  td{padding:7px 10px;border-bottom:1px solid #e6edf1;vertical-align:top}
  tbody tr:nth-child(even){background:#fafcfd}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  tfoot td{font-weight:700;border-top:2px solid #1f4e5f;background:#eef4f6}
  .empty{padding:26px;text-align:center;color:#8798a4;border:1px dashed #cdd9e0;border-radius:8px}
  .foot{margin-top:16px;color:#8798a4;font-size:11px;display:flex;justify-content:space-between}
  .toolbar{position:fixed;top:12px;right:12px;display:flex;gap:8px}
  .toolbar button{font:inherit;padding:8px 14px;border-radius:7px;border:1px solid #1f4e5f;background:#1f4e5f;color:#fff;cursor:pointer}
  .toolbar button.ghost{background:#fff;color:#1f4e5f}
  @media print{.toolbar{display:none}body{padding:0}@page{margin:14mm;size:auto}}
</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button><button class="ghost" onclick="window.close()">Close</button></div>
<h1>${htmlEsc(title)}</h1>
<div class="sub">${htmlEsc(subtitle || '')}</div>
${metaHtml ? `<div class="meta">${metaHtml}</div>` : ''}
${rows.length
  ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${totalHtml}</table>`
  : '<div class="empty">No data for this report</div>'}
<div class="foot"><span>Generated ${new Date().toLocaleString('en-GB', { hour12: false })}</span><span>${rows.length} row(s)</span></div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},350)})</script>
</body></html>`;
}
