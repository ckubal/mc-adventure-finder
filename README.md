**mc-adventure-finder** — SF Bay Area events aggregator (m+c sf adventure finder). Lives at [metime.weirdlittleideas.com](https://metime.weirdlittleideas.com) or weirdlittleideas.com/metime.  
→ **Render (recommended):** [DEPLOY_RENDER.md](./DEPLOY_RENDER.md) — use your existing Render account; no Hostinger upgrade.  
→ **Hostinger:** [DEPLOY_HOSTINGER.md](./DEPLOY_HOSTINGER.md) — requires Node.js–capable plan.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000/metime](http://localhost:3000/metime) with your browser to see the result (app uses base path `/metime` by default).

### If the dev server hangs (page never loads)

This project is in **Dropbox**. Dropbox sync can make the Next.js dev server hang on the first request because Turbopack does a lot of file I/O when compiling. **Run the app from a folder outside Dropbox**:

```bash
# Example: copy project to a local folder, then run from there
cp -R "/Users/ckubal/Dropbox/coding-projects-25/sf events" ~/mc-adventure-finder-local
cd ~/mc-adventure-finder-local
npm install
npm run dev
```

Then open http://localhost:3000/metime. Keep using Dropbox for backup; develop from the local copy and sync changes when you’re done (or use git to move code between the two).

### "The requested action is invalid" when signing in with Google

Firebase Auth shows this when the app’s origin isn’t allowed or the OAuth client is misconfigured. Fix it in the Firebase and Google Cloud consoles:

1. **Firebase Console** → [Authentication](https://console.firebase.google.com/project/sf-events-aggregator/authentication/providers) → **Sign-in method**: ensure **Google** is **Enabled** and has a Web client ID / secret (or use the same GCP project so it’s linked).

2. **Firebase Console** → Authentication → **Settings** (tab) → **Authorized domains**. Add every origin where the app runs, for example:
   - `localhost` (for `http://localhost:3000`)
   - Your production host (e.g. `your-app.vercel.app` or your custom domain)  
   No port or scheme—just the host.

3. **Google Cloud Console** → [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=sf-events-aggregator) → open the **Web client** used by Firebase:
   - **Authorized JavaScript origins**: add `http://localhost:3000` and your production URL (e.g. `https://your-app.vercel.app`).
   - **Authorized redirect URIs**: must include `https://sf-events-aggregator.firebaseapp.com/__/auth/handler` (Firebase usually adds this when you enable Google sign-in).

4. **Env**: Ensure `.env.local` has `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=sf-events-aggregator.firebaseapp.com` and the correct `NEXT_PUBLIC_FIREBASE_API_KEY` for project `sf-events-aggregator`.

After changing authorized domains or OAuth client settings, try signing in again in a new tab.

### Hosting at weirdlittleideas.com/metime

This project (**mc-adventure-finder**) is set up to live at `https://weirdlittleideas.com/metime`.

1. **Base path**  
   The app uses `NEXT_PUBLIC_BASE_PATH=/metime` by default (see `.env.local.example`). For production you can set the same in Vercel (or leave unset to use the default).

2. **Local dev**  
   Run `npm run dev` and open [http://localhost:3000/metime](http://localhost:3000/metime). To run at the root instead, set `NEXT_PUBLIC_BASE_PATH=` (empty) in `.env.local`.

3. **Point weirdlittleideas.com at this app**  
   - **Option A – Vercel:** Deploy this repo as the **mc-adventure-finder** project. In the *main* weirdlittleideas.com project, add a rewrite:
     - In the main project’s `vercel.json`:  
       `"rewrites": [{ "source": "/metime/:path*", "destination": "https://<mc-adventure-finder-vercel-url>/metime/:path*" }]`
   - **Option B – Same host/reverse proxy:** Proxy `/metime` to this app’s server.

4. **Firebase Auth**  
   Add `weirdlittleideas.com` to Firebase Console → Authentication → Settings → **Authorized domains**. In Google Cloud OAuth client, add `https://weirdlittleideas.com` to **Authorized JavaScript origins**.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
