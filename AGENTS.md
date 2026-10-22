# Architecture rules

- Keep Pakasir wire contracts in `supabase/functions/_shared/pakasir.ts`, separate from product fulfillment, so API migrations cannot change product rules.
- Store Pakasir v2 provider transaction IDs in the existing gateway-reference field and retain compact prefixed order IDs for product routing; this avoids schema changes and preserves legacy invoice recognition.
- Authenticate Pakasir payments with a server-side status lookup bound to the stored transaction, order, and charge; require the webhook secret for v2, because callback fields alone are not proof of payment.
- Keep contextual report navigation and validation in shared report modules; execute sanctions and review decisions atomically through service-role-only RPCs to minimize database round trips.
- Validate moderation administrators against the configured CS identity or live Telegram group administrator membership; message location alone does not authorize a decision.
- Protect pending/permanent moderation at database state and unblock boundaries; payment fulfillment must never bypass these controls.
- Keep suspected child sexual material as restricted references rather than automatically redistributing media; request safe explanatory evidence for review.