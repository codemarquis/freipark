# FreiPark Privacy Policy

*Last updated: 8 October 2026*

## 1. Who we are

This Privacy Policy explains how FreiPark ("we", "us", "the App")
collects, uses and protects your information when you use the FreiPark
mobile app.

**Data controller:**
[LEGAL ENTITY NAME / YOUR NAME]
[ADDRESS]
[CONTACT EMAIL]

## 2. What data we collect

We collect only what the App needs. This list is checked against the
App's code and our server configuration.

### Account data (only if you create an account)
You can browse the map without an account. If you sign up, we collect:
- your **email address** and a **password** (stored only as a secure
  hash — we never see your actual password), or
- your **phone number** (you sign in with a one-time code sent by SMS).

### Location
With your permission (which you can decline or revoke at any time in
your device settings), the App uses your **device's location** to:
- centre the map on you and show parking spots nearby,
- calculate directions to a spot you select (the start and end points
  are sent to our own routing server), and
- check that you're at a spot when you report it (see *Spot reports*).

Location is used only while the App is open — never in the background —
and **is not stored**.

### Map area you're viewing
To draw the map, the App downloads map tiles and parking data for the
area on screen. Those requests show which area you're looking at (see
§ 4 for who serves them). They are not linked to your account.

### Search queries
When you search for a place, your search text is sent to
**OpenStreetMap's Nominatim service** to find matching places (see § 4).

### Spot reports (only if you're signed in)
You can report whether a parking spot has space ("free") or is
occupied. Other users see that a spot was reported free or occupied and
how long ago — **never who reported it**.

When you send a report, the App reads your current location once and
sends it to our server, which checks you're within 150 m of a street
spot (300 m for car parks and zones). **Your coordinates are not
stored.** We store:
- your account ID,
- the spot,
- the report ("free" or "occupied") and when you made it,
- your distance from the spot at that moment (in metres).

### Crash reports and usage statistics (only if you allow them)
On first launch the App asks whether you allow **crash reports** and
**usage statistics**. Both are off unless you tap "Allow", and you can
turn each one on or off at any time in **Settings → Privacy**.

- **Crash reports (Sentry):** when the App crashes or hits an error, it
  sends the error, the technical steps leading up to it, your device
  model, operating system and App version. No IP address, no account
  details, no screen recordings.
- **Usage statistics (PostHog):** the App sends which features are used
  — for example "parking spot selected", "report sent", "navigation
  opened", whether loading parking data worked — with the spot's type
  (free/paid/permit) but **not its location**. Events carry a random
  identifier, or your account ID if you're signed in. **Never your email
  address or phone number.**

### Server logs
Like virtually all web services, our servers log standard technical
information for security and troubleshooting (IP address, time,
requested address). See § 6 for how long.

