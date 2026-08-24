import type { OnlyPreviewSheetCellStyle } from './workers/onlyPreviewSheetWorker.contract';

interface OnlyPreviewRichTextPart {
  text?: unknown;
}

interface OnlyPreviewFormulaValue {
  formula?: unknown;
  sharedFormula?: unknown;
  result?: unknown;
}

interface OnlyPreviewHyperlinkValue {
  text?: unknown;
  hyperlink?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const excelSerialToDate = (serial: number, date1904: boolean): Date => {
  if (date1904) return new Date(Date.UTC(1904, 0, 1) + Math.round(serial * 86_400_000));
  const wholeDays = Math.floor(serial);
  const adjustedDays = wholeDays > 60 ? wholeDays - 1 : wholeDays;
  const fraction = serial - wholeDays;
  return new Date(
    Date.UTC(1899, 11, 31) + adjustedDays * 86_400_000 + Math.round(fraction * 86_400_000)
  );
};

interface OnlyPreviewDateParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

interface OnlyPreviewDateFormatPart {
  kind: 'literal' | 'token';
  value: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];
const DATE_TOKEN_PATTERN = /^(AM\/PM|A\/P|yyyy|mmmm|dddd|mmm|ddd|yy|mm|dd|hh|ss|m|d|h|s)/i;

const dateParts = (value: Date): OnlyPreviewDateParts => ({
  year: value.getUTCFullYear(),
  month: value.getUTCMonth() + 1,
  day: value.getUTCDate(),
  weekday: value.getUTCDay(),
  hour: value.getUTCHours(),
  minute: value.getUTCMinutes(),
  second: value.getUTCSeconds()
});

const tokenizeDateFormat = (format: string): OnlyPreviewDateFormatPart[] => {
  const parts: OnlyPreviewDateFormatPart[] = [];
  const section = format.split(';')[0] ?? format;
  for (let offset = 0; offset < section.length; ) {
    const character = section[offset];
    if (character === '"') {
      const end = section.indexOf('"', offset + 1);
      const stop = end < 0 ? section.length : end;
      parts.push({ kind: 'literal', value: section.slice(offset + 1, stop) });
      offset = end < 0 ? section.length : end + 1;
      continue;
    }
    if (character === '\\' || character === '_' || character === '*') {
      if (character === '\\' && offset + 1 < section.length) {
        parts.push({ kind: 'literal', value: section[offset + 1] });
      } else if (character === '_' && offset + 1 < section.length) {
        parts.push({ kind: 'literal', value: ' ' });
      }
      offset += 2;
      continue;
    }
    if (character === '[') {
      const end = section.indexOf(']', offset + 1);
      offset = end < 0 ? section.length : end + 1;
      continue;
    }
    const token = DATE_TOKEN_PATTERN.exec(section.slice(offset))?.[0];
    if (token) {
      parts.push({ kind: 'token', value: token });
      offset += token.length;
      continue;
    }
    parts.push({ kind: 'literal', value: character });
    offset += 1;
  }
  return parts;
};

const isMinuteToken = (parts: OnlyPreviewDateFormatPart[], index: number): boolean => {
  const previous = parts
    .slice(0, index)
    .reverse()
    .find((part) => part.kind === 'token');
  const next = parts.slice(index + 1).find((part) => part.kind === 'token');
  return /^h/i.test(previous?.value ?? '') || /^s/i.test(next?.value ?? '');
};

const renderDateParts = (parts: OnlyPreviewDateParts, format: string): string => {
  const tokens = tokenizeDateFormat(format);
  if (!tokens.some((part) => part.kind === 'token')) {
    return `${parts.year.toString().padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  }
  const usesMeridiem = tokens.some(
    (part) => part.kind === 'token' && /^(AM\/PM|A\/P)$/i.test(part.value)
  );
  return tokens
    .map((part, index) => {
      if (part.kind === 'literal') return part.value;
      const token = part.value.toLowerCase();
      if (token === 'yyyy') return String(parts.year).padStart(4, '0');
      if (token === 'yy') return String(parts.year % 100).padStart(2, '0');
      if (token === 'mmmm') return MONTH_NAMES[parts.month - 1];
      if (token === 'mmm') return MONTH_NAMES[parts.month - 1].slice(0, 3);
      if (token === 'dddd') return WEEKDAY_NAMES[parts.weekday];
      if (token === 'ddd') return WEEKDAY_NAMES[parts.weekday].slice(0, 3);
      if (token === 'dd') return String(parts.day).padStart(2, '0');
      if (token === 'd') return String(parts.day);
      if (token === 'mm' || token === 'm') {
        const value = isMinuteToken(tokens, index) ? parts.minute : parts.month;
        return token === 'mm' ? String(value).padStart(2, '0') : String(value);
      }
      if (token === 'hh' || token === 'h') {
        const value = usesMeridiem ? parts.hour % 12 || 12 : parts.hour;
        return token === 'hh' ? String(value).padStart(2, '0') : String(value);
      }
      if (token === 'ss') return String(parts.second).padStart(2, '0');
      if (token === 's') return String(parts.second);
      if (token === 'am/pm') return parts.hour < 12 ? 'AM' : 'PM';
      if (token === 'a/p') return parts.hour < 12 ? 'A' : 'P';
      return part.value;
    })
    .join('');
};

const formatDate = (value: Date, format: string): string =>
  renderDateParts(dateParts(value), format);

const excelDateToSerial = (value: Date, date1904: boolean): number =>
  25_569 + value.getTime() / 86_400_000 - (date1904 ? 1_462 : 0);

const isDateNumberFormat = (format: string): boolean => {
  const normalized = format.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[ymdhs]/i.test(normalized) && !/[0#?]/.test(normalized);
};

const decimalsInFormat = (format: string): number => {
  const section = format.split(';')[0] ?? format;
  const decimal = section.match(/\.([0#]+)/);
  return Math.min(decimal?.[1].length ?? 0, 12);
};

const formatNumber = (value: number, format: string, date1904: boolean): string => {
  const normalized = format.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  if (isDateNumberFormat(format)) {
    if (!date1904 && Math.floor(value) === 60) {
      const fakeLeapDay = dateParts(excelSerialToDate(value - 1, false));
      fakeLeapDay.year = 1900;
      fakeLeapDay.month = 2;
      fakeLeapDay.day = 29;
      return renderDateParts(fakeLeapDay, format);
    }
    return formatDate(excelSerialToDate(value, date1904), normalized);
  }
  const decimals = decimalsInFormat(normalized);
  if (normalized.includes('%')) return `${(value * 100).toFixed(decimals)}%`;
  const currency = normalized.match(/[$€£¥₹]/)?.[0];
  const useThousands = normalized.includes(',');
  const absolute = Math.abs(value);
  const rendered = useThousands
    ? absolute.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      })
    : decimals > 0
      ? absolute.toFixed(decimals)
      : String(absolute);
  const signed = value < 0 ? `-${rendered}` : rendered;
  return currency ? `${value < 0 ? '-' : ''}${currency}${rendered}` : signed;
};

const unwrapCellValue = (value: unknown, formulaResult = false): unknown => {
  if (!isRecord(value)) return value;
  const formula = value as OnlyPreviewFormulaValue;
  if (!formulaResult && ('formula' in formula || 'sharedFormula' in formula)) {
    return unwrapCellValue(formula.result ?? null, true);
  }
  const richText = value.richText;
  if (Array.isArray(richText)) {
    return richText.map((part: OnlyPreviewRichTextPart) => String(part.text ?? '')).join('');
  }
  const hyperlink = value as OnlyPreviewHyperlinkValue;
  if ('hyperlink' in hyperlink) return hyperlink.text ?? '';
  if ('error' in value) return String(value.error ?? '');
  return value;
};

export const formatOnlyPreviewSheetValue = (
  value: unknown,
  numFmt = 'General',
  date1904 = false
): string => {
  const displayValue = unwrapCellValue(value);
  if (displayValue === null || displayValue === undefined) return '';
  if (displayValue instanceof Date) {
    return isDateNumberFormat(numFmt)
      ? formatNumber(excelDateToSerial(displayValue, date1904), numFmt, date1904)
      : formatDate(displayValue, numFmt);
  }
  if (typeof displayValue === 'number' && Number.isFinite(displayValue)) {
    return numFmt && numFmt !== 'General'
      ? formatNumber(displayValue, numFmt, date1904)
      : String(displayValue);
  }
  if (typeof displayValue === 'boolean') return displayValue ? 'TRUE' : 'FALSE';
  if (typeof displayValue === 'string') return displayValue;
  return '';
};

const argbToCss = (value: unknown): string | undefined => {
  if (!isRecord(value) || typeof value.argb !== 'string') return undefined;
  const argb = value.argb.toUpperCase();
  if (!/^[A-F0-9]{8}$/.test(argb)) return undefined;
  const alpha = Number.parseInt(argb.slice(0, 2), 16) / 255;
  const red = Number.parseInt(argb.slice(2, 4), 16);
  const green = Number.parseInt(argb.slice(4, 6), 16);
  const blue = Number.parseInt(argb.slice(6, 8), 16);
  return alpha >= 0.999
    ? `#${argb.slice(2).toLowerCase()}`
    : `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
};

export const extractOnlyPreviewSheetStyle = (
  cell: Record<string, unknown>
): OnlyPreviewSheetCellStyle | undefined => {
  const style: OnlyPreviewSheetCellStyle = {};
  const alignment = isRecord(cell.alignment) ? cell.alignment : {};
  if (['left', 'center', 'right'].includes(String(alignment.horizontal))) {
    style.horizontal = alignment.horizontal as OnlyPreviewSheetCellStyle['horizontal'];
  }
  if (
    alignment.vertical === 'top' ||
    alignment.vertical === 'middle' ||
    alignment.vertical === 'bottom'
  ) {
    style.vertical = alignment.vertical;
  }
  if (alignment.wrapText === true) style.wrap = true;
  const font = isRecord(cell.font) ? cell.font : {};
  if (font.bold === true) style.bold = true;
  if (font.italic === true) style.italic = true;
  style.color = argbToCss(font.color);
  const fill = isRecord(cell.fill) ? cell.fill : {};
  if (fill.type === 'pattern' && fill.pattern === 'solid') style.fill = argbToCss(fill.fgColor);
  for (const key of Object.keys(style) as Array<keyof OnlyPreviewSheetCellStyle>) {
    if (style[key] === undefined) delete style[key];
  }
  return Object.keys(style).length ? style : undefined;
};
