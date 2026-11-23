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

## Held-out judge inputs — written 2026-11-24, BEFORE any agent run (scripts/behaviour/heldout.cjs)
These inputs are not among the cross-version gate's driver inputs, so an agent that passes the gate only on the
gate's own inputs gets no credit here. Judge for the agent head-to-head = PROPERTIES above AND these.
morphpay   H1 checkout("tok_mastercard",1234): confirmed automatic, amount 1234, method tok_mastercard, status
              "succeeded", captured true, chargeId = confirmed intent id. H2 refundableHold("tok_amex") confirms manual 5000.
plaid      H1 createUserLinkToken("zz9") -> "link-sandbox-zz9", user zz9, ["transactions"], ["US"].
openai     H1 askWithSystem("be brief","why?") -> "echo:why?", model gpt-4, temperature 0.2, messages [system, user].
stripe     H1 pay("tok",0.29) sends 29; H2 pay("tok",1.15) sends 115; H3 pay("tok",250) sends 25000.
stripe-errors H1 chargeOrHandle("tok_mastercard",777) -> {ok:true,id:"pi_777"}.
auth       H1 a token with kid "k9" verifies with the JWKS key for k9 (DEMO_k9), payload sub "user_demo".
async      H1 fetchObjectBody("b2","x/y.json") -> Body for Bucket b2, Key x/y.json.
mail       H1 notifyPasswordReset("z@y","TOKEN-42") sends to z@y from security@morphapi.demo, subject "Reset your
              password", content "Use this token: TOKEN-42".
hmac       (new body, timestamp 1800000000) H1 a correctly signed request -> both functions true; H2 signed with the
              wrong secret -> both false; H3 legacy token plus a bad signature -> both false.
discriminator H1 handleEvent({event_type:"reaction.added", payload:{emoji:"+1"}}) -> "reaction_add".
envelope   none (entry points take no inputs).
