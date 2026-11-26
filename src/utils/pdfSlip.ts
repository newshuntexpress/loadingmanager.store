import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { TicketRecord, CompanySettings } from '../types';
import { formatSaudiPhoneNumber } from './whatsapp';
import { formatDisplayDate, resolveSettingsForPlant } from '../services/storage';
import { drawPdfLogo } from './logo';
import { buildDriverLiveStatusUrl } from './driverStatusUrl';

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

function drawDashedLine(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, dashLen = 1.8, gapLen = 1.4) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const totalLen = Math.hypot(dx, dy);
  if (totalLen === 0) return;
  const steps = Math.floor(totalLen / (dashLen + gapLen));
  const ux = dx / totalLen;
  const uy = dy / totalLen;

  for (let i = 0; i <= steps; i++) {
    const start = i * (dashLen + gapLen);
    const end = Math.min(start + dashLen, totalLen);
    if (start < totalLen) {
      doc.line(x1 + ux * start, y1 + uy * start, x1 + ux * end, y1 + uy * end);
    }
  }
}

function drawPdfQrCode(doc: jsPDF, url: string, x: number, y: number, sizeMm: number): void {
  if (!url) return;
  try {
    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    if (!count) return;
    const quietModules = 2;
    const totalModules = count + quietModules * 2;
    const cell = sizeMm / totalModules;

    // Crisp pure-white quiet-zone backing
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, sizeMm, sizeMm, 'F');

    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.modules.get(r, c)) {
          doc.rect(
            x + (c + quietModules) * cell,
            y + (r + quietModules) * cell,
            cell + 0.02,
            cell + 0.02,
            'F'
          );
        }
      }
    }
  } catch {
    // Skip QR rendering on unexpected input failure
  }
}