### What we do **not** collect
- No advertising identifiers and no ad networks
- No background or continuous location tracking
- No push notification tokens (the App doesn't send push notifications)
- No payment or card information (see § 5)
- No contacts, photos or other files from your device

## 3. Why we use your data, and the legal basis

| Data | Purpose | Legal basis (GDPR) |
|---|---|---|
| Email or phone number, password | Create and secure your account; send sign-up confirmation and sign-in codes | Performance of a contract (Art. 6(1)(b)) |
| Location (while the App is open) | Show nearby spots, calculate routes | Consent (Art. 6(1)(a)), given through your device's permission prompt |
| Map area requests, search text | Show the map and find places | Performance of a contract (Art. 6(1)(b)) |
| Spot reports (account ID, spot, status, time, distance) | Show other users whether a spot has space; prevent abuse (rate limits, distance check) | Performance of a contract (Art. 6(1)(b)); keeping them for 30 days to tune how long reports stay visible: legitimate interest (Art. 6(1)(f)) |
| Location at the moment you report | Check you're at the spot (not stored) | Consent (Art. 6(1)(a)), through the permission prompt |
| Crash reports, usage statistics | Fix errors; understand which features help drivers | Consent (Art. 6(1)(a)) — only if you tap "Allow"; withdraw any time in Settings → Privacy |
| Server logs | Security, abuse prevention, troubleshooting | Legitimate interest (Art. 6(1)(f)) |

## 4. Who processes data for us

Our own servers (database, accounts, parking data, routing and the
roadworks layer) run on **OVH** in **Frankfurt am Main, Germany**. In
addition:

| Service | What it receives | When | Location |
|---|---|---|---|
| **Cloudflare** (R2) | Your IP address and the map tiles requested (the area you view) | Whenever the map loads | Global network; Cloudflare, Inc. (USA) |
| **GitHub Pages** | Your IP address when the App loads map fonts and icons | Map loading | GitHub, Inc. (USA) |
| **OpenStreetMap Foundation** (Nominatim) | Your IP address and search text | When you search | United Kingdom ([Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/)) |
| **Brevo** | Your email address | When we send a sign-up or account email | EU (France) |
| **Vonage** | Your phone number | When you request an SMS sign-in code | Vonage (USA) |
| **Sentry** (Functional Software, Inc.) | Crash reports as described in § 2 | Only if you allowed crash reports | EU data region (Germany) |
| **PostHog** (PostHog, Inc.) | Usage statistics as described in § 2 | Only if you allowed usage statistics | EU data region (Frankfurt) |

- **EasyPark / ParkNow:** if you tap a payment link for a paid spot, the
  App opens that provider's app or website. We share nothing with them —
  it's a plain link. Their privacy policies apply after you leave the App.
- **Apple Maps / Google Maps:** if you tap "Open in Maps", the App passes
  the spot's coordinates to the maps app you choose. Its own privacy
  policy applies.

Roadworks and closures come from the Autobahn GmbH des Bundes and
OpenStreetMap; our server fetches them, so the App never contacts those
sources and they receive nothing about you.

We do not sell your data to anyone, for any reason.

## 5. Payments

FreiPark does not process payments and does not collect payment card
information. For paid parking we link to the provider's (EasyPark /
ParkNow) own app or website, where their terms and privacy practices
apply.

## 6. How long we keep data

- **Account data:** until you delete your account (see § 7).
- **Location:** not stored.
- **Spot reports:** shown to others for 30 minutes and deleted after 30
  days, or immediately when you delete your account.
- **Backups:** nightly database backups (on Cloudflare R2, encrypted at
  rest) are kept for 14 days, so deleted account data or reports can
  remain in a backup for up to 14 more days.
- **Server logs:** kept in rotating files of limited size (30 MB per
  service) that are overwritten as new entries arrive — usually within
  days.
- **Crash reports:** deleted by Sentry after at most 90 days.
- **Usage statistics:** deleted by PostHog after 12 months.

## 7. Your rights (GDPR)

You have the right to:
- **access** the personal data we hold about you,
- **correct** inaccurate data,
- **erase** your data — delete your account at any time in the App:
  **Settings (⚙︎) → Delete Account**; this also deletes all your spot
  reports,
- **restrict** or **object** to processing,
- **data portability** — receive your data in a portable format,
- **withdraw consent** at any time without affecting earlier processing:
  location in your device settings, crash reports and usage statistics in
  **Settings → Privacy**.

To exercise any of these rights, email [CONTACT EMAIL]. You also have the
right to complain to a data protection authority, for example the one
where you live.

## 8. Security

Connections between the App and our servers are encrypted (HTTPS/TLS),
passwords are stored only as hashes, and our database accepts no direct
connections from the App — all access goes through permission-checked
interfaces.

## 9. Children

FreiPark is not directed at children under 16, and we do not knowingly
collect data from children under 16.

## 10. Transfers outside the EU/EEA

Our own servers are in Germany. Cloudflare, GitHub, Vonage, Sentry and
PostHog are US-based companies (Sentry and PostHog store your data in
their EU regions); where data reaches the USA, the transfer relies on the
EU–US Data Privacy Framework or the European Commission's Standard
Contractual Clauses. Nominatim is run from the United Kingdom, which the
European Commission recognises as providing adequate protection.

## 11. Changes to this policy

We'll update the date at the top whenever this policy changes. For
material changes, we'll tell you in the App or by email before they take
effect.

## 12. Contact

Questions about this policy or your data: [CONTACT EMAIL]
