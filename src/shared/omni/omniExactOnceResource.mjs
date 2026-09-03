export const createOmniExactOnceResource = () => {
  let closed = false;
  const cleanups = [];
  return Object.freeze({
    add(cleanup) {
      if (closed) {
        cleanup();
        return false;
      }
      cleanups.push(cleanup);
      return true;
    },
    close() {
      if (closed) return false;
      closed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
      return true;
    },
  });
};
