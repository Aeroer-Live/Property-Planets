import { Hono } from 'hono';
import { requireAuth, requireAdmin } from './middleware';
import type { Env, Variables } from './types';

const PAGE_SIZE = 20;

const properties = new Hono<{ Bindings: Env; Variables: Variables }>();

properties.use('*', requireAuth);

properties.get('/', async (c) => {
  const db = c.env.DB;
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const search = (c.req.query('search') || '').trim();
  const createdBy = (c.req.query('created_by') || '').trim();
  const offset = (page - 1) * PAGE_SIZE;

  let where: string[] = [];
  let params: (string | number)[] = [];

  if (search) {
    const term = `%${search}%`;
    where.push('(property_name LIKE ? OR property_owner_name LIKE ? OR phone_01 LIKE ? OR phone_02 LIKE ? OR ic_number LIKE ?)');
    params.push(term, term, term, term, term);
  }
  if (createdBy) {
    const createdById = parseInt(createdBy, 10);
    if (!Number.isNaN(createdById)) {
      where.push('created_by = ?');
      params.push(createdById);
    }
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countResult = await db.prepare(
    `SELECT COUNT(*) as total FROM properties ${whereClause}`
  ).bind(...params).first();
  const total = Number((countResult as { total: number })?.total ?? 0);

  const rows = await db.prepare(
    `SELECT p.*, u.username as created_by_username FROM properties p LEFT JOIN users u ON p.created_by = u.id ${whereClause} ORDER BY p.updated_at DESC, p.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, PAGE_SIZE, offset).all();

  return c.json({
    properties: rows.results,
    pagination: {
      page,
      page_size: PAGE_SIZE,
      total,
      total_pages: Math.ceil(total / PAGE_SIZE),
    },
  });
});

properties.get('/creators', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    'SELECT DISTINCT u.id, u.username FROM properties p JOIN users u ON p.created_by = u.id ORDER BY u.username'
  ).all();
  return c.json({ creators: rows.results as { id: number; username: string }[] });
});

properties.get('/count', async (c) => {
  const db = c.env.DB;
  const r = await db.prepare('SELECT COUNT(*) as total FROM properties').first();
  const total = Number((r as { total: number })?.total ?? 0);
  return c.json({ total });
});

properties.get('/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const row = await db.prepare(
    'SELECT p.*, u.username as created_by_username FROM properties p LEFT JOIN users u ON p.created_by = u.id WHERE p.id = ?'
  ).bind(id).first();
  if (!row) return c.json({ error: 'Property not found' }, 404);
  return c.json(row);
});

properties.post('/', async (c) => {
  const body = await c.req.json<{
    property_name: string;
    property_owner_name: string;
    phone_01: string;
    phone_02?: string;
    ic_number?: string;
  }>();
  const { property_name, property_owner_name, phone_01, phone_02, ic_number } = body || {};
  if (!property_name?.trim() || !property_owner_name?.trim() || !phone_01?.trim()) {
    return c.json({ error: 'property_name, property_owner_name and phone_01 are required' }, 400);
  }
  const userId = c.get('userId');
  const db = c.env.DB;
  const r = await db.prepare(
    `INSERT INTO properties (property_name, property_owner_name, phone_01, phone_02, ic_number, created_by) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(property_name.trim(), property_owner_name.trim(), phone_01.trim(), (phone_02 || '').trim() || null, (ic_number || '').trim() || null, userId).run();
  const row = await db.prepare('SELECT * FROM properties WHERE id = ?').bind(Number(r.meta.last_row_id)).first();
  return c.json(row, 201);
});

properties.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    property_name?: string;
    property_owner_name?: string;
    phone_01?: string;
    phone_02?: string;
    ic_number?: string;
  }>();
  const userId = c.get('userId');
  const db = c.env.DB;
  const existing = await db.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first() as Record<string, unknown> | null;
  if (!existing) return c.json({ error: 'Property not found' }, 404);
  const property_name = body?.property_name?.trim() ?? existing.property_name;
  const property_owner_name = body?.property_owner_name?.trim() ?? existing.property_owner_name;
  const phone_01 = body?.phone_01?.trim() ?? existing.phone_01;
  const phone_02 = body?.phone_02 !== undefined ? (body.phone_02?.trim() || null) : existing.phone_02;
  const ic_number = body?.ic_number !== undefined ? (body.ic_number?.trim() || null) : existing.ic_number;
  await db.prepare(
    `UPDATE properties SET property_name = ?, property_owner_name = ?, phone_01 = ?, phone_02 = ?, ic_number = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(property_name, property_owner_name, phone_01, phone_02, ic_number, userId, id).run();
  const row = await db.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first();
  return c.json(row);
});

properties.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const r = await db.prepare('DELETE FROM properties WHERE id = ?').bind(id).run();
  if (r.meta.changes === 0) return c.json({ error: 'Property not found' }, 404);
  return c.json({ message: 'Property deleted' });
});

export const propertyRoutes = properties;
