import { TicketRecord } from '../types';

export type WhatsAppTemplateId =
  | 'gate_call'
  | 'token_generated'
  | 'under_loading'
  | 'completed_dispatch'
  | 'loading_slip_generated';

export interface WhatsAppTemplateVariable {
  key: string;
  token: string;
  label: string;
  sampleValue: string;
}

export interface WhatsAppTemplate {
  id: string;
  titleHindi: string;
  titleEnglish: string;
  description: string;
  category: 'manual' | 'automated';
  icon: string;
  defaultBody: string;
  variables: string[];
  generateText: (
    ticket: TicketRecord,
    companyName: string,
    customTemplates?: Record<string, string>
  ) => string;
}

export const WHATSAPP_TEMPLATE_VARIABLES: WhatsAppTemplateVariable[] = [
  { key: 'companyName', token: '{{companyName}}', label: 'Company Name', sampleValue: 'ARABIAN WATERPROOFING CO. AWAZEL' },
  { key: 'driverName', token: '{{driverName}}', label: 'Driver Name', sampleValue: 'FAYAZ' },
  { key: 'truckNumber', token: '{{truckNumber}}', label: 'Truck Number', sampleValue: '5332 AXG' },
  { key: 'ticketNumber', token: '{{ticketNumber}}', label: 'Ticket No', sampleValue: 'AWZR-20261120-001' },
  { key: 'sequenceNumber', token: '{{sequenceNumber}}', label: 'Daily Seq #', sampleValue: '1' },
  { key: 'gateNumber', token: '{{gateNumber}}', label: 'Loading Gate', sampleValue: 'Gate 2' },
  { key: 'gateSequenceNumber', token: '{{gateSequenceNumber}}', label: 'Gate Queue #', sampleValue: '1' },
  { key: 'timeIn', token: '{{timeIn}}', label: 'Inward Time', sampleValue: '08:40 AM' },
  { key: 'currentTime', token: '{{currentTime}}', label: 'Current Time', sampleValue: '10:35 AM' },
  { key: 'delNoteNumber', token: '{{delNoteNumber}}', label: 'Delivery Note No', sampleValue: 'A1DD002525' },
  { key: 'destinationPlace', token: '{{destinationPlace}}', label: 'Destination', sampleValue: 'RIYADH LOCAL' },
  { key: 'totalQty', token: '{{totalQty}}', label: 'Total Qty', sampleValue: '565' },
  { key: 'totalPallets', token: '{{totalPallets}}', label: 'Total Pallets', sampleValue: '24' },
  { key: 'totalLooseRolls', token: '{{totalLooseRolls}}', label: 'Loose Rolls', sampleValue: '13' },
  { key: 'statusLabel', token: '{{statusLabel}}', label: 'Live Status Label', sampleValue: 'Waiting in Queue' },
  { key: 'liveStatusUrl', token: '{{liveStatusUrl}}', label: 'Live Status Link', sampleValue: 'https://dispatch.example.com/driver-loading-status/sample-token' },
];

export const DEFAULT_WHATSAPP_TEMPLATES: Record<WhatsAppTemplateId, string> = {
  gate_call: `📢 *Loading Alert | Call to Gate*
🏢 *{{companyName}}*

Dear Driver *{{driverName}}*,
Your vehicle *{{truckNumber}}* has been called for loading at *{{gateNumber}}*.

📌 *Ticket No:* {{ticketNumber}}
🔢 *Daily Seq:* #{{sequenceNumber}}
🚪 *Loading Gate:* {{gateNumber}}
⏳ *Status:* You are next in line at this gate!

⚠️ *Please place your truck at {{gateNumber}} and report to the Loading Boy or Forklift Operator.*
Thank you!`,

  token_generated: `🎫 *Material Loading Ticket*
🏢 *{{companyName}}*

Hello *{{driverName}}*,
Your vehicle inward entry has been registered successfully.

📋 *Ticket Details:*
• Vehicle Number: *{{truckNumber}}*
• Ticket Number: *{{ticketNumber}}*
• Daily Overall Sequence: *#{{sequenceNumber}}*
• Assigned Gate: *{{gateNumber}}*
• Position at Gate: *#{{gateSequenceNumber}}*
• Inward Time: {{timeIn}}

🔔 *You will receive a WhatsApp alert when your turn is called at the gate. Please wait in the outside parking safe place.*`,

  under_loading: `🏗️ *Loading in Progress | Under Loading*
🏢 *{{companyName}}*

Driver *{{driverName}}*,
Loading for vehicle *{{truckNumber}}* has commenced at *{{gateNumber}}*.

• Ticket No: {{ticketNumber}}
• Gate: {{gateNumber}}
• Time: {{currentTime}}

⚠️ Please adhere to plant safety protocols (Safety Shoes & Helmet) during material tally and loading.`,

  completed_dispatch: `✅ *Loading Completed | Ready for Dispatch*
🏢 *{{companyName}}*

Loading for vehicle *{{truckNumber}}* at *{{gateNumber}}* has been successfully completed.

📄 *Dispatch Summary:*
• Delivery Note No: *{{delNoteNumber}}*
• Destination Place: *{{destinationPlace}}*
• Total Quantity: *{{totalQty}}*
• Total Pallets: *{{totalPallets}}*
• Loose Rolls/Packages: *{{totalLooseRolls}}*

Please collect your 2-copy Delivery Note from the Dispatch Office.
🛣️ *Have a safe journey!*`,

  loading_slip_generated: `🚛 *Loading Status Update*

Dear Driver,

Your loading slip has been generated successfully.

*Delivery Number:* {{delNoteNumber}}
*Truck Number:* {{truckNumber}}
*Gate Number:* {{gateNumber}}
*Queue Number:* {{gateSequenceNumber}}
*Current Status:* {{statusLabel}}

You can check your *Live Loading Status* here:

🔗 {{liveStatusUrl}}

Please wait for further instructions.

Thank you.`,
};

