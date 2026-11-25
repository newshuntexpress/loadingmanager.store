import { TruckLoadingType } from '../types';

const EXPORT_KEYWORDS = [
  'EXPORT',
  'INTERNATIONAL',
  'KUWAIT',
  'QATAR',
  'DOHA',
  'BAHRAIN',
  'MANAMA',
  'OMAN',
  'MUSCAT',
  'SALALAH',
  'SOHAR',
  'UAE',
  'U.A.E',
  'UNITED ARAB EMIRATES',
  'DUBAI',
  'ABU DHABI',
  'ABUDHABI',
  'SHARJAH',
  'AJMAN',
  'FUJAIRAH',
  'RAS AL KHAIMAH',
  'JORDAN',
  'AMMAN',
  'AQABA',
  'IRAQ',
  'BAGHDAD',
  'BASRA',
  'ERBIL',
  'EGYPT',
  'CAIRO',
  'ALEXANDRIA',
  'YEMEN',
  'ADEN',
  'SANAA',
  'SANA',
  'LEBANON',
  'BEIRUT',
  'SYRIA',
  'DAMASCUS',
  'SUDAN',
  'KHARTOUM',
  'LIBYA',
  'TRIPOLI',
  'MOROCCO',
  'TUNISIA',
  'ALGERIA',
  'INDIA',
  'PAKISTAN',
  'AFRICA',
  'EUROPE',
];

const LOCAL_KEYWORDS = [
  'LOCAL',
  'DOMESTIC',
  'RIYADH',
  'JEDDAH',
  'DAMMAM',
  'DAMMMA',
  'KHOBAR',
  'AL KHOBAR',
  'DHAHRAN',
  'JUBAIL',
  'YANBU',
  'MAKKAH',
  'MECCA',
  'MADINAH',
  'MEDINA',
  'TAIF',
  'TABUK',
  'ABHA',
  'KHAMIS',
  'JAZAN',
  'JIZAN',
  'NAJRAN',
  'HAIL',
  'QASSIM',
  'BURAIDAH',
  'HOFUF',
  'AL AHSA',
  'KHARJ',
  'AL KHARJ',
  'KSA',
];

const STO_KEYWORDS = [
  'STO',
  'STOCK TRANSFER',
  'STOCK TRANSFER ORDER',
  'BRANCH TRANSFER',
  'WAREHOUSE TRANSFER',
  'PLANT TRANSFER',
  'DEPOT TRANSFER',
  'INTERNAL TRANSFER',
];

function containsKeyword(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, 'i').test(haystack);
}

export function inferLoadingTypeFromDestination(destination?: string | null): TruckLoadingType | null {
  const upper = String(destination || '').trim().toUpperCase();
  if (!upper) return null;

  for (const kw of STO_KEYWORDS) {
    if (containsKeyword(upper, kw)) return 'sto';
  }
  if (containsKeyword(upper, 'EXPORT')) return 'export';
  if (containsKeyword(upper, 'LOCAL')) return 'local';

  for (const kw of EXPORT_KEYWORDS) {
    if (containsKeyword(upper, kw)) return 'export';
  }
  for (const kw of LOCAL_KEYWORDS) {
    if (containsKeyword(upper, kw)) return 'local';
  }

  return null;
}

export function resolveLoadingType(input?: {
  loadingType?: string | null;
  destinationPlace?: string | null;
  placeName?: string | null;
  remarks?: string | null;
}): TruckLoadingType {
  if (!input) return 'local';

  const explicit = String(input.loadingType || '').trim().toLowerCase();
  if (explicit === 'sto') return 'sto';
  if (explicit === 'export') return 'export';
  if (explicit === 'local') return 'local';

  const candidates = [input.destinationPlace, input.placeName, input.remarks];
  for (const text of candidates) {
    const inferred = inferLoadingTypeFromDestination(text);
    if (inferred) return inferred;
  }

  return 'local';
}

export function getLoadingTypeLabel(type: TruckLoadingType): string {
  if (type === 'export') return 'Export';
  if (type === 'sto') return 'STO';
  return 'Local';
}
