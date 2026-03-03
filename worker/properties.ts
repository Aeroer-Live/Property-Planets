import { Hono } from 'hono';
import { requireAuth, requireAdmin } from './middleware';
import type { Env, Variables } from './types';

const PAGE_SIZE = 20;
/** Max rows returned by export endpoint (same filters/search as list). */
const EXPORT_MAX = 5000;

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
  const search = (c.req.query('search') || c.req.query('q') || '').trim();
  const filtersParam = c.req.query('filters');
  let filters: FilterRow[] = [];
  try {
    if (filtersParam) filters = JSON.parse(decodeURIComponent(filtersParam)) as FilterRow[];
  } catch (_) {}
  if (!Array.isArray(filters)) filters = [];

  const { where: filterWhere, params: filterParams } = buildFilterClause(filters);
  const searchPart = search
    ? '(p.property_name LIKE ? OR p.property_owner_name LIKE ? OR p.phone_01 LIKE ? OR p.phone_02 LIKE ? OR p.ic_number LIKE ?)'
    : '';
  const searchParams = search ? [search, search, search, search, search].map((v) => `%${v}%`) : [];
  const whereClause =
    searchPart && filterWhere
      ? 'WHERE ' + searchPart + ' AND ' + filterWhere.replace(/^WHERE\s+/, '')
      : searchPart
        ? 'WHERE ' + searchPart
        : filterWhere;
  const params = [...searchParams, ...filterParams];
  const offset = (page - 1) * PAGE_SIZE;

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

properties.get('/export', async (c) => {
  const db = c.env.DB;
  const search = (c.req.query('search') || c.req.query('q') || '').trim();
  const filtersParam = c.req.query('filters');
  let filters: FilterRow[] = [];
  try {
    if (filtersParam) filters = JSON.parse(decodeURIComponent(filtersParam)) as FilterRow[];
  } catch (_) {}
  if (!Array.isArray(filters)) filters = [];

  const { where: filterWhere, params: filterParams } = buildFilterClause(filters);
  const searchPart = search
    ? '(p.property_name LIKE ? OR p.property_owner_name LIKE ? OR p.phone_01 LIKE ? OR p.phone_02 LIKE ? OR p.ic_number LIKE ?)'
    : '';
  const searchParams = search ? [search, search, search, search, search].map((v) => `%${v}%`) : [];
  const whereClause =
    searchPart && filterWhere
      ? 'WHERE ' + searchPart + ' AND ' + filterWhere.replace(/^WHERE\s+/, '')
      : searchPart
        ? 'WHERE ' + searchPart
        : filterWhere;
  const params = [...searchParams, ...filterParams];

  const rows = await db.prepare(
    `SELECT p.id, p.property_name, p.property_owner_name, p.phone_01, p.phone_02, p.ic_number, u.username as created_by_username FROM properties p LEFT JOIN users u ON p.created_by = u.id ${whereClause} ORDER BY p.updated_at DESC, p.created_at DESC LIMIT ?`
  ).bind(...params, EXPORT_MAX).all();

  return c.json({ properties: rows.results });
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

properties.post('/bulk-delete', requireAdmin, async (c) => {
  const body = await c.req.json<{ ids?: number[] }>();
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'ids array is required and must not be empty' }, 400);
  }
  const validIds = ids.filter((id) => typeof id === 'number' && Number.isInteger(id) && id > 0);
  if (validIds.length === 0) {
    return c.json({ error: 'No valid property ids provided' }, 400);
  }
  const db = c.env.DB;
  const placeholders = validIds.map(() => '?').join(',');
  const r = await db.prepare(`DELETE FROM properties WHERE id IN (${placeholders})`).bind(...validIds).run();
  return c.json({ deleted: r.meta.changes ?? validIds.length });
});

