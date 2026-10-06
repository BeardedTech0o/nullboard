![nullboard](nullboard-banner.png)

# nullboard

A synced, signed-in kanban PWA built to keep you on one task. It self-hosts in Docker with SQLite (or runs as a Cloudflare Worker with D1), and installs on a phone, PC or Mac.

## The evening routine it is built for

Open it, see what is next, see where you are on that task, decide the next step. Ideas that turn up mid-task go in the inbox in two seconds, so they stop pulling you away.

- **Focus view** shows only the task you committed to today: status, steps, last note, time. One tap switches to the full board.
- **Inbox capture** is a button on every screen (or press `c`). Title only. Enter saves and keeps the box open.
- **Someday/Maybe** is a separate lane for low priority ideas.
- **Daily checklist** slides out on login. Editable, ticks reset every day.
- **Streak** records days you opened the board and ticked something off. Calm, no points.
- **Blocked tasks** link to the task they wait on and release themselves when it is finished.
- **Time** compares a rough estimate with time actually spent.
- **Archive** keeps completed and dropped tasks, searchable, with restore.
- **Weekly review** walks through the inbox, stale tasks and Someday/Maybe once a week.

Model: projects hold tiles (tasks); tiles have steps (subtasks), notes, and sit in a column (To Do, In Progress, Awaiting Sign-Off). Finishing a tile archives it, so there is no separate Completed column. Subtasks had been removed from the old app; they are back because the Focus view needs them.

## Stack

- One Worker (`worker/`), plain fetch router, no framework, no ORM. It serves `/api/*` and the static app in `public/`.
- D1 (`nullobj-db`, tables prefixed `nb_`). D1 is the source of truth; localStorage is a per-device cache with an outbox for offline edits. Sync is last-write-wins per record using server-calibrated timestamps.
- Frontend: plain ES modules, no build step. Design tokens and global classes are copied verbatim from the nullobj design system (`public/css/nullobj-tokens.css`); `app.css` only uses those custom properties. The typeface is overridden to Google Sans with the system stack as fallback.
- Auth: email and password (PBKDF2-SHA256), TOTP MFA with QR and manual key, ten one-time recovery codes, HS256 JWT in an HttpOnly SameSite=Strict cookie, reset by Resend email. Login, MFA and reset endpoints are rate limited per IP, and five failures per account in 15 minutes lock it out (identically for unknown emails). TOTP secrets are encrypted at rest. A reset never signs anyone in.
- Strict CSP (inline theme script allowed by hash, computed at runtime), HSTS, nosniff, frame-ancestors none, no referrer.

## Self-hosting on Proxmox (Docker, no domain)

The same Worker code runs on plain Node 22 with SQLite (`server/`). No npm dependencies. Use a VM, or an LXC with nesting enabled, that has Docker.

```bash
git clone https://github.com/BeardedTech0o/nullboard && cd nullboard
git checkout claude/nullboard-rebuild
cp .env.example .env
# edit .env: SITE_HOST (e.g. board.lan or the host's IP), SITE_URL (https://same-thing),
# ALLOWED_EMAILS, and two secrets from: openssl rand -hex 32  (JWT_SECRET, DATA_KEY)
docker compose up -d --build
```

Open `https://<SITE_HOST>`, create the account (your address must be in `ALLOWED_EMAILS`), scan the QR code, save the recovery codes.

**HTTPS without a domain.** Browsers only install a PWA and keep the secure cookie over HTTPS. Caddy issues a certificate from its own internal CA, so each device must trust that CA once:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Install `caddy-root.crt` on each device (iOS: open the file, install the profile, then Settings, General, About, Certificate Trust Settings, enable it). Make `SITE_HOST` resolve on your network (router DNS entry, `/etc/hosts`, or just use the IP).

If you use Tailscale, `tailscale serve` gives real certificates with nothing to install on phones; run the `app` service alone, publish its port, and set `SITE_URL` to the tailnet name.

**Password reset email.** Either set `RESEND_API_KEY`, or leave it empty with `LOG_RESET_LINKS=1`; the reset link then appears in `docker compose logs app`.

**Data and backups.** Everything lives in one SQLite file in the `nullboard-data` volume. Online backup: `docker compose exec app node server/backup.mjs /data/backup.db`, then copy it out (or use Proxmox VM backups). Updating: `git pull && docker compose up -d --build`; new migrations apply on start, applied ones never re-run.

Do not publish port 8787 directly. The app trusts the proxy for the client address (used by rate limiting), so only Caddy should reach it.

## Developing

```bash
npm install
cp .dev.vars.example .dev.vars
npm run migrate:local && npm run dev   # Cloudflare runtime locally, http://localhost:8787
npm test                               # NB_TARGET=node npm test runs the same suite on the self-hosted server
```

## Cloudflare (optional)

The Worker still deploys to Cloudflare if you ever want that: set the secrets in `wrangler.toml` with `wrangler secret put`, then `npm run deploy`. `routes` in `wrangler.toml` points at a custom domain; change or remove it.

## Moving your old boards

In the old standalone page's console run `copy(localStorage.getItem('ashcombe-kanban-v1'))`, then paste into Settings, Import. Ids are kept, so importing twice never duplicates. The old app is in `legacy/`.

