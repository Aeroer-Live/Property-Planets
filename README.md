# Property Planets

**Property Planets** is a web-based property database management system. It replaces spreadsheets (e.g. Excel) with a secure, role-based application where staff can register, admins approve users, and everyone can search, add, edit, and manage property records at scale.

---

## Overview

- **Purpose:** Manage property records (owner, contacts, IC, etc.) with search, filters, CSV import/export, and full audit (who created/updated what).
- **Users:** Two roles — **Admin** (full access, user management, approvals) and **Staff** (view/add properties, no delete or user management). New staff register and wait for admin approval (Pending list).
- **Scale:** The app supports large datasets: web CSV import up to 50,000 rows per file, and a separate bulk-import script for millions of rows directly into the database.

---

## Technology Stack

| Layer | Technology |
|--------|------------|
| **Frontend** | HTML, CSS, JavaScript (vanilla) — no framework; static files served by the same Worker. |
| **Backend / API** | **TypeScript** — runs on **Cloudflare Workers** (serverless). |
| **API framework** | **Hono** — lightweight web framework for routes, middleware, CORS, and security headers. |
| **Database** | **Neon** — serverless **PostgreSQL**. All application data (users, properties) is stored in Neon. |
| **Database access from Workers** | **Cloudflare Hyperdrive** — connection pooler that connects Workers to your Neon database efficiently and securely. |
| **Hosting** | **Cloudflare** — one Worker serves both the REST API and the static frontend (HTML/CSS/JS). |

### Why this stack?

- **Cloudflare Workers:** Global edge runtime; low latency, no servers to manage, pay-per-request.
- **Neon PostgreSQL:** Familiar SQL, scalable, branching and backups; ideal for structured property and user data.
- **Hyperdrive:** Connects Workers to Neon with connection pooling and caching so each request gets a fast, reliable database connection without opening a new one every time.

---

## Architecture and Request Flow

```
┌─────────────┐     HTTPS      ┌─────────────────────────────────────┐     Hyperdrive      ┌──────────────────┐
│   Browser   │ ──────────────► │   Cloudflare Worker (Property Planets) │ ─────────────────► │  Neon PostgreSQL │
│ (HTML/JS)   │                 │   • Hono API (/api/auth, /api/users,  │     (pooled        │  • users         │
│             │ ◄────────────── │     /api/properties)                   │      connection)   │  • properties    │
└─────────────┘   JSON / HTML   │   • Static assets (/, /login.html, …)  │                    └──────────────────┘
                                └─────────────────────────────────────┘
```

1. **Browser** loads the app from the Worker (e.g. `index.html`, `login.html`, `properties.html`).
2. **Frontend** calls **REST API** on the same origin (`/api/auth/*`, `/api/users/*`, `/api/properties/*`) with cookies for auth.
3. **Worker** (Hono) validates the JWT cookie, then uses **Hyperdrive** to get a connection string and runs queries with the **`pg`** (node-postgres) client against **Neon**.
4. **Neon** holds all persistent data; **Hyperdrive** handles connection pooling and optional caching so the Worker does not open a new TCP connection to Neon on every request.

---

## Project Structure

```
Property-Planets/
├── public/                    # Static frontend (served by Worker)
│   ├── index.html             # Landing / redirect
│   ├── login.html             # Login page
│   ├── register.html          # Staff registration
│   ├── setup.html             # First-time admin creation (no users yet)
│   ├── dashboard.html         # Dashboard after login
│   ├── properties.html        # Property list, search, filters, import/export
│   ├── property-add.html      # Add new property
│   ├── property-edit.html     # View / edit property
│   ├── pending.html           # Admin: approve/reject pending users
│   ├── users.html             # Admin: user management (edit/delete)
│   ├── css/
│   │   └── styles.css         # Global styles (light/dark theme)
│   ├── js/
│   │   ├── api.js             # API client (fetch, credentials)
│   │   └── auth.js             # Auth state, login/logout, theme
│   └── images/
│       └── logo.png
├── worker/                    # Cloudflare Worker (TypeScript)
│   ├── index.ts               # Hono app, routes, static asset fallback
│   ├── types.ts               # Env, User, Property, JwtPayload
│   ├── db.ts                  # withClient() — Hyperdrive → Neon via pg
│   ├── middleware.ts          # JWT auth, requireAdmin, getJwtSecret
│   ├── lib/
│   │   └── auth.ts            # Password hashing, JWT sign/verify
│   ├── auth.ts                # /api/auth (login, register, setup, logout, theme)
│   ├── users.ts               # /api/users (list, me, PATCH, DELETE)
│   └── properties.ts          # /api/properties (CRUD, search, import, export)
├── scripts/
│   ├── bulk-import-properties.js   # CLI: import huge CSVs into Neon (direct pg)
│   └── copy-logo.js                # Copy logo into public before dev/deploy
├── migrations/                # (Optional) D1 migrations; app uses Neon + Hyperdrive
├── NEON_FULL_SCHEMA.sql       # Full Neon schema — run once in Neon SQL Editor
├── wrangler.toml              # Worker config: name, assets, Hyperdrive binding
├── package.json               # Scripts: dev, deploy, db:* (D1), dependencies
├── DEPLOY.md                  # Step-by-step deployment (Cloudflare + Neon)
└── README.md                  # This file
```

