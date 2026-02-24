# Property Planets

Property Rent Database Management System — web-based replacement for Excel/Sheets with role-based access, staff approval, and Cloudflare (Workers + D1).

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

### 2. Create D1 database (remote; optional for local)

```bash
npm run db:create
```

Copy the returned `database_id` into `wrangler.toml` under `[[d1_databases]]` → `database_id`.

### 3. Run migrations (local D1 for dev)

```bash
npm run db:migrate:local
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

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run Worker + assets locally |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run db:migrate` | Apply migrations (remote D1) |
| `npm run db:migrate:local` | Apply migrations (local D1) |

## Features

- **Roles:** Admin (full access), Staff (view + add properties; no delete/user management)
- **Staff registration:** Register → Pending → Admin approves or rejects
- **Properties:** CRUD with server-side search (name, owner, phone) and filter by location (Malaysia state); pagination
- **Audit:** Created By/At, Updated By/At on every property
- **Theme:** Light/dark mode; preference stored per user
- **Screens:** Login, Register, Dashboard, Property list/add/edit, Pending approvals, User management (admin)

## Deployment

1. Create D1 database: `npm run db:create` (if not done).
2. Set `database_id` in `wrangler.toml`.
3. Run `npm run db:migrate` (remote).
4. Run `npm run deploy`.
5. Call `POST /api/auth/setup` once to create the first admin (if DB is empty).
