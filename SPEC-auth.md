# Spec: auth — Sign Up, Sign In, Session Persistence

**Module:** `auth`
**Capability map:** [CLAUDE.md](CLAUDE.md) → module order `infra → map → auth`. This is the third module; depends on `infra` (Supabase Auth is already provisioned as part of the Supabase project) and is independent of `map` (no map code changes required, though the map screen gains one new entry point).
**Status:** Draft — awaiting review before implementation begins.

---

## Objective

Let a user create an account and sign in, with the session persisting
across app restarts and working independently across their devices
(Supabase's standard JWT + refresh-token model — no extra work required
for "cross-device" beyond normal sign-in on each device).

**Why now:** `SPEC-infra.md`'s Phase 2 roadmap (crowdsourced "mark spot
free/taken" reports) requires attributing reports to a user account. Auth
is the precondition for that, and per `CLAUDE.md`'s module order it's the
next dependency-ordered slice regardless of when Phase 2 itself gets built.

**Explicitly not this module's job:** the `spot_reports` feature that will
eventually consume auth. This spec produces the account/session
capability only — signed-out users keep full access to every existing
feature (browse, search, route to a spot). Auth is additive, never a gate.

**User story:** A user opens FreiPark, uses the map fully without signing
in. If they tap the account icon, they can create an account or sign in
with email + password. Once signed in, that state persists — closing and
reopening the app doesn't sign them out, and signing in on a second device
works independently via its own session.

**Success looks like:** Sign up, sign in, sign out, and session-restore-on-
relaunch all work against the real Supabase project, with zero regressions
to the existing signed-out map experience.

---

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Auth provider | Supabase Auth, email+password | Already the project's designated choice (`SPEC-infra.md`); no new service |
| Client SDK | `@supabase/supabase-js` v2 `.auth` API | Already a dependency (`supabase.rpc` already used by `useSpots.ts`) |
| Session storage | `@react-native-async-storage/async-storage` | **Already wired** — `src/lib/supabase.ts` already configures `storage: AsyncStorage, autoRefreshToken: true, persistSession: true`. This module implements the UI and hook layer on top of groundwork that already exists. |
| Auth UI | `@gorhom/bottom-sheet` | Already a dependency, already used for `SpotDetailSheet` — reuse the same bottom-sheet pattern for visual/interaction consistency instead of introducing a new UI paradigm |
| Validation | Client-side (email format, password length) + Supabase server-side enforcement | No new validation library; Supabase rejects invalid signups itself |
| Transactional email (SMTP) | Brevo, via Supabase's custom-SMTP setting | *(Added 2026-08-24.)* Fixes both the shared-sender branding and Supabase's low default send-rate. Dashboard + DNS config only — see § Auth Flows and § Open Questions. |
| Phone auth (SMS/OTP) | Twilio (testing) → MessageBird (production), both via Supabase's Phone provider setting | *(Added 2026-08-24.)* Neither provider is referenced anywhere in app code — `supabase.auth.signInWithOtp`/`verifyOtp` are provider-agnostic; the SMS provider is entirely a Supabase Dashboard → Authentication → Providers → Phone credential. Swapping Twilio → MessageBird later is a dashboard credential change, not a code change. See § Auth Flows. |

No new npm dependencies, no new database tables. **Still no backend (FastAPI) changes** — confirmed 2026-08-24 while investigating the JWT signing-key question: the backend has zero JWT-verification code today (grepped the whole tree), so there's nothing for a key-algorithm change to affect. See `SPEC-infra.md` § Verifying Supabase JWTs (Future) for what backend code would look like *if* a protected route is ever added — not built now, since unused verification code with no caller would be untestable dead code.

---

## Commands

```bash
# Frontend dev server (unchanged)
npx expo start

# Frontend tests (unchanged)
cd frontend && npx jest
```

---

## Project Structure

```
frontend/
  src/
    features/
      auth/
        useAuth.ts          → Hook: wraps supabase.auth (signUp, signInWithPassword,
                               signOut, getSession, onAuthStateChange); exposes
                               { session, user, loading, signUp, signIn, signOut }
        AuthSheet.tsx        → Bottom sheet: toggles between sign-in and sign-up
                               forms; shows inline validation/error state
        AccountButton.tsx    → Small icon button (signed-out: "Sign in"; signed-in:
                               shows a simple account state) — entry point for AuthSheet
      map/
        MapScreen.tsx        → One addition: renders <AccountButton /> alongside
                               the existing <SearchBar />; otherwise unchanged
  __tests__/
    useAuth.test.ts
    AuthSheet.test.tsx
```

