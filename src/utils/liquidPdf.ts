import { jsPDF } from 'jspdf';
import { LiquidAuditLog, LiquidTankComputed, LiquidTransaction } from '../types';
import { drawPdfLogo } from './logo';

function fmtKG(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n || 0);
}

function fmtMT(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n || 0);
}

function fmtM(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

function fmtPct(n: number): string {
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(n || 0)}%`;
}

function fmtDate(val: string | number | null | undefined): string {
  if (!val) return '-';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function fitText(doc: jsPDF, text: string, maxWidth: number): string {
  const s = String(text ?? '');
  if (!s) return '';
  if (doc.getTextWidth(s) <= maxWidth) return s;
  let cut = s;
  while (cut.length > 0 && doc.getTextWidth(cut + '...') > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut ? cut + '...' : '';
}

function drawReportHeader(
  doc: jsPDF,
  pageW: number,
  title: string,
  subtitle: string,
  facilityName: string,
  badgeText?: string,
  badgeColor: [number, number, number] = [10, 110, 209],
  companyLogoUrl?: string
): number {
  const margin = 10;
  // SAP Shell Navy top banner
  doc.setFillColor(53, 74, 95); // #354A5F
  doc.rect(margin, 8, pageW - margin * 2, 18, 'F');

  // SAP Gold bottom accent bar
  doc.setFillColor(240, 171, 0); // #F0AB00
  doc.rect(margin, 26, pageW - margin * 2, 1.2, 'F');

  const hasLogo = drawPdfLogo(doc, companyLogoUrl, margin + 3, 10, 14, 14, true);
  const textX = hasLogo ? margin + 20 : margin + 4;
  const maxTextW = hasLogo ? pageW - 101 : pageW - 85;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(fitText(doc, title, maxTextW), textX, 15.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(214, 226, 238);
  doc.text(fitText(doc, `${facilityName}  |  ${subtitle}`, maxTextW), textX, 22);

  if (badgeText) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const bw = Math.max(36, doc.getTextWidth(badgeText) + 8);
    doc.setFillColor(badgeColor[0], badgeColor[1], badgeColor[2]);
    doc.roundedRect(pageW - margin - bw - 4, 11.5, bw, 8, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(badgeText, pageW - margin - 4 - bw / 2, 16.8, { align: 'center' });
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(225, 234, 244);
    doc.text(`Generated: ${fmtDate(Date.now())}`, pageW - margin - 4, 16.5, { align: 'right' });
  }

  return 32;
}

function addPageFooters(doc: jsPDF, pageW: number, pageH: number, facilityName: string): void {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(209, 219, 229);
    doc.setLineWidth(0.25);
    doc.line(10, pageH - 11, pageW - 10, pageH - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(91, 115, 139);
    doc.text(`${facilityName} — Liquid Material Camp Store`, 10, pageH - 6.5);
    doc.text(`Printed: ${fmtDate(Date.now())}   |   Page ${i} of ${total}`, pageW - 10, pageH - 6.5, {
      align: 'right',
    });
  }
}

export function generateLiquidTransactionPDF(
  tx: LiquidTransaction,
  tank: LiquidTankComputed | undefined,
  facilityName: string,
  operatorName: string,
  companyLogoUrl?: string
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
  const margin = 12;
  const contentW = pageW - margin * 2;
  const isIn = tx.type === 'INWARD';

  let y = drawReportHeader(
    doc,
    pageW,
    `Material ${isIn ? 'Inward' : 'Outward'} Entry Voucher`,
    `Transaction ID: ${tx.txCode}`,
    facilityName,
    tx.type,
    isIn ? [16, 126, 62] : [187, 0, 0],
    companyLogoUrl
  );

  // Summary Highlight Strip
  doc.setFillColor(239, 244, 249);
  doc.setDrawColor(209, 219, 229);
  doc.setLineWidth(0.35);
  doc.rect(margin, y, contentW, 20, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(91, 115, 139);
  doc.text('Transaction ID', margin + 4, y + 5.5);
  doc.text('Material', margin + 56, y + 5.5);
  doc.text('Quantity (MT)', margin + 114, y + 5.5);
  doc.text('Quantity (KG)', margin + 154, y + 5.5);

  doc.setFontSize(11);
  doc.setTextColor(28, 40, 51);
  doc.text(tx.txCode, margin + 4, y + 13.5);
  doc.text(fitText(doc, tx.materialName, 54), margin + 56, y + 13.5);

  doc.setTextColor(isIn ? 16 : 187, isIn ? 126 : 0, isIn ? 62 : 0);
  doc.text(`${isIn ? '+' : '-'}${fmtMT(tx.quantityMt)} MT`, margin + 114, y + 13.5);
  doc.text(`${isIn ? '+' : '-'}${fmtKG(tx.quantityKg)} KG`, margin + 154, y + 13.5);

  y += 26;

  // Details Grid
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(53, 74, 95);
  doc.text('Transaction & Transport Particulars', margin, y);
  y += 3;

  const rows: Array<[string, string, string, string]> = [
    ['Transaction Date & Time', fmtDate(tx.txDate), 'Storage Tank', tank ? `${tank.name} (${tank.location})` : `Tank #${tx.tankId}`],
    ['Document Number', tx.documentNumber || '-', 'Reference No. (PO / DO)', tx.referenceNumber || '-'],
    [isIn ? 'Supplier Name' : 'Customer / Department', tx.partyName || '-', 'Vehicle Number', tx.vehicleNumber || '-'],
    ['Driver Name', tx.driverName || '-', 'Recorded By', tx.createdBy || operatorName || '-'],
  ];

  const colW = contentW / 2;
  const rowH = 14;
  for (const [l1, v1, l2, v2] of rows) {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(209, 219, 229);
    doc.rect(margin, y, colW, rowH, 'FD');
    doc.rect(margin + colW, y, colW, rowH, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(91, 115, 139);
    doc.text(l1, margin + 3.5, y + 5);
    doc.text(l2, margin + colW + 3.5, y + 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(28, 40, 51);
    doc.text(fitText(doc, v1, colW - 7), margin + 3.5, y + 11);
    doc.text(fitText(doc, v2, colW - 7), margin + colW + 3.5, y + 11);

    y += rowH;
  }

  // Remarks box
  doc.setFillColor(250, 252, 254);
  doc.rect(margin, y, contentW, 18, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(91, 115, 139);
  doc.text('Remarks / Weighbridge Notes', margin + 3.5, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(28, 40, 51);
  doc.text(fitText(doc, tx.remarks || 'No remarks recorded.', contentW - 7), margin + 3.5, y + 12);
  y += 26;

  // Current Tank Status Snapshot
  if (tank) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(53, 74, 95);
    doc.text(`Tank Live Inventory Snapshot (${tank.name})`, margin, y);
    y += 3;

    const snapW = contentW / 4;
    const snapItems = [
      ['Total Capacity', `${fmtMT(tank.totalCapacityMt)} MT`],
      ['Current Stock', `${fmtMT(tank.currentStockMt)} MT`],
      ['Empty Capacity', `${fmtMT(tank.emptyCapacityMt)} MT`],
      ['Fill Level', `${fmtPct(tank.filledPercentage)} (${fmtM(tank.filledMeters)}m)`],
    ];
    snapItems.forEach(([lbl, val], idx) => {
      const sx = margin + idx * snapW;
      doc.setFillColor(239, 244, 249);
      doc.setDrawColor(209, 219, 229);
      doc.rect(sx, y, snapW, 15, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(91, 115, 139);
      doc.text(lbl, sx + 3, y + 5.5);
      doc.setFontSize(9.5);
      doc.setTextColor(10, 110, 209);
      doc.text(val, sx + 3, y + 11.5);
    });
    y += 25;
  }

  // Signature Footer
  const sigY = Math.max(y + 18, 220);
  const sigW = (contentW - 16) / 3;
  const sigTitles = ['Store Keeper / Operator', 'Driver / Transporter Sign', 'Camp Store Incharge'];
  sigTitles.forEach((title, idx) => {
    const sx = margin + idx * (sigW + 8);
    doc.setDrawColor(53, 74, 95);
    doc.setLineWidth(0.35);
    doc.line(sx, sigY, sx + sigW, sigY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(53, 74, 95);
    doc.text(title, sx + sigW / 2, sigY + 5, { align: 'center' });
  });

  addPageFooters(doc, pageW, pageH, facilityName);
  doc.save(`Liquid_${tx.type}_${tx.txCode}.pdf`);
}

export function generateLiquidRegisterPDF(
  mode: 'INWARD' | 'OUTWARD' | 'HISTORY',
  rows: LiquidTransaction[],
  tanks: LiquidTankComputed[],
  facilityName: string,
  filterSummary: string,
  companyLogoUrl?: string
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = 297;
  const pageH = 210;
  const margin = 10;

  const title =
    mode === 'INWARD'
      ? 'Material Inward Register'
      : mode === 'OUTWARD'
      ? 'Material Outward Register'
      : 'Liquid Store Transaction Ledger';

  const cols = [
    { label: 'Date & Time', w: 28, align: 'left' as const },
    { label: 'TX ID', w: 24, align: 'left' as const },
    { label: 'Type', w: 14, align: 'left' as const },
    { label: 'Tank', w: 18, align: 'left' as const },
    { label: 'Material', w: 24, align: 'left' as const },
    { label: 'Qty (KG)', w: 20, align: 'right' as const },
    { label: 'Qty (MT)', w: 18, align: 'right' as const },
    { label: 'Doc No.', w: 23, align: 'left' as const },
    { label: 'Ref No.', w: 22, align: 'left' as const },
    { label: 'Party', w: 30, align: 'left' as const },
    { label: 'Vehicle', w: 20, align: 'left' as const },
    { label: 'Driver Name', w: 22, align: 'left' as const },
    { label: 'Remarks', w: 14, align: 'left' as const },
  ]; // total = 277mm

  const drawHeaderAndCols = (): number => {
    const startY = drawReportHeader(
      doc,
      pageW,
      title,
      `${filterSummary}  (${rows.length} entries)`,
      facilityName,
      undefined,
      undefined,
      companyLogoUrl
    );
    doc.setFillColor(239, 244, 249);
    doc.setDrawColor(209, 219, 229);
    doc.setLineWidth(0.3);
    doc.rect(margin, startY, 277, 7.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(53, 74, 95);
    let x = margin;
    for (const c of cols) {
      if (c.align === 'right') {
        doc.text(c.label, x + c.w - 1.5, startY + 5, { align: 'right' });
      } else {
        doc.text(c.label, x + 1.5, startY + 5);
      }
      x += c.w;
    }
    return startY + 7.5;
  };

  let y = drawHeaderAndCols();
  let totalInKg = 0;
  let totalOutKg = 0;

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(91, 115, 139);
    doc.text('No matching transactions for the selected filter criteria.', pageW / 2, y + 12, { align: 'center' });
  } else {
    rows.forEach((tx, idx) => {
      if (y > pageH - 22) {
        doc.addPage();
        y = drawHeaderAndCols();
      }
      const isIn = tx.type === 'INWARD';
      if (isIn) totalInKg += tx.quantityKg;
      else totalOutKg += tx.quantityKg;

      const tankName = tanks.find((t) => t.id === tx.tankId)?.name || `Tank ${tx.tankId}`;
      const rowH = 6.8;
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, 277, rowH, 'F');
      }
      doc.setDrawColor(227, 234, 242);
      doc.line(margin, y + rowH, margin + 277, y + rowH);

      const vals = [
        fmtDate(tx.txDate),
        tx.txCode,
        tx.type,
        tankName,
        tx.materialName,
        `${isIn ? '+' : '-'}${fmtKG(tx.quantityKg)}`,
        `${isIn ? '+' : '-'}${fmtMT(tx.quantityMt)}`,
        tx.documentNumber || '-',
        tx.referenceNumber || '-',
        tx.partyName || '-',
        tx.vehicleNumber || '-',
        tx.driverName || '-',
        tx.remarks || '-',
      ];

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      let x = margin;
      vals.forEach((val, i) => {
        const c = cols[i];
        if (i === 2 || i === 5 || i === 6) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(isIn ? 16 : 187, isIn ? 126 : 0, isIn ? 62 : 0);
        } else {
          doc.setFont('helvetica', i === 1 ? 'bold' : 'normal');
          doc.setTextColor(28, 40, 51);
        }
        const txt = fitText(doc, val, c.w - 2.5);
        if (c.align === 'right') {
          doc.text(txt, x + c.w - 1.5, y + 4.6, { align: 'right' });
        } else {
          doc.text(txt, x + 1.5, y + 4.6);
        }
        x += c.w;
      });
      y += rowH;
    });
  }

  // Totals bar
  if (y > pageH - 22) {
    doc.addPage();
    y = drawReportHeader(doc, pageW, title, 'Summary Totals', facilityName, undefined, undefined, companyLogoUrl);
  }
  y += 4;
  doc.setFillColor(239, 244, 249);
  doc.setDrawColor(53, 74, 95);
  doc.rect(margin, y, 277, 10, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(53, 74, 95);
  doc.text(`Total Records: ${rows.length}`, margin + 4, y + 6.5);
  doc.setTextColor(16, 126, 62);
  doc.text(`Inward: +${fmtMT(totalInKg / 1000)} MT (${fmtKG(totalInKg)} KG)`, margin + 62, y + 6.5);
  doc.setTextColor(187, 0, 0);
  doc.text(`Outward: -${fmtMT(totalOutKg / 1000)} MT (${fmtKG(totalOutKg)} KG)`, margin + 150, y + 6.5);
  doc.setTextColor(10, 110, 209);
  doc.text(`Net: ${fmtMT((totalInKg - totalOutKg) / 1000)} MT`, margin + 273, y + 6.5, { align: 'right' });

  addPageFooters(doc, pageW, pageH, facilityName);
  doc.save(`Liquid_${mode}_Register_${todayStamp()}.pdf`);
}

export function generateLiquidAuditPDF(
  auditLogs: LiquidAuditLog[],
  facilityName: string,
  companyLogoUrl?: string
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = 297;
  const pageH = 210;
  const margin = 10;

  const cols = [
    { label: 'Timestamp', w: 42 },
    { label: 'Action', w: 30 },
    { label: 'Entity', w: 28 },
    { label: 'Summary', w: 137 },
    { label: 'Performed By', w: 40 },
  ]; // 277mm

  const drawHeader = (): number => {
    const startY = drawReportHeader(
      doc,
      pageW,
      'Liquid Material Store — Audit Log',
      `${auditLogs.length} audit entries`,
      facilityName,
      undefined,
      undefined,
      companyLogoUrl
    );
    doc.setFillColor(239, 244, 249);
    doc.setDrawColor(209, 219, 229);
    doc.rect(margin, startY, 277, 7.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(53, 74, 95);
    let x = margin;
    for (const c of cols) {
      doc.text(c.label, x + 2, startY + 5);
      x += c.w;
    }
    return startY + 7.5;
  };

  let y = drawHeader();
  auditLogs.forEach((a, idx) => {
    if (y > pageH - 18) {
      doc.addPage();
      y = drawHeader();
    }
    const rowH = 6.8;
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, 277, rowH, 'F');
    }
    doc.setDrawColor(227, 234, 242);
    doc.line(margin, y + rowH, margin + 277, y + rowH);

    const vals = [fmtDate(a.createdAt), a.action, a.entityType, a.summary, a.performedBy];
    let x = margin;
    vals.forEach((v, i) => {
      doc.setFont('helvetica', i === 1 ? 'bold' : 'normal');
      doc.setFontSize(7);
      doc.setTextColor(28, 40, 51);
      doc.text(fitText(doc, v, cols[i].w - 3), x + 2, y + 4.6);
      x += cols[i].w;
    });
    y += rowH;
  });

  addPageFooters(doc, pageW, pageH, facilityName);
  doc.save(`Liquid_Store_Audit_Log_${todayStamp()}.pdf`);
}

export function generateLiquidTanksPDF(
  tanks: LiquidTankComputed[],
  facilityName: string,
  companyLogoUrl?: string
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = 297;
  const pageH = 210;
  const margin = 10;

  const cols = [
    { label: 'Tank Name', w: 26, align: 'left' as const },
    { label: 'Material(s)', w: 36, align: 'left' as const },
    { label: 'Location', w: 32, align: 'left' as const },
    { label: 'Capacity (MT)', w: 26, align: 'right' as const },
    { label: 'Depth (m)', w: 18, align: 'right' as const },
    { label: 'Stock (MT)', w: 26, align: 'right' as const },
    { label: 'Stock (KG)', w: 28, align: 'right' as const },
    { label: 'Empty (MT)', w: 25, align: 'right' as const },
    { label: 'Fill %', w: 18, align: 'right' as const },
    { label: 'Last Activity', w: 42, align: 'left' as const },
  ]; // 277mm

  const drawHeader = (): number => {
    const startY = drawReportHeader(
      doc,
      pageW,
      'Liquid Storage Tank Inventory Report',
      `${tanks.length} storage units`,
      facilityName,
      undefined,
      undefined,
      companyLogoUrl
    );
    doc.setFillColor(239, 244, 249);
    doc.setDrawColor(209, 219, 229);
    doc.rect(margin, startY, 277, 7.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(53, 74, 95);
    let x = margin;
    for (const c of cols) {
      if (c.align === 'right') {
        doc.text(c.label, x + c.w - 2, startY + 5, { align: 'right' });
      } else {
        doc.text(c.label, x + 2, startY + 5);
      }
      x += c.w;
    }
    return startY + 7.5;
  };

  let y = drawHeader();
  let totalCap = 0;
  let totalStock = 0;
  let totalEmpty = 0;

  tanks.forEach((t, idx) => {
    if (y > pageH - 22) {
      doc.addPage();
      y = drawHeader();
    }
    totalCap += t.totalCapacityMt;
    totalStock += t.currentStockMt;
    totalEmpty += t.emptyCapacityMt;

    const rowH = 7;
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, 277, rowH, 'F');
    }
    doc.setDrawColor(227, 234, 242);
    doc.line(margin, y + rowH, margin + 277, y + rowH);

    const vals = [
      t.name,
      t.productLabel,
      t.location,
      `${fmtMT(t.totalCapacityMt)} MT`,
      `${fmtM(t.depthMeters)} m`,
      `${fmtMT(t.currentStockMt)} MT`,
      `${fmtKG(t.currentStockKg)} KG`,
      `${fmtMT(t.emptyCapacityMt)} MT`,
      fmtPct(t.filledPercentage),
      fmtDate(t.lastTransactionAt),
    ];

    let x = margin;
    vals.forEach((v, i) => {
      const c = cols[i];
      doc.setFont('helvetica', i === 0 || i === 5 ? 'bold' : 'normal');
      doc.setFontSize(7);
      if (i === 5 || i === 8) doc.setTextColor(10, 110, 209);
      else doc.setTextColor(28, 40, 51);
      const txt = fitText(doc, v, c.w - 3);
      if (c.align === 'right') doc.text(txt, x + c.w - 2, y + 4.8, { align: 'right' });
      else doc.text(txt, x + 2, y + 4.8);
      x += c.w;
    });
    y += rowH;
  });

  y += 4;
  doc.setFillColor(239, 244, 249);
  doc.setDrawColor(53, 74, 95);
  doc.rect(margin, y, 277, 10, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(53, 74, 95);
  doc.text(`Fleet Summary (${tanks.length} Tanks)`, margin + 4, y + 6.5);
  doc.text(`Capacity: ${fmtMT(totalCap)} MT`, margin + 88, y + 6.5);
  doc.setTextColor(10, 110, 209);
  doc.text(`Available Stock: ${fmtMT(totalStock)} MT`, margin + 152, y + 6.5);
  doc.setTextColor(28, 40, 51);
  doc.text(`Empty Space: ${fmtMT(totalEmpty)} MT`, margin + 273, y + 6.5, { align: 'right' });

  addPageFooters(doc, pageW, pageH, facilityName);
  doc.save(`Liquid_Tank_Inventory_${todayStamp()}.pdf`);
}

export function generateLiquidSingleTankPDF(
  tank: LiquidTankComputed,
  recentTxs: LiquidTransaction[],
  facilityName: string,
  companyLogoUrl?: string
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
  const margin = 12;
  const contentW = pageW - margin * 2;

  let y = drawReportHeader(
    doc,
    pageW,
    `${tank.name} — Specification & Stock Sheet`,
    `${tank.location}  |  Product: ${tank.productLabel}`,
    facilityName,
    fmtPct(tank.filledPercentage),
    undefined,
    companyLogoUrl
  );

  // Spec KPI boxes
  const boxW = (contentW - 6) / 3;
  const kpis = [
    ['Total Capacity', `${fmtMT(tank.totalCapacityMt)} MT`, `${fmtKG(tank.totalCapacityKg)} KG`],
    ['Current Stock', `${fmtMT(tank.currentStockMt)} MT`, `${fmtKG(tank.currentStockKg)} KG`],
    ['Empty Capacity', `${fmtMT(tank.emptyCapacityMt)} MT`, `${fmtKG(tank.emptyCapacityKg)} KG`],
    ['Tank Depth', `${fmtM(tank.depthMeters)} m`, 'Calibration depth'],
    ['Filled Level', `${fmtM(tank.filledMeters)} m`, fmtPct(tank.filledPercentage)],
    ['Empty Headspace', `${fmtM(tank.emptyMeters)} m`, fmtPct(tank.emptyPercentage)],
  ];

  kpis.forEach(([lbl, v1, v2], idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const bx = margin + col * (boxW + 3);
    const by = y + row * 19;
    doc.setFillColor(239, 244, 249);
    doc.setDrawColor(209, 219, 229);
    doc.rect(bx, by, boxW, 16, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(91, 115, 139);
    doc.text(lbl, bx + 3, by + 5);
    doc.setFontSize(10);
    doc.setTextColor(idx === 1 || idx === 4 ? 10 : 28, idx === 1 || idx === 4 ? 110 : 40, idx === 1 || idx === 4 ? 209 : 51);
    doc.text(v1, bx + 3, by + 10.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(91, 115, 139);
    doc.text(v2, bx + 3, by + 14.2);
  });

  y += 42;

  if (tank.materials.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(53, 74, 95);
    doc.text('Material-Wise Balance in Tank', margin, y);
    y += 3;

    const mCols = [
      { label: 'Material', w: 66, align: 'left' as const },
      { label: 'Inward (MT)', w: 40, align: 'right' as const },
      { label: 'Outward (MT)', w: 40, align: 'right' as const },
      { label: 'Balance (MT)', w: 40, align: 'right' as const },
    ];
    doc.setFillColor(239, 244, 249);
    doc.setDrawColor(209, 219, 229);
    doc.rect(margin, y, contentW, 7.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    let x = margin;
    for (const c of mCols) {
      if (c.align === 'right') doc.text(c.label, x + c.w - 2, y + 5, { align: 'right' });
      else doc.text(c.label, x + 2, y + 5);
      x += c.w;
    }
    y += 7.5;

    for (const m of tank.materials) {
      doc.setDrawColor(227, 234, 242);
      doc.rect(margin, y, contentW, 7, 'D');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(28, 40, 51);
      doc.text(fitText(doc, m.materialName, 62), margin + 2, y + 4.8);
      doc.setTextColor(16, 126, 62);
      doc.text(`${fmtMT(m.inwardKg / 1000)} MT`, margin + 104, y + 4.8, { align: 'right' });
      doc.setTextColor(187, 0, 0);
      doc.text(`${fmtMT(m.outwardKg / 1000)} MT`, margin + 144, y + 4.8, { align: 'right' });
      doc.setTextColor(10, 110, 209);
      doc.text(`${fmtMT(m.balanceMt)} MT`, margin + 184, y + 4.8, { align: 'right' });
      y += 7;
    }
    y += 8;
  }

  // Recent transactions for this tank
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(53, 74, 95);
  doc.text(`Recent Tank Movements (${Math.min(recentTxs.length, 15)})`, margin, y);
  y += 3;

  const tCols = [
    { label: 'Date', w: 32, align: 'left' as const },
    { label: 'TX ID', w: 28, align: 'left' as const },
    { label: 'Type', w: 18, align: 'left' as const },
    { label: 'Qty (MT)', w: 24, align: 'right' as const },
    { label: 'Doc No.', w: 26, align: 'left' as const },
    { label: 'Driver', w: 28, align: 'left' as const },
    { label: 'Party', w: 30, align: 'left' as const },
  ]; // 186mm

  doc.setFillColor(239, 244, 249);
  doc.setDrawColor(209, 219, 229);
  doc.rect(margin, y, contentW, 7, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  let txX = margin;
  for (const c of tCols) {
    if (c.align === 'right') doc.text(c.label, txX + c.w - 1.5, y + 4.8, { align: 'right' });
    else doc.text(c.label, txX + 1.5, y + 4.8);
    txX += c.w;
  }
  y += 7;

  const limited = recentTxs.slice(0, 15);
  if (limited.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(91, 115, 139);
    doc.text('No transactions recorded for this tank.', margin + 2, y + 6);
  } else {
    for (const tx of limited) {
      if (y > pageH - 22) break;
      const isIn = tx.type === 'INWARD';
      doc.setDrawColor(227, 234, 242);
      doc.line(margin, y + 6.5, margin + contentW, y + 6.5);
      const vals = [
        fmtDate(tx.txDate),
        tx.txCode,
        tx.type,
        `${isIn ? '+' : '-'}${fmtMT(tx.quantityMt)}`,
        tx.documentNumber || '-',
        tx.driverName || '-',
        tx.partyName || '-',
      ];
      let x = margin;
      vals.forEach((v, i) => {
        const c = tCols[i];
        doc.setFont('helvetica', i === 2 || i === 3 ? 'bold' : 'normal');
        doc.setFontSize(6.5);
        if (i === 2 || i === 3) doc.setTextColor(isIn ? 16 : 187, isIn ? 126 : 0, isIn ? 62 : 0);
        else doc.setTextColor(28, 40, 51);
        const s = fitText(doc, v, c.w - 2);
        if (c.align === 'right') doc.text(s, x + c.w - 1.5, y + 4.5, { align: 'right' });
        else doc.text(s, x + 1.5, y + 4.5);
        x += c.w;
      });
      y += 6.5;
    }
  }

  addPageFooters(doc, pageW, pageH, facilityName);
  doc.save(`Liquid_${tank.name.replace(/\s+/g, '_')}_Spec_${todayStamp()}.pdf`);
}

export function generateLiquidStockReportPDF(
  rows: Array<{ name: string; inKg: number; outKg: number; balKg: number; tankNames?: string[] }>,
  facilityName: string,
  filterSummary: string,
  companyLogoUrl?: string
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
  const margin = 12;
  const contentW = pageW - margin * 2; // 186mm

  let y = drawReportHeader(
    doc,
    pageW,
    'Product-Wise Consolidated Stock Report',
    filterSummary,
    facilityName,
    undefined,
    undefined,
    companyLogoUrl
  );

  // Product-Wise Total Summary Cards
  if (rows.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(53, 74, 95);
    doc.text('Product-Wise Total Stock Summary', margin, y + 1);
    y += 4;

    const gap = 3;
    const cardsPerRow = rows.length === 1 ? 1 : rows.length === 2 ? 2 : 3;
    const cardW = (contentW - gap * (cardsPerRow - 1)) / cardsPerRow;
    const cardH = 19;

    rows.forEach((r, idx) => {
      const col = idx % cardsPerRow;
      if (col === 0 && idx > 0) {
        y += cardH + gap;
      }
      if (y + cardH > pageH - 28) {
        doc.addPage();
        y = drawReportHeader(
          doc,
          pageW,
          'Product-Wise Consolidated Stock Report',
          filterSummary,
          facilityName,
          undefined,
          undefined,
          companyLogoUrl
        );
      }
      const cx = margin + col * (cardW + gap);
      doc.setFillColor(239, 244, 249);
      doc.setDrawColor(209, 219, 229);
      doc.rect(cx, y, cardW, cardH, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(28, 40, 51);
      doc.text(fitText(doc, r.name, cardW - 6), cx + 3, y + 5.2);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(10, 110, 209);
      doc.text(`${fmtMT(r.balKg / 1000)} MT`, cx + 3, y + 11.2);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(91, 115, 139);
      const tankMeta = r.tankNames && r.tankNames.length > 0 ? ` (${r.tankNames.length} tanks)` : '';
      doc.text(`${fmtKG(r.balKg)} KG${tankMeta}`, cx + 3, y + 15);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(16, 126, 62);
      doc.text(`In: +${fmtMT(r.inKg / 1000)} MT`, cx + cardW - 3, y + 10.5, { align: 'right' });
      doc.setTextColor(187, 0, 0);
      doc.text(`Out: -${fmtMT(r.outKg / 1000)} MT`, cx + cardW - 3, y + 15, { align: 'right' });
    });

    y += cardH + 6;
  }

  const cols = [
    { label: 'Product / Material', w: 42, align: 'left' as const },
    { label: 'Inward (KG)', w: 24, align: 'right' as const },
    { label: 'Inward (MT)', w: 24, align: 'right' as const },
    { label: 'Outward (KG)', w: 24, align: 'right' as const },
    { label: 'Outward (MT)', w: 24, align: 'right' as const },
    { label: 'Balance (KG)', w: 24, align: 'right' as const },
    { label: 'Balance (MT)', w: 24, align: 'right' as const },
  ]; // 186mm

  const drawTableHeader = (startY: number): number => {
    doc.setFillColor(239, 244, 249);
    doc.setDrawColor(209, 219, 229);
    doc.rect(margin, startY, contentW, 8, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(53, 74, 95);
    let hx = margin;
    for (const c of cols) {
      if (c.align === 'right') doc.text(c.label, hx + c.w - 1.5, startY + 5.2, { align: 'right' });
      else doc.text(c.label, hx + 2, startY + 5.2);
      hx += c.w;
    }
    return startY + 8;
  };

  if (y > pageH - 42) {
    doc.addPage();
    y = drawReportHeader(
      doc,
      pageW,
      'Product-Wise Consolidated Stock Report',
      filterSummary,
      facilityName,
      undefined,
      undefined,
      companyLogoUrl
    );
  }

  y = drawTableHeader(y);

  let totIn = 0;
  let totOut = 0;
  let totBal = 0;

  rows.forEach((r, idx) => {
    if (y > pageH - 32) {
      doc.addPage();
      y = drawReportHeader(
        doc,
        pageW,
        'Product-Wise Consolidated Stock Report',
        filterSummary,
        facilityName,
        undefined,
        undefined,
        companyLogoUrl
      );
      y = drawTableHeader(y);
    }
    totIn += r.inKg;
    totOut += r.outKg;
    totBal += r.balKg;

    const rowH = 8.5;
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentW, rowH, 'F');
    }
    doc.setDrawColor(227, 234, 242);
    doc.line(margin, y + rowH, margin + contentW, y + rowH);

    const vals = [
      r.name,
      fmtKG(r.inKg),
      fmtMT(r.inKg / 1000),
      fmtKG(r.outKg),
      fmtMT(r.outKg / 1000),
      fmtKG(r.balKg),
      fmtMT(r.balKg / 1000),
    ];

    let x = margin;
    vals.forEach((v, i) => {
      const c = cols[i];
      doc.setFont('helvetica', i === 0 || i === 2 || i === 4 || i === 6 ? 'bold' : 'normal');
      doc.setFontSize(7.5);
      if (i === 1 || i === 2) doc.setTextColor(16, 126, 62);
      else if (i === 3 || i === 4) doc.setTextColor(187, 0, 0);
      else if (i === 6) doc.setTextColor(10, 110, 209);
      else doc.setTextColor(28, 40, 51);
      const txt = fitText(doc, v, c.w - 2.5);
      if (c.align === 'right') doc.text(txt, x + c.w - 1.5, y + 5.4, { align: 'right' });
      else doc.text(txt, x + 2, y + 5.4);
      x += c.w;
    });
    y += rowH;
  });

  // Grand Total row
  doc.setFillColor(239, 244, 249);
  doc.setDrawColor(53, 74, 95);
  doc.rect(margin, y, contentW, 9.5, 'FD');
  const tVals = [
    'Grand Total',
    fmtKG(totIn),
    fmtMT(totIn / 1000),
    fmtKG(totOut),
    fmtMT(totOut / 1000),
    fmtKG(totBal),
    fmtMT(totBal / 1000),
  ];
  let tx = margin;
  tVals.forEach((v, i) => {
    const c = cols[i];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    if (i === 1 || i === 2) doc.setTextColor(16, 126, 62);
    else if (i === 3 || i === 4) doc.setTextColor(187, 0, 0);
    else if (i === 6) doc.setTextColor(10, 110, 209);
    else doc.setTextColor(53, 74, 95);
    if (c.align === 'right') doc.text(v, tx + c.w - 1.5, y + 6, { align: 'right' });
    else doc.text(v, tx + 2, y + 6);
    tx += c.w;
  });
  y += 14;

  // Signature Footer
  if (y > pageH - 34) {
    doc.addPage();
    y = drawReportHeader(
      doc,
      pageW,
      'Product-Wise Consolidated Stock Report',
      filterSummary,
      facilityName,
      undefined,
      undefined,
      companyLogoUrl
    );
  }
  const sigY = Math.max(y + 18, 240);
  const sigW = (contentW - 16) / 3;
  const sigTitles = ['Store Operator', 'Camp Store Incharge', 'MMD Manager'];
  sigTitles.forEach((title, idx) => {
    const sx = margin + idx * (sigW + 8);
    doc.setDrawColor(53, 74, 95);
    doc.setLineWidth(0.35);
    doc.line(sx, sigY, sx + sigW, sigY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(53, 74, 95);
    doc.text(title, sx + sigW / 2, sigY + 5, { align: 'center' });
  });

  addPageFooters(doc, pageW, pageH, facilityName);
  doc.save(`Liquid_Stock_Report_${todayStamp()}.pdf`);
}