/** Normalize Excel header for column mapping */
function norm(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Map normalized header to property field name */
const HEADER_MAP: Record<string, string> = {
  'property name': 'property_name',
  'property': 'property_name',
  'name': 'property_name',
  'owner': 'property_owner_name',
  'property owner': 'property_owner_name',
  'owner name': 'property_owner_name',
  'property owner name': 'property_owner_name',
  'phone': 'phone_01',
  'phone 01': 'phone_01',
  'phone 1': 'phone_01',
  'phone1': 'phone_01',
  'phone01': 'phone_01',
  'phone 02': 'phone_02',
  'phone 2': 'phone_02',
  'phone2': 'phone_02',
  'phone02': 'phone_02',
  'ic': 'ic_number',
  'ic number': 'ic_number',
  'ic no': 'ic_number',
  'nric': 'ic_number',
};

/** Unescape a CSV cell value (strip surrounding quotes, unescape "" -> "). */
function unquoteCell(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"').trim();
  }
  return t;
}

/** Parse CSV text into rows. Handles newlines inside quoted fields and comma/semicolon delimiter. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const delim = (() => {
    const firstLine = text.split(/\r?\n/)[0] ?? '';
    const withComma = firstLine.split(',').length;
    const withSemi = firstLine.split(';').length;
    return withSemi > withComma ? ';' : ',';
  })();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (inQuotes) {
      cell += ch;
    } else if (ch === delim) {
      row.push(unquoteCell(cell));
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i++;
      row.push(unquoteCell(cell));
      cell = '';
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(unquoteCell(cell));
  if (row.some((c) => c.length > 0)) rows.push(row);
  return rows;
}

properties.post('/import', requireAdmin, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No file uploaded. Use form field "file".' }, 400);
  }
  const name = (file.name || '').toLowerCase();
  if (!name.endsWith('.csv')) {
    return c.json({ error: 'File must be a CSV file. In Excel, use Save As → CSV UTF-8 to export.' }, 400);
  }
  let rows: string[][];
  try {
    let text = await file.text();
    text = text.replace(/^\uFEFF/, ''); // strip BOM (Excel CSV UTF-8)
    rows = parseCSV(text);
  } catch (e) {
    return c.json({ error: 'Invalid or corrupted file. ' + (e instanceof Error ? e.message : '') }, 400);
  }
  if (!rows.length) return c.json({ error: 'File has no data rows' }, 400);
  const headerRow = rows[0];
  const headers = headerRow.map((h) => norm(String(h ?? '')));
  const colIndex: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = HEADER_MAP[headers[i]];
    if (key && colIndex[key] === undefined) colIndex[key] = i;
  }
  if (colIndex.property_name === undefined || colIndex.property_owner_name === undefined || colIndex.phone_01 === undefined) {
    return c.json({
      error: 'File must have columns for Property Name, Owner (or Property Owner Name), and Phone 01 (or Phone).',
    }, 400);
  }
  const userId = c.get('userId');
  const db = c.env.DB;
  const errors: string[] = [];
  let imported = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !Array.isArray(row)) continue;
    const cell = (i: number) => (row[i] != null ? String(row[i]).trim() : '');
    const property_name = cell(colIndex.property_name ?? -1);
    const property_owner_name = colIndex.property_owner_name != null ? cell(colIndex.property_owner_name) : '';
    const phone_01 = cell(colIndex.phone_01 ?? -1);
    const phone_02 = colIndex.phone_02 != null ? cell(colIndex.phone_02) : undefined;
    const ic_number = colIndex.ic_number != null ? cell(colIndex.ic_number) : undefined;
    if (!property_name || !property_owner_name || !phone_01) {
      errors.push(`Row ${r + 1}: missing required field (property name, owner, or phone 01). Skipped.`);
      continue;
    }
    try {
      await db.prepare(
        `INSERT INTO properties (property_name, property_owner_name, phone_01, phone_02, ic_number, created_by) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(property_name, property_owner_name, phone_01, (phone_02 || '').trim() || null, (ic_number || '').trim() || null, userId).run();
      imported++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Insert failed';
      if (msg.includes('location') && msg.includes('NOT NULL')) {
        errors.push(`Row ${r + 1}: Database still has old "location" column. Run: npx wrangler d1 migrations apply property-planets-db`);
      } else {
        errors.push(`Row ${r + 1}: ${msg}`);
      }
    }
  }
  return c.json({ imported, errors: errors.slice(0, 50) });
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
