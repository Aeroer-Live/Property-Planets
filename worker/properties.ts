import { Hono } from 'hono';
import type { Client } from 'pg';
import { requireAuth, requireAdmin } from './middleware';
import { withClient } from './db';
import type { Env, Variables } from './types';

const PAGE_SIZE = 20;
/** Max rows returned by export endpoint (same filters/search as list). */
const EXPORT_MAX = 5000;

/** Allowed filter columns (property table or join). */
const FILTER_COLUMNS = new Set(['property_name', 'property_owner_name', 'phone_01', 'phone_02', 'ic_number', 'created_by']);

type FilterRow = { column: string; operator: string; value?: string; logic?: 'and' | 'or' };

function buildPgFilterClause(filters: FilterRow[], startIndex = 1): { clause: string; params: (string | number)[]; nextIndex: number } {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  let idx = startIndex;

  for (let i = 0; i < filters.length; i++) {
    const row = filters[i];
    if (!row?.column || !FILTER_COLUMNS.has(row.column)) continue;
    const op = String(row.operator || 'equals').toLowerCase();
    const val = row.value?.trim();
    const col = row.column === 'created_by' ? 'created_by' : row.column;
    const logic = parts.length > 0 ? (row.logic === 'or' ? ' OR ' : ' AND ') : '';

    let frag: string | null = null;

    if (op === 'equals') {
      if (row.column === 'created_by') {
        const id = parseInt(val ?? '', 10);
        if (Number.isNaN(id)) continue;
        frag = `${col} = $${idx++}`;
        params.push(id);
      } else {
        frag = `${col} = $${idx++}`;
        params.push(val ?? '');
      }
    } else if (op === 'not_equals') {
      if (row.column === 'created_by') {
        const id = parseInt(val ?? '', 10);
        if (Number.isNaN(id)) continue;
        frag = `(${col} != $${idx} OR ${col} IS NULL)`;
        params.push(id);
        idx++;
      } else {
        frag = `(${col} != $${idx} OR ${col} IS NULL)`;
        params.push(val ?? '');
        idx++;
      }
    } else if (op === 'starts_with') {
      frag = `${col} ILIKE $${idx++}`;
      params.push((val ?? '') + '%');
    } else if (op === 'does_not_start_with') {
      frag = `(${col} NOT ILIKE $${idx} OR ${col} IS NULL)`;
      params.push((val ?? '') + '%');
      idx++;
    } else if (op === 'contains') {
      frag = `${col} ILIKE $${idx++}`;
      params.push('%' + (val ?? '') + '%');
    } else if (op === 'does_not_contain') {
      frag = `(${col} NOT ILIKE $${idx} OR ${col} IS NULL)`;
      params.push('%' + (val ?? '') + '%');
      idx++;
    } else if (op === 'ends_with') {
      frag = `${col} ILIKE $${idx++}`;
      params.push('%' + (val ?? ''));
    } else if (op === 'does_not_end_with') {
      frag = `(${col} NOT ILIKE $${idx} OR ${col} IS NULL)`;
      params.push('%' + (val ?? ''));
      idx++;
    } else if (op === 'empty') {
      frag = row.column === 'created_by' ? `${col} IS NULL` : `(${col} IS NULL OR ${col} = '')`;
    } else if (op === 'not_empty') {
      frag = row.column === 'created_by' ? `${col} IS NOT NULL` : `(${col} IS NOT NULL AND ${col} != '')`;
    }

    if (!frag) continue;
    parts.push(logic + (parts.length === 0 ? frag : `(${frag})`));
  }

  const clause = parts.length ? (parts.length === 1 ? parts[0] : parts.join('')) : '';
  return { clause, params, nextIndex: idx };
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch (_) {
    return String(e);
  }
}

function requireNumericUserId(userId: string): number {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) throw new Error('Invalid user id in session (expected numeric id). Please log out and log in again.');
  return uid;
}

async function attachCreatedByUsernames(client: Client, props: Array<Record<string, unknown>>): Promise<void> {
  const ids = Array.from(new Set(props.map((p) => Number(p.created_by)).filter((n) => Number.isFinite(n) && n > 0)));
  if (ids.length === 0) return;
  const map = new Map<number, string>();
  const r = await client.query<{ id: string; username: string }>('SELECT id::text, username FROM users WHERE id = ANY($1::bigint[])', [ids]);
  for (const row of r.rows) {
    map.set(Number(row.id), row.username);
  }
  for (const p of props) {
    const id = Number(p.created_by);
    (p as Record<string, unknown>).created_by_username = map.get(id) ?? null;
  }
}

const properties = new Hono<{ Bindings: Env; Variables: Variables }>();
properties.use('*', requireAuth);