No changes to `supabase/migrations/` — `auth.users` is fully managed by
Supabase Auth already; nothing to add to the schema for this module.

---

## Auth Flows

### Sign up

```ts
const { data, error } = await supabase.auth.signUp({ email, password });
```

- Client-side validation before calling: valid email shape, password ≥ 6
  chars (Supabase's own default minimum — don't hardcode a stricter rule
  without checking the project's actual configured minimum first).
- **Confirmed 2026-08-23 (real signup, real inbox): this project requires
  email confirmation.** `data.session` is `null` until the user confirms;
  `AuthSheet` handles that with a "check your email" message.
- On error: show `error.message` inline — **except** when
  `error.code` is `user_already_exists` or `email_exists` (Supabase's code
  for "this email already has an account"). That specific case is
  deliberately **not** shown to the user — surfacing "User already
  registered" is a user-enumeration vector (an attacker can probe arbitrary
  emails to learn which ones have FreiPark accounts). Instead `AuthSheet`
  shows the exact same "check your email to confirm your account" message
  a genuine new signup gets, so the response is indistinguishable either
  way. This is why `useAuth`'s `AuthResult` carries a stable `code` field
  alongside `error` — keying off Supabase's `code` is robust; keying off
  the human-readable `message` string would not be.
- Sign-**in** does not have this problem: Supabase's `signInWithPassword`
  already returns a generic "Invalid login credentials" for both "no such
  user" and "wrong password", so it's shown as-is.

### Sign in

```ts
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
```

- On success: `onAuthStateChange` fires, `useAuth`'s `session` updates,
  `AuthSheet` closes automatically.
- On error: inline error message (e.g. "Invalid login credentials").

### Sign out

```ts
const { error } = await supabase.auth.signOut();
```

- Clears the persisted session (AsyncStorage) and fires `onAuthStateChange`.
- No confirmation dialog — sign-out is non-destructive and instantly
  reversible by signing back in.

### Session restore on launch

```ts
const { data: { session } } = await supabase.auth.getSession();
```

- `useAuth` calls this once on mount, then subscribes via
  `supabase.auth.onAuthStateChange` for subsequent changes (sign in/out
  from anywhere in the app, or a token refresh).
- While the initial `getSession()` call is in flight, `AccountButton`
  should show a neutral/loading state, not flash "Sign in" and then
  immediately flip to signed-in — same pattern as `MapScreen`'s existing
  "Locating…" chip for `expo-location`.

### Phone auth (OTP)

*(Added 2026-08-24.)* An alternative to email+password, not a required
second factor — `AuthSheet` has an Email/Phone method toggle above the
existing sign-in/sign-up tabs, and the user picks either. Two calls, both
in `useAuth.ts`:

```ts
const { error } = await supabase.auth.signInWithOtp({ phone });
// ... user reads the SMS, types the code ...
const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
```

- **`signInWithOtp({ phone })` is a unified passwordless flow** — Supabase
  signs in an existing phone number *or* signs up a new one with no
  separate distinction, and (unlike email) doesn't return an
  "already registered"-style error either way. There is nothing to guard
  against here for the enumeration concern email sign-up has — the
  response is inherently the same whether the number is new or not.
- On success: `AuthSheet` moves from the phone-number step to a
  verification-code step (`otpSent` state), showing "Enter the code sent
  to {phone}."
- Client-side phone validation before calling: `/^\+[1-9]\d{7,14}$/` — a
  loose E.164 check (leading `+`, no leading zero, 8–15 digits total).
  This is UX-only; Supabase does the real validation.
- Verifying calls `verifyOtp({ phone, token, type: 'sms' })`. On success,
  same close/reset behavior as the email flow. On error (e.g. expired or
  wrong code), inline error, sheet stays open.
- `AuthSheet` also offers "Use a different number" (back to the phone-entry
  step) and "Resend code" (re-calls `signInWithOtp` with the same number)
  — both simple, no added throttling beyond whatever Supabase/the SMS
  provider enforces server-side.
