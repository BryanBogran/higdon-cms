/**
 * An in-memory stand-in for the Supabase client. TEST ONLY -- no app code
 * imports this, and nothing here ships in the bundle.
 *
 * It runs the operations for real against plain objects rather than recording
 * that they were called. Asserting "insert was called with X" only proves the
 * store said something; asserting "the row now reads Y" proves it meant it.
 * The bugs this layer has actually produced -- a column mapped on write but
 * not on read, an update that blanked a field it was never given -- are
 * invisible to a call-shape assertion and obvious to a state assertion.
 *
 * It implements exactly what supabase-store.js uses: from/select/insert/
 * update/upsert/delete/eq/in/order/single/maybeSingle, plus rpc. It is not a
 * Postgres emulator; there are no constraints, no RLS and no triggers. Where a
 * test needs a database error, script one with `failOn`.
 */

/** Deep clone, so a caller mutating a returned row cannot reach the store. */
const clone = (v) => (v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)));

function matches(row, filters) {
  return filters.every(({ op, column, value }) => {
    if (op === 'eq') return row[column] === value;
    if (op === 'in') return value.includes(row[column]);
    return true;
  });
}

/**
 * @param {Record<string, object[]>} seed Initial rows, keyed by table name.
 * @param {object} [options]
 * @param {Record<string, any>} [options.rpc] Return values by function name. A
 *   value of `Error` is returned as an error instead of data.
 * @param {Array<{table?: string, op?: string, message?: string, code?: string}>} [options.failOn]
 *   Operations that should come back as a database error.
 */
export function fakeSupabase(seed = {}, { rpc = {}, failOn = [] } = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map(clone);

  let nextId = 1;
  const calls = [];

  const errorFor = (table, op) => {
    const hit = failOn.find(
      (f) => (!f.table || f.table === table) && (!f.op || f.op === op)
    );
    if (!hit) return null;
    // `code` matters: the store branches on it -- 23505 (unique violation) on
    // matter_relation means the link already exists, which is a success.
    return { message: hit.message || `${op} on ${table} failed`, code: hit.code };
  };

  function builder(table) {
    const rows = (tables[table] ||= []);
    const filters = [];
    let op = 'select';
    let payload = null;
    let onConflict = null;
    let wantsRows = true;
    let single = null; // 'single' | 'maybeSingle'
    let order = null;
    let countMode = null; // 'exact' when the caller asked for a row count
    let headOnly = false; // count without the rows, as addSectionRow does

    const run = () => {
      calls.push({ table, op, filters: filters.map((f) => ({ ...f })) });

      const err = errorFor(table, op);
      if (err) return { data: null, error: err };

      let data = null;

      if (op === 'select') {
        data = rows.filter((r) => matches(r, filters)).map(clone);
        if (order) {
          const { column, ascending } = order;
          data.sort((a, b) => {
            const av = a[column] ?? '';
            const bv = b[column] ?? '';
            if (av === bv) return 0;
            return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
          });
        }
      }

      if (op === 'insert') {
        const incoming = (Array.isArray(payload) ? payload : [payload]).map(clone);
        for (const row of incoming) {
          if (row.id === undefined) row.id = `id-${nextId++}`;
          rows.push(row);
        }
        data = incoming.map(clone);
      }

      if (op === 'update') {
        const hit = rows.filter((r) => matches(r, filters));
        for (const row of hit) Object.assign(row, clone(payload));
        data = hit.map(clone);
      }

      if (op === 'upsert') {
        const incoming = (Array.isArray(payload) ? payload : [payload]).map(clone);
        const keys = (onConflict || 'id').split(',').map((k) => k.trim());
        for (const row of incoming) {
          const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
          if (existing) Object.assign(existing, row);
          else {
            if (row.id === undefined && !keys.includes('id')) row.id = `id-${nextId++}`;
            rows.push(row);
          }
        }
        data = incoming.map(clone);
      }

      if (op === 'delete') {
        const kept = [];
        const removed = [];
        for (const r of rows) (matches(r, filters) ? removed : kept).push(r);
        rows.length = 0;
        rows.push(...kept);
        data = removed.map(clone);
      }

      if (single === 'single') {
        if (!data || data.length !== 1) {
          return { data: null, error: { message: 'Expected exactly one row', code: 'PGRST116' } };
        }
        return { data: data[0], error: null };
      }
      if (single === 'maybeSingle') {
        return { data: data?.[0] ?? null, error: null };
      }

      // `.select('id', { count: 'exact', head: true })` asks how many rows
      // match without returning them -- addSectionRow uses it for the ordinal.
      if (countMode) {
        const n = rows.filter((r) => matches(r, filters)).length;
        return { data: headOnly ? null : data, count: n, error: null };
      }

      // Supabase returns no rows for a write unless .select() was chained.
      return { data: wantsRows ? data : null, error: null };
    };

    const api = {
      select(_cols, opts) {
        wantsRows = true;
        if (opts?.count) countMode = opts.count;
        if (opts?.head) headOnly = true;
        return api;
      },
      insert(v) { op = 'insert'; payload = v; wantsRows = false; return api; },
      update(v) { op = 'update'; payload = v; wantsRows = false; return api; },
      upsert(v, opts) { op = 'upsert'; payload = v; onConflict = opts?.onConflict || null; wantsRows = false; return api; },
      delete() { op = 'delete'; wantsRows = false; return api; },
      eq(column, value) { filters.push({ op: 'eq', column, value }); return api; },
      in(column, value) { filters.push({ op: 'in', column, value }); return api; },
      order(column, opts) { order = { column, ascending: opts?.ascending !== false }; return api; },
      limit() { return api; },
      single() { single = 'single'; return api; },
      maybeSingle() { single = 'maybeSingle'; return api; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    return api;
  }

  return {
    from: (table) => builder(table),
    async rpc(name) {
      calls.push({ table: null, op: `rpc:${name}` });
      const value = rpc[name];
      if (value instanceof Error) return { data: null, error: { message: value.message } };
      return { data: value ?? null, error: null };
    },
    /* -------- test inspection -------- */
    _tables: tables,
    _rows: (table) => (tables[table] || []).map(clone),
    _calls: calls,
  };
}
