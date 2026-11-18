# Windows IIS hosting (e.g. SmarterASP.NET)

One IIS site runs everything: IIS's **HttpPlatformHandler** starts a bundled Python 3.12. It serves the API,
the WebSocket voice calls and the built dashboard from one process. The database is SQLite in `App_Data`.

Use this only on hosts that can't run Docker. It is a single-process setup: one app process, an SQLite file,
and in-memory call state. For anything larger, use `docker-compose.prod.yml`.

## Host requirements

The host must confirm all of these:

- HttpPlatformHandler is allowed, and `web.config` may start `python\python.exe`.
- The IIS WebSocket module is enabled.
- The app folder is writable (for `App_Data`).
- Outbound HTTPS/WSS to `api.sarvam.ai` is allowed.

## Build

```powershell
powershell -ExecutionPolicy Bypass -File infrastructure\iis\build-bundle.ps1
```

This creates `deploy\kural-iis\` and `deploy\kural-iis.zip`. `deploy\` is git-ignored because the bundle's
`.env` holds secrets.

- **First build:** generates `JWT_SECRET` and `ENCRYPTION_KEY`.
- **Before uploading:** fill in `SARVAM_API_KEY`, `CORS_ORIGINS`, `BOOTSTRAP_ADMIN_EMAIL` and
  `BOOTSTRAP_ADMIN_PASSWORD` (12+ characters) in `deploy\kural-iis\.env`, then run the script again to
  rebuild the zip. Rebuilds keep the existing `.env`.

## Deploy

1. Empty the site's root folder.
2. Upload the zip there and extract it. `web.config`, `serve.py`, `.env`, `python\` and `static\` must be at
   the root.
3. Recycle the site.
4. Open the site and sign in with the bootstrap admin. Then remove `BOOTSTRAP_ADMIN_PASSWORD` from the
   server's `.env`.

To update, upload a new zip but **keep `App_Data\`**, which holds the database. Startup logs are written to
`App_Data\logs\`.