- **Known limitation, not fixed:** RN's `phone-pad` keyboard type doesn't
  include a `+` key on iOS, so users may need to switch keyboards to type
  the country-code prefix. A masked/formatted phone input would fix this
  but is its own small effort — not built now, flagged so it's a
  deliberate gap, not a silent one.

---

## Dashboard Configuration (Manual — 2026-08-24)

*Everything in this section happens in the Supabase Dashboard (and, for
email, freipark.com's DNS). None of it is app code — recorded here so the
decisions and exact values aren't scattered across chat history.*

### Email — Brevo SMTP

Once Brevo account creation, domain verification, and DNS records (SPF +
DKIM) are done and Brevo has issued SMTP credentials, enter in
**Supabase Dashboard → Authentication → Emails → SMTP Settings**:

| Field | Value |
|---|---|
| Host | `smtp-relay.brevo.com` |
| Port | `587` (STARTTLS — recommended) |
| Username | The Brevo **account login email** — not `smtp-relay.brevo.com` itself, that's the host, a common mix-up |
| Password | The **SMTP key** generated in Brevo under Settings → SMTP & API → SMTP tab — **not** the Brevo account password, and not an API key. Paste it into a plain-text editor first to check for accidental leading/trailing whitespace — Brevo's own docs note a single stray character causes a 535 auth error. |
| Sender name | `FreiPark` |
| Sender email | An address at the **verified** freipark.com sending domain, e.g. `noreply@freipark.com` — must match the domain Brevo verified, or sending fails |

Port 465 (SSL) also works if 587/STARTTLS has network issues; Brevo does
not support port 25 for this. Supabase imposes a 30 messages/hour rate
limit even with custom SMTP configured — raise it under Authentication →
Rate Limits once Brevo is live, before expecting real signup volume.

**This does fix the branding issue already logged** — the "from" identity
becomes whatever Brevo/freipark.com's verified sender is, not Supabase's
shared address. It does **not** touch the separate, already-tracked
`localhost:3000` redirect bug (§ Open Questions) — that's the link
*inside* the email, unrelated to who the email appears to be from, and is
explicitly out of scope for this pass per your instruction.

### Phone — Twilio (testing), then MessageBird (production)

**Twilio, first:** in **Supabase Dashboard → Authentication → Providers →
Phone**, enable the provider and select **Twilio**, then enter:

| Field | Where to find it |
|---|---|
| Account SID | Twilio Console dashboard home page |
| Auth Token | Same page, next to Account SID (click "show") |
| Messaging Service SID *or* a Twilio phone number | A trial Twilio account can send from a Twilio-provided trial number without setting up a full Messaging Service — use the trial number's SID/number directly for initial testing; a Messaging Service is the more production-shaped option (supports number pooling, sender rotation) worth setting up before the MessageBird switch |

Twilio trial accounts can generally only send to phone numbers you've
manually verified in the Twilio console — expect that limitation during
testing; it goes away once the account is upgraded (or once production
moves to MessageBird).

**MessageBird, later:** same dashboard screen, switch the provider
dropdown from Twilio to MessageBird, enter MessageBird's Access Key. No
app code changes either time — confirmed in § Tech Stack: nothing in
`frontend/src/` references either provider.

---

## UI

**`AccountButton`** sits near `SearchBar` (top of the map screen, opposite
corner) so it doesn't compete with existing search/location UI. Signed
out: a simple "Sign in" pill. Signed in: shows the user's email (truncated)
or an account glyph — exact visual TBD in implementation, not load-bearing
for this spec.

**`AuthSheet`** (bottom sheet, same `@gorhom/bottom-sheet` mechanics as
`SpotDetailSheet`):

```
[Sign In]  [Sign Up]   ← tab toggle

Email:    [___________]
Password: [___________]

[ Continue ]

Error message, if any, shown inline below the button.
```

Signed-in state: sheet instead shows the account email and a "Sign Out"
button — no separate screen needed for this minimal scope.

---

## Code Style

Strict TypeScript, no `any`, matching the existing map module's
conventions (`SPEC-map.md` § Code Style).

```tsx
// Preferred — typed hook return, no any
interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ session: null, user: null, loading: true });
  // ...
  return { ...state, signUp, signIn, signOut };
}
```

Import `Session`/`User` types from `@supabase/supabase-js` — don't hand-roll
duplicate interfaces for what the SDK already types.

---

## Testing Strategy

Same infra as the map module (`jest-expo` + `@testing-library/react-native`
v14) — **note the gotchas already fixed there, plus one new one found
while building this module:**
- `render()`/`renderHook()` are `async` in v14 and must be `await`ed — this
  extends to `renderHook`'s returned `unmount()`, which is also async and
  must be `await`ed before asserting on cleanup effects (e.g. an
  unsubscribe call), not just the initial render.
- Any fake-timer test should use `jest.advanceTimersByTimeAsync` rather
  than `advanceTimersByTime` + a separate `act()` flush (see `SPEC-map.md`
  § Testing Strategy for why).
- **New:** `fireEvent.changeText` and `fireEvent.press` are *also* async in
  this version (`Promise<undefined>`/`Promise<void>`, not the historically
  synchronous API). Skipping `await` on them doesn't throw — it silently
  no-ops, so a test can fail with "mock never called" or "element not
  found" that looks like a real bug but is actually a missing `await`.
  Every `fireEvent.*` call in `AuthSheet.test.tsx` awaits.

- `useAuth.test.ts` — mock `supabase.auth.*` the same way `useSpots.test.ts`
  mocks `supabase.rpc`: assert `signUp`/`signIn`/`signOut` call the right
  SDK methods with the right args, assert `session`/`user`/`loading` state
  transitions correctly, assert the `onAuthStateChange` subscription is
  unsubscribed on unmount (a common leak source).
- `AuthSheet.test.tsx` — sign-in vs sign-up tab toggle renders the right
  form; validation errors show for malformed email / short password before
  ever calling Supabase; server errors from a mocked failed call surface
  inline; successful sign-in closes the sheet.
- *(Added 2026-08-24)* Same two files cover phone auth: `useAuth.test.ts`
  asserts `signInWithOtp`/`verifyOtp` call the SDK with the right args
  (including `type: 'sms'`); `AuthSheet.test.tsx` covers the method
  toggle, malformed-phone and too-short-code validation, the send →
  verify → close happy path, error-inline-on-failure for both steps, and
  the "different number"/"resend" affordances.

**Coverage target:** ≥ 80% on `useAuth.ts`, matching the bar already set
for `useSpots.ts`. `AuthSheet.tsx`/`AccountButton.tsx`: snapshot-level only,
consistent with how `SpotDetailSheet.tsx` is treated.

**Explicitly out of scope for tests:** actually exercising Supabase's email
confirmation flow (would require a real inbox) — mock at the SDK boundary
instead, as with every other Supabase call in this codebase.

---

## Boundaries

**Always:**
- Run `npx jest` before committing
- Keep every existing map feature (browse/search/route) fully functional
  when signed out — auth must never become a gate on existing behavior
- Use the SDK's own `Session`/`User` types — no hand-rolled duplicates
- Surface Supabase's own error messages to the user rather than
  swallowing or re-wording them

**Ask first:**
- Changing the Supabase project's Auth settings (email confirmation
  requirement, allowed redirect URLs, password minimum, SMTP settings,
  phone provider credentials) — these are dashboard-level project config,
  not something this module's code controls, and changing them affects
  every client