export function renderWhatsAppTemplateString(
  rawTemplate: string,
  values: Record<string, string | number | undefined | null>
): string {
  return rawTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const val = values[key];
      return val !== undefined && val !== null ? String(val) : '';
    }
    return match;
  });
}

function getTicketStatusLabel(status?: TicketRecord['status']): string {
  switch (status) {
    case 'under_loading':
      return 'Under Loading';
    case 'called':
      return 'Called to Gate';
    case 'completed':
      return 'Loading Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'waiting':
    default:
      return 'Waiting in Queue';
  }
}

export function buildTicketTemplateValues(
  ticket: TicketRecord,
  companyName: string,
  extra?: { liveStatusUrl?: string; statusLabel?: string }
): Record<string, string> {
  const slip = ticket.loadingSlip;
  return {
    companyName: companyName || 'Factory Dispatch',
    driverName: ticket.driverName || 'Partner',
    truckNumber: ticket.truckNumber || '—',
    ticketNumber: ticket.ticketNumber || '—',
    sequenceNumber: String(ticket.sequenceNumber ?? '-'),
    gateNumber: ticket.gateNumber || 'Gate 1',
    gateSequenceNumber: String(ticket.gateSequenceNumber ?? '-'),
    timeIn: ticket.timeIn || '—',
    currentTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
    delNoteNumber: slip?.delNoteNumber || ticket.delNoteNumber || 'Issued',
    destinationPlace: ticket.destinationPlace || slip?.placeName || 'N/A',
    totalQty: String(slip?.totalQty ?? '0'),
    totalPallets: String(slip?.totalPallets ?? '0'),
    totalLooseRolls: String(slip?.totalLooseRolls ?? '0'),
    statusLabel: extra?.statusLabel || getTicketStatusLabel(ticket.status),
    liveStatusUrl:
      extra?.liveStatusUrl ||
      (ticket.driverStatusToken
        ? `${typeof window !== 'undefined' ? window.location.origin : ''}/driver-loading-status/${ticket.driverStatusToken}`
        : 'https://dispatch.example.com/driver-loading-status/live-token'),
  };
}

export function resolveWhatsAppTemplateText(
  templateId: string,
  ticket: TicketRecord,
  companyName: string,
  customTemplates?: Record<string, string>,
  extra?: { liveStatusUrl?: string; statusLabel?: string }
): string {
  const defaultBody =
    DEFAULT_WHATSAPP_TEMPLATES[templateId as WhatsAppTemplateId] || DEFAULT_WHATSAPP_TEMPLATES.gate_call;
  const customBody = customTemplates?.[templateId];
  const rawTemplate = customBody && customBody.trim().length > 0 ? customBody : defaultBody;
  return renderWhatsAppTemplateString(rawTemplate, buildTicketTemplateValues(ticket, companyName, extra));
}

