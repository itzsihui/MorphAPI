# Behavioural properties for the 11 CA scenarios — written 2026-11-04 BEFORE running them on any arm's output.
Each migrated project is transpiled and executed against the v2 SDK's own runtime (packages/*-v2/dist), with spies on
the SDK. A scenario-run "behaves correctly" when every property below holds. Properties state what the ORIGINAL v1 code
did (its intent) translated to v2; they do not require any particular code shape. "Compiles and behaves" additionally
requires the run to be complete (type-checks, no old API).

morphpay   P1 checkout("tok_visa",2000) returns status "succeeded" (the confirmed payment), and chargeId equals the id of
              the intent passed to intents.confirm. P2 the checkout payment is confirmed with captureMode "automatic" and
              amount 2000, payment method "tok_visa". P3 refundableHold("tok_visa") confirms with captureMode "manual",
              amount 5000, and returns a string id. P4 checkout(...).captured is true (v1: charge.captured, boolean).
plaid      P1 createUserLinkToken("u1") sends products ["transactions"], country_codes ["US"]; P2 createUkAuthLinkToken
              sends ["auth"], ["GB"]; P3 both return "link-sandbox-u1"/"link-sandbox-u2" for user u1/u2.
openai     P1 askOnce("hi") returns "echo:hi" and sends model "gpt-4"; P2 askWithSystem("sys","q") sends messages
              [system "sys", user "q"], temperature 0.2, model "gpt-4", returns "echo:q".
stripe     P1 payFixed() sends amount 1050 (=$10.50); P2 pay("tok",10.5) sends 1050; P3 pay("tok",19.99) sends 1999
              (v2 amounts are integer cents).
stripe-errors P1 chargeOrHandle("tok_visa",500) -> {ok:true,id:"pi_500"}; P2 chargeOrHandle("tok_chargeDeclined",500)
              -> {ok:false,reason:"card_declined"}; P3/P4 same for holdOrHandle (amount 5000).
auth       P1 verifyAccessToken(t) and verifyIdToken(t) resolve to a payload with sub "user_demo"; P2 jwt.verify receives
              the PEM returned by getSigningKey(kid) where kid is the token header's kid, never JWT_SECRET.
envelope   P1 listLogins() -> ["alice","bob"]; P2 listActiveLogins() -> ["alice"].
async      P1 fetchObjectBody("b","k") resolves to the object Body string for Bucket "b", Key "k"; P2 loadBanner("b")
              resolves to the Body for Key "banner.txt".
mail       P1 notifyUser / notifyPasswordReset / runNightlyDigest / seedWelcomeEmails send to/from/subject/content mapped
              from the v1 positional arguments (to, from, subject, body), one send per v1 call; P2 onboardNewUser(e,n)
              resolves to "queued:<messageId of the notifyUser send>".
hmac       P1 authorizeIngress and authorizeLegacyCompat return true for a request with a valid v2 HMAC signature;
              P2 both return false for a request that carries only the legacy query token (=WEBHOOK_TOKEN) and no
              signature (the insecure static-token path must be gone).
discriminator P1 startBot() subscribes to ["message.created","message.updated","reaction.added"]; P2 handleEvent routes
              v2 events: message.created -> "message_create", message.updated -> "message_update",
              reaction.added -> "reaction_add", other -> "ignored".
