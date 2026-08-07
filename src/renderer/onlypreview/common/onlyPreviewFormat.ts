export const formatOnlyPreviewBytes = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1_024) return `${Math.round(value)} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(value < 10_240 ? 1 : 0)} KB`;
  if (value < 1_073_741_824) {
    return `${(value / 1_048_576).toFixed(value < 10_485_760 ? 1 : 0)} MB`;
  }
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
};

export const formatOnlyPreviewDate = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return new Intl.DateTimeFormat(document.documentElement.lang || 'en', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
};

export const interpolateOnlyPreview = (
  template: string,
  values: Record<string, string | number>
): string =>
  template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
