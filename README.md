# Property Planets

Property database management system — web-based replacement for Excel/Sheets with role-based access, staff approval, and Cloudflare (Workers + D1).

## Stack

- **Frontend:** HTML, CSS, JavaScript (vanilla)
- **API:** Cloudflare Workers (Hono)
- **Database:** Cloudflare D1 (SQLite)
- **Hosting:** Cloudflare (Worker serves API + static assets)

## Local development

### 1. Install dependencies

```bash
npm install
```

### 2. Create D1 database (optional for local dev)

```bash
npm run db:create
```

Copy the returned `database_id` into `wrangler.toml` under `[[d1_databases]]` → `database_id`.

### 3. Run migrations

For local development (SQLite file in `.wrangler/`):

```bash
npm run db:migrate:local
```

For a remote D1 database (e.g. before deploy), use:

```bash
npm run db:migrate
```

### 4. Start dev server

```bash
npm run dev
```

Open [http://localhost:8787](http://localhost:8787).

### 5. Create first admin (one-time)

When the app has no users, open **[http://localhost:8787/setup.html](http://localhost:8787/setup.html)** and create the first admin account. Then log in at the main app.

Alternatively via API:

```bash
curl -X POST http://localhost:8787/api/auth/setup -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"your-secure-password\",\"email\":\"admin@example.com\"}"
```

## Bulk import (millions of rows)

Excel has a **~1.05 million row limit** per sheet. For **14 million or more** property records:

1. **Split data** into multiple CSV files (e.g. 1 million rows each, or any size). Save from Excel as **CSV UTF-8** (File → Save As → CSV UTF-8).
2. **Use the bulk import script** (connects directly to Neon; no browser/Worker timeout):
   ```bash
   node scripts/bulk-import-properties.js --conn "postgres://user:pass@host/db?sslmode=require" --created-by 1 --file part1.csv --file part2.csv
   ```
   Or point at a folder of CSVs:
   ```bash
   node scripts/bulk-import-properties.js --conn "postgres://..." --created-by 1 --dir ./my-csv-folder
   ```
   Get the **Neon connection string** from Neon Console → your project → Connection string. Use **created-by** = an existing user ID in your app (e.g. `1` for the first admin).
3. **Web import** remains available for smaller batches (up to 50,000 rows per file) from the Properties page.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run Worker + static assets locally |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run db:create` | Create D1 database (remote) |
| `npm run db:migrate` | Apply migrations (remote D1) |
| `npm run db:migrate:local` | Apply migrations (local D1) |
| `npm run db:studio` | Open D1 CLI for local DB (execute commands) |
| `node scripts/bulk-import-properties.js` | Bulk import from CSV into Neon (see above) |

## Features

- **Roles:** Admin (full access), Staff (view + add properties; no delete/user management)
- **Staff registration:** Register → Pending → Admin approves or rejects
- **Properties**
  - CRUD with **quick search** (single bar: name, owner, phone, IC)
  - **Search Builder:** multiple conditions (column, operator, value), And/Or, add/remove rows
  - **CSV import** (Admin): upload CSV with Property Name, Owner, Phone 01 (optional: Phone 02, IC Number). Up to **50,000 rows per file** in the web UI. For **millions of rows**, use the bulk import script (see below).
  - **Export to Excel:** download current search results as `.xlsx` (up to 5,000 rows)
  - Pagination; audit fields: Created By/At, Updated By/At
- **Theme:** Light/dark mode; preference stored per user
- **Screens:** Login, Register, Dashboard, Property list/add/edit, Pending approvals, User management (Admin)

## Deployment to Cloudflare

See **[DEPLOY.md](./DEPLOY.md)** for step-by-step instructions:

1. `npx wrangler login` (if needed)
2. `npx wrangler d1 create property-planets-db` → copy `database_id`
3. Put `database_id` in `wrangler.toml`
4. `npm run db:migrate` (remote D1)
5. `npm run deploy`
6. Open `https://<your-worker>.workers.dev/setup.html` to create the first admin
