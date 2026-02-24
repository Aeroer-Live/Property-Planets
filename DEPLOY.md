# Deploying Property Planets to Cloudflare

Run these steps **in order** from your project folder. Use **Command Prompt** or **PowerShell** (or double‑click `deploy.bat` and follow the prompts).

**Quick option (Windows):** Double‑click **`deploy.bat`** in the project folder. It will create the DB, pause so you can paste `database_id` into `wrangler.toml`, then run migrations and deploy.

---

## 1. Log in to Cloudflare (if needed)

```bash
npx wrangler login
```

Browser will open; complete the login. You only need to do this once per machine.

---

## 2. Create the D1 database

```bash
npx wrangler d1 create property-planets-db
```

You’ll see output like:

```
✅ Successfully created DB 'property-planets-db'
[[d1_databases]]
binding = "DB"
database_name = "property-planets-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the **`database_id`** value (the UUID).

---

## 3. Put the database ID in wrangler.toml

Open `wrangler.toml` and replace `YOUR_D1_DATABASE_ID` with the UUID you copied:

```toml
[[d1_databases]]
binding = "DB"
database_name = "property-planets-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Save the file.

---

## 4. Apply migrations to the remote D1 database

```bash
npm run db:migrate
```

(or: `npx wrangler d1 migrations apply property-planets-db`)

This creates the `users` and `properties` tables in your Cloudflare D1 database.

---

## 5. Deploy the Worker

```bash
npm run deploy
```

(or: `npx wrangler deploy`)

When it finishes, you’ll get a URL like:

```
https://property-planets.<your-subdomain>.workers.dev
```

That is your live app URL.

---

## 6. Create the first admin (one-time)

1. Open: **`https://property-planets.<your-subdomain>.workers.dev/setup.html`**
2. Enter username, email, and password and submit.
3. Go to the main URL and log in with that admin account.

After that, you can use **Login**, **Register** (staff), **Dashboard**, **Properties**, and (as admin) **Pending** and **Users** as in the spec.

---

## Optional: Custom domain

In the [Cloudflare dashboard](https://dash.cloudflare.com) → Workers & Pages → your worker → **Settings** → **Domains & Routes**, add a custom domain and follow the prompts.

---

## Troubleshooting

| Issue | What to do |
|--------|------------|
| `Authentication error` | Run `npx wrangler login` again. |
| `Database not found` | Ensure `database_id` in `wrangler.toml` matches the DB you created and you ran `npm run db:migrate`. |
| `Migrations failed` | Run `npm run db:migrate` again; check that the database name in the command is `property-planets-db`. |
| 404 on pages | Worker serves assets from `public/`. Ensure `npm run deploy` completed and you’re opening the Workers URL (not a Pages URL unless you’ve set that up). |
