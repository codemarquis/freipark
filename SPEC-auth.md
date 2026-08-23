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

No new npm dependencies, no new database tables, no backend (FastAPI) changes. This is a frontend-only module.

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
  requirement, allowed redirect URLs, password minimum) — these are
  dashboard-level project config, not something this module's code
  controls, and changing them affects every client
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

---

## Open Questions

| Question | Status |
|---|---|
| Does the Supabase project currently require email confirmation before first sign-in? | **Resolved 2026-08-23 — yes**, confirmed by an actual signup against the real project (a confirmation email arrived). Superseded the earlier "unverified from this environment" note. |
| **New 2026-08-23:** the confirmation email's link is broken. | **Confirmed bug, not yet fixed.** The link points to `redirect_to=http://localhost:3000` — the Supabase project's **Site URL** (Authentication → URL Configuration in the dashboard) is still the default placeholder from project creation, and FreiPark has no web frontend for it to resolve to. This is dashboard config, not app code — someone with Supabase dashboard access needs to point Site URL at either (a) a minimal static "confirmed, return to the app" page (quick, no app changes), or (b) a proper `freipark://` deep link, which requires the same `app.json` URI-scheme work as the password-reset item below. Until fixed, **no one can actually complete signup** — this blocks the "Sign up creates an account" success criterion end-to-end, not just the UX polish of it. |
| **New 2026-08-23:** confirmation emails are sent from Supabase's own address, not freipark.com. | **Known limitation, not yet fixed.** Fixing it requires configuring custom SMTP (Authentication → Emails → SMTP Settings) through a transactional provider (Resend/Postmark/SendGrid/SES) with a domain-verified sender for freipark.com (SPF + DKIM DNS records). Also raises Supabase's default shared-sender rate limit, which will matter at real usage volume regardless of branding. Dashboard + DNS work, not app code. |
| Password reset — build now or defer? | **Still deferred.** Real scope: `app.json` URI scheme + deep-link handling for the reset redirect — the same infrastructure the broken confirmation-email redirect above needs. Worth doing both together if/when this gets built, rather than twice. |
| Any profile data beyond `auth.users` (display name, avatar)? | **Deferred — no.** Nothing in the app consumes profile data yet; adding a `profiles` table now would be speculative. Revisit when Phase 2 (`spot_reports`) needs to display "reported by X". |
| Where exactly does `AccountButton` sit visually relative to `SearchBar`? | **Resolved** — confirmed correct via live simulator screenshot 2026-08-23, no overlap. |
