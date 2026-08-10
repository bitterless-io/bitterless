import {
  BACKGROUND_WORK_PAUSE_MS,
  BACKGROUND_WORK_SLICE_MS,
} from './constants.mjs';

const defaultTimers = {
  now: () => performance.now(),
  pause: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
};

export const createBackgroundWorkSlicer = ({
  sliceMs = BACKGROUND_WORK_SLICE_MS,
  pauseMs = BACKGROUND_WORK_PAUSE_MS,
  timers = defaultTimers,
} = {}) => {
  let sliceStartedAt = timers.now();
  let yieldCount = 0;
  return {
    async checkpoint({ force = false } = {}) {
      if (!force && timers.now() - sliceStartedAt < sliceMs) return false;
      await timers.pause(pauseMs);
      sliceStartedAt = timers.now();
      yieldCount += 1;
      return true;
    },
    statistics() {
      return { yieldCount, sliceMs, pauseMs };
    },
  };
};
