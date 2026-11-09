// All concurrent callers share one refresh. Events received while it is loading
// request one following pass, so changes are not lost behind an older response.
export function coalescedRefresh(work: () => Promise<void>): () => Promise<void> {
  let flight: Promise<void> | null = null;
  let again = false;
  async function drain() {
    try {
      do {
        again = false;
        // Also make synchronous failures settle after `flight` is assigned.
        await Promise.resolve().then(work);
      } while (again);
    } finally {
      flight = null;
      again = false;
    }
  }
  return () => {
    if (flight) { again = true; return flight; }
    flight = drain();
    return flight;
  };
}