export const WHATSAPP_MANAGED_TEMPLATES: WhatsAppTemplate[] = [
  {
    id: 'gate_call',
    titleHindi: 'Call to Gate (Next in Queue)',
    titleEnglish: 'Gate Calling Notification',
    description: 'Sent manually when calling a waiting truck to report to its assigned loading gate.',
    category: 'manual',
    icon: 'Megaphone',
    defaultBody: DEFAULT_WHATSAPP_TEMPLATES.gate_call,
    variables: ['companyName', 'driverName', 'truckNumber', 'gateNumber', 'ticketNumber', 'sequenceNumber'],
    generateText: (ticket, companyName, customTemplates) =>
      resolveWhatsAppTemplateText('gate_call', ticket, companyName, customTemplates),
  },
  {
    id: 'token_generated',
    titleHindi: 'Ticket Issued & Gate Position',
    titleEnglish: 'Token Registration Receipt',
    description: 'Sent after creating a gate ticket to share the assigned gate and queue position.',
    category: 'manual',
    icon: 'Ticket',
    defaultBody: DEFAULT_WHATSAPP_TEMPLATES.token_generated,
    variables: ['companyName', 'driverName', 'truckNumber', 'ticketNumber', 'sequenceNumber', 'gateNumber', 'gateSequenceNumber', 'timeIn'],
    generateText: (ticket, companyName, customTemplates) =>
      resolveWhatsAppTemplateText('token_generated', ticket, companyName, customTemplates),
  },
  {
    id: 'under_loading',
    titleHindi: 'Under Loading Confirmation',
    titleEnglish: 'Loading Commenced Alert',
    description: 'Sent when loading operations start at the gate, with plant safety instructions.',
    category: 'manual',
    icon: 'Loader2',
    defaultBody: DEFAULT_WHATSAPP_TEMPLATES.under_loading,
    variables: ['companyName', 'driverName', 'truckNumber', 'gateNumber', 'ticketNumber', 'currentTime'],
    generateText: (ticket, companyName, customTemplates) =>
      resolveWhatsAppTemplateText('under_loading', ticket, companyName, customTemplates),
  },
  {
    id: 'completed_dispatch',
    titleHindi: 'Loading Completed & Slip Ready',
    titleEnglish: 'Dispatch & Gatepass Ready',
    description: 'Sent when loading is completed and the 2-copy Delivery Note is ready for collection.',
    category: 'manual',
    icon: 'CheckCircle2',
    defaultBody: DEFAULT_WHATSAPP_TEMPLATES.completed_dispatch,
    variables: ['companyName', 'truckNumber', 'gateNumber', 'delNoteNumber', 'destinationPlace', 'totalQty', 'totalPallets', 'totalLooseRolls'],
    generateText: (ticket, companyName, customTemplates) =>
      resolveWhatsAppTemplateText('completed_dispatch', ticket, companyName, customTemplates),
  },
  {
    id: 'loading_slip_generated',
    titleHindi: 'Automated Loading Slip Alert',
    titleEnglish: 'Auto Cloud API Notification',
    description: 'Sent automatically by the server when a Loading Slip is generated, including the live status link.',
    category: 'automated',
    icon: 'Send',
    defaultBody: DEFAULT_WHATSAPP_TEMPLATES.loading_slip_generated,
    variables: ['delNoteNumber', 'truckNumber', 'gateNumber', 'gateSequenceNumber', 'statusLabel', 'liveStatusUrl', 'driverName', 'ticketNumber', 'companyName'],
    generateText: (ticket, companyName, customTemplates) =>
      resolveWhatsAppTemplateText('loading_slip_generated', ticket, companyName, customTemplates),
  },
];

// Manual Send-WhatsApp modal templates (keeps exact 4 manual templates in WhatsAppModal)
export const WHATSAPP_TEMPLATES: WhatsAppTemplate[] = WHATSAPP_MANAGED_TEMPLATES.filter(
  (tpl) => tpl.category === 'manual'
);

/**
 * Formats any input phone number to the standard Saudi international format +966XXXXXXXXX
 * If user inputs:
 *  - "0550000000" -> "+966550000000"
 *  - "0500000000" -> "+966500000000"
 *  - "550000000"  -> "+966550000000"
 *  - "+966550000000" -> "+966550000000"
 *  - "966550000000"  -> "+966550000000"
 *  - "00966550000000" -> "+966550000000"
 */
export function formatSaudiPhoneNumber(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Extract digits only
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed.startsWith('+') ? trimmed : '';

  // Case 1: Starts with 00966
  if (digits.startsWith('00966')) {
    const rest = digits.slice(5);
    return '+966' + (rest.startsWith('0') ? rest.slice(1) : rest);
  }

  // Case 2: Starts with 966
  if (digits.startsWith('966')) {
    const rest = digits.slice(3);
    return '+966' + (rest.startsWith('0') ? rest.slice(1) : rest);
  }

  // Case 3: Local Saudi mobile format 05XXXXXXXX (10 digits starting with 0)
  if (digits.startsWith('0')) {
    // Drop the leading 0 and attach +966 -> e.g. 0550000000 -> +966550000000
    return '+966' + digits.slice(1);
  }

  // Case 4: 9 digits starting with 5 (e.g. 550000000)
  if (digits.length === 9 && digits.startsWith('5')) {
    return '+966' + digits;
  }

  // If already starts with + and has country code
  if (trimmed.startsWith('+')) {
    return trimmed;
  }

  // Default fallback: attach +966
  return '+966' + digits;
}

/**
 * Clean phone number for WhatsApp Web / API URL:
 * WhatsApp API requires purely numerical country code + subscriber number (e.g. 966550000000)
 * without +, spaces, brackets, or dashes.
 */
export function cleanPhoneNumber(rawPhone: string): string {
  if (!rawPhone) return '';
  const formatted = formatSaudiPhoneNumber(rawPhone);
  const digits = formatted.replace(/\D/g, '');
  // If digits are e.g. 966055000000, remove the erroneous 0
  if (digits.startsWith('9660')) {
    return '966' + digits.slice(4);
  }
  return digits;
}

export function openWhatsAppChat(phone: string, message: string): void {
  const cleaned = cleanPhoneNumber(phone);
  const encodedText = encodeURIComponent(message);
  const url = `https://api.whatsapp.com/send?phone=${cleaned}&text=${encodedText}`;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
