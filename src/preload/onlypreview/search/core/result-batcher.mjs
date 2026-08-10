import { MAX_BATCH_DELAY_MS, MAX_BATCH_RESULTS } from './constants.mjs';

export const createSearchResultBatcher = ({
  onBatch,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) => {
  let pending = [];
  let timer;

  const flush = () => {
    clearTimer(timer);
    timer = undefined;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    onBatch(batch);
  };

  const push = (result) => {
    pending.push(result);
    if (pending.length >= MAX_BATCH_RESULTS) flush();
    else if (!timer) timer = setTimer(flush, MAX_BATCH_DELAY_MS);
  };

  return {
    push,
    finish: flush,
    cancel() {
      clearTimer(timer);
      timer = undefined;
      pending = [];
    },
  };
};
