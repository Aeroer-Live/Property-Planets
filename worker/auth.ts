import { Hono } from 'hono';
import { hashPassword, verifyPassword, signJwt } from './lib/auth';
import { getJwtSecret } from './middleware';
import type { Env, Variables } from './types';

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

authRoutes.post('/login', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  const { username, password } = body || {};
  if (!username || !password) {
    return c.json({ error: 'Username and password required' }, 400);
  }
  const db = c.env.DB;
  const row = await db.prepare('SELECT id, username, password, role, status, theme_preference FROM users WHERE username = ?').bind(username).first();
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
  const cookieOpts = `Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${isSecure ? '; Secure' : ''}`; // 7 days
  return c.json(
    {
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        theme_preference: row.theme_preference || 'light',
      },
    },
    200,
    {
      'Set-Cookie': `token=${token}; ${cookieOpts}`,
    }
  );
});

authRoutes.post('/setup', async (c) => {
  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM users LIMIT 1').first();
  if (existing) return c.json({ error: 'Setup already completed' }, 400);
  const body = await c.req.json<{ username: string; password: string; email: string }>();
  const { username, password, email } = body || {};
  if (!username?.trim() || !password || !email?.trim()) return c.json({ error: 'username, password, email required' }, 400);
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
  const hashed = await hashPassword(password);
  await db.prepare(
    `INSERT INTO users (username, first_name, last_name, phone, email, password, role, status) VALUES (?, 'Admin', 'User', '', ?, ?, 'Admin', 'Active')`
  ).bind(username.trim(), email.trim(), hashed).run();
  return c.json({ message: 'First admin created. You can now log in.' }, 201);
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
  const db = c.env.DB;
  const existingUser = await db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').bind(username.trim(), email.trim()).first();
  if (existingUser) {
    return c.json({ error: 'Username or email already registered' }, 409);
  }
  const hashed = await hashPassword(password);
  await db.prepare(
    `INSERT INTO users (username, first_name, last_name, phone, email, password, role, status) VALUES (?, ?, ?, ?, ?, ?, 'Staff', 'Pending')`
  ).bind(username.trim(), first_name.trim(), last_name.trim(), phone.trim(), email.trim(), hashed).run();
  return c.json({ message: 'Registration submitted. Please wait for admin approval.' }, 201);
});

authRoutes.post('/logout', async (c) => {
  const isSecure = new URL(c.req.url).protocol === 'https:';
  const clearCookie = `token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure ? '; Secure' : ''}`;
  return c.json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
});
