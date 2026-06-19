const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const REPORT_COLUMNS = [
  { key: "recordType", label: "Type", width: 12, style: "text" },
  { key: "status", label: "Status", width: 24, style: "text" },
  { key: "expectedPayoutDate", label: "Expected payout date", width: 18, style: "date" },
  { key: "amount", label: "Amount", width: 12, style: "currency" },
  { key: "vendor", label: "Vendor", width: 22, style: "text" },
  { key: "category", label: "Category", width: 16, style: "text" },
  { key: "tripNumber", label: "Trip #", width: 12, style: "text" },
  { key: "expenseDate", label: "Expense date", width: 14, style: "date" },
  { key: "submittedDate", label: "Submitted date", width: 14, style: "date" },
  { key: "reimbursedDate", label: "Reimbursed date", width: 14, style: "date" },
  { key: "location", label: "Location", width: 20, style: "text" },
  { key: "notes", label: "Notes", width: 30, style: "wrap" },
];

const STYLE_INDEX = {
  header: 1,
  currency: 2,
  text: 3,
  wrap: 4,
  date: 5,
};

let crcTable = null;

export async function downloadExpenseReportWorkbook(report, filename) {
  const blob = createExpenseReportWorkbookBlob(report);
  const shared = await tryShareWorkbook(blob, filename);
  if (shared) {
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

export function createExpenseReportWorkbookBlob(report) {
  const files = buildWorkbookFiles(report);
  const zipBytes = buildStoredZip(files);
  return new Blob([zipBytes], { type: XLSX_MIME });
}

function buildWorkbookFiles(report) {
  return [
    { name: "[Content_Types].xml", content: buildContentTypesXml() },
    { name: "_rels/.rels", content: buildRootRelationshipsXml() },
    { name: "docProps/app.xml", content: buildAppPropertiesXml() },
    { name: "docProps/core.xml", content: buildCorePropertiesXml(report.generatedAt) },
    { name: "xl/workbook.xml", content: buildWorkbookXml() },
    { name: "xl/_rels/workbook.xml.rels", content: buildWorkbookRelationshipsXml() },
    { name: "xl/styles.xml", content: buildStylesXml() },
    { name: "xl/worksheets/sheet1.xml", content: buildWorksheetXml(report.rows) },
  ];
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
}

function buildRootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildAppPropertiesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Trip Ledger</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant>
        <vt:lpstr>Worksheets</vt:lpstr>
      </vt:variant>
      <vt:variant>
        <vt:i4>1</vt:i4>
      </vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="1" baseType="lpstr">
      <vt:lpstr>Report</vt:lpstr>
    </vt:vector>
  </TitlesOfParts>
  <Company>PrismJet</Company>
</Properties>`;
}

function buildCorePropertiesXml(generatedAt) {
  const isoTimestamp = String(generatedAt || new Date().toISOString());
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Trip Ledger Report</dc:title>
  <dc:creator>Trip Ledger</dc:creator>
  <cp:lastModifiedBy>Trip Ledger</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(isoTimestamp)}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(isoTimestamp)}</dcterms:modified>
</cp:coreProperties>`;
}

function buildWorkbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Report" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function buildWorkbookRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>
    <numFmt numFmtId="165" formatCode="yyyy-mm-dd"/>
  </numFmts>
  <fonts count="2">
    <font>
      <sz val="11"/>
      <name val="Aptos"/>
    </font>
    <font>
      <b/>
      <sz val="11"/>
      <color rgb="FFFFFFFF"/>
      <name val="Aptos"/>
    </font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="FF111111"/>
        <bgColor indexed="64"/>
      </patternFill>
    </fill>
  </fills>
  <borders count="2">
    <border>
      <left/><right/><top/><bottom/><diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FFE7D7C3"/></left>
      <right style="thin"><color rgb="FFE7D7C3"/></right>
      <top style="thin"><color rgb="FFE7D7C3"/></top>
      <bottom style="thin"><color rgb="FFE7D7C3"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="top"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;
}