- **Frontend:** Static HTML/CSS/JS in `public/`; no build step. The Worker serves these files and the app uses the same origin for API calls.
- **Backend:** All API and auth logic live in `worker/` (TypeScript). Database access goes through `worker/db.ts`, which uses the **Hyperdrive** binding to get a connection string and then uses **Neon** (PostgreSQL) for every query.

---

## Database: Neon PostgreSQL

The application uses **Neon** as its only primary database for users and properties.

### Schema (run once in Neon)

The file **`NEON_FULL_SCHEMA.sql`** defines the full schema. Run it once in the **Neon Console → SQL Editor** (or via `psql`) to create:

- **`users`** — id, username, first_name, last_name, phone, email, password (hashed), role (Admin/Staff), status (Pending/Active/Rejected), theme_preference, created_at, approved_by, approved_at.
- **`properties`** — id, property_name, property_owner_name, phone_01, phone_02, ic_number, created_by, created_at, updated_by, updated_at.

Indexes are included for search and lookups. No application data is stored in Cloudflare D1; D1 is not used for the main app flow.

### How the Worker connects to Neon: Hyperdrive

Workers cannot hold long-lived TCP connections. **Cloudflare Hyperdrive** sits between the Worker and Neon:

1. In the **Cloudflare dashboard**, you create a **Hyperdrive** config and point it to your **Neon** database (connection string from Neon Console).
2. In **`wrangler.toml`** you add a `[[hyperdrive]]` binding (e.g. `binding = "HYPERDRIVE"`) and attach that Hyperdrive config by ID.
3. At runtime, the Worker reads `env.HYPERDRIVE.connectionString` and passes it to the **`pg`** client in **`worker/db.ts`**. Every API request that needs the database calls `withClient(env, async (client) => { ... })`, which opens a connection, runs your queries, and closes it. Hyperdrive handles pooling and optional caching on the Cloudflare side.

So: **coding language** for the backend is **TypeScript**; **database** is **Neon PostgreSQL**; **integration with Cloudflare** is **Workers + Hyperdrive** (Worker talks to Neon via Hyperdrive’s connection string).

---

## Cloudflare Integration (Summary)

| Component | Role |
|-----------|------|
| **Cloudflare Workers** | Run the Hono app: serve the REST API and static assets (HTML/CSS/JS) from `public/`. |
| **Assets binding** | `assets = { directory = "public", binding = "ASSETS" }` — Worker serves files from `public/` for non-API routes. |
| **Hyperdrive** | Provides a pooled connection string from the Worker to your Neon PostgreSQL database; configured in the dashboard and bound in `wrangler.toml`. |
| **Wrangler** | CLI for local dev (`wrangler dev`) and deploy (`wrangler deploy`). |

The app is **one Worker**: same URL for the website and the API. No separate “frontend host” or “API host.”

---

## Features (for the client)

- **Authentication:** Login, logout, JWT in HTTP-only cookie; first-time setup creates the first admin.
- **Roles:** Admin (full access); Staff (view/add properties; no delete, no user management).
- **Staff registration:** New users register; they appear in **Pending** until an Admin approves or rejects.
- **Properties:**
  - List with **quick search** (single bar: name, owner, phone, IC).
  - **Search Builder:** multiple conditions (column, operator, value), And/Or.
  - Add / edit / delete (delete only for Admin).
  - **CSV import (web):** Admin uploads CSV (Property Name, Owner, Phone 01; optional Phone 02, IC). Up to **50,000 rows per file** in the UI.
  - **Export to Excel:** download current search results as `.xlsx` (e.g. up to 5,000 rows).
  - Pagination; audit fields: Created By/At, Updated By/At.
