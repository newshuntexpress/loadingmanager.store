import QRCode from 'qrcode';
import { TicketRecord } from '../types';

export function buildDriverLiveStatusUrl(
  ticket: Pick<TicketRecord, 'driverStatusToken' | 'truckNumber'>
): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const token = (ticket.driverStatusToken || '').trim();
  if (token) {
    return `${origin}/driver-loading-status/${encodeURIComponent(token)}`;
  }
  const truck = (ticket.truckNumber || '').trim();
  if (truck) {
    return `${origin}/driver-status?truck=${encodeURIComponent(truck)}`;
  }
  return `${origin}/driver-status`;
}

export async function generateQrPngDataUrl(url: string, width = 360): Promise<string> {
  if (!url) return '';
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}
