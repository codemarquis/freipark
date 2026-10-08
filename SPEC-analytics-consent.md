# Spec: analytics-consent — Opt-in crash reports and usage statistics

**Module:** `analytics-consent`
**Capability map:** [CLAUDE.md](CLAUDE.md) → after `road-closures`. Depends on `settings` (the sheet gets a Privacy section) and the existing Sentry / PostHog setup. No backend or database changes.
**Status:** Decided 2026-10-08 (keep both SDKs, disclose them, ask first). Implementation tracked in `tasks/plan.md` § analytics-consent.

---

## Objective

The app ships **Sentry** (crash reports, session replay) and **PostHog**
(product events, logs, error tracking), but the privacy policy said there
was no analytics, and nothing asked users. Before the App Store
submission: **send nothing until the user agrees**, let them change their
mind in Settings, collect less, and say so in the privacy policy and the
App Store privacy label.

**Decided (2026-10-08):** keep both, disclose them, ask for consent.

**Cost note (CLAUDE.md hard constraint):** both services bill by volume
above their free tiers (Sentry 5k errors/month; PostHog 1M events/month).
Opt-in keeps volume a fraction of users; if a tier is reached, sampling
goes down or the SDK comes out — never a paid plan by default.

---

## What changes

### Two choices, both off until the user says yes

| Choice | SDK | What is sent |
|---|---|---|
| **Crash reports** | Sentry (EU, `ingest.de.sentry.io`) | Errors and crashes with the stack trace, device model, OS and app version. |
| **Usage statistics** | PostHog (EU, `eu.i.posthog.com`) | The app's named events (spot selected, report sent, navigation opened…), fetch logs, uncaught errors; a random ID, or the account ID when signed in. |

Collected less than today:
- `sendDefaultPii: false` (no IP address, no user data in Sentry events).
- **No session replay** at all: a replay would record the map with the
  user's location dot, which Sentry's text/image masking doesn't cover.
- No Sentry feedback widget (unused).
- PostHog `identify()` sends the account ID only — **no email**.
- PostHog doesn't preload feature flags (no request before consent).

### First launch: a consent sheet

Shown once, when no choice has been stored, over the map:

```
Help improve FreiPark
──────────────────────────────
With your permission we send crash reports
(Sentry) and anonymous usage statistics
(PostHog), both hosted in the EU. Nothing is
sent unless you allow it. You can change
this any time in Settings.        Privacy policy

[   Don't allow   ]   [   Allow   ]
──────────────────────────────
```

Both buttons look the same (no nudging). "Allow" turns both on; "Don't
allow" stores both off. Closing the sheet without choosing stores
nothing, so it asks again next launch.

### Settings: a Privacy section

Under Language: two switches, "Crash reports" and "Usage statistics",
showing the stored choice; changes apply immediately.

### How the SDKs are started

- `src/features/consent/consent.ts` owns the stored choice
  (`freipark.consent.v1` in AsyncStorage, JSON
  `{crashReports, analytics, decidedAt}`) and applies it:
  - **Crash reports on:** `Sentry.init(...)` (once). **Off:** `Sentry.close()`.
  - **Usage statistics:** PostHog is created with `defaultOptIn: false`
    and `preloadFeatureFlags: false`; on → `optIn()`, off → `optOut()`.
- `App.tsx` no longer calls `Sentry.init` at import time; it loads the
  choice at startup and applies it.

---

## Translations

`consent.title`, `consent.body`, `consent.allow`, `consent.deny`,
`consent.privacyLink`, `settings.privacy`, `settings.crashReports`,
`settings.analytics` (de/en/tr).

---

## Tests

- `consent.ts`: nothing stored → `null`; save/load round-trip; corrupt
  value → `null`; apply: crash on → `Sentry.init` once, off → `close`;
  analytics on → `optIn`, off → `optOut`.
- `ConsentSheet`: both buttons store and apply the right choice; privacy
  link opens the policy URL.
- `SettingsSheet`: switches show the stored choice and change it.
- Key parity across de/en/tr.

---

## Boundaries

- **Always:** nothing sent before consent; both choices equally easy;
  the policy and App Store label match what the code sends.
- **Ask first:** new events or properties containing personal data;
  turning session replay back on; any paid plan.
- **Never:** send email addresses or precise locations to Sentry/PostHog.

---

## Success Criteria

1. Fresh install: the consent sheet appears; no Sentry/PostHog request
   before a choice.
2. "Don't allow" → nothing sent; "Allow" → events arrive in both EU
   projects.
3. Settings switches change it immediately and persist across restarts.
4. `npx jest` and `npx tsc --noEmit` pass; no `any`.
5. `PRIVACY_POLICY.md` describes both services, the data, the legal basis
   (consent, Art. 6(1)(a)) and how to withdraw.
