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
- On success: if the project requires email confirmation (see § Open
  Questions — unverified from this environment), `data.session` will be
  `null` until the user confirms; `AuthSheet` must handle that case with a
  "check your email" message rather than assuming an immediate session.
- On error: show the message from `error.message` inline in the form
  (Supabase's errors are already user-presentable, e.g. "User already
  registered").

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

---

## Success Criteria

1. Signing up with a new email/password creates an account (verify: user
   appears in Supabase Auth dashboard, or, if email confirmation is on,
   the "check your email" state shows correctly)
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
| Does the Supabase project currently require email confirmation before first sign-in? | **Unverified from this environment** — couldn't reach the linked project's Auth dashboard settings (local `supabase status` failed: no Docker daemon running, and dashboard-level Auth config isn't visible via the CLI's local commands). `AuthSheet` must handle both cases gracefully regardless; confirm the actual setting before relying on either sign-up path in manual testing. |
| Password reset — build now or defer? | **Recommend defer.** Real scope: `app.json` URI scheme + deep-link handling for the reset redirect, which is its own small effort. Flagging so it's a deliberate follow-up, not a silent gap. |
| Any profile data beyond `auth.users` (display name, avatar)? | **Deferred — no.** Nothing in the app consumes profile data yet; adding a `profiles` table now would be speculative. Revisit when Phase 2 (`spot_reports`) needs to display "reported by X". |
| Where exactly does `AccountButton` sit visually relative to `SearchBar`? | **Not blocking — implementation detail**, finalize during Phase 4 (Implement) against the real screen layout. |
