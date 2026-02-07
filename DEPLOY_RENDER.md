# Deploying mc-adventure-finder on Render

Use your existing Render account so you don’t need to upgrade Hostinger. The app runs as a **Web Service** (Node).

## 1. Push your code to GitHub

If the project isn’t in a repo yet:

- Create a repo (e.g. `mc-adventure-finder`).
- Push your project (no need to commit `node_modules`, `.next`, or `.env*`; keep secrets out of the repo).

## 2. Create a Web Service on Render

1. **Dashboard** → **New +** → **Web Service**.
2. Connect the repo (GitHub/GitLab) and select the **mc-adventure-finder** repo.
3. **Configure:**
   - **Name:** `mc-adventure-finder` (or any name).
   - **Region:** Pick one (e.g. Oregon).
   - **Branch:** `main` (or your default).
   - **Runtime:** **Node**.
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance type:** Free or paid, depending on your plan.

4. **Environment** (add in the Render dashboard):
   - `NODE_VERSION` = `20` (optional; Render often defaults to a recent LTS).
   - **Firebase (client):**  
     `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`
   - **Firebase Admin:**  
     `FIREBASE_PROJECT_ID`, and either:
     - `FIREBASE_SERVICE_ACCOUNT_KEY` = full JSON string of the service account key, or  
     - `FIREBASE_SERVICE_ACCOUNT_PATH` if you add the file via a different mechanism (Render doesn’t support arbitrary file uploads the same way; JSON in env is usual).
   - **Auth:**  
     `AUTH_SECRET` (required).  
     Optional: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` for calendar sync.
   - **Base path:**
     - If you’ll use **metime.weirdlittleideas.com** (recommended): set `NEXT_PUBLIC_BASE_PATH` = *(leave empty)* so the app is at the root of that subdomain.
     - If you’ll use only the default Render URL and want the app under `/metime`: set `NEXT_PUBLIC_BASE_PATH` = `/metime`. Then the app will be at `https://<your-service>.onrender.com/metime`.

5. Click **Create Web Service**. Render will install, build, and start the app. The service URL will look like `https://mc-adventure-finder-xxxx.onrender.com`.

## 3. Custom domain: metime.weirdlittleideas.com (recommended)

So the app lives at **https://metime.weirdlittleideas.com** without paying for a Hostinger upgrade:

1. **Render:** In your Web Service → **Settings** → **Custom Domains** → **Add Custom Domain** → enter `metime.weirdlittleideas.com`. Render will show the CNAME target (e.g. `mc-adventure-finder-xxxx.onrender.com`).
2. **DNS (where weirdlittleideas.com is managed):** Add a **CNAME** record:
   - **Name/host:** `metime`
   - **Target/value:** the Render hostname (e.g. `mc-adventure-finder-xxxx.onrender.com`).
3. Leave **NEXT_PUBLIC_BASE_PATH** **empty** in Render so the app is served at the root of `metime.weirdlittleideas.com` (i.e. `https://metime.weirdlittleideas.com/`).
4. Wait for DNS to propagate; Render will issue SSL for `metime.weirdlittleideas.com`.

## 4. Firebase

- **Firebase Console** → Authentication → **Authorized domains** → add `metime.weirdlittleideas.com` (and your Render URL if you want to test before adding the custom domain).
- **Google Cloud Console** (OAuth client used by Firebase) → **Authorized JavaScript origins** → add `https://metime.weirdlittleideas.com`.

## 5. Optional: `render.yaml` (Blueprint)

The repo includes a **render.yaml** that sets the same build/start commands and Node version. You can:

- Use **Blueprint** deploy: **New +** → **Blueprint** → connect repo and Render will read `render.yaml`, or  
- Ignore it and create the Web Service manually as in step 2; the result is the same.

## Summary

| Step | Action |
|------|--------|
| 1 | Push code to GitHub. |
| 2 | Render → New Web Service → connect repo, Build: `npm install && npm run build`, Start: `npm start`. |
| 3 | Add all env vars (Firebase, AUTH_SECRET, leave NEXT_PUBLIC_BASE_PATH empty for metime subdomain). |
| 4 | Add custom domain `metime.weirdlittleideas.com` in Render; add CNAME `metime` → your Render URL in DNS. |
| 5 | Add `metime.weirdlittleideas.com` to Firebase authorized domains and OAuth origins. |

You keep Hostinger for weirdlittleideas.com (or other sites) and run mc-adventure-finder on Render at **metime.weirdlittleideas.com** on your existing plan.