- Adding password reset (`resetPasswordForEmail`) — needs a redirect URL
  and `app.json` URI scheme registration for the deep link back into the
  app; real scope, not a one-line add. Deferred out of this spec's v1 —
  see § Open Questions.
- Adding social/OAuth login providers
- Any change to `app.json`

**Never:**
- Gate map browsing, search, or routing behind a signed-in check
- Store passwords or tokens anywhere outside Supabase's own session
  storage (AsyncStorage, already configured) — no custom token handling
- Roll a custom JWT verification path — Supabase's SDK handles this
- Let any auth flow's response distinguish "this email has an account"
  from "it doesn't" — a user-enumeration vector. Sign-up already handles
  this (see § Auth Flows); apply the same principle if password reset is
  ever built — "if that email has an account, we sent a reset link" reads
  identically whether it does or not.

---

## Success Criteria

1. Signing up with a new email/password creates an account (verify: user
   appears in Supabase Auth dashboard, or, if email confirmation is on,
   the "check your email" state shows correctly). **Currently blocked
   end-to-end** — the "check your email" UI state itself is confirmed
   correct, but the confirmation link Supabase emails points at
   `localhost:3000` and fails (§ Open Questions), so no one can actually
   complete a signup against the real project right now until the
   dashboard's Site URL is fixed.
