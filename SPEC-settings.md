# Spec: settings — Account and language in one place

**Module:** `settings`
**Capability map:** [CLAUDE.md](CLAUDE.md) → after `spot-address`. Depends on `auth` (`useAuth`, `AuthSheet`) and the i18n setup. No backend or database changes.
**Status:** Approved 2026-10-08 (open-question defaults accepted) — tasks in `tasks/plan.md` § Implementation Plan: settings.

---

## Objective

Give the app a **Settings** screen for account and language, and make the
sign-in sheet do only sign-in.

**Decided (2026-10-07):** Settings holds **account + language** (not map
filters, about/legal or navigation-app choice — those can be added later).

**Today:** the top-right account button ("Sign in" / your email) opens
`AuthSheet`, which mixes three jobs: the DE/EN/TR switch (always at the
top), the sign-in/sign-up form (signed out), and email + Sign out +
Delete account (signed in). Changing language means opening "Sign in".

---

## Design

### Entry point

The top-right account button becomes a **Settings button**: a round pill
showing `⚙︎` (text gear, U+2699 + text-variation selector — no icon
library, no new dependency), `accessibilityLabel` "Settings" /
"Einstellungen" / "Ayarlar". Same position and size as today's button.

### `SettingsSheet` (new, `src/features/settings/SettingsSheet.tsx`)

A bottom sheet (same `@gorhom/bottom-sheet` pattern as the others):

```
Settings
──────────────────────────────
Account
  Signed out:  [ Sign in or create account ]      → opens AuthSheet
  Signed in:   you@example.com
               [ Sign out ]
               Delete account                      (confirm dialog, as today)

Language
  [ DE ] [ EN ] [ TR ]                             (current one highlighted)
──────────────────────────────
```

- Sign out / delete keep today's behaviour and error handling, moved
  verbatim from `AuthSheet` (same `useAuth` calls, same confirm dialog,
  same analytics).
- Language uses the existing `setLanguage()` (persists to AsyncStorage).

### `AuthSheet` becomes sign-in only

- Language row and the signed-in block are removed.
- After a successful sign-in/sign-up it closes, as today.
- Still opened directly by the report buttons when a signed-out user taps
  "Space free" / "Occupied" (unchanged).

### `MapScreen`

- `AccountButton` → `SettingsButton` (opens `SettingsSheet`).
- One `AuthSheet` instance at screen level serves both Settings' "Sign in"
  and the report buttons (today there are two).

---

## Translations

New keys (de/en/tr): `settings.title`, `settings.account`,
`settings.language`, `settings.signInOrCreate`, `settings.a11y`. Existing
`account.*` keys are reused for sign out / delete.

---

## Tests

- `SettingsSheet`: signed out shows "Sign in or create account" and calls
  `onSignInRequested`; signed in shows email, Sign out, Delete account;
  sign-out and delete call `useAuth` and handle errors; language pills
  call `setLanguage` and highlight the current language.
- `AuthSheet`: no language row, no signed-in block; existing sign-in /
  sign-up / OTP tests unchanged.
- `SettingsButton`: accessible label, opens the sheet.
- Key parity across de/en/tr.

---

## Boundaries

- **Always:** keep account actions' behaviour identical (only moved).
- **Ask first:** adding an icon library; new settings beyond account +
  language.
- **Never:** change auth logic in `useAuth`; gate browsing behind sign-in.

---

## Success Criteria

1. Tapping the top-right `⚙︎` opens Settings; Account and Language
   sections behave as above, signed in and signed out.
2. Changing language in Settings updates the whole app immediately and
   persists across restarts.
3. The sign-in sheet shows only sign-in/sign-up; report buttons still
   open it when signed out.
4. `npx jest` and `npx tsc --noEmit` pass; no `any`.
5. Checked on the simulator: both states, all three languages.

---

## Open Questions

| Question | Decided 2026-10-08 (defaults accepted) |
|---|---|
| Show something on the button when signed in (e.g. a dot)? | No — Settings shows the account; keep the button simple. |
| Add the app version at the bottom of Settings? | Not now (needs `expo-application` or `expo-constants`; "About" was deferred). |
