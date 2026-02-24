import { Hono } from 'hono';
import { requireAuth, requireAdmin, getJwtSecret } from './middleware';
import { signJwt } from './lib/auth';
import type { Env, Variables } from './types';

const users = new Hono<{ Bindings: Env; Variables: Variables }>();

users.use('*', requireAuth);

users.get('/me', async (c) => {
  const db = c.env.DB;
  const id = c.get('userId');
  const row = await db.prepare(
    'SELECT id, username, first_name, last_name, phone, email, role, status, theme_preference, created_at FROM users WHERE id = ?'
  ).bind(id).first();
  if (!row) return c.json({ error: 'User not found' }, 404);
  return c.json({
    id: row.id,
    username: row.username,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    status: row.status,
    theme_preference: row.theme_preference,
    created_at: row.created_at,
  });
});

users.patch('/me/theme', async (c) => {
  const body = await c.req.json<{ theme_preference: 'light' | 'dark' }>();
  const theme = body?.theme_preference;
  if (theme !== 'light' && theme !== 'dark') {
    return c.json({ error: 'theme_preference must be "light" or "dark"' }, 400);
  }
  const id = c.get('userId');
  const db = c.env.DB;
  await db.prepare('UPDATE users SET theme_preference = ? WHERE id = ?').bind(theme, id).run();
  return c.json({ theme_preference: theme });
});

users.get('/pending', requireAdmin, async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    'SELECT id, username, first_name, last_name, phone, email, created_at FROM users WHERE status = ? ORDER BY created_at DESC'
  ).bind('Pending').all();
  return c.json({ users: rows.results });
});

users.post('/:id/approve', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const adminId = c.get('userId');
  const db = c.env.DB;
  const user = await db.prepare('SELECT id, status FROM users WHERE id = ?').bind(id).first();
  if (!user) return c.json({ error: 'User not found' }, 404);
  if (user.status !== 'Pending') return c.json({ error: 'User is not pending' }, 400);
  await db.prepare(
    'UPDATE users SET status = ?, approved_by = ?, approved_at = datetime(\'now\') WHERE id = ?'
  ).bind('Active', adminId, id).run();
  return c.json({ message: 'User approved' });
});

users.post('/:id/reject', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const user = await db.prepare('SELECT id, status FROM users WHERE id = ?').bind(id).first();
  if (!user) return c.json({ error: 'User not found' }, 404);
  if (user.status !== 'Pending') return c.json({ error: 'User is not pending' }, 400);
  await db.prepare('UPDATE users SET status = ? WHERE id = ?').bind('Rejected', id).run();
  return c.json({ message: 'User rejected' });
});

users.get('/', requireAdmin, async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    'SELECT id, username, first_name, last_name, phone, email, role, status, theme_preference, created_at FROM users ORDER BY created_at DESC'
  ).all();
  return c.json({ users: rows.results });
});

users.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const selfId = c.get('userId');
  if (id === selfId) return c.json({ error: 'Cannot delete yourself' }, 400);
  const db = c.env.DB;
  const r = await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  if (r.meta.changes === 0) return c.json({ error: 'User not found' }, 404);
  return c.json({ message: 'User deleted' });
});

export const userRoutes = users;