2. Signing in with valid credentials succeeds; `AccountButton` reflects
   signed-in state
3. Signing in with wrong credentials shows a clear inline error, no crash
4. Signing out clears the session; `AccountButton` reverts to signed-out
5. Force-quitting and relaunching the app restores the session without
   requiring sign-in again (manual device test — this is the main payoff
   of the AsyncStorage persistence already wired in `src/lib/supabase.ts`)
6. Every existing map success criterion (`SPEC-map.md`) still passes
   signed-out — no regression
7. `npx jest` passes; `useAuth.ts` ≥ 80% coverage
8. No new backend/database changes required — `git diff` touches only
   `frontend/src/features/auth/`, `frontend/src/features/map/MapScreen.tsx`,
   and `frontend/__tests__/`
9. *(New 2026-08-24)* Sending a phone OTP and verifying it creates/signs in
   a session the same way email does; a wrong or expired code shows an
   inline error, no crash — **unverified live** (unit-tested only; needs
   the dashboard-side Twilio config below before it can be exercised
   against the real project)
10. *(New 2026-08-24)* No email/phone provider name (Brevo, Twilio,
    MessageBird) appears anywhere in `frontend/src/` — confirmed by design,
    since none of §Auth Flows' code references a provider directly

---

## Open Questions

| Question | Status |
|---|---|
| Does the Supabase project currently require email confirmation before first sign-in? | **Resolved 2026-08-23 — yes**, confirmed by an actual signup against the real project (a confirmation email arrived). Superseded the earlier "unverified from this environment" note. |
| **New 2026-08-23:** the confirmation email's link is broken. | **Confirmed bug, not yet fixed.** The link points to `redirect_to=http://localhost:3000` — the Supabase project's **Site URL** (Authentication → URL Configuration in the dashboard) is still the default placeholder from project creation, and FreiPark has no web frontend for it to resolve to. This is dashboard config, not app code — someone with Supabase dashboard access needs to point Site URL at either (a) a minimal static "confirmed, return to the app" page (quick, no app changes), or (b) a proper `freipark://` deep link, which requires the same `app.json` URI-scheme work as the password-reset item below. Until fixed, **no one can actually complete signup** — this blocks the "Sign up creates an account" success criterion end-to-end, not just the UX polish of it. |
| **New 2026-08-23:** confirmation emails are sent from Supabase's own address, not freipark.com. | **Decided 2026-08-24: Brevo.** Custom SMTP via Brevo's relay, with a verified freipark.com sending domain (SPF + DKIM). Exact dashboard field values in § Auth Flows below. Also raises Supabase's default shared-sender rate limit (30/hr even on custom SMTP per Supabase's own docs), which matters at real usage volume regardless of branding. Dashboard + DNS work, not app code — not yet executed as of this writing. |
| Password reset — build now or defer? | **Still deferred.** Real scope: `app.json` URI scheme + deep-link handling for the reset redirect — the same infrastructure the broken confirmation-email redirect above needs. Worth doing both together if/when this gets built, rather than twice. |
| Any profile data beyond `auth.users` (display name, avatar)? | **Deferred — no.** Nothing in the app consumes profile data yet; adding a `profiles` table now would be speculative. Revisit when Phase 2 (`spot_reports`) needs to display "reported by X". |
| Where exactly does `AccountButton` sit visually relative to `SearchBar`? | **Resolved** — confirmed correct via live simulator screenshot 2026-08-23, no overlap. |
| **New 2026-08-24:** phone SMS provider — Twilio or MessageBird? | **Decided: both, sequentially.** Twilio for initial testing (free trial credit, no card), MessageBird for production later. Zero app-code impact either way — see Tech Stack table. Dashboard config steps in § Auth Flows. |
| **New 2026-08-24:** does migrating Supabase's JWT signing keys to asymmetric (RS256/ES256) require a backend code change? | **No** — confirmed by grepping the entire backend: there is no JWT-verification code anywhere in this codebase today, so there's nothing for a key-algorithm change to affect. The premise behind "update the backend's token verification" assumed existing verification code that doesn't exist. See `SPEC-infra.md` § Verifying Supabase JWTs (Future) for the JWKS-based approach to use *when* a protected backend route is actually added (e.g. Phase 2 `spot_reports`) — documented as ready-to-build guidance, not built now, since verification code with no route to protect would be untestable dead code. |
