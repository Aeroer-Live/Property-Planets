import { Hono } from 'hono';
import { requireAuth, requireAdmin } from './middleware';
import type { Env, Variables } from './types';

const PAGE_SIZE = 20;

/** Allowed filter columns (property table or join). */
const FILTER_COLUMNS = new Set(['property_name', 'property_owner_name', 'phone_01', 'phone_02', 'ic_number', 'created_by']);
/** Operators that need a value. */
const VALUE_OPS = new Set(['equals', 'not_equals', 'starts_with', 'does_not_start_with', 'contains', 'does_not_contain', 'ends_with', 'does_not_end_with']);

type FilterRow = { column: string; operator: string; value?: string; logic?: 'and' | 'or' };

function buildFilterClause(filters: FilterRow[]): { where: string; params: (string | number)[] } {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  const prefix = 'p.';

  for (let i = 0; i < filters.length; i++) {
    const row = filters[i];
    if (!row?.column || !FILTER_COLUMNS.has(row.column)) continue;
    const op = String(row.operator || 'equals').toLowerCase();
    const col = row.column === 'created_by' ? 'p.created_by' : `${prefix}${row.column}`;
    const val = row.value?.trim();
    const needVal = VALUE_OPS.has(op);

    const logic = i > 0 ? (row.logic === 'or' ? ' OR ' : ' AND ') : '';
    let frag: string;
    let addParams: (string | number)[] = [];

    if (op === 'equals') {
      if (row.column === 'created_by') {
        const id = parseInt(val ?? '', 10);
        if (!Number.isNaN(id)) {
          frag = `${col} = ?`;
          addParams = [id];
        } else continue;
      } else {
        frag = `${col} = ?`;
        addParams = [val ?? ''];
      }
    } else if (op === 'not_equals') {
      if (row.column === 'created_by' && val) {
        const id = parseInt(val, 10);
        if (!Number.isNaN(id)) {
          frag = `(${col} != ? OR ${col} IS NULL)`;
          addParams = [id];
        } else continue;
      } else {
        frag = `(${col} != ? OR ${col} IS NULL)`;
        addParams = [val ?? ''];
      }
    } else if (op === 'starts_with') {
      frag = `${col} LIKE ?`;
      addParams = [(val ?? '') + '%'];
    } else if (op === 'does_not_start_with') {
      frag = `(${col} NOT LIKE ? OR ${col} IS NULL)`;
      addParams = [(val ?? '') + '%'];
    } else if (op === 'contains') {
      frag = `${col} LIKE ?`;
      addParams = ['%' + (val ?? '') + '%'];
    } else if (op === 'does_not_contain') {
      frag = `(${col} NOT LIKE ? OR ${col} IS NULL)`;
      addParams = ['%' + (val ?? '') + '%'];
    } else if (op === 'ends_with') {
      frag = `${col} LIKE ?`;
      addParams = ['%' + (val ?? '')];
    } else if (op === 'does_not_end_with') {
      frag = `(${col} NOT LIKE ? OR ${col} IS NULL)`;
      addParams = ['%' + (val ?? '')];
    } else if (op === 'empty') {
      frag = row.column === 'created_by' ? `${col} IS NULL` : `(${col} IS NULL OR ${col} = '')`;
    } else if (op === 'not_empty') {
      frag = row.column === 'created_by' ? `${col} IS NOT NULL` : `(${col} IS NOT NULL AND ${col} != '')`;
    } else continue;

    parts.push(logic + (i === 0 ? frag : `(${frag})`));
    params.push(...addParams);
  }

  const where = parts.length ? 'WHERE ' + (parts.length === 1 ? parts[0] : parts.join('')) : '';
  return { where, params };
}

const properties = new Hono<{ Bindings: Env; Variables: Variables }>();
properties.use('*', requireAuth);

properties.get('/', async (c) => {
  const db = c.env.DB;
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const filtersParam = c.req.query('filters');
  let filters: FilterRow[] = [];
  try {
    if (filtersParam) filters = JSON.parse(decodeURIComponent(filtersParam)) as FilterRow[];
  } catch (_) {}
  if (!Array.isArray(filters)) filters = [];

  const offset = (page - 1) * PAGE_SIZE;
  const { where: whereClause, params } = buildFilterClause(filters);
  const countResult = await db.prepare(
    `SELECT COUNT(*) as total FROM properties p ${whereClause}`
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