function drawSingleSlipCopy(
  doc: jsPDF,
  ticket: TicketRecord,
  settings: CompanySettings,
  copyType: 'Original (Office Use)' | 'Duplicate (For Forklift Operator)',
  yStart: number,
  storeInchargeFullName?: string,
  storeInchargeSignatureDataUrl?: string
) {
  const slip = ticket.loadingSlip;
  const items = slip?.items || [];
  const paddedItems = Array.from({ length: 8 }, (_, i) => {
    return (
      items[i] || {
        srNo: i + 1,
        description: '',
        pack: '',
        qty: '',
        pallets: '',
        looseRolls: '',
        remarks: '',
      }
    );
  });

  const outerX = 6;
  const outerW = 198;
  const outerH = 132;
  const pad = 3;
  const innerX = outerX + pad;
  const innerW = outerW - pad * 2; // 192mm

  // Outer slip border
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(outerX, yStart, outerW, outerH);

  // Header section
  const headerY = yStart + 3;
  const hasLogo = drawPdfLogo(doc, settings.logoDataUrl, innerX, headerY - 0.5, 10, 10);
  const textX = hasLogo ? innerX + 12 : innerX;
  const maxTextW = hasLogo ? 108 : 120;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text(truncateText(doc, settings.companyName, maxTextW), textX, headerY + 3.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(65, 65, 65);
  const infoLine = [
    settings.address,
    settings.phone ? `Ph: ${settings.phone}` : '',
    settings.email ? settings.email : '',
    settings.gstin ? `Tax/GSTIN: ${settings.gstin}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
  doc.text(truncateText(doc, infoLine, maxTextW + 2), textX, headerY + 7.8);

  // Right header badge + title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  const badgeW = doc.getTextWidth(copyType) + 4;
  const badgeX = innerX + innerW - badgeW;
  doc.setFillColor(243, 244, 246);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.25);
  doc.rect(badgeX, headerY, badgeW, 4.5, 'FD');
  doc.setTextColor(0, 0, 0);
  doc.text(copyType, badgeX + 2, headerY + 3.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Material Loading Slip', innerX + innerW, headerY + 9.2, { align: 'right' });

  // Divider below header
  const dividerY = yStart + 14;
  doc.setLineWidth(0.35);
  doc.line(innerX, dividerY, innerX + innerW, dividerY);

  // Master Info Grid (4 columns x 2 rows)
  const gridY = dividerY + 1.5;
  const colWidths = [44, 48, 52, 48]; // sum = 192
  const row1H = 9;
  const row2H = 11.5;

  doc.setFillColor(249, 250, 251);
  doc.setLineWidth(0.3);
  doc.rect(innerX, gridY, innerW, row1H + row2H, 'FD');

  // Grid lines
  let curX = innerX;
  for (let i = 0; i < colWidths.length - 1; i++) {
    curX += colWidths[i];
    doc.line(curX, gridY, curX, gridY + row1H + row2H);
  }
  doc.line(innerX, gridY + row1H, innerX + innerW, gridY + row1H);

  // Row 1 cells
  const isExFactory = ticket.gateNumber === 'EX-FACTORY';
  const r1Cells = [
    { label: 'Del Note No:', value: slip?.delNoteNumber || ticket.delNoteNumber || '—', bold: true, size: 9 },
    {
      label: 'Date & Time:',
      value: `${formatDisplayDate(ticket.date)} | ${ticket.timeLoadingStarted || ticket.timeIn}`,
      bold: true,
      size: 7.5,
    },
    {
      label: isExFactory ? 'Ref No:' : 'Ticket No:',
      value: `${ticket.ticketNumber} (#${ticket.sequenceNumber})`,
      bold: true,
      size: 7.5,
    },
    {
      label: isExFactory ? 'Dispatch Mode:' : 'Gate & Queue Pos:',
      value: isExFactory
        ? `EX-FACTORY (#${ticket.gateSequenceNumber})`
        : `${ticket.gateNumber} (Seq. #${ticket.gateSequenceNumber})`,
      bold: true,
      size: 8.5,
    },
  ];

  curX = innerX;
  r1Cells.forEach((cell, idx) => {
    const cw = colWidths[idx];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(90, 90, 90);
    doc.text(cell.label, curX + 1.5, gridY + 3.2);

    doc.setFont('helvetica', cell.bold ? 'bold' : 'normal');
    doc.setFontSize(cell.size);
    doc.setTextColor(0, 0, 0);
    doc.text(truncateText(doc, cell.value, cw - 3), curX + 1.5, gridY + 7.4);
    curX += cw;
  });

  // Row 2 cells
  const r2Y = gridY + row1H;
  curX = innerX;

  // Col 0: Truck Number
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(90, 90, 90);
  doc.text('Truck Number:', curX + 1.5, r2Y + 3.2);
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text(truncateText(doc, ticket.truckNumber || '—', colWidths[0] - 3), curX + 1.5, r2Y + 8.5);
  curX += colWidths[0];

  // Col 1: Driver Name & Mobile No
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(90, 90, 90);
  doc.text('Driver Name:', curX + 1.5, r2Y + 2.6);
  doc.setFontSize(7.5);
  doc.setTextColor(0, 0, 0);
  doc.text(truncateText(doc, ticket.driverName || '—', colWidths[1] - 3), curX + 1.5, r2Y + 5.5);

  doc.setDrawColor(215, 215, 215);
  doc.setLineWidth(0.15);
  doc.line(curX + 1.5, r2Y + 6.4, curX + colWidths[1] - 1.5, r2Y + 6.4);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.2);
  doc.setTextColor(100, 100, 100);
  doc.text('Mobile No:', curX + 1.5, r2Y + 8.4);
  doc.setFontSize(7.2);
  doc.setTextColor(0, 0, 0);
  doc.text(
    truncateText(doc, formatSaudiPhoneNumber(ticket.driverPhone) || '—', colWidths[1] - 3),
    curX + 1.5,
    r2Y + 10.9
  );
  curX += colWidths[1];

  // Col 2: Destination / Place
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(90, 90, 90);
  doc.text('Destination / Place:', curX + 1.5, r2Y + 3.2);
  doc.setFontSize(8.2);
  doc.setTextColor(30, 58, 138);
  doc.text(
    truncateText(doc, slip?.placeName || ticket.destinationPlace || '—', colWidths[2] - 3),
    curX + 1.5,
    r2Y + 8.5
  );
  curX += colWidths[2];

  // Col 3: Transporter / Customer Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(90, 90, 90);
  doc.text(isExFactory ? 'Customer Name:' : 'Transporter:', curX + 1.5, r2Y + 3.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(0, 0, 0);
  doc.text(truncateText(doc, ticket.transporterName || 'Self / Own', colWidths[3] - 3), curX + 1.5, r2Y + 8.5);

  // Materials Table (8 Rows + Total)
  const tableY = gridY + row1H + row2H + 1.5;
  const tCols = [8, 68, 20, 20, 24, 22, 30]; // sum = 192
  const tHeaders = ['#', 'Material Description', 'Pack Type', 'Quantity', 'Pallets', 'Loose Rolls', 'Remarks / Batch'];
  const headerH = 6;
  const rowH = 7;
  const totalH = 6.5;

  // Table Header
  doc.setFillColor(229, 231, 235);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(innerX, tableY, innerW, headerH, 'FD');

  curX = innerX;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(0, 0, 0);
  tCols.forEach((w, idx) => {
    if (idx > 0) doc.line(curX, tableY, curX, tableY + headerH);
    const align = idx === 1 ? 'left' : 'center';
    const textX = align === 'left' ? curX + 1.5 : curX + w / 2;
    doc.text(tHeaders[idx], textX, tableY + 4.2, { align });
    curX += w;
  });

  // 8 Rows
  let curY = tableY + headerH;
  paddedItems.forEach((item, index) => {
    const hasData = item.description || item.qty || item.pallets || item.looseRolls;
    if (index % 2 === 1) {
      doc.setFillColor(249, 250, 251);
      doc.rect(innerX, curY, innerW, rowH, 'FD');
    } else {
      doc.setFillColor(255, 255, 255);
      doc.rect(innerX, curY, innerW, rowH, 'FD');
    }

    curX = innerX;
    tCols.forEach((w, cIdx) => {
      if (cIdx > 0) doc.line(curX, curY, curX, curY + rowH);
      curX += w;
    });

    // Cell values
    let vx = innerX;
    doc.setTextColor(0, 0, 0);

    // #
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(String(index + 1), vx + tCols[0] / 2, curY + 4.7, { align: 'center' });
    vx += tCols[0];

    // Material Description
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.3);
    doc.text(truncateText(doc, item.description || (hasData ? '' : '—'), tCols[1] - 3), vx + 1.5, curY + 4.9);
    vx += tCols[1];

    // Pack Type
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.text(truncateText(doc, item.pack || '', tCols[2] - 2), vx + tCols[2] / 2, curY + 4.7, { align: 'center' });
    vx += tCols[2];

    // Quantity
    doc.setFont('helvetica', 'bold');
    doc.text(truncateText(doc, item.qty ? String(item.qty) : '', tCols[3] - 2), vx + tCols[3] / 2, curY + 4.7, {
      align: 'center',
    });
    vx += tCols[3];

    // Pallets + ratio
    if (item.pallets) {
      if (item.palletRatio) {
        doc.setFontSize(7);
        doc.text(String(item.pallets), vx + tCols[4] / 2, curY + 3.4, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.5);
        doc.setTextColor(80, 80, 80);
        doc.text(`@${item.palletRatio}/P`, vx + tCols[4] / 2, curY + 6.1, { align: 'center' });
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
      } else {
        doc.text(String(item.pallets), vx + tCols[4] / 2, curY + 4.7, { align: 'center' });
      }
    }
    vx += tCols[4];

    // Loose Rolls
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.text(
      truncateText(doc, item.looseRolls ? String(item.looseRolls) : '', tCols[5] - 2),
      vx + tCols[5] / 2,
      curY + 4.7,
      { align: 'center' }
    );
    vx += tCols[5];

    // Remarks
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(55, 65, 81);
    doc.text(truncateText(doc, item.remarks || '', tCols[6] - 3), vx + 1.5, curY + 4.7);

    curY += rowH;
  });

  // Totals Footer Row
  doc.setFillColor(229, 231, 235);
  doc.setLineWidth(0.4);
  doc.rect(innerX, curY, innerW, totalH, 'FD');

  // Highlight Pallets & Loose Rolls columns in light yellow
  const palletsX = innerX + tCols[0] + tCols[1] + tCols[2] + tCols[3];
  const looseX = palletsX + tCols[4];
  doc.setFillColor(254, 252, 232);
  doc.rect(palletsX, curY, tCols[4], totalH, 'FD');
  doc.rect(looseX, curY, tCols[5], totalH, 'FD');

  // Vertical borders in total row
  doc.setDrawColor(0, 0, 0);
  doc.line(innerX + tCols[0] + tCols[1] + tCols[2], curY, innerX + tCols[0] + tCols[1] + tCols[2], curY + totalH);
  doc.line(palletsX, curY, palletsX, curY + totalH);
  doc.line(looseX, curY, looseX, curY + totalH);
  doc.line(looseX + tCols[5], curY, looseX + tCols[5], curY + totalH);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(0, 0, 0);
  doc.text('Total Dispatched :', innerX + tCols[0] + tCols[1] + tCols[2] - 2, curY + 4.5, { align: 'right' });
  doc.text(String(slip?.totalQty || 0), innerX + tCols[0] + tCols[1] + tCols[2] + tCols[3] / 2, curY + 4.5, {
    align: 'center',
  });
  doc.text(String(slip?.totalPallets || 0), palletsX + tCols[4] / 2, curY + 4.5, { align: 'center' });
  doc.text(String(slip?.totalLooseRolls || 0), looseX + tCols[5] / 2, curY + 4.5, { align: 'center' });

  // Footer Live Status QR (Left) + Signatures
  const sigTopY = yStart + outerH - 23;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(innerX, sigTopY, innerX + innerW, sigTopY);

  const boxY = sigTopY + 1.8;
  const qrBoxW = 46;
  const boxW = 70; // 46 + 3 + 70 + 3 + 70 = 192mm
  const boxH = 19.5;

  // Box 1 (Left): Driver Live Loading Status QR Pass
  const qrBoxX = innerX;
  const liveStatusUrl = buildDriverLiveStatusUrl(ticket);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.35);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(qrBoxX, boxY, qrBoxW, boxH, 1, 1, 'FD');

  const qrSizeMm = 17.5;
  drawPdfQrCode(doc, liveStatusUrl, qrBoxX + 1.2, boxY + 1, qrSizeMm);

  const qrTextX = qrBoxX + qrSizeMm + 2.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.4);
  doc.setTextColor(0, 0, 0);
  doc.text('LIVE STATUS QR', qrTextX, boxY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(55, 65, 81);
  doc.text('Scan at Gate for', qrTextX, boxY + 8.6);
  doc.text('Queue & Status', qrTextX, boxY + 11.6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.setTextColor(0, 0, 0);
  doc.text(truncateText(doc, ticket.gateNumber || 'Gate', qrBoxW - qrSizeMm - 3.5), qrTextX, boxY + 16.5);

  // Box 2 (Middle): Forklift Operator / Loaded By
  const box1X = qrBoxX + qrBoxW + 3;
  doc.setDrawColor(120, 120, 120);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(box1X, boxY, boxW, boxH, 1, 1, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(31, 41, 55);
  doc.text('Forklift Operator / Loaded By', box1X + boxW / 2, boxY + 4, { align: 'center' });

  if (slip?.checkedBy) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(0, 0, 0);
    doc.text(truncateText(doc, slip.checkedBy, boxW - 8), box1X + boxW / 2, boxY + 13.5, { align: 'center' });
  }
  doc.setDrawColor(156, 163, 175);
  doc.setLineWidth(0.25);
  drawDashedLine(doc, box1X + 3, boxY + 16, box1X + boxW - 3, boxY + 16, 1.5, 1.2);

  // Box 3 (Right): Store Incharge Signature
  const box2X = box1X + boxW + 3;
  const inchargeFullName = (storeInchargeFullName || slip?.storeInchargeName || '').trim();
  doc.setDrawColor(120, 120, 120);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(box2X, boxY, boxW, boxH, 1, 1, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(31, 41, 55);
  doc.text('Store Incharge Signature', box2X + boxW / 2, boxY + 4, { align: 'center' });

  const signatureToDraw =
    storeInchargeSignatureDataUrl !== undefined
      ? storeInchargeSignatureDataUrl
      : slip?.storeInchargeSignatureDataUrl || settings.storeInchargeSignatureDataUrl || '';
  if (signatureToDraw) {
    drawPdfLogo(doc, signatureToDraw, box2X + 8, boxY + 4.8, boxW - 16, 7.2);
  }

  doc.setDrawColor(156, 163, 175);
  doc.setLineWidth(0.25);
  drawDashedLine(doc, box2X + 3, boxY + 12.5, box2X + boxW - 3, boxY + 12.5, 1.5, 1.2);

  if (inchargeFullName) {
    // Fit complete full name without truncation/shortening
    let nameFontSize = 7.6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(nameFontSize);
    while (nameFontSize > 5.5 && doc.getTextWidth(inchargeFullName) > boxW - 6) {
      nameFontSize -= 0.3;
      doc.setFontSize(nameFontSize);
    }
    doc.setTextColor(0, 0, 0);
    doc.text(inchargeFullName, box2X + boxW / 2, boxY + 16.8, { align: 'center' });
  }
}

export function generateLoadingSlipPDF(
  ticket: TicketRecord,
  settings: CompanySettings,
  storeInchargeFullName?: string,
  storeInchargeSignatureDataUrl?: string
): void {
  const plantSettings = resolveSettingsForPlant(settings, ticket.plantId);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Copy 1: Original (Top half, shifted 12mm down from top edge)
  drawSingleSlipCopy(
    doc,
    ticket,
    plantSettings,
    'Original (Office Use)',
    12,
    storeInchargeFullName,
    storeInchargeSignatureDataUrl
  );

  // Middle Scissor Cut Line
  const cutY = 149.5;
  doc.setDrawColor(140, 140, 140);
  doc.setLineWidth(0.35);
  drawDashedLine(doc, 6, cutY, 204, cutY, 2, 1.5);

  doc.setFillColor(255, 255, 255);
  doc.rect(6, cutY - 2, 48, 4, 'F');
  doc.rect(168, cutY - 2, 36, 4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text('Cut Here Along Dotted Line', 7, cutY + 1);
  doc.text('A4 Dual Copy Sheet', 203, cutY + 1, { align: 'right' });

  // Copy 2: Duplicate (Bottom half)
  drawSingleSlipCopy(
    doc,
    ticket,
    plantSettings,
    'Duplicate (For Forklift Operator)',
    155,
    storeInchargeFullName,
    storeInchargeSignatureDataUrl
  );

  const fileIdentifier = (ticket.loadingSlip?.delNoteNumber || ticket.delNoteNumber || ticket.ticketNumber).replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );
  doc.save(`Loading_Slip_${fileIdentifier}.pdf`);
}

export function generateGateTokenPDF(ticket: TicketRecord, settings: CompanySettings): void {
  const plantSettings = resolveSettingsForPlant(settings, ticket.plantId);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [80, 145],
  });

  const w = 80;
  let y = 7;

  if (drawPdfLogo(doc, plantSettings.logoDataUrl, w / 2 - 7, y - 2, 14, 10)) {
    y += 10.5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(truncateText(doc, plantSettings.companyName, 72), w / 2, y, { align: 'center' });
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(80, 80, 80);
  doc.text(truncateText(doc, plantSettings.address, 72), w / 2, y, { align: 'center' });
  y += 4;

  doc.setFillColor(0, 0, 0);
  doc.rect(12, y, 56, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text('Gate Inward & Loading Token', w / 2, y + 3.8, { align: 'center' });
  y += 8.5;

  // Assigned Gate Box
  doc.setFillColor(243, 244, 246);
  doc.setDrawColor(100, 100, 100);
  doc.rect(6, y, 68, 18, 'FD');
  doc.setFontSize(7);
  doc.setTextColor(75, 85, 99);
  doc.text('Assigned Loading Gate', w / 2, y + 4.5, { align: 'center' });
  doc.setFontSize(16);
  doc.setTextColor(30, 58, 138);
  doc.text(String(ticket.gateNumber || ''), w / 2, y + 11.5, { align: 'center' });
  doc.setFontSize(7.5);
  doc.text(`Position at Gate: #${ticket.gateSequenceNumber}`, w / 2, y + 16, { align: 'center' });
  y += 22;

  const rows: Array<[string, string]> = [
    ['Ticket Number:', String(ticket.ticketNumber || '')],
    ['Daily Overall Seq:', `#${ticket.sequenceNumber}`],
    ['Truck Number:', String(ticket.truckNumber || '')],
    ['Driver Name:', String(ticket.driverName || '')],
    ['Driver Mobile:', formatSaudiPhoneNumber(ticket.driverPhone)],
    ['Destination:', ticket.destinationPlace || 'N/A'],
    ['Date & Time In:', `${formatDisplayDate(ticket.date)} ${ticket.timeIn}`],
    ['Transporter:', ticket.transporterName || 'Self / Own'],
  ];

  doc.setDrawColor(180, 180, 180);
  doc.line(6, y, 74, y);
  y += 4.5;

  rows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(75, 85, 99);
    doc.text(label, 6, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(truncateText(doc, val, 40), 74, y, { align: 'right' });
    y += 5.5;
  });

  doc.line(6, y, 74, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(String(ticket.ticketNumber || ''), w / 2, y, { align: 'center' });
  y += 12;

  drawDashedLine(doc, 6, y, 74, y, 1.5, 1.2);
  y += 4;
  doc.setFontSize(6.5);
  doc.setTextColor(80, 80, 80);
  doc.text('Security Guard Sign', 6, y);
  doc.text('Driver Signature', 74, y, { align: 'right' });

  doc.save(`Gate_Token_${ticket.ticketNumber}.pdf`);
}