- **User management (Admin):** List users; edit password, email, phone; delete users (except self).
- **Theme:** Light/dark mode; preference stored per user in Neon.
- **Bulk import (millions of rows):** Use the Node script with Neon connection string and CSV files; see **Bulk import** below.

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Database (Neon + Hyperdrive)

- Create a **Neon** project at [neon.tech](https://neon.tech) and run **`NEON_FULL_SCHEMA.sql`** in the SQL Editor.
- In **Cloudflare Dashboard** → Workers & Pages → **Hyperdrive**, create a config that points to your Neon connection string.
- In **`wrangler.toml`**, set the Hyperdrive binding and reference your Hyperdrive config (e.g. `id = "..."`). The Worker uses this to get the Neon connection via Hyperdrive.

### 3. Start the dev server

```bash
npm run dev
```

Open [http://localhost:8787](http://localhost:8787).

### 4. First admin (one-time)

When there are no users, open **[http://localhost:8787/setup.html](http://localhost:8787/setup.html)** and create the first admin. Then log in from the main app.

---

## Deployment to Cloudflare

See **[DEPLOY.md](./DEPLOY.md)** for step-by-step instructions. In short:

1. **Neon:** Schema applied (e.g. run `NEON_FULL_SCHEMA.sql`).
2. **Cloudflare:** Wrangler login, create Hyperdrive config for Neon, add binding in `wrangler.toml`.
3. Deploy: `npm run deploy`.
4. Open `https://<your-worker>.workers.dev/setup.html` to create the first admin if needed.

---

## Bulk import (millions of rows)

For very large datasets (e.g. 14M+ rows), use the **bulk import script** (direct connection to Neon; no browser/Worker timeout):

```bash
node scripts/bulk-import-properties.js --conn "postgres://user:pass@host/db?sslmode=require" --created-by 1 --file part1.csv --file part2.csv
```

Or a folder of CSVs:

```bash
node scripts/bulk-import-properties.js --conn "postgres://..." --created-by 1 --dir ./my-csv-folder
```

- **Neon connection string:** From Neon Console → your project → Connection string (direct, not Hyperdrive).
- **`--created-by`:** An existing user ID in the app (e.g. `1` for the first admin).
- **CSV:** First row = headers. Required: Property Name (or Name), Owner, Phone 01. Optional: Phone 02, IC Number. Save as CSV UTF-8.

Web import remains available for smaller batches (up to 50,000 rows per file) from the Properties page.

---

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Run Worker + static assets locally (Wrangler dev). |
| `npm run deploy` | Deploy Worker and assets to Cloudflare. |
| `npm run copy-logo` | Copy logo into `public/` (runs before dev/deploy). |
| `npm run db:create` | Create D1 database (optional; app uses Neon). |
| `npm run db:migrate` | Apply D1 migrations (optional). |
| `npm run db:migrate:local` | Apply D1 migrations locally (optional). |
| `npm run db:studio` | D1 CLI for local DB (optional). |
| `node scripts/bulk-import-properties.js` | Bulk import from CSV into Neon (see above). |

---

## Summary for the Client

- **What it is:** A web app to manage property records with roles (Admin/Staff), approval flow, search, filters, CSV import/export, and optional bulk import for millions of rows.
- **Coding languages:** **TypeScript** (backend/API on Cloudflare Workers), **HTML/CSS/JavaScript** (frontend, no framework).
- **Integration with Cloudflare:** The app runs entirely on **Cloudflare Workers** (one Worker serves both the API and the static site). **Cloudflare Hyperdrive** connects the Worker to your **Neon PostgreSQL** database with connection pooling.
- **Database:** **Neon PostgreSQL** stores all users and properties; schema is in **`NEON_FULL_SCHEMA.sql`**. The Worker talks to Neon only via Hyperdrive’s connection string.
- **Full structure and flow:** Frontend in `public/`, backend in `worker/`, database in Neon; request flow: Browser → Worker (Hono) → Hyperdrive → Neon, as described in the **Architecture and Request Flow** section above.

For deployment details and troubleshooting, see **[DEPLOY.md](./DEPLOY.md)**.
