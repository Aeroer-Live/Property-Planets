# Deploying Property Planets to Cloudflare

Run these steps **in order** from your project folder. Use **Command Prompt** or **PowerShell**.

The app uses **Neon PostgreSQL** as the database and **Cloudflare Hyperdrive** to connect the Worker to Neon. You do **not** need to create a D1 database for the main application.

---

## 1. Log in to Cloudflare (if needed)

```bash
npx wrangler login
```

Complete the login in the browser. You only need to do this once per machine.

---

## 2. Set up Neon PostgreSQL

1. Create a project at **[Neon](https://neon.tech)** (or use an existing one).
2. In the Neon Console, open the **SQL Editor**.
3. Run the contents of **`NEON_FULL_SCHEMA.sql`** from this repo. This creates the `users` and `properties` tables and indexes.
4. In Neon, go to your project → **Connection details** and copy the **connection string** (e.g. `postgres://user:password@host/dbname?sslmode=require`). You will use it in the next step.

---

## 3. Create a Hyperdrive config (Cloudflare)

Hyperdrive connects your Worker to Neon with connection pooling.

1. Open **[Cloudflare Dashboard](https://dash.cloudflare.com)** → **Workers & Pages** → **Hyperdrive** (or **Overview** → **Hyperdrive**).
2. Click **Create configuration**.
3. **Database type:** PostgreSQL.
4. **Connection string:** Paste your Neon connection string from step 2.
5. Name the config (e.g. `property-planets-neon`) and create it.
6. Copy the **Hyperdrive config ID** (a hex string). You will add it to `wrangler.toml`.

---

## 4. Configure wrangler.toml

Open **`wrangler.toml`** and ensure the Hyperdrive binding is set:

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "YOUR_HYPERDRIVE_CONFIG_ID"
```

Replace **`YOUR_HYPERDRIVE_CONFIG_ID`** with the ID you copied in step 3. Save the file.

(The `[[d1_databases]]` block in `wrangler.toml` is optional and not used by the main app; the app uses Neon via Hyperdrive.)

---

## 5. Deploy the Worker

```bash
npm run deploy
```

(or: `npx wrangler deploy`)

When it finishes, you’ll see a URL like:

```
https://property-planets.<your-subdomain>.workers.dev
```

That is your live app URL.

---

## 6. Create the first admin (one-time)

1. Open: **`https://property-planets.<your-subdomain>.workers.dev/setup.html`**
2. Enter username, email, and password and submit.
3. Go to the main URL and log in with that admin account.

After that, you can use **Login**, **Register** (staff), **Dashboard**, **Properties**, and (as admin) **Pending** and **Users**.

---

## Optional: Custom domain

In the [Cloudflare dashboard](https://dash.cloudflare.com) → Workers & Pages → your worker → **Settings** → **Domains & Routes**, add a custom domain and follow the prompts.

---

## Troubleshooting

| Issue | What to do |
|--------|------------|
| `Authentication error` | Run `npx wrangler login` again. |
| `Neon/Hyperdrive not configured` | Ensure `wrangler.toml` has `[[hyperdrive]]` with `binding = "HYPERDRIVE"` and the correct `id`. The ID is from Cloudflare Dashboard → Hyperdrive → your config. |
| `Database connection` / timeouts | Check the Neon connection string in the Hyperdrive config; ensure Neon project is not paused; try recreating the Hyperdrive config. |
| 404 on pages | Worker serves assets from `public/`. Ensure `npm run deploy` completed and you’re opening the Workers URL (not a Pages URL unless you’ve set that up). |
| Tables don’t exist | Run **`NEON_FULL_SCHEMA.sql`** in the Neon SQL Editor for your database. |
