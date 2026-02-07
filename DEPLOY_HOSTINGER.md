# Deploying mc-adventure-finder to Hostinger (metime folder)

Get the app live at **weirdlittleideas.com/metime** (or **metime.weirdlittleideas.com**) on Hostinger.

## What to upload

Upload **source code only** — no build output, no `node_modules`.

**Include:**
- `app/`
- `components/`
- `lib/`
- `public/`
- `types/`
- `package.json`
- `package-lock.json`
- `next.config.ts`
- `tsconfig.json`
- `postcss.config.mjs`
- `eslint.config.mjs`
- `auth.ts`
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc` (if you use them)

**Exclude:**
- `node_modules/`
- `.next/`
- `out/`
- `.env`, `.env.local`, `.env.production` (set these as env vars in hPanel instead)
- `firebase-service-account.json` (use Hostinger env vars or secure file upload per Hostinger docs)
- `.git/`, `.DS_Store`, `*.log`, `coverage/`

### Option A: Create zip from terminal (recommended)

From the **project root** (e.g. `sf events` or `mc-adventure-finder`):

```bash
# From project root
zip -r mc-adventure-finder.zip . \
  -x "node_modules/*" \
  -x ".next/*" \
  -x "out/*" \
  -x ".git/*" \
  -x "*.env*" \
  -x "firebase-service-account.json" \
  -x ".DS_Store" \
  -x "*.log" \
  -x "coverage/*"
```

Then upload `mc-adventure-finder.zip` in hPanel.

### Option B: Use .gitignore and zip the rest

If you use git, you can zip only tracked source files:

```bash
git archive -o mc-adventure-finder.zip HEAD
```

That excludes anything in `.gitignore` (including `node_modules`, `.next`, `.env*`). Add `firebase-service-account.json` to `.gitignore` if it’s not already, and **do not** commit it; set Firebase credentials via Hostinger env vars instead.

---

## Deploy in Hostinger

1. **hPanel** → **Websites** → **Add Website** → **Node.js Apps**.
2. Choose **Upload your website files** and upload `mc-adventure-finder.zip`.
3. **Build settings** (Hostinger usually detects Next.js):
   - Build command: `npm run build`
   - Start / run command: `npm start` (or whatever runs `next start`)
   - Node version: 18.x or 20.x.
4. **Environment variables** (in the app’s settings in hPanel):
   - `NEXT_PUBLIC_BASE_PATH=/metime`
   - All Firebase client vars: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, etc.
   - Firebase Admin: `FIREBASE_PROJECT_ID`, and either `FIREBASE_SERVICE_ACCOUNT_PATH` (if you upload the JSON to a path Hostinger allows) or `FIREBASE_SERVICE_ACCOUNT_KEY` (JSON string).
   - `AUTH_SECRET` (and optional `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` for calendar sync).
5. Deploy. The app will build and run on a **temporary Hostinger URL** first.

---

## Making it live at weirdlittleideas.com/metime

Hostinger typically gives each Node app a **temporary subdomain**. To serve the app under **weirdlittleideas.com**:

- **Subdomain (easiest):** Connect **metime.weirdlittleideas.com** to this Node app (hPanel: connect preferred domain/subdomain to the deployment). Then either:
  - Use the app as-is with `NEXT_PUBLIC_BASE_PATH=` (empty) so the app is at **https://metime.weirdlittleideas.com**, or
  - Keep `NEXT_PUBLIC_BASE_PATH=/metime` and connect the subdomain; the app will still work at the root of that subdomain (e.g. **https://metime.weirdlittleideas.com** with basePath `/metime` means the app is at **https://metime.weirdlittleideas.com/metime** — so for a subdomain you’d set `NEXT_PUBLIC_BASE_PATH=` so the app is at **https://metime.weirdlittleideas.com**).
- **Path /metime on main domain:** If you need **weirdlittleideas.com/metime** exactly, you may need to:
  - Use a reverse proxy or rewrite on the main site so `/metime` (and `/metime/*`) is served by this Node app, or
  - Ask Hostinger support how to attach a Node app to a **path** (e.g. `/metime`) on an existing domain.

So in short:
- For **https://metime.weirdlittleideas.com**: deploy the zip, set env vars, connect subdomain **metime.weirdlittleideas.com** to this app, and set `NEXT_PUBLIC_BASE_PATH=` (empty).
- For **https://weirdlittleideas.com/metime**: deploy the zip, set `NEXT_PUBLIC_BASE_PATH=/metime`, then configure the main domain (rewrite/proxy or Hostinger path option) so `/metime` points to this Node app.

---

## After deploy

- **Firebase Auth:** In Firebase Console → Authentication → **Authorized domains**, add:
  - The Hostinger URL (e.g. `metime.weirdlittleideas.com` or `weirdlittleideas.com`).
- In **Google Cloud Console** (OAuth client used by Firebase), add the same URL to **Authorized JavaScript origins**.
- Open the app URL and test sign-in and event list.

---

## Checklist

- [ ] Zip contains source only (no `node_modules`, no `.next`, no `.env`).
- [ ] All env vars set in hPanel (Firebase, `AUTH_SECRET`, `NEXT_PUBLIC_BASE_PATH`).
- [ ] Build command: `npm run build`; run command: `npm start`.
- [ ] Domain/subdomain connected to the Node app (or path configured for `/metime`).
- [ ] Firebase authorized domains and OAuth origins updated.
