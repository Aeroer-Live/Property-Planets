#!/usr/bin/env node
/**
 * Bulk import properties from CSV files into Neon (PostgreSQL).
 * Use this for hundreds of thousands or millions of rows — the web import is limited to 50k per file.
 *
 * Prerequisites:
 *   - Node.js 18+
 *   - Neon connection string (from Neon Console → Connection string; use direct connection, not Hyperdrive)
 *   - An existing user ID in the app (created_by) — e.g. 1 for the first admin
 *
 * Usage:
 *   node scripts/bulk-import-properties.js --conn "postgres://user:pass@host/db?sslmode=require" --created-by 1 --file data1.csv --file data2.csv
 *   node scripts/bulk-import-properties.js --conn "postgres://..." --created-by 1 --dir ./csv-folder
 *
 * CSV format: first row = headers. Required: Property Name (or Name), Owner (or Property Owner Name), Phone 01 (or Phone). Optional: Phone 02, IC Number.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const HEADER_MAP = {
  'property name': 'property_name', 'property': 'property_name', 'name': 'property_name',
  'owner': 'property_owner_name', 'property owner': 'property_owner_name', 'owner name': 'property_owner_name', 'property owner name': 'property_owner_name',
  'phone': 'phone_01', 'phone 01': 'phone_01', 'phone 1': 'phone_01', 'phone1': 'phone_01', 'phone01': 'phone_01',
  'phone 02': 'phone_02', 'phone 2': 'phone_02', 'phone2': 'phone_02', 'phone02': 'phone_02',
  'ic': 'ic_number', 'ic number': 'ic_number', 'ic no': 'ic_number', 'nric': 'ic_number',
};

function norm(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  const newline = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const firstLine = (text.split(newline)[0] ?? '').trim();
  const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (inQuotes) {
      cell += ch;
    } else if (ch === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      cell = '';
      if (row.some(c => c.length > 0)) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(c => c.length > 0)) rows.push(row);
  return rows;
}

function getFilesFromArgs(argv) {
  const files = [];
  const dir = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : null;
  if (dir) {
    const names = fs.readdirSync(dir);
    for (const n of names) {
      if (n.toLowerCase().endsWith('.csv')) files.push(path.join(dir, n));
    }
  }
  let i = argv.indexOf('--file');
  while (i !== -1 && argv[i + 1]) {
    files.push(argv[i + 1]);
    i = argv.indexOf('--file', i + 1);
  }
  return files;
}

async function main() {
  const argv = process.argv.slice(2);
  const connIndex = argv.indexOf('--conn');
  const createdByIndex = argv.indexOf('--created-by');
  const conn = connIndex !== -1 && argv[connIndex + 1] ? argv[connIndex + 1] : process.env.NEON_CONNECTION_STRING;
  const createdBy = createdByIndex !== -1 && argv[createdByIndex + 1] ? parseInt(argv[createdByIndex + 1], 10) : null;

  if (!conn) {
    console.error('Usage: node bulk-import-properties.js --conn "postgres://..." --created-by <user_id> --file a.csv [--file b.csv]');
    console.error('   or: node bulk-import-properties.js --conn "postgres://..." --created-by <user_id> --dir ./folder');
    console.error('   or: set NEON_CONNECTION_STRING and run with --created-by <user_id> --file a.csv');
    process.exit(1);
  }
  if (!Number.isInteger(createdBy) || createdBy <= 0) {
    console.error('--created-by must be an existing user ID (e.g. 1 for first admin).');
    process.exit(1);
  }

  const files = getFilesFromArgs(argv);
  if (files.length === 0) {
    console.error('Provide --file path.csv (repeat for multiple) or --dir ./path');
    process.exit(1);
  }

  const client = new Client({ connectionString: conn });
  await client.connect();

  let totalImported = 0;
  const BATCH_SIZE = 2000;

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      console.warn('Skip (not found):', filePath);
      continue;
    }
    let text = fs.readFileSync(filePath, 'utf8');
    text = text.replace(/^\uFEFF/, '');
    const rows = parseCSV(text);
    if (rows.length < 2) {
      console.warn('Skip (no data rows):', filePath);
      continue;
    }
    const headers = rows[0].map(h => norm(h));
    const colIndex = {};
    for (let i = 0; i < headers.length; i++) {
      const key = HEADER_MAP[headers[i]];
      if (key && colIndex[key] === undefined) colIndex[key] = i;
    }
    if (colIndex.property_name === undefined || colIndex.property_owner_name === undefined || colIndex.phone_01 === undefined) {
      console.warn('Skip (missing required columns):', filePath);
      continue;
    }

    const batch = [];
    let fileImported = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !Array.isArray(row)) continue;
      const cell = i => (row[i] != null ? String(row[i]).trim() : '');
      const property_name = cell(colIndex.property_name ?? -1);
      const property_owner_name = colIndex.property_owner_name != null ? cell(colIndex.property_owner_name) : '';
      const phone_01 = cell(colIndex.phone_01 ?? -1);
      const phone_02 = colIndex.phone_02 != null ? cell(colIndex.phone_02) : undefined;
      const ic_number = colIndex.ic_number != null ? cell(colIndex.ic_number) : undefined;
      if (!property_name || !property_owner_name || !phone_01) continue;
      batch.push([
        property_name,
        property_owner_name,
        phone_01,
        (phone_02 || '').trim() || null,
        (ic_number || '').trim() || null,
      ]);
      if (batch.length >= BATCH_SIZE) {
        const values = [];
        const placeholders = [];
        let idx = 1;
        for (const [pn, pon, p1, p2, ic] of batch) {
          placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5})`);
          values.push(pn, pon, p1, p2, ic, createdBy);
          idx += 6;
        }
        await client.query(
          `INSERT INTO properties (property_name, property_owner_name, phone_01, phone_02, ic_number, created_by) VALUES ${placeholders.join(', ')}`,
          values
        );
        fileImported += batch.length;
        totalImported += batch.length;
        batch.length = 0;
        if (totalImported % 10000 === 0 || totalImported === 10000) console.log('  Imported', totalImported.toLocaleString(), 'rows so far...');
      }
    }
    if (batch.length > 0) {
      const values = [];
      const placeholders = [];
      let idx = 1;
      for (const [pn, pon, p1, p2, ic] of batch) {
        placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5})`);
        values.push(pn, pon, p1, p2, ic, createdBy);
        idx += 6;
      }
      await client.query(
        `INSERT INTO properties (property_name, property_owner_name, phone_01, phone_02, ic_number, created_by) VALUES ${placeholders.join(', ')}`,
        values
      );
      fileImported += batch.length;
      totalImported += batch.length;
    }
    console.log(path.basename(filePath) + ':', fileImported.toLocaleString(), 'rows');
  }

  await client.end();
  console.log('Total imported:', totalImported.toLocaleString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