properties.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const search = (c.req.query('search') || c.req.query('q') || '').trim();
  const filtersParam = c.req.query('filters');
  let filters: FilterRow[] = [];
  try {
    if (filtersParam) filters = JSON.parse(decodeURIComponent(filtersParam)) as FilterRow[];
  } catch (_) {}
  if (!Array.isArray(filters)) filters = [];

  const offset = (page - 1) * PAGE_SIZE;
  const searchClause = search
    ? '(property_name ILIKE $1 OR property_owner_name ILIKE $1 OR phone_01 ILIKE $1 OR phone_02 ILIKE $1 OR ic_number ILIKE $1)'
    : '';
  const searchParams = search ? [`%${search}%`] : [];
  const { clause: filterClause, params: filterParams, nextIndex } = buildPgFilterClause(filters, search ? 2 : 1);
  const whereClause = (searchClause || filterClause)
    ? 'WHERE ' + [searchClause, filterClause].filter(Boolean).join(' AND ')
    : '';
  const params: (string | number)[] = [...searchParams, ...filterParams];

  try {
    const out = await withClient(c.env, async (client) => {
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*)::text as total FROM properties ${whereClause}`,
        params,
      );
      const total = Number(countRes.rows?.[0]?.total ?? 0);
      const listParams = [...params, PAGE_SIZE, offset];
      const limitIdx = nextIndex;
      const offsetIdx = nextIndex + 1;
      const listRes = await client.query(
        `SELECT * FROM properties ${whereClause} ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        listParams,
      );
      const results = listRes.rows as Array<Record<string, unknown>>;
      await attachCreatedByUsernames(client, results);
      return { results, total };
    });
    return c.json({
      properties: out.results,
      pagination: {
        page,
        page_size: PAGE_SIZE,
        total: out.total,
        total_pages: Math.ceil(out.total / PAGE_SIZE),
      },
    });
  } catch (e) {
    return c.json({ error: `Postgres query failed: ${getErrorMessage(e)}` }, 500);
  }
});

properties.get('/creators', async (c) => {
  const creators = await withClient(c.env, async (client) => {
    const r = await client.query<{ id: string; username: string }>(
      'SELECT DISTINCT u.id::text, u.username FROM properties p JOIN users u ON p.created_by = u.id ORDER BY u.username'
    );
    return r.rows.map((row) => ({ id: Number(row.id), username: row.username }));
  });
  return c.json({ creators });
});

properties.get('/count', async (c) => {
  const total = await withClient(c.env, async (client) => {
    const r = await client.query<{ total: string }>('SELECT COUNT(*)::text as total FROM properties');
    return Number(r.rows?.[0]?.total ?? 0);
  });
  return c.json({ total });
});

properties.get('/export', async (c) => {
  const search = (c.req.query('search') || c.req.query('q') || '').trim();
  const filtersParam = c.req.query('filters');
  let filters: FilterRow[] = [];
  try {
    if (filtersParam) filters = JSON.parse(decodeURIComponent(filtersParam)) as FilterRow[];
  } catch (_) {}
  if (!Array.isArray(filters)) filters = [];

  const searchClause = search
    ? '(property_name ILIKE $1 OR property_owner_name ILIKE $1 OR phone_01 ILIKE $1 OR phone_02 ILIKE $1 OR ic_number ILIKE $1)'
    : '';
  const searchParams = search ? [`%${search}%`] : [];
  const { clause: filterClause, params: filterParams, nextIndex } = buildPgFilterClause(filters, search ? 2 : 1);
  const whereClause = (searchClause || filterClause)
    ? 'WHERE ' + [searchClause, filterClause].filter(Boolean).join(' AND ')
    : '';
  const params: (string | number)[] = [...searchParams, ...filterParams, EXPORT_MAX];
  const limitIdx = nextIndex;

  try {
    const results = await withClient(c.env, async (client) => {
      const r = await client.query(
        `SELECT id, property_name, property_owner_name, phone_01, phone_02, ic_number, created_by FROM properties ${whereClause} ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT $${limitIdx}`,
        params,
      );
      const rows = r.rows as Array<Record<string, unknown>>;
      await attachCreatedByUsernames(client, rows);
      return rows;
    });
    return c.json({ properties: results });
  } catch (e) {
    return c.json({ error: `Postgres query failed: ${getErrorMessage(e)}` }, 500);
  }
});

