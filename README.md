![nullboard](nullboard-banner.png)

# nullboard

A synced, signed-in kanban PWA built to keep you on one task. It runs as a single Cloudflare Worker with a D1 database, and installs on a phone, PC or Mac.

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

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars          # local secrets
npm run migrate:local
npm run dev                             # http://localhost:8787
npm test                                # API, sync, unit, browser and phone tests
```

Registration is closed unless the address is in `ALLOWED_EMAILS`.

### Deploy to board.nullobj.dev

```bash
npx wrangler secret put JWT_SECRET       # 32+ random characters
npx wrangler secret put DATA_KEY         # 32+ random characters; do not rotate casually
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ALLOWED_EMAILS   # comma separated
npm run deploy                           # stamps sw.js, applies new migrations, deploys
```

`.github/workflows/deploy.yml` does the same on push to `main` (needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets). Migrations live in `migrations/` and run through `wrangler d1 migrations apply`, which records each file and never replays it. To change the schema, add `0002_*.sql`; never edit an applied file.

In Resend, verify `nullobj.dev` and set `EMAIL_FROM` in `wrangler.toml`; the default sender only delivers to your own Resend address.

## Moving your old boards

In the old standalone page's console run `copy(localStorage.getItem('ashcombe-kanban-v1'))`, then paste into Settings, Import. Ids are kept, so importing twice never duplicates. The old app is in `legacy/`.

## Self-hosting

Everything is standard Workers, D1 and WebCrypto. `wrangler dev` runs the whole thing locally; set `RESEND_API_URL` to point reset email at any Resend-compatible relay.
