# Architecture rules

- Keep Pakasir wire contracts in `supabase/functions/_shared/pakasir.ts`, separate from product fulfillment, so API migrations cannot change product rules.
- Store Pakasir v2 provider transaction IDs in the existing gateway-reference field and retain compact prefixed order IDs for product routing; this avoids schema changes and preserves legacy invoice recognition.
- Authenticate Pakasir payments with a server-side status lookup bound to the stored transaction, order, and charge; enforce the webhook secret when configured, because callback fields alone are not proof of payment.