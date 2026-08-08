# mc-adventure-finder

**m+c sf adventure finder** — a San Francisco Bay Area events aggregator. It scrapes ~20 SF
venues and listing sites, stores everything in Firestore, and shows it as a single scannable
agenda. Live at **[mc-adventure-finder.onrender.com](https://mc-adventure-finder.onrender.com/)**.

Built with [Next.js](https://nextjs.org) (App Router) + Firestore, deployed on Render.

## How it works

```
Scrapers (GitHub Actions, every 2h)  ──►  Firestore "events"  ──►  Next.js API/UI (Render)
      lib/scrapers/*  +  scripts/scrape.ts        cache              /api/events → agenda
```

- **Scraping runs in GitHub Actions, not on the web server.** A scheduled workflow
  ([`.github/workflows/scrape.yml`](.github/workflows/scrape.yml)) runs [`scripts/scrape.ts`](scripts/scrape.ts)
  every 2 hours inside the runner (which has plenty of memory for headless Chrome) and writes
  results straight to Firestore. This keeps browser-heavy scraping off Render's small web
  instance, which was exceeding its memory limit when it tried to launch Chrome itself.
- **The web app only reads.** `GET /api/events` returns upcoming events from Firestore; the
  page never scrapes on load. The UI defaults to the next ~month with a "load more" for events
  further out, plus source and date filters. The **Refresh** button just re-reads Firestore.
- **Idempotent upserts.** Each event has a stable id (`sourceEventId`/`sourceUrl`), so re-scrapes
  update in place instead of creating duplicates.

## Sources

Music & clubs: The Independent, Bottom of the Hill, Rickshaw Stop, Cafe du Nord, Brick & Mortar,
Make-Out Room, 1015 Folsom, SFJazz, The Faight, Envelop · Comedy: Cobb's, Punch Line · Books &
talks: Green Apple Books, The Booksmith, Manny's · Art & film: Gray Area, The Castro Theatre ·
Sports: SF Giants, Golden State Warriors (home games) · Aggregator: Funcheap SF.

Several venues sit behind bot protection (Cloudflare / WAFs) or load events via internal JSON
APIs, so those scrapers drive a real browser via Playwright. See
[SCRAPER_TESTING.md](./SCRAPER_TESTING.md) for how to preview and add scrapers.

## Local development

```bash
npm install
npm run dev
# open http://localhost:3000/metime   (the app uses base path /metime by default)
```

Set env vars in `.env.local` (see [`.env.local.example`](./.env.local.example)) — Firebase client
config plus a Firebase Admin service account (`FIREBASE_SERVICE_ACCOUNT_PATH` or
`FIREBASE_SERVICE_ACCOUNT_KEY`) so the API can read/write Firestore.

> **Dropbox note:** this project lives in Dropbox, and Dropbox sync can make the Turbopack dev
> server hang on first compile. If it hangs, develop from a copy outside Dropbox
> (`cp -R "…/sf events" ~/mc-adventure-finder-local && cd ~/mc-adventure-finder-local && npm run dev`)
> and sync back via git.

## Running scrapers manually

```bash
npm run scrape                 # all sources → Firestore
npm run scrape -- --batch 3    # one batch (see lib/scrapers/batches.ts)
npm run scrape -- --dry-run    # fetch + parse only, no writes
```

Needs the same Firebase env as the app. To preview a single source's parsed output without
writing, use the test endpoint: `GET /api/scrape/test?sourceId=<id>` (see SCRAPER_TESTING.md).

The scheduled workflow reads its credentials from repo **Actions secrets**
(`FIREBASE_SERVICE_ACCOUNT_KEY`, `FIREBASE_PROJECT_ID`). You can also trigger it manually from the
GitHub **Actions** tab ("Scrape events into Firebase" → Run workflow), optionally for one batch.

## Deployment

Render builds and deploys automatically on push to `main` (`npm run build` / `npm start`). Set the
runtime env vars (Firebase config, service account) in the Render dashboard. See
[DEPLOY_RENDER.md](./DEPLOY_RENDER.md); a Hostinger path is documented in
[DEPLOY_HOSTINGER.md](./DEPLOY_HOSTINGER.md).

## Troubleshooting

### "The requested action is invalid" on Google sign-in

Firebase Auth shows this when the app's origin isn't allowed or the OAuth client is misconfigured:

1. **Firebase Console → Authentication → Sign-in method:** ensure **Google** is enabled.
2. **Authentication → Settings → Authorized domains:** add every host the app runs on (e.g.
   `localhost`, your production host) — host only, no scheme or port.
3. **Google Cloud Console → APIs & Services → Credentials → Web client:** add the app origins to
   **Authorized JavaScript origins**, and ensure **Authorized redirect URIs** includes
   `https://sf-events-aggregator.firebaseapp.com/__/auth/handler`.
4. **Env:** `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=sf-events-aggregator.firebaseapp.com` and the correct
   `NEXT_PUBLIC_FIREBASE_API_KEY`.

### Base path / hosting at weirdlittleideas.com/metime

The app uses `NEXT_PUBLIC_BASE_PATH=/metime` by default; set it empty to serve at the root. To host
under `weirdlittleideas.com/metime`, proxy/rewrite `/metime/:path*` to this app and add the domain
to Firebase **Authorized domains** + the Google OAuth client's **Authorized JavaScript origins**.
