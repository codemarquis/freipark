# FreiPark Privacy Policy

**⚠️ Draft — not legal advice.** This is a starting point based on what the
app actually does (verified against the codebase, not assumed). Every
`[PLACEHOLDER]` below needs a real value, and given FreiPark targets EU
users (Germany) and handles account/location data, **have this reviewed
by someone qualified in GDPR compliance before publishing it** — this
draft is not a substitute for that review.

*Last updated: [DATE]*

---

## 1. Who this policy covers

This Privacy Policy explains how FreiPark ("we", "us", "the App")
collects, uses, and protects your information when you use the FreiPark
mobile app.

**Data controller:**
[LEGAL ENTITY NAME / YOUR NAME]
[ADDRESS]
[CONTACT EMAIL]

## 2. What data we collect

We collect only what the app actually needs to function — verified
against the app's own code, not a generic template:

### Account data
When you sign up, we collect:
- **Email address** (email sign-up) or **phone number** (phone sign-up)
- **Password** (stored as a secure hash — we never store or can see your
  actual password)

### Location data
With your permission (which you can decline or revoke at any time in
your device Settings), we collect your **device's location** to:
- Center the map on your current position
- Show parking spots near you
- Calculate directions to a spot you select

Location data is used to make requests to our own servers (for directions)
and is **not** continuously tracked in the background — only while you
have the app open and in use.

### Search queries
When you search for a location, your search text is sent to
**OpenStreetMap's Nominatim service** (a third-party, publicly-run
geocoding service) to find matching places. See § 4 below.

### Server logs
Like virtually all web services, our servers automatically log standard
technical information for security and debugging purposes (IP address,
request timestamp, requested endpoint). [CONFIRM RETENTION PERIOD — e.g.
"retained for 30 days, then deleted"].

### What we do **not** collect
- No advertising identifiers, no third-party analytics SDKs, no crash
  reporting SDKs, no ad networks — verified against the app's actual
  dependencies, not assumed
- No push notification tokens (the app does not send push notifications)
- No payment or card information (see § 5)
- No background/continuous location tracking

## 3. How we use your data

| Data | Purpose | Legal basis (GDPR) |
|---|---|---|
| Email/phone + password | Create and secure your account | Performance of a contract (Art. 6(1)(b)) |
| Location (while app is open) | Show nearby spots, calculate routes | Consent (Art. 6(1)(a)) — you grant this via the OS permission prompt |
| Search query text | Return matching locations | Performance of a contract (Art. 6(1)(b)) |
| Server logs | Security, abuse prevention, debugging | Legitimate interest (Art. 6(1)(f)) |

## 4. Who we share data with

- **OpenStreetMap Nominatim** — receives your search query text when you
  use the search feature. Nominatim's own privacy policy applies to that
  request: [https://operations.osmfoundation.org/policies/nominatim/](https://operations.osmfoundation.org/policies/nominatim/)
- **EasyPark / ParkNow** — if you tap a payment link for a paid spot, the
  App hands off to that provider's own app or website. We do not share
  your FreiPark account data with them — this is a plain link, not an
  API integration. Their own privacy policies govern what happens after
  you leave the FreiPark app.
- **No other third parties.** Parking spot location data, routing, and
  authentication are all served from infrastructure we operate ourselves
  — verified: no third-party backend-as-a-service, analytics, or
  advertising vendor receives your account or location data.

We do not sell your data to anyone, for any reason.

## 5. Payments

FreiPark does not process payments and does not collect payment card
information. For paid parking spots, we link out to the relevant
provider's (EasyPark/ParkNow) own app or website, where their payment
terms and privacy practices apply.

## 6. Data retention

- **Account data**: retained until you delete your account (see § 7)
- **Location data**: not stored after your session ends — used only to
  serve the immediate map/routing request
  [CONFIRM: if any location data is persisted anywhere, e.g. logs,
  disclose it here specifically]
- **Server logs**: [CONFIRM RETENTION PERIOD]

## 7. Your rights (GDPR)

If you are in the EU/EEA, you have the right to:
- **Access** the personal data we hold about you
- **Rectify** inaccurate data
- **Erase** your data ("right to be forgotten") — you can delete your
  account at any time from the app: tap your account button, then
  "Delete Account"
- **Restrict** or **object** to certain processing
- **Data portability** — receive your data in a portable format
- **Withdraw consent** (e.g., revoke location permission at any time in
  device Settings) without affecting the lawfulness of prior processing

To exercise any of these rights, contact us at [CONTACT EMAIL].

## 8. Data security

Your account data is stored on infrastructure we operate ourselves, with
industry-standard measures including encrypted connections (TLS/HTTPS)
between the app and our servers, and password hashing (we never store
plain-text passwords). [CONFIRM: add specifics if you want — e.g. hosting
location/jurisdiction, backup practices — once finalized.]

## 9. Children's privacy

FreiPark is not directed at children under 16, and we do not knowingly
collect data from children under that age. [CONFIRM AGE THRESHOLD FOR
YOUR JURISDICTION — 16 is the GDPR default but member states can set it
as low as 13.]

## 10. International data transfers

[CONFIRM: state where your servers are physically located, and whether
any data leaves the EU/EEA. If Nominatim or other third parties process
data outside the EU/EEA, that needs disclosure here too.]

## 11. Changes to this policy

We may update this policy from time to time. We'll update the "Last
updated" date above when we do, and for material changes we'll
[CONFIRM: describe how you'll notify users — e.g. in-app notice].

## 12. Contact us

Questions about this policy or your data: [CONTACT EMAIL]

---

**Reminder:** the `[CONFIRM ...]` and `[PLACEHOLDER]` markers above are
not optional — Apple's App Store review and GDPR both require this to be
accurate and complete, not templated boilerplate.
