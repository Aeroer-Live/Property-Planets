import { Hono } from 'hono';
import { requireAuth, requireAdmin } from './middleware';
import { withClient } from './db';
import { hashPassword } from './lib/auth';
import type { Env, Variables } from './types';

const users = new Hono<{ Bindings: Env; Variables: Variables }>();

users.use('*', requireAuth);

users.get('/me', async (c) => {
  try {
    const idRaw = c.get('userId');
    if (!idRaw) return c.json({ error: 'Unauthorized' }, 401);
    const id = String(idRaw);
    const row = await withClient(c.env, async (client) => {
      const r = await client.query(
        'SELECT id, username, first_name, last_name, phone, email, role, status, theme_preference, created_at FROM users WHERE id = $1',
        [id]
      );
      return r.rows[0];
    });
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
      theme_preference: row.theme_preference ?? 'light',
      created_at: row.created_at,
    });
  } catch (e) {
    return c.json({ error: 'Server error' }, 500);
  }
});

users.patch('/me/theme', async (c) => {
  const body = await c.req.json<{ theme_preference: 'light' | 'dark' }>();
  const theme = body?.theme_preference;
  if (theme !== 'light' && theme !== 'dark') {
    return c.json({ error: 'theme_preference must be "light" or "dark"' }, 400);
  }
  const id = c.get('userId');
  await withClient(c.env, async (client) => {
    await client.query('UPDATE users SET theme_preference = $1 WHERE id = $2', [theme, id]);
  });
  return c.json({ theme_preference: theme });
});

users.get('/pending', requireAdmin, async (c) => {
  const rows = await withClient(c.env, async (client) => {
    const r = await client.query(
      'SELECT id, username, first_name, last_name, phone, email, created_at FROM users WHERE status = $1 ORDER BY created_at DESC',
      ['Pending']
    );
    return r.rows;
  });
  return c.json({ users: rows });
});

users.post('/:id/approve', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const adminId = c.get('userId');
  try {
    await withClient(c.env, async (client) => {
      const userRes = await client.query('SELECT id, status FROM users WHERE id = $1', [id]);
      const user = userRes.rows[0];
      if (!user) throw new Error('NOT_FOUND');
      if (user.status !== 'Pending') throw new Error('NOT_PENDING');
      await client.query(
        'UPDATE users SET status = $1, approved_by = $2, approved_at = NOW() WHERE id = $3',
        ['Active', adminId, id]
      );
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'NOT_FOUND') return c.json({ error: 'User not found' }, 404);
    if (e instanceof Error && e.message === 'NOT_PENDING') return c.json({ error: 'User is not pending' }, 400);
    throw e;
  }
  return c.json({ message: 'User approved' });
});

users.post('/:id/reject', requireAdmin, async (c) => {
  const id = c.req.param('id');
  try {
    await withClient(c.env, async (client) => {
      const userRes = await client.query('SELECT id, status FROM users WHERE id = $1', [id]);
      const user = userRes.rows[0];
      if (!user) throw new Error('NOT_FOUND');
      if (user.status !== 'Pending') throw new Error('NOT_PENDING');
      await client.query('UPDATE users SET status = $1 WHERE id = $2', ['Rejected', id]);
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'NOT_FOUND') return c.json({ error: 'User not found' }, 404);
    if (e instanceof Error && e.message === 'NOT_PENDING') return c.json({ error: 'User is not pending' }, 400);
    throw e;
  }
  return c.json({ message: 'User rejected' });
});

users.get('/count', requireAdmin, async (c) => {
  const { total, staff } = await withClient(c.env, async (client) => {
    const totalRes = await client.query('SELECT COUNT(*)::text as total FROM users');
    const staffRes = await client.query("SELECT COUNT(*)::text as total FROM users WHERE role = 'Staff'");
    return {
      total: Number(totalRes.rows[0]?.total ?? 0),
      staff: Number(staffRes.rows[0]?.total ?? 0),
    };
  });
  return c.json({ total, staff });
});

users.get('/', requireAdmin, async (c) => {
  const rows = await withClient(c.env, async (client) => {
    const r = await client.query(
      'SELECT id, username, first_name, last_name, phone, email, role, status, theme_preference, created_at FROM users ORDER BY created_at DESC'
    );
    return r.rows;
  });
  return c.json({ users: rows });
});

/** Admin only: update a user's password, email, and/or phone. */
users.patch('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ password?: string; email?: string; phone?: string }>().catch(() => ({}));
  const password = typeof body?.password === 'string' ? body.password.trim() : undefined;
  const email = typeof body?.email === 'string' ? body.email.trim() : undefined;
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : undefined;

  if (!password && email === undefined && phone === undefined) {
    return c.json({ error: 'Provide at least one of: password, email, phone' }, 400);
  }
  if (password && password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }
  if (email !== undefined && !email) {
    return c.json({ error: 'Email cannot be empty' }, 400);
  }

  try {
    await withClient(c.env, async (client) => {
      const userRes = await client.query('SELECT id, email FROM users WHERE id = $1', [id]);
      const user = userRes.rows[0];
      if (!user) throw new Error('NOT_FOUND');
      if (email !== undefined && email !== (user.email as string)) {
        const existing = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, id]);
        if (existing.rows.length > 0) throw new Error('EMAIL_TAKEN');
      }
      const updates: string[] = [];
      const values: (string | number)[] = [];
      let idx = 1;
      if (password) {
        const hashed = await hashPassword(password);
        updates.push(`password = $${idx++}`);
        values.push(hashed);
      }
      if (email !== undefined) {
        updates.push(`email = $${idx++}`);
        values.push(email);
      }
      if (phone !== undefined) {
        updates.push(`phone = $${idx++}`);
        values.push(phone);
      }
      if (updates.length === 0) return;
      values.push(id);
      await client.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'NOT_FOUND') return c.json({ error: 'User not found' }, 404);
    if (e instanceof Error && e.message === 'EMAIL_TAKEN') return c.json({ error: 'Email already in use by another user' }, 409);
    throw e;
  }
  return c.json({ message: 'User updated' });
});

users.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const selfId = c.get('userId');
  if (id === selfId) return c.json({ error: 'Cannot delete yourself' }, 400);
  const deleted = await withClient(c.env, async (client) => {
    const r = await client.query('DELETE FROM users WHERE id = $1', [id]);
    return r.rowCount ?? 0;
  });
  if (deleted === 0) return c.json({ error: 'User not found' }, 404);
  return c.json({ message: 'User deleted' });
});

export const userRoutes = users;