properties.get('/:id', async (c) => {
  const id = c.req.param('id');
  const pid = Number(id);
  if (!Number.isFinite(pid) || pid <= 0) return c.json({ error: 'Invalid property id' }, 400);
  const row = await withClient(c.env, async (client) => {
    const r = await client.query('SELECT * FROM properties WHERE id = $1', [pid]);
    const row = (r.rows?.[0] ?? null) as Record<string, unknown> | null;
    if (!row) return null;
    await attachCreatedByUsernames(client, [row]);
    return row;
  });
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
  let uid: number;
  try {
    uid = requireNumericUserId(userId);
  } catch (e) {
    return c.json({ error: getErrorMessage(e) }, 400);
  }
  const row = await withClient(c.env, async (client) => {
    const r = await client.query(
      `INSERT INTO properties (property_name, property_owner_name, phone_01, phone_02, ic_number, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [property_name.trim(), property_owner_name.trim(), phone_01.trim(), (phone_02 || '').trim() || null, (ic_number || '').trim() || null, uid],
    );
    const row = (r.rows?.[0] ?? null) as Record<string, unknown> | null;
    if (row) await attachCreatedByUsernames(client, [row]);
    return row;
  });
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
  const deleted = await withClient(c.env, async (client) => {
    const r = await client.query('DELETE FROM properties WHERE id = ANY($1::bigint[])', [validIds]);
    return r.rowCount ?? validIds.length;
  });
  return c.json({ deleted });
});

/** Admin only: delete ALL properties. Requires body: { "confirm": "DELETE_ALL_PROPERTIES" } */
properties.delete('/clear-all', requireAdmin, async (c) => {
  const body = await c.req.json<{ confirm?: string }>().catch(() => ({}));
  if (body?.confirm !== 'DELETE_ALL_PROPERTIES') {
    return c.json({ error: 'Confirmation required. Send { "confirm": "DELETE_ALL_PROPERTIES" } in the request body.' }, 400);
  }
  const deleted = await withClient(c.env, async (client) => {
    const r = await client.query('DELETE FROM properties');
    return r.rowCount ?? 0;
  });
  return c.json({ deleted, message: `All property data removed (${deleted} records).` });
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
  const WEB_IMPORT_MAX_ROWS = 50_000;
  if (rows.length - 1 > WEB_IMPORT_MAX_ROWS) {
    return c.json({
      error: `File has ${rows.length - 1} data rows. Web import is limited to ${WEB_IMPORT_MAX_ROWS.toLocaleString()} rows per file. For millions of rows, use the bulk import script (see README or scripts/bulk-import-properties.js).`,
    }, 400);
  }
  const userId = c.get('userId');
  const uid = Number(userId);
  const BATCH_SIZE = 500;
  const { imported, errors: errList } = await withClient(c.env, async (client) => {
    const errors: string[] = [];
    let imported = 0;
    const batch: [string, string, string, string | null, string | null][] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const values: (string | number)[] = [];
      const placeholders: string[] = [];
      let idx = 1;
      for (const [pn, pon, p1, p2, ic] of batch) {
        placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
        values.push(pn, pon, p1, p2 ?? null, ic ?? null, uid);
        idx += 6;
      }
      await client.query(
        `INSERT INTO properties (property_name, property_owner_name, phone_01, phone_02, ic_number, created_by) VALUES ${placeholders.join(', ')}`,
        values,
      );
      imported += batch.length;
      batch.length = 0;
    };
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
        errors.push(`Row ${r + 1}: missing required field. Skipped.`);
        continue;
      }
      batch.push([
        property_name,
        property_owner_name,
        phone_01,
        (phone_02 || '').trim() || null,
        (ic_number || '').trim() || null,
      ]);
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();
    return { imported, errors: errors.slice(0, 50) };
  });
  return c.json({ imported, errors: errList });
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
  const pid = Number(id);
  if (!Number.isFinite(pid) || pid <= 0) return c.json({ error: 'Invalid property id' }, 400);
  const uid = Number(userId);
  const row = await withClient(c.env, async (client) => {
    const existingRes = await client.query('SELECT * FROM properties WHERE id = $1', [pid]);
    const existing = (existingRes.rows?.[0] ?? null) as Record<string, unknown> | null;
    if (!existing) return null;
    const property_name = body?.property_name?.trim() ?? (existing.property_name as string);
    const property_owner_name = body?.property_owner_name?.trim() ?? (existing.property_owner_name as string);
    const phone_01 = body?.phone_01?.trim() ?? (existing.phone_01 as string);
    const phone_02 = body?.phone_02 !== undefined ? (body.phone_02?.trim() || null) : (existing.phone_02 as string | null);
    const ic_number = body?.ic_number !== undefined ? (body.ic_number?.trim() || null) : (existing.ic_number as string | null);
    const r = await client.query(
      `UPDATE properties
       SET property_name = $1,
           property_owner_name = $2,
           phone_01 = $3,
           phone_02 = $4,
           ic_number = $5,
           updated_by = $6,
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [property_name, property_owner_name, phone_01, phone_02, ic_number, uid, pid],
    );
    const row = (r.rows?.[0] ?? null) as Record<string, unknown> | null;
    if (row) await attachCreatedByUsernames(client, [row]);
    return row;
  });
  if (!row) return c.json({ error: 'Property not found' }, 404);
  return c.json(row);
});

properties.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const pid = Number(id);
  if (!Number.isFinite(pid) || pid <= 0) return c.json({ error: 'Invalid property id' }, 400);
  const rowCount = await withClient(c.env, async (client) => {
    const r = await client.query('DELETE FROM properties WHERE id = $1', [pid]);
    return r.rowCount ?? 0;
  });
  if (rowCount === 0) return c.json({ error: 'Property not found' }, 404);
  return c.json({ message: 'Property deleted' });
});

export const propertyRoutes = properties;
