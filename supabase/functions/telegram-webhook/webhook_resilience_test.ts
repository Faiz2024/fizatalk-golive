import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isCriticalPaymentUpdate,
  isStaleWebhookUpdate,
  STALE_MESSAGE_MAX_AGE_SECONDS,
  webhookDatabaseFailureStatus,
} from "../_shared/webhook-resilience.ts";

Deno.test("pesan lebih dari 90 detik dibuang, batas 90 detik masih diproses", () => {
  assertEquals(STALE_MESSAGE_MAX_AGE_SECONDS, 90);
  assertEquals(isStaleWebhookUpdate({ message: { date: 911 } }, 1_000), false);
  assertEquals(isStaleWebhookUpdate({ message: { date: 910 } }, 1_000), false);
  assertEquals(isStaleWebhookUpdate({ message: { date: 909 } }, 1_000), true);
  assertEquals(isStaleWebhookUpdate({ edited_message: { date: 800 } }, 1_000), true);
});

Deno.test("pembayaran Stars lama dan klik tombol lama tidak dibuang", () => {
  assertEquals(
    isStaleWebhookUpdate({ message: { date: 1, successful_payment: {} } }, 1_000),
    false,
  );
  assertEquals(isStaleWebhookUpdate({ callback_query: {} }, 1_000), false);
  assertEquals(isStaleWebhookUpdate({ pre_checkout_query: {} }, 1_000), false);
});

Deno.test("hanya pembayaran Stars yang mendapat HTTP 500 untuk retry database", () => {
  assertEquals(webhookDatabaseFailureStatus({ pre_checkout_query: {} }), 500);
  assertEquals(
    webhookDatabaseFailureStatus({ message: { successful_payment: {} } }),
    500,
  );
  assertEquals(webhookDatabaseFailureStatus({ message: { date: 1 } }), 200);
  assertEquals(webhookDatabaseFailureStatus({ callback_query: {} }), 200);
  assertEquals(isCriticalPaymentUpdate(undefined), false);
});
