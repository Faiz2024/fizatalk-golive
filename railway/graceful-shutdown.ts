export interface ManagedServer {
  shutdown(): Promise<void>;
}

interface ShutdownOptions {
  timeoutMs?: number;
  exit?: (code: number) => void;
}

// Berhenti menerima koneksi baru, lalu beri request aktif waktu untuk selesai.
export function createGracefulShutdown(
  server: ManagedServer,
  options: ShutdownOptions = {},
): () => void {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const exit = options.exit ?? ((code: number) => Deno.exit(code));
  let stopping = false;

  return () => {
    if (stopping) return;
    stopping = true;
    const forceExit = setTimeout(() => exit(1), timeoutMs);
    server.shutdown().then(
      () => {
        clearTimeout(forceExit);
        exit(0);
      },
      () => {
        clearTimeout(forceExit);
        exit(1);
      },
    );
  };
}
