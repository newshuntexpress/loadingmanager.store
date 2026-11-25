import type { jsPDF } from 'jspdf';

const MAX_LOGO_DIMENSION = 320;
const MAX_SIGNATURE_DIMENSION = 480;
const MAX_RAW_FILE_BYTES = 5 * 1024 * 1024;

async function normalizeImageFile(file: File, maxDimension: number, label: string): Promise<string> {
  if (!file) {
    throw new Error('No image file selected.');
  }
  const allowedMime = /^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i.test(file.type);
  const allowedExt = /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || '');
  if (!allowedMime && !allowedExt) {
    throw new Error('Please upload a valid image file (PNG, JPG, WebP, GIF, or SVG).');
  }
  if (file.size > MAX_RAW_FILE_BYTES) {
    throw new Error(`${label} file is too large. Maximum allowed file size is 5 MB.`);
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.readAsDataURL(file);
  });

  // Load into an HTMLImageElement and normalize to a crisp transparent PNG for UI + jsPDF compatibility
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to decode the selected image. Try PNG or JPG format.'));
    image.src = rawDataUrl;
  });

  const srcW = img.naturalWidth || img.width || maxDimension;
  const srcH = img.naturalHeight || img.height || maxDimension;
  const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(`Unable to process ${label.toLowerCase()} image in this browser.`);
  }
  ctx.clearRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);

  return canvas.toDataURL('image/png');
}

export async function processLogoFile(file: File): Promise<string> {
  return normalizeImageFile(file, MAX_LOGO_DIMENSION, 'Logo');
}

export async function processSignatureFile(file: File): Promise<string> {
  return normalizeImageFile(file, MAX_SIGNATURE_DIMENSION, 'Signature');
}

export function drawPdfLogo(
  doc: jsPDF,
  logoDataUrl: string | undefined,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  withWhitePlate = false
): boolean {
  if (!logoDataUrl || !logoDataUrl.startsWith('data:image/')) {
    return false;
  }
  try {
    let format: 'PNG' | 'JPEG' | 'WEBP' = 'PNG';
    if (/^data:image\/jpe?g/i.test(logoDataUrl)) format = 'JPEG';
    else if (/^data:image\/webp/i.test(logoDataUrl)) format = 'WEBP';

    let drawW = boxW;
    let drawH = boxH;
    try {
      const props = doc.getImageProperties(logoDataUrl);
      if (props && props.width > 0 && props.height > 0) {
        const ratio = Math.min(boxW / props.width, boxH / props.height);
        drawW = props.width * ratio;
        drawH = props.height * ratio;
      }
    } catch {
      // Fallback to box dimensions
    }

    if (withWhitePlate) {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(boxX, boxY, boxW, boxH, 1.2, 1.2, 'F');
    }

    const innerPad = withWhitePlate ? 0.6 : 0;
    const availW = Math.max(1, boxW - innerPad * 2);
    const availH = Math.max(1, boxH - innerPad * 2);
    const scale = Math.min(1, availW / drawW, availH / drawH);
    const finalW = drawW * scale;
    const finalH = drawH * scale;
    const offsetX = boxX + (boxW - finalW) / 2;
    const offsetY = boxY + (boxH - finalH) / 2;

    doc.addImage(logoDataUrl, format, offsetX, offsetY, finalW, finalH);
    return true;
  } catch {
    return false;
  }
}
