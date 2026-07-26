export const SETTING_SERIALIZED_VALUE_MAX_BYTES = 4 * 1024 * 1024;

export const serializeSettingValue = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Setting value must be JSON serializable.');
  }
  if (Buffer.byteLength(serialized, 'utf8') > SETTING_SERIALIZED_VALUE_MAX_BYTES) {
    throw new RangeError(
      `Setting value exceeds ${SETTING_SERIALIZED_VALUE_MAX_BYTES} serialized bytes.`,
    );
  }
  return serialized;
};