function buildWorksheetXml(rows) {
  const headerCells = REPORT_COLUMNS.map((column, columnIndex) =>
    buildInlineStringCell(1, columnIndex + 1, column.label, STYLE_INDEX.header)
  ).join("");

  const dataRows = rows
    .map((row, rowIndex) => buildDataRowXml(row, rowIndex + 2))
    .join("");

  const lastRowNumber = Math.max(rows.length + 1, 1);
  const lastColumnName = getColumnName(REPORT_COLUMNS.length);
  const dimensionRef = `A1:${lastColumnName}${lastRowNumber}`;
  const autoFilterRef = `A1:${lastColumnName}${lastRowNumber}`;
  const columnXml = REPORT_COLUMNS.map((column, index) => {
    const width = Math.max(8, Number(column.width || 12));
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimensionRef}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columnXml}</cols>
  <sheetData>
    <row r="1" ht="24" customHeight="1">${headerCells}</row>
    ${dataRows}
  </sheetData>
  <autoFilter ref="${autoFilterRef}"/>
</worksheet>`;
}

function buildDataRowXml(row, rowNumber) {
  const cells = REPORT_COLUMNS.map((column, columnIndex) => {
    const value = row[column.key];
    if (column.style === "currency") {
      return buildNumberCell(rowNumber, columnIndex + 1, value, STYLE_INDEX.currency);
    }

    if (column.style === "date") {
      return buildDateCell(rowNumber, columnIndex + 1, value, STYLE_INDEX.date);
    }

    const styleIndex = column.style === "wrap" ? STYLE_INDEX.wrap : STYLE_INDEX.text;
    return buildInlineStringCell(rowNumber, columnIndex + 1, value, styleIndex);
  }).join("");

  return `<row r="${rowNumber}">${cells}</row>`;
}

function buildInlineStringCell(rowNumber, columnNumber, value, styleIndex) {
  const ref = `${getColumnName(columnNumber)}${rowNumber}`;
  return `<c r="${ref}" s="${styleIndex}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value || ""))}</t></is></c>`;
}

function buildNumberCell(rowNumber, columnNumber, value, styleIndex) {
  const ref = `${getColumnName(columnNumber)}${rowNumber}`;
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `<c r="${ref}" s="${styleIndex}"><v>${numericValue}</v></c>`;
}

function buildDateCell(rowNumber, columnNumber, value, styleIndex) {
  if (!value) {
    return buildInlineStringCell(rowNumber, columnNumber, "", STYLE_INDEX.text);
  }

  const serial = isoDateToExcelSerial(value);
  if (!Number.isFinite(serial)) {
    return buildInlineStringCell(rowNumber, columnNumber, String(value), STYLE_INDEX.text);
  }

  const ref = `${getColumnName(columnNumber)}${rowNumber}`;
  return `<c r="${ref}" s="${styleIndex}"><v>${serial}</v></c>`;
}

function isoDateToExcelSerial(value) {
  const [year, month, day] = String(value || "")
    .split("-")
    .map(Number);

  if (!year || !month || !day) {
    return Number.NaN;
  }

  return Date.UTC(year, month - 1, day) / 86_400_000 + 25569;
}

function getColumnName(columnNumber) {
  let index = Number(columnNumber);
  let name = "";

  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }

  return name;
}

function buildStoredZip(files) {
  const entries = files.map((file) => {
    const nameBytes = encodeUtf8(file.name);
    const contentBytes = encodeUtf8(file.content);
    return {
      name: file.name,
      nameBytes,
      contentBytes,
      crc32: getCrc32(contentBytes),
    };
  });

  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  entries.forEach((entry) => {
    const localHeader = buildLocalFileHeader(entry);
    localChunks.push(localHeader, entry.nameBytes, entry.contentBytes);

    const centralHeader = buildCentralDirectoryHeader(entry, offset);
    centralChunks.push(centralHeader, entry.nameBytes);

    offset += localHeader.length + entry.nameBytes.length + entry.contentBytes.length;
  });

  const centralDirectorySize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const endRecord = buildEndOfCentralDirectoryRecord(entries.length, centralDirectorySize, offset);

  return concatUint8Arrays([...localChunks, ...centralChunks, endRecord]);
}

function buildLocalFileHeader(entry) {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  const contentLength = entry.contentBytes.length;

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, entry.crc32, true);
  view.setUint32(18, contentLength, true);
  view.setUint32(22, contentLength, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);

  return header;
}

function buildCentralDirectoryHeader(entry, localHeaderOffset) {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  const contentLength = entry.contentBytes.length;

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, contentLength, true);
  view.setUint32(24, contentLength, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localHeaderOffset, true);

  return header;
}

function buildEndOfCentralDirectoryRecord(entryCount, centralDirectorySize, centralDirectoryOffset) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);

  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return record;
}

function getCrc32(bytes) {
  if (!crcTable) {
    crcTable = buildCrcTable();
  }

  let crc = 0 ^ -1;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 0xff];
  }

  return (crc ^ -1) >>> 0;
}

function buildCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }

  return table;
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });

  return output;
}

function encodeUtf8(value) {
  return new TextEncoder().encode(String(value));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function tryShareWorkbook(blob, filename) {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function" ||
    typeof File === "undefined"
  ) {
    return false;
  }

  const file = new File([blob], filename, {
    type: XLSX_MIME,
    lastModified: Date.now(),
  });

  if (!navigator.canShare({ files: [file] })) {
    return false;
  }

  try {
    await navigator.share({
      title: filename,
      files: [file],
    });
    return true;
  } catch (error) {
    if (error?.name === "AbortError") {
      return true;
    }

    console.error("Trip Ledger could not open the report share sheet.", error);
    return false;
  }
}
