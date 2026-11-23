interface WaitingCaller {
  signal: AbortSignal;
  resolve: () => void;
  reject: (reason: unknown) => void;
  onAbort: () => void;
}

// Antrean RAM per proses: membatasi koneksi PostgREST tanpa menambah kueri DB.
export class DatabaseConcurrencyGate {
  private active = 0;
  private readonly waiting: WaitingCaller[] = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Concurrency limit must be a positive integer");
    }
  }

  async acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw signal.reason;
    if (this.active < this.limit) {
      this.active++;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const caller: WaitingCaller = {
        signal,
        resolve,
        reject,
        onAbort: () => {},
      };
      caller.onAbort = () => {
        const index = this.waiting.indexOf(caller);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal.reason);
      };
      this.waiting.push(caller);
      signal.addEventListener("abort", caller.onAbort, { once: true });
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    while (this.waiting.length > 0) {
      const caller = this.waiting.shift()!;
      caller.signal.removeEventListener("abort", caller.onAbort);
      if (caller.signal.aborted) {
        caller.reject(caller.signal.reason);
        continue;
      }
      this.active++;
      caller.resolve();
      break;
    }
  }
}
