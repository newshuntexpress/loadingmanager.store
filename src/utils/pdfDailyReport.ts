import { jsPDF } from 'jspdf';
import { TicketRecord, CompanySettings } from '../types';
import { formatSaudiPhoneNumber } from './whatsapp';
import { resolveLoadingType } from './loadingType';
import { drawPdfLogo } from './logo';

function truncateText(doc: jsPDF, text: string, maxWidth: number): string {
  const str = String(text || '');
  if (!str) return '';
  if (doc.getTextWidth(str) <= maxWidth) return str;
  let truncated = str;
  while (truncated.length > 0 && doc.getTextWidth(truncated + '...') > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '...';
}

export function generateDailyReportPDF(
  dayTickets: TicketRecord[],
  settings: CompanySettings,
  date: string
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = doc.internal.pageSize.getWidth(); // 297mm
  const pageH = doc.internal.pageSize.getHeight(); // 210mm
  const margin = 10;
  const contentW = pageW - margin * 2; // 277mm

  const completed = dayTickets.filter((t) => t.status === 'completed');
  const underLoading = dayTickets.filter((t) => t.status === 'under_loading');
  const waiting = dayTickets.filter((t) => t.status === 'waiting');
  const activeLoadingTrucks = dayTickets.filter((t) => t.status !== 'cancelled');
  const localTrucksCount = activeLoadingTrucks.filter((t) => resolveLoadingType(t) === 'local').length;
  const exportTrucksCount = activeLoadingTrucks.filter((t) => resolveLoadingType(t) === 'export').length;
  const stoTrucksCount = activeLoadingTrucks.filter((t) => resolveLoadingType(t) === 'sto').length;

  const totalQty = dayTickets.reduce((acc, t) => acc + (t.loadingSlip?.totalQty || 0), 0);
  const totalPallets = dayTickets.reduce((acc, t) => acc + (t.loadingSlip?.totalPallets || 0), 0);
  const totalLooseRolls = dayTickets.reduce((acc, t) => acc + (t.loadingSlip?.totalLooseRolls || 0), 0);

  const generatedAt = new Date().toLocaleString();

  const drawHeader = (isContinuation = false): number => {
    doc.setFillColor(24, 34, 48);
    doc.rect(margin, 8, contentW, 20, 'F');

    const hasLogo = drawPdfLogo(doc, settings.logoDataUrl, margin + 3, 10.5, 15, 15, true);
    const textX = hasLogo ? margin + 21 : margin + 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text(truncateText(doc, settings.companyName || 'DISPATCH REPORT', 175), textX, 15);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(203, 213, 225);
    doc.text(
      truncateText(
        doc,
        `${settings.address || ''}${settings.phone ? ` | Ph: ${settings.phone}` : ''}`,
        175
      ),
      textX,
      20
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(248, 250, 252);
    doc.text(
      `DAILY MATERIAL LOADING & DISPATCH REPORT: ${date}${isContinuation ? ' (CONT.)' : ''}`,
      textX,
      25.2
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(203, 213, 225);
    doc.text(`Generated: ${generatedAt}`, pageW - margin - 3, 15, { align: 'right' });
    doc.text(`Date: ${date}`, pageW - margin - 3, 20.5, { align: 'right' });

    return 31;
  };

  let y = drawHeader(false);

  // Top KPI Row 1 (4 cards)
  const cardGap = 3;
  const cardW1 = (contentW - cardGap * 3) / 4;
  const topCards = [
    { label: 'TOTAL INWARD VEHICLES', value: String(dayTickets.length), bg: [248, 250, 252], border: [203, 213, 225], text: [15, 23, 42] },
    { label: 'COMPLETED & DISPATCHED', value: String(completed.length), bg: [236, 253, 245], border: [167, 243, 208], text: [4, 120, 87] },
    { label: 'ACTIVE / IN QUEUE', value: String(underLoading.length + waiting.length), bg: [255, 251, 235], border: [253, 230, 138], text: [180, 83, 9] },
    { label: 'TOTAL PALLETS & ROLLS', value: `${totalPallets} Pallets | ${totalLooseRolls} Rolls`, bg: [239, 246, 255], border: [191, 219, 254], text: [30, 58, 138] },
  ] as const;

  topCards.forEach((c, idx) => {
    const cx = margin + idx * (cardW1 + cardGap);
    doc.setFillColor(c.bg[0], c.bg[1], c.bg[2]);
    doc.setDrawColor(c.border[0], c.border[1], c.border[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, y, cardW1, 13, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text(c.label, cx + cardW1 / 2, y + 4.3, { align: 'center' });
    doc.setFontSize(idx === 3 ? 9.5 : 12);
    doc.setTextColor(c.text[0], c.text[1], c.text[2]);
    doc.text(c.value, cx + cardW1 / 2, y + 10.3, { align: 'center' });
  });
  y += 15.5;

  // Row 2: Total Truck Loading Breakdown (Local, Export & STO)
  const cardW2 = (contentW - cardGap * 3) / 4;
  const truckCards = [
    { label: 'TOTAL TRUCK LOADING', value: String(activeLoadingTrucks.length), bg: [248, 250, 252], border: [148, 163, 184], text: [15, 23, 42] },
    { label: 'LOCAL TRUCKS', value: String(localTrucksCount), bg: [236, 253, 245], border: [110, 231, 183], text: [4, 120, 87] },
    { label: 'EXPORT TRUCKS', value: String(exportTrucksCount), bg: [238, 242, 255], border: [165, 180, 252], text: [67, 56, 202] },
    { label: 'STO TRUCKS', value: String(stoTrucksCount), bg: [255, 251, 235], border: [252, 211, 77], text: [180, 83, 9] },
  ] as const;

  truckCards.forEach((c, idx) => {
    const cx = margin + idx * (cardW2 + cardGap);
    doc.setFillColor(c.bg[0], c.bg[1], c.bg[2]);
    doc.setDrawColor(c.border[0], c.border[1], c.border[2]);
    doc.roundedRect(cx, y, cardW2, 11.5, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text(c.label, cx + cardW2 / 2, y + 4, { align: 'center' });
    doc.setFontSize(11);
    doc.setTextColor(c.text[0], c.text[1], c.text[2]);
    doc.text(c.value, cx + cardW2 / 2, y + 9.2, { align: 'center' });
  });
  y += 14.5;

  // Table Definition (total width = 277mm)
  const cols = [
    { label: 'SEQ', w: 12, align: 'center' as const },
    { label: 'TICKET NO', w: 28, align: 'left' as const },
    { label: 'GATE', w: 16, align: 'left' as const },
    { label: 'TRUCK NO', w: 26, align: 'left' as const },
    { label: 'DRIVER & PHONE', w: 46, align: 'left' as const },
    { label: 'DESTINATION (TYPE)', w: 47, align: 'left' as const },
    { label: 'DEL NOTE', w: 25, align: 'left' as const },
    { label: 'QTY / PALLET / LOOSE', w: 33, align: 'center' as const },
    { label: 'STATUS', w: 22, align: 'center' as const },
    { label: 'TIME', w: 22, align: 'left' as const },
  ];

  const drawTableHeader = (startY: number): number => {
    doc.setFillColor(226, 232, 240);
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.3);
    doc.rect(margin, startY, contentW, 7.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(15, 23, 42);

    let x = margin;
    for (const col of cols) {
      if (col.align === 'center') {
        doc.text(col.label, x + col.w / 2, startY + 5, { align: 'center' });
      } else {
        doc.text(col.label, x + 1.5, startY + 5);
      }
      x += col.w;
    }
    return startY + 7.5;
  };

  y = drawTableHeader(y);

  const rowH = 9;
  if (dayTickets.length === 0) {
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentW, 12, 'D');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`No tickets recorded for ${date}.`, margin + contentW / 2, y + 7.5, { align: 'center' });
    y += 14;
  } else {
    dayTickets.forEach((t, idx) => {
      if (y + rowH > pageH - 22) {
        doc.addPage();
        y = drawHeader(true);
        y = drawTableHeader(y);
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, contentW, rowH, 'F');
      }
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.2);
      doc.rect(margin, y, contentW, rowH, 'D');

      const resolvedType = resolveLoadingType(t);
      const loadingTypeTag = resolvedType === 'export' ? 'EXPORT' : resolvedType === 'sto' ? 'STO' : 'LOCAL';
      const qtyText = t.loadingSlip
        ? `${t.loadingSlip.totalQty} Qty | ${t.loadingSlip.totalPallets} P | ${t.loadingSlip.totalLooseRolls} R`
        : '—';
      const statusText = String(t.status || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const timeText = `${t.timeIn || ''}${t.timeCompleted ? ` -> ${t.timeCompleted}` : ''}`;

      let x = margin;

      // 0: Seq
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(15, 23, 42);
      doc.text(`#${t.sequenceNumber}`, x + cols[0].w / 2, y + 5.5, { align: 'center' });
      x += cols[0].w;

      // 1: Ticket No
      doc.setFont('helvetica', 'bold');
      doc.text(truncateText(doc, t.ticketNumber, cols[1].w - 3), x + 1.5, y + 5.5);
      x += cols[1].w;

      // 2: Gate
      doc.text(truncateText(doc, t.gateNumber, cols[2].w - 3), x + 1.5, y + 5.5);
      x += cols[2].w;

      // 3: Truck No
      doc.text(truncateText(doc, t.truckNumber, cols[3].w - 3), x + 1.5, y + 5.5);
      x += cols[3].w;

      // 4: Driver & Phone (2 lines)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text(truncateText(doc, t.driverName, cols[4].w - 3), x + 1.5, y + 3.8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(71, 85, 105);
      doc.text(truncateText(doc, formatSaudiPhoneNumber(t.driverPhone), cols[4].w - 3), x + 1.5, y + 7.2);
      doc.setTextColor(15, 23, 42);
      x += cols[4].w;

      // 5: Destination + [LOCAL/EXPORT/STO]
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(truncateText(doc, t.destinationPlace || '—', cols[5].w - 3), x + 1.5, y + 3.8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.3);
      if (loadingTypeTag === 'EXPORT') {
        doc.setTextColor(67, 56, 202);
      } else if (loadingTypeTag === 'STO') {
        doc.setTextColor(180, 83, 9);
      } else {
        doc.setTextColor(4, 120, 87);
      }
      doc.text(`[${loadingTypeTag}]`, x + 1.5, y + 7.2);
      doc.setTextColor(15, 23, 42);
      x += cols[5].w;

      // 6: Del Note
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(30, 58, 138);
      doc.text(truncateText(doc, t.loadingSlip?.delNoteNumber || '—', cols[6].w - 3), x + 1.5, y + 5.5);
      doc.setTextColor(15, 23, 42);
      x += cols[6].w;

      // 7: Qty / Pallets / Loose
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.text(truncateText(doc, qtyText, cols[7].w - 2), x + cols[7].w / 2, y + 5.5, { align: 'center' });
      x += cols[7].w;

      // 8: Status
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.text(truncateText(doc, statusText, cols[8].w - 2), x + cols[8].w / 2, y + 5.5, { align: 'center' });
      x += cols[8].w;

      // 9: Time
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.text(truncateText(doc, timeText, cols[9].w - 3), x + 1.5, y + 5.5);

      y += rowH;
    });
  }

  // Ensure space for totals + signatures
  if (y + 32 > pageH - 10) {
    doc.addPage();
    y = drawHeader(true);
  }

  y += 3;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(51, 65, 85);
  doc.setLineWidth(0.35);
  doc.roundedRect(margin, y, contentW, 9, 1.2, 1.2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text(
    `TRUCK LOADING: Total ${activeLoadingTrucks.length} (Local: ${localTrucksCount} | Export: ${exportTrucksCount} | STO: ${stoTrucksCount})`,
    margin + 3,
    y + 5.8
  );
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  doc.text(
    `Total Quantity: ${totalQty} Units | Total Pallets: ${totalPallets} | Total Loose Rolls: ${totalLooseRolls}`,
    pageW - margin - 3,
    y + 5.8,
    { align: 'right' }
  );

  // Signatures
  const sigY = Math.min(pageH - 12, y + 22);
  const sigW = 62;
  const sigPositions = [margin + 12, margin + contentW / 2 - sigW / 2, pageW - margin - sigW - 12];
  const sigLabels = ['Security Officer', 'Dispatch Manager', 'Plant Head'];
  doc.setDrawColor(30, 41, 59);
  doc.setLineWidth(0.35);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  sigPositions.forEach((sx, idx) => {
    doc.line(sx, sigY, sx + sigW, sigY);
    doc.text(sigLabels[idx], sx + sigW / 2, sigY + 4.5, { align: 'center' });
  });

  // Page numbers
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${p} of ${pageCount}`, pageW - margin, pageH - 4, { align: 'right' });
  }

  const safeDate = String(date || 'report').replace(/[^0-9A-Za-z_-]/g, '_');
  doc.save(`Daily_Material_Loading_Dispatch_Report_${safeDate}.pdf`);
}
