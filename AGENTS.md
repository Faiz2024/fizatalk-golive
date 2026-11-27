# Architecture rules

- Keep Pakasir wire contracts in `supabase/functions/_shared/pakasir.ts`, separate from product fulfillment, so API migrations cannot change product rules.
- Store Pakasir v2 provider transaction IDs in the existing gateway-reference field and retain compact prefixed order IDs for product routing; this avoids schema changes and preserves legacy invoice recognition.
- Authenticate Pakasir payments with a server-side status lookup bound to the stored transaction, order, and charge; require the webhook secret for v2, because callback fields alone are not proof of payment.
- Keep contextual report navigation and validation in shared report modules; execute sanctions and review decisions atomically through service-role-only RPCs to minimize database round trips.
- Validate moderation administrators against the configured CS identity or live Telegram group administrator membership; message location alone does not authorize a decision.
- Protect pending/permanent moderation at database state and unblock boundaries; payment fulfillment must never bypass these controls.
- Keep suspected child sexual material as restricted references rather than automatically redistributing media; request safe explanatory evidence for review.
- Derive Telegram webhook authentication from the bot credential in one shared helper and register the same secret with Telegram; reject forged updates before database access.
- Filter partner photos through the shared visibility policy in pairing notifications for both search and reconnect; reuse the existing batch query to avoid additional database calls.
- Keep HTTP handlers independent from Supabase and Railway entrypoints so both runtimes execute the same bot logic without parallel implementations.
- Deploy the Railway bot through the root Dockerfile with repository-root context; keep the legacy railway/Dockerfile identical so builder detection never depends on website sources.
- Keep database concurrency and total queue/request deadlines in the shared service client; count only HTTP 502/503/504 toward its circuit breaker, so local timeouts cannot disable all bot traffic.
- Keep channel AI generation and scheduled work in the Supabase `channel-agent` function; Telegram handlers only queue work and require explicit admin approval before channel posting, so AI latency and credentials stay outside the P2P chat path.
