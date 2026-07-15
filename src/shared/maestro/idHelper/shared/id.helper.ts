import { nanoid } from 'nanoid';

const genSessionId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomPart = nanoid(8);
  return `${timestamp}${randomPart}`;
};

export const idHelper = {
  genSessionId,
};
