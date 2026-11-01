# Phoenix Community Calendar

The community events board for **The Phoenix Catalyst**: neighbors share local events (snap a flyer or type it in), RSVP or volunteer, and get events straight into Google, Apple or Outlook calendars. *Bring color back into your world.*

Live at: https://thedragonflycatalyst.github.io/phoenix-events/

## How it works

- **Static web app** (no build step), installable to a phone's home screen. Hosted on GitHub Pages.
- **Accounts:** the shared Dragonfly account system (Supabase project `fkksaivdznqbfsfsagsj`). Sign in with username or email.
- **Poster scanning:** free and on-device. Tesseract.js reads the text, chrono-node finds dates and times, and `ocr.js` guesses the title, place, link, cost and category. Users confirm before posting.
- **Calendars:** the `phoenix-calendar` edge function serves iCalendar feeds:
  - `?event=<id>` one event · `?feed=all` all community events · `?feed=tpc` volunteer events · `?token=<private>` a user's own RSVPs (auto-updates)
- **Map:** Leaflet + OpenStreetMap; addresses are placed with Nominatim (free).
- **Moderation:** posts go live instantly. Moderators review new posts and user reports under *Review posts*. Admins assign roles under *Team roles*.
- **Donations:** set Stripe Payment Links from The Phoenix Catalyst's Stripe account in `config.js` (`DONATE_LINKS`).

## Database (Supabase, `phoenix_` prefix)

| Table / function | Purpose |
|---|---|
| `phoenix_events` | Events. A trigger forces safe values (owner, status, counts) and limits 20 new posts per user per day. |
| `phoenix_rsvps` | Going / volunteer sign-ups; counts kept on the event. Volunteer only on TPC events, capped by `volunteer_slots`. |
| `phoenix_flags` | User reports for moderators. |
| `phoenix_roles` | `admin`, `organizer` (official TPC events + volunteer roster), `moderator`. |
| `phoenix_calendar_tokens` | Private calendar-feed tokens. |
| `phoenix_search_events()` | Filtered search: dates, pillars, tags, cost, TPC-only, keywords, distance. |
| Storage `phoenix-posters` | Poster photos (public read; users write to their own folder). |

## Local preview

```sh
python3 -m http.server 8080   # then open http://localhost:8080
```
Add the site URL to Supabase **Authentication → URL Configuration → Redirect URLs** so sign-up and password-reset links return here.

## Going native later

The app is plain HTML/JS, so it can be wrapped with Capacitor for the App Store and Google Play without a rewrite.

## Releasing changes

Bump the `?v=` number in `index.html`, the imports at the top of `app.js`, and `sw.js` (cache name and file list) so browsers fetch the new files right away.

## Native app (`mobile/`)

The real Android/iPhone app, built with Expo (React Native). It shares the same Supabase database, accounts, calendar feeds and moderation as the web version, so both always show the same events.

- **Test builds:** every push to `mobile/` runs the *Android app* GitHub Action, which publishes an installable APK as the `android-preview` release.
- **Native features:** on-device flyer reading (Google ML Kit, free), add to the phone's calendar, event reminders, haptics, native maps (MapLibre + OpenFreeMap, free).
- **Local dev:** `cd mobile && npm install && npx expo run:android` (needs Android Studio), then `npx expo start`.
- **Checks:** `npx tsc --noEmit` and `npm run test:ocr`.
