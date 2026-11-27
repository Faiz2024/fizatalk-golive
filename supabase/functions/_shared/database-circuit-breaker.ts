export const DATABASE_FAILURE_THRESHOLD = 15;
export const DATABASE_FAILURE_WINDOW_MS = 10_000;
export const DATABASE_CIRCUIT_OPEN_MS = 10_000;

export class DatabaseCircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;

  constructor(
    private readonly failureThreshold = DATABASE_FAILURE_THRESHOLD,
    private readonly failureWindowMs = DATABASE_FAILURE_WINDOW_MS,
    private readonly openMs = DATABASE_CIRCUIT_OPEN_MS,
  ) {}

  isOpen(now = Date.now()): boolean {
    if (this.openedAt === null) return false;
    if (now - this.openedAt < this.openMs) return true;
    this.openedAt = null;
    this.failures = [];
    return false;
  }

  recordSuccess(): void {
    this.failures = [];
    this.openedAt = null;
  }

  recordFailure(now = Date.now()): void {
    if (this.isOpen(now)) return;
    this.failures = this.failures.filter((at) => now - at < this.failureWindowMs);
    this.failures.push(now);
    if (this.failures.length >= this.failureThreshold) {
      this.openedAt = now;
      this.failures = [];
    }
  }
}

export function createCircuitBreakerFetch(
  fetcher: typeof fetch,
  breaker: DatabaseCircuitBreaker,
): typeof fetch {
  return async (input, init) => {
    if (breaker.isOpen()) {
      const error = new Error("Database circuit breaker is open");
      error.name = "CircuitBreakerOpenError";
      throw error;
    }
    // Timeout/abort lokal dan kegagalan transport tetap diteruskan, tetapi bukan
    // bukti PostgREST sedang down. Hanya respons gateway yang membuka circuit.
    const response = await fetcher(input, init);
    if ([502, 503, 504].includes(response.status)) breaker.recordFailure();
    else breaker.recordSuccess();
    return response;
  };
}
