// Tracks recoverable faults from independent call channels (the peer
// connection and the control poll) under one shared grace window. The window
// starts at the first fault and is cleared only once every channel recovers;
// if any fault is still present when it elapses, the call is given up once.
export function createRecoveryWindow(
  graceMs: number,
  onExpire: (message: string) => void,
) {
  const faults = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    fault(source: string, message: string) {
      if (done) return;
      faults.set(source, message);
      timer ??= setTimeout(() => {
        timer = undefined;
        const [message] = faults.values();
        if (message === undefined || done) return;
        done = true;
        onExpire(message);
      }, graceMs);
    },
    recover(source: string) {
      faults.delete(source);
      if (!faults.size) stop();
    },
    dispose() {
      done = true;
      stop();
    },
  };
}
