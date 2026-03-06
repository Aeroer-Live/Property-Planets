import { Hono } from 'hono';
import { hashPassword, verifyPassword, signJwt } from './lib/auth';
import { getJwtSecret } from './middleware';
import { withClient } from './db';
import type { Env, Variables } from './types';

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function authErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

authRoutes.post('/login', async (c) => {
  try {
    const body = await c.req.json<{ username: string; password: string }>();
    const { username, password } = body || {};
    if (!username || !password) {
      return c.json({ error: 'Username and password required' }, 400);
    }
    const row = await withClient(c.env, async (client) => {
      const r = await client.query(
        'SELECT id, username, password, role, status, theme_preference FROM users WHERE username = $1',
        [username]
      );
      return r.rows[0];
    });
    if (!row) {
      return c.json({ error: 'Invalid username or password' }, 401);
    }
    const status = row.status as string;
    if (status !== 'Active') {
      return c.json({ error: 'Account is pending approval or has been rejected' }, 403);
    }
    const ok = await verifyPassword(password, row.password as string);
    if (!ok) {
      return c.json({ error: 'Invalid username or password' }, 401);
    }
    const token = await signJwt(
      { sub: String(row.id), role: row.role as string },
      getJwtSecret()
    );
    const isSecure = new URL(c.req.url).protocol === 'https:';
    const maxAge = 7 * 24 * 60 * 60; // 7 days
    const cookie = `token=${token}; Path=/; Max-Age=${maxAge}; SameSite=Strict${isSecure ? '; Secure' : ''}; HttpOnly`;
    const userId = typeof row.id === 'bigint' || typeof row.id === 'number' ? Number(row.id) : Number(String(row.id));
    return c.json(
      {
        token,
        user: {
          id: userId,
          username: String(row.username),
          role: String(row.role),
          theme_preference: String(row.theme_preference || 'light'),
        },
      },
      200,
      { 'Set-Cookie': cookie }
    );
  } catch (e) {
    const msg = authErr(e);
    return c.json({ error: msg || 'Login failed' }, 500);
  }
});

authRoutes.post('/setup', async (c) => {
  try {
    const body = await c.req.json<{ username: string; password: string; email: string }>();
    const { username, password, email } = body || {};
    if (!username?.trim() || !password || !email?.trim()) return c.json({ error: 'username, password, email required' }, 400);
    if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
    const hashed = await hashPassword(password);
    await withClient(c.env, async (client) => {
      const existing = await client.query('SELECT id FROM users LIMIT 1');
      if (existing.rows.length > 0) throw new Error('SETUP_DONE');
      await client.query(
        `INSERT INTO users (username, first_name, last_name, phone, email, password, role, status) VALUES ($1, 'Admin', 'User', '', $2, $3, 'Admin', 'Active')`,
        [username.trim(), email.trim(), hashed]
      );
    });
    return c.json({ message: 'First admin created. You can now log in.' }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'SETUP_DONE') return c.json({ error: 'Setup already completed' }, 400);
    return c.json({ error: authErr(e) }, 500);
  }
});

authRoutes.post('/register', async (c) => {
  const body = await c.req.json<{
    username: string;
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
    password: string;
    confirm_password: string;
  }>();
  const { username, first_name, last_name, phone, email, password, confirm_password } = body || {};
  if (!username?.trim() || !first_name?.trim() || !last_name?.trim() || !phone?.trim() || !email?.trim() || !password || !confirm_password) {
    return c.json({ error: 'All fields are required' }, 400);
  }
  if (password !== confirm_password) {
    return c.json({ error: 'Password and confirmation do not match' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }
  const hashed = await hashPassword(password);
  try {
    await withClient(c.env, async (client) => {
      const existingUser = await client.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username.trim(), email.trim()]);
      if (existingUser.rows.length > 0) throw new Error('USER_EXISTS');
      await client.query(
        `INSERT INTO users (username, first_name, last_name, phone, email, password, role, status) VALUES ($1, $2, $3, $4, $5, $6, 'Staff', 'Pending')`,
        [username.trim(), first_name.trim(), last_name.trim(), phone.trim(), email.trim(), hashed]
      );
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'USER_EXISTS') return c.json({ error: 'Username or email already registered' }, 409);
    throw e;
  }
  return c.json({ message: 'Registration submitted. Please wait for admin approval.' }, 201);
});

authRoutes.post('/logout', async (c) => {
  const isSecure = new URL(c.req.url).protocol === 'https:';
  const clearCookie = `token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure ? '; Secure' : ''}`;
  return c.json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
});
