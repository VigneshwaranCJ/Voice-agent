# Deploy on Zoho Catalyst AppSail + Supabase

One AppSail service runs everything (API, WebSockets, dashboard) on Catalyst's managed **Python 3.12** runtime.
The database is **Supabase PostgreSQL**. No Docker is needed: the build folder already contains every dependency,
compiled for Linux.

## Know before you start

| Catalyst limit (from the AppSail docs) | Effect here |
|---|---|
| A request must finish within **30 seconds** (support can raise it) | Dashboard, text chat and the website widget are fine. A **voice call is one long WebSocket**, so it will be cut at 30 s unless Zoho raises the limit, and WebSocket support itself isn't documented. Test voice after the first deploy (step 6). |
| Instances stop when idle (after about 5 minutes) and cold-start on the next request | The first request after a quiet period is slower. Nothing is lost: data lives in Supabase. |
| Up to **5 instances**, local disk not persistent | SQLite can't be used (hence Supabase). Live chat/call state is per instance, so add **Redis** (`REDIS_URL`) for reliable multi-instance chats. |
| The app must listen within **10 seconds** of starting | Handled: the port opens immediately (≈2 s on a cold Linux start) and requests queue until the app is ready (≈8 s); Python is precompiled. |

## 1. Supabase database

1. Create a project at supabase.com. Region: **South Asia (Mumbai)**. Save the database password.
2. Open **Connect** (or Project Settings > Database) > **Connection string** > **Session pooler**. Copy it. It
   looks like `postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`.
3. Replace `[YOUR-PASSWORD]` and add `?sslmode=require` to the end.
   - Use the **Session** pooler (port 5432), not the Transaction pooler (6543), which breaks the asyncpg driver.
     The "Direct connection" is IPv6-only on the free plan.
   - If the password has special characters (`@ : / ?`), URL-encode them (e.g. `@` → `%40`).

Optional, recommended: create a free **Upstash Redis** database (region Mumbai) and copy its `rediss://…` URL.

## 2. Build the deploy folder (on your PC)

```powershell
powershell -ExecutionPolicy Bypass -File infrastructure\catalyst\build-catalyst.ps1
```

This creates `deploy\catalyst-app\` (the AppSail build path) and `deploy\catalyst-env.txt` (the settings to paste,
with fresh `JWT_SECRET` and `ENCRYPTION_KEY`). Re-running keeps `catalyst-env.txt`, so secrets stay the same.

## 3. Catalyst CLI and project

```powershell
npm install -g zcatalyst-cli
catalyst login            # India data centre accounts: catalyst login --dc in
mkdir D:\voice-agent\deploy\catalyst-project
cd D:\voice-agent\deploy\catalyst-project
catalyst init             # India: catalyst init --dc in
```

In `catalyst init`:

1. Pick (or create) your Catalyst project.
2. Choose **AppSail** > **Catalyst-Managed Runtime** > your own app.
3. Name: `kural`.
4. Build path: `D:\voice-agent\deploy\catalyst-app`.
5. Stack: **Python 3.12**.
6. Startup command: `python3 -u catalyst_serve.py`.

Then open the generated `app-config.json` and set `"memory": 1024`. The default 512 MB is tight for this app.

## 4. First deploy and settings

```powershell
catalyst deploy
```

The CLI prints the app URL (`https://kural-…development.catalystappsail.com`). Then, in the Catalyst console:

1. Go to AppSail > `kural` > **Configuration** > **Environment variables** (Development).
2. Add every variable from `deploy\catalyst-env.txt`:
   - `DATABASE_URL`: the Supabase string from step 1.
   - `SARVAM_API_KEY`: your key.
   - `CORS_ORIGINS` and `PUBLIC_BASE_URL`: the AppSail URL.
   - `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`: your first admin login.
   - `REDIS_URL`: optional.
3. Restart or redeploy the service (`catalyst deploy`).

On start the app creates the tables in Supabase, creates the admin, and serves the dashboard. Open the URL and
sign in, then remove `BOOTSTRAP_ADMIN_PASSWORD`.

## 5. Production

In the console, deploy the service to **Production**. Set the same environment variables for the Production
environment (they're separate per environment). The production URL is `https://kural-….catalystappsail.com`.

## 6. Test voice

Open the dashboard on the AppSail URL (it's HTTPS), go to **Voice** and start a call.

- **The agent greets you and keeps talking:** voice works.
- **The call can't connect, or drops at about 30 s:** ask Catalyst support (support@zohocatalyst.com):

  > Our AppSail service `kural` (project …) serves a WebSocket endpoint at `/api/v1/voice/ws` for live voice
  > calls lasting up to 30 minutes. Please confirm AppSail supports WebSocket upgrades, and raise the request
  > timeout for this service (currently 30 s) to 30 minutes.

## 7. Your domain (app.kuralai.com)

Catalyst maps **subdomains only** (not `kuralai.com` itself):

1. At your DNS provider (NameBright today), add a CNAME: host `app`, value `catalyst.cs.zohohost.com`.
2. In the Catalyst console (Production) > **Domain Mappings** > **Add Mapping**: enter `app.kuralai.com`. Catalyst
   shows a hash key.
3. Add a second CNAME: host `<hash_key>.app`, value `catalyst.cs.zohohost.com`. Then click **Verify**.
4. Email support@zohocatalyst.com asking for the free SSL certificate for `app.kuralai.com` (they say within
   48 hours). Then click **Apply**.
5. Add `https://app.kuralai.com` to `CORS_ORIGINS`, and set `PUBLIC_BASE_URL=https://app.kuralai.com`.

## Updating

Run the build script again, then `catalyst deploy` from `deploy\catalyst-project`. Data stays in Supabase.
