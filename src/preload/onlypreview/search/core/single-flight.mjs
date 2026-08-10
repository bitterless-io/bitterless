const cancellationError = () => Object.assign(new Error('Search cancelled.'), {
  code: 'CANCELLED',
});

export const createLatestSingleFlight = ({ createControl, execute, cancelExecution }) => {
  let active;
  let pending;
  let blockCount = 0;
  let closed = false;

  const rejectJob = (job) => {
    if (!job || job.settled) return;
    job.settled = true;
    job.reject(cancellationError());
  };

  const dispatchPending = () => {
    if (closed || blockCount > 0 || active || !pending) return;
    const job = pending;
    pending = undefined;
    active = job;
    Promise.resolve()
      .then(() => execute(job.value, job.control))
      .then((value) => {
        if (job.superseded) rejectJob(job);
        else if (!job.settled) {
          job.settled = true;
          job.resolve(value);
        }
      }, (error) => {
        if (job.superseded) rejectJob(job);
        else if (!job.settled) {
          job.settled = true;
          job.reject(error);
        }
      })
      .finally(() => {
        if (active === job) active = undefined;
        job.resolveDone();
        dispatchPending();
      });
  };

  const supersedeActive = () => {
    if (!active || active.superseded) return;
    active.superseded = true;
    cancelExecution(active.value, active.control);
  };

  const submit = (value) => {
    if (closed) return Promise.reject(new Error('Search scheduler is closed.'));
    let resolve;
    let reject;
    const promise = new Promise((resolveValue, rejectValue) => {
      resolve = resolveValue;
      reject = rejectValue;
    });
    let resolveDone;
    const done = new Promise((resolveValue) => {
      resolveDone = resolveValue;
    });
    const job = {
      value,
      control: createControl(value),
      resolve,
      reject,
      done,
      resolveDone,
      settled: false,
      superseded: false,
    };
    if (pending) rejectJob(pending);
    pending = job;
    if (active) supersedeActive();
    dispatchPending();
    return promise;
  };

  const cancelWhere = (predicate) => {
    if (pending && predicate(pending.value)) {
      const job = pending;
      pending = undefined;
      rejectJob(job);
      job.resolveDone();
    }
    if (active && predicate(active.value)) supersedeActive();
  };

  const beginBlock = () => {
    blockCount += 1;
    if (pending) {
      const job = pending;
      pending = undefined;
      rejectJob(job);
      job.resolveDone();
    }
    supersedeActive();
    const drained = active?.done ?? Promise.resolve();
    let released = false;
    return {
      drained,
      release() {
        if (released) return;
        released = true;
        blockCount -= 1;
        dispatchPending();
      },
    };
  };

  const close = async () => {
    closed = true;
    if (pending) {
      const job = pending;
      pending = undefined;
      rejectJob(job);
      job.resolveDone();
    }
    supersedeActive();
    await (active?.done ?? Promise.resolve());
  };

  return { submit, cancelWhere, beginBlock, close };
};
