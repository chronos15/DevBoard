# TaskBoard V169 — Windows Server + XAMPP + auto deploy from GitHub

This project is a Next.js 16 application. Do **not** copy it into `htdocs` as a static site.
Run Next.js as a local Node.js service and let Apache/XAMPP proxy the HTTPS domain to it.

## Final architecture

Internet -> Apache/XAMPP :443 -> http://127.0.0.1:3000 -> TaskBoard/Next.js

GitHub push to `main` -> GitHub Actions self-hosted runner on the Windows server
-> build -> new release -> restart TaskBoard Windows service -> health check
-> automatic rollback if the new release does not answer.

The current production service keeps running while the new build is prepared. The service is
restarted only after the build succeeds.

## 1. Prerequisites on Windows

Install:

- Git
- Node.js 20.9 or newer (the included workflow uses Node 22)
- XAMPP/Apache
- NSSM (default expected path: `C:\Tools\nssm\nssm.exe`)

Create:

```powershell
New-Item -ItemType Directory -Force C:\TaskBoard\config
New-Item -ItemType Directory -Force C:\TaskBoard\releases
New-Item -ItemType Directory -Force C:\TaskBoard\logs
```

Do not expose port 3000 to the internet. Only Apache should reach `127.0.0.1:3000`.

## 2. Export the Production environment from Vercel

On a trusted machine:

```powershell
npm install -g vercel
vercel login
cd C:\CAMINHO\DO\PROJETO
vercel link
vercel env pull .env.production.local --environment=production
```

Then edit:

```env
NEXT_PUBLIC_APP_URL=https://SEU-DOMINIO-REAL
```

Copy the resulting file to:

```text
C:\TaskBoard\config\.env.production.local
```

Important: Vercel variables marked **Sensitive** are non-readable after creation. If
`SUPABASE_SERVICE_ROLE_KEY` is Sensitive, obtain/rotate the server key from Supabase and put
the value directly into the server file.

The V169 source currently reads these application variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED
```

`TASKBOARD_VERSION`, `TASKBOARD_BUILD_DATE` and `TASKBOARD_BUILD_TIMEZONE` are optional build
metadata. The old `NEXT_PUBLIC_WEBRTC_STUN_URL` shown in some Vercel configurations is not read
by this V169 source; TURN/STUN reliability is handled by the Supabase Edge Function described
in `SUPABASE_SETUP.md`.

## 3. Configure Supabase Auth for the physical server

In Supabase Authentication URL Configuration, use the real HTTPS domain as Site URL and allow:

```text
https://SEU-DOMINIO-REAL/auth/callback
```

If the Vercel deployment will continue to exist, keep its callback URL allowed too.

## 4. Configure Apache/XAMPP

Use `deploy/apache/taskboard-vhost.conf.example` as the VirtualHost template.

Make sure Apache has `mod_proxy`, `mod_proxy_http`, `mod_headers`, `mod_rewrite` and SSL enabled.
Use a valid HTTPS certificate. PWA, notifications, camera/microphone and service worker behavior
should be served over HTTPS in production.

After editing Apache configuration:

```powershell
C:\xampp\apache\bin\httpd.exe -t
```

If syntax is OK, restart Apache from the XAMPP control panel.

## 5. Configure the GitHub self-hosted runner

In the GitHub repository:

Settings -> Actions -> Runners -> New self-hosted runner -> Windows x64

On the physical server, run the commands GitHub provides. Install the runner as a Windows
service when prompted.

For this private deployment, the runner account must have:

- read/write access to `C:\TaskBoard`
- permission to start/restart the `TaskBoard` service

Because a self-hosted runner executes repository workflow code on the server, protect the
production branch and do not run untrusted pull-request code on this production runner.

## 6. First deploy and every next deploy

This package already includes:

```text
.github/workflows/deploy-windows.yml
scripts/windows/deploy-taskboard.ps1
```

Push these files to `main`.

Every push to `main` will:

1. check out the commit on the physical server;
2. copy the private production env only temporarily for the build;
3. install dependencies;
4. run `npm run build`;
5. create `C:\TaskBoard\releases\<commit>`;
6. point the Windows service to the new release;
7. restart it;
8. test `http://127.0.0.1:3000/login`;
9. rollback automatically if the health check fails;
10. keep only recent releases.

The first successful workflow run also creates the `TaskBoard` NSSM service automatically.

## 7. Recommended repository improvement

This V169 package has no `package-lock.json`. The deployment script therefore falls back to
`npm install`. For reproducible deployments, run once in development:

```powershell
npm install
git add package-lock.json
git commit -m "Add npm lockfile"
git push
```

From then on, the server automatically uses `npm ci`.

## 8. Vercel Analytics

`app/layout.tsx` was adjusted so `<Analytics />` only loads when `VERCEL=1`.
This avoids self-hosted production trying to call Vercel-only Analytics routes.

You can keep Vercel and the Windows server active at the same time if desired.
