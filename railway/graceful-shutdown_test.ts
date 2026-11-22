import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createGracefulShutdown } from "./graceful-shutdown.ts";

Deno.test("SIGTERM menunggu request aktif selesai lalu keluar normal satu kali", async () => {
  let finish!: () => void;
  let shutdownCalls = 0;
  const exits: number[] = [];
  const server = {
    shutdown: () => {
      shutdownCalls++;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  };
  const shutdown = createGracefulShutdown(server, {
    timeoutMs: 60_000,
    exit: (code) => {
      exits.push(code);
    },
  });

  shutdown();
  shutdown();
  assertEquals(shutdownCalls, 1);
  assertEquals(exits, []);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(exits, [0]);
});

Deno.test("server yang gagal berhenti menghasilkan kode error", async () => {
  const exits: number[] = [];
  const shutdown = createGracefulShutdown(
    { shutdown: () => Promise.reject(new Error("failed")) },
    {
      timeoutMs: 60_000,
      exit: (code) => {
        exits.push(code);
      },
    },
  );
  shutdown();
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(exits, [1]);
});
