/**
 * A throwaway in-process mock Supabase for the E2E suite (M4-T009) — TEST
 * INFRASTRUCTURE ONLY, never imported by the app. Implements just enough of
 * the two HTTP surfaces the app exercises:
 *
 *  - GoTrue (`/auth/v1`): signup, password grant, refresh, `/user`, signout.
 *    Sessions are opaque random tokens; `Authorization: Bearer <token>`
 *    maps to a user, exactly like the real service.
 *  - PostgREST (`/rest/v1`): the table verbs the server actions use —
 *    select with `eq`/`in`/`gte`/`ilike`/`or`/`order` filters, `Accept:
 *    vnd.pgrst.object+json` (maybeSingle/single), inserts, updates, deletes,
 *    `Prefer: count=exact` head counts, and the `23505` unique-violation
 *    error shape (an insert/update that violates a unique constraint must
 *    answer the same JSON the real service does, or the idempotent-attach
 *    paths the suite proves would take the wrong branch).
 *
 * Rows are kept in an in-memory `db` with per-club tenant isolation enforced
 * the same way the service-role client path does it (explicit club_id filters
 * — the app's own filters ARE the tenant guard there). No persistence, no
 * concurrency between test workers: the suite runs single-worker so no
 * cross-test state leaks.
 */

import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

/** The fixed port shared by build.mjs and bootstrap.mjs (NEXT_PUBLIC inlining). */
export const MOCK_PORT = 54321;

/**
 * The Claude double's answer rules (TEST INFRASTRUCTURE). Tests steer it
 * over HTTP (`POST /e2e/claude`, see the route below) because the mock runs
 * in the webServer bootstrap's process, not the test worker's. A rule is
 * `{ status, payload, onlyWhenTextIncludes? }`; `onlyWhenTextIncludes`
 * narrows a rule to prompts containing it so multi-step flows can answer
 * differently per call, and an unmatched narrowed rule falls through to
 * `default`.
 */
let claudeRules = [];
let claudeDefault = { status: 200, payload: "{}" };

export function createMockSupabase(port = 0) {
  const now = () => new Date().toISOString();

  // ── GoTrue state ────────────────────────────────────────────────────────────
  /** email → { id, email, password, metadata } */
  const usersByEmail = new Map();
  const usersById = new Map();
  /** access token → refresh token and back */
  const refreshByAccess = new Map();
  const accessByRefresh = new Map();
  /** access token → { userId, expiresAt } */
  const accessTokens = new Map();
  const ACCESS_TTL_SECONDS = 3600;

  function newUser(email, password, metadata = {}) {
    const id = randomUUID();
    const user = {
      id,
      email,
      password,
      metadata,
      created_at: now(),
      last_sign_in_at: now(),
    };
    usersByEmail.set(email, user);
    usersById.set(id, user);
    return user;
  }

  function sessionFor(user) {
    const access = randomBytes(24).toString("base64url");
    const refresh = randomBytes(24).toString("base64url");
    accessTokens.set(access, {
      userId: user.id,
      expiresAt: Date.now() + ACCESS_TTL_SECONDS * 1000,
    });
    refreshByAccess.set(access, refresh);
    accessByRefresh.set(refresh, access);
    return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_SECONDS, token_type: "bearer" };
  }

  /**
   * The flat GoTrue session+user body (signup/token): auth-js reads
   * `access_token`/`user` at the TOP level (`_sessionResponse`), never nested.
   */
  function userResponse(user) {
    const session = sessionFor(user);
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
      token_type: session.token_type,
      user: {
        id: user.id,
        aud: "authenticated",
        role: "authenticated",
        email: user.email,
        email_confirmed_at: user.created_at,
        phone: "",
        confirmed_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: user.metadata,
        identities: [],
        created_at: user.created_at,
      },
    };
  }

  function userFromAuth(req) {
    const header = req.headers.authorization ?? "";
    const token = header.replace(/^Bearer\s+/i, "");
    const entry = accessTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return usersById.get(entry.userId) ?? null;
  }

  // ── PostgREST state ─────────────────────────────────────────────────────────
  /** table → array of row objects */
  const db = new Map();
  for (const table of [
    "clubs", "profiles", "staff_invitations", "superadmin_audit_log",
    "courses", "holes", "tee_sets", "events", "event_formats", "players",
    "groups", "event_players", "event_flights", "event_sponsors",
    "side_games", "scores", "score_audit", "ai_parse_log", "email_log",
    "leagues", "league_members", "rate_limit_state", "pin_attempts",
  ]) {
    db.set(table, []);
  }

  const uuid = () => randomUUID();

  function rows(table) {
    return db.get(table) ?? [];
  }

  // ── PostgREST query parsing ─────────────────────────────────────────────────
  function parseFilters(url) {
    const params = url.searchParams;
    const filters = [];
    for (const [key, raw] of params) {
      // postgrest-js appends filters directly as `col=op.value` — the key is
      // the column and the value is `op.value` (with `or` handled below).
      if (key === "or" || key === "and") continue;
      // Dotted keys (e.g. `events.club_id`) target a joined table this test
      // double does not model — treat them as satisfied.
      if (key.includes(".")) continue;
      const opMatch = /^(eq|neq|gt|gte|lt|lte|ilike|is|in)\.(.*)$/.exec(raw);
      if (opMatch) {
        const [, op, value] = opMatch;
        filters.push({ column: key, op, value });
      }
    }
    const ors = params
      .getAll("or")
      .flatMap((raw) => raw.split(","))
      .map((part) => {
        const m = /^(.*)\.(eq|ilike)\.(.*)$/.exec(part);
        return m ? { column: m[1], op: m[2], value: m[3] } : null;
      })
      .filter(Boolean);
    return { filters, ors };
  }

  /** Numbers when both parse, else lexicographic (ISO timestamps). */
  function numericOrLex(asNumber, targetNumber, asString, target) {
    if (!Number.isNaN(asNumber) && !Number.isNaN(targetNumber)) {
      return Math.sign(asNumber - targetNumber);
    }
    return asString === target ? 0 : asString > target ? 1 : -1;
  }

  function compare(op, cell, value) {
    const asString = String(cell ?? "");
    const target = String(value);
    const asNumber = Number(cell);
    const targetNumber = Number(value);
    switch (op) {
      case "eq": return cell === value || asString === target;
      case "neq": return !(cell === value || asString === target);
      case "gt": return numericOrLex(asNumber, targetNumber, asString, target) > 0;
      case "gte": return numericOrLex(asNumber, targetNumber, asString, target) >= 0;
      case "lt": return numericOrLex(asNumber, targetNumber, asString, target) < 0;
      case "lte": return numericOrLex(asNumber, targetNumber, asString, target) <= 0;
      case "ilike": {
        const pattern = "^" + target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$";
        return new RegExp(pattern, "i").test(asString);
      }
      case "is": return value === "null" ? cell == null : cell === value;
      case "in": {
        const inner = /^\((.*)\)$/.exec(target);
        const list = (inner ? inner[1] : target)
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
        return list.includes(asString);
      }
      default: return false;
    }
  }

  function matchesFilters(row, { filters, ors }) {
    return (
      filters.every(({ column, op, value }) => compare(op, row[column], value)) &&
      (ors.length === 0 || ors.some(({ column, op, value }) => compare(op, row[column], value)))
    );
  }

  function sortRows(list, url) {
    const orders = [];
    for (const [key, value] of url.searchParams) {
      const m = /^(.*)\.(asc|desc)(\.nullsfirst|\.nullslast)?$/.exec(value);
      if (m) orders.push({ column: m[1], dir: m[2] === "asc" ? 1 : -1 });
    }
    if (orders.length === 0) return list;
    return [...list].sort((a, b) => {
      for (const { column, dir } of orders) {
        const av = a[column]; const bv = b[column];
        if (av == null && bv == null) continue;
        if (av == null) return 1 * dir;
        if (bv == null) return -1 * dir;
        if (av === bv) continue;
        return (av < bv ? -1 : 1) * dir;
      }
      return 0;
    });
  }

  // ── Unique constraints the idempotent paths depend on ───────────────────────
  // Mirrors supabase/migrations: a violation answers the 23505 JSON error so
  // the app's "concurrent attach lost the race" branches behave identically.
  function uniqueViolation(table, row) {
    const existing = rows(table);
    const checks = {
      event_players: (r) =>
        existing.some((x) => x.event_id === r.event_id && x.player_id === r.player_id && x.id !== r.id) ||
        existing.some((x) => x.group_token === r.group_token && x.id !== r.id),
      profiles: (r) =>
        r.club_id != null && r.role === "owner" &&
        existing.some((x) => x.club_id === r.club_id && x.role === "owner" && x.is_superadmin === false && x.id !== r.id),
      clubs: (r) => existing.some((x) => x.slug === r.slug && x.id !== r.id),
      events: (r) =>
        r.short_code != null && existing.some((x) => x.short_code === r.short_code),
      groups: (r) =>
        existing.some((x) => x.event_id === r.event_id && x.name === r.name && x.id !== r.id),
      event_formats: (r) =>
        existing.some((x) => x.event_id === r.event_id && x.format === r.format && x.id !== r.id),
      event_flights: (r) =>
        existing.some((x) => x.event_id === r.event_id && x.name === r.name && x.id !== r.id),
      event_sponsors: (r) =>
        existing.some((x) => x.event_id === r.event_id && x.name === r.name && x.id !== r.id),
    };
    const check = checks[table];
    return check ? check(row) : false;
  }

  const UNIQUE_ERROR = (message) => ({
    code: "23505",
    message,
    details: "Key already exists",
    hint: null,
  });

  function notFound(url) {
    const message = `"${url.pathname}" does not exist`;
    return { code: "42P01", message, details: null, hint: null };
  }

  function applyUpsertDefaults(table, row) {
    const defaults = {
      clubs: { name: "", slug: "", plan: "free", billing_status: "inactive", timezone: "America/New_York", created_at: now(), updated_at: now() },
      profiles: { full_name: "", role: "event_manager", is_superadmin: false, created_at: now(), updated_at: now() },
      courses: { name: "", country: "US", holes_count: 18, created_at: now(), updated_at: now() },
      holes: {},
      tee_sets: {},
      events: { status: "draft", holes_count: 18, nine_option: "front", rounds: 1, start_type: "tee_times", is_public: true, scorer_pin_hash: "x", scorer_pin_salt: "y", created_at: now(), updated_at: now() },
      event_formats: { is_primary: false, team_size: 1, scoring_basis: "both", max_score_rule: "none", tiebreak_method: "card_off", created_at: now(), updated_at: now() },
      players: { created_at: now(), updated_at: now() },
      groups: { starting_hole: null, cart_number: null, created_at: now() },
      event_players: { created_at: now(), group_token: randomBytes(16).toString("hex") },
      event_flights: { position: 0, created_at: now() },
      event_sponsors: { position: 0, created_at: now() },
      side_games: { created_at: now() },
      scores: { client_ts: now(), server_ts: now() },
      score_audit: { created_at: now() },
      ai_parse_log: { created_at: now() },
    };
    return { ...(defaults[table] ?? {}), ...row };
  }

  function withId(table, row) {
    if (row.id == null) return { ...row, id: uuid() };
    return row;
  }

  // ── The HTTP server ─────────────────────────────────────────────────────────
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = bodyText.length > 0 && /json/.test(String(req.headers["content-type"] ?? ""))
        ? JSON.parse(bodyText)
        : undefined;
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      const json = (status, payload, headers = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(payload));
      };

      try {
        route(req, res, url, body, json);
      } catch (error) {
        json(500, { message: error instanceof Error ? error.message : String(error), error: "internal" });
      }
    });
  });

  function route(req, res, url, body, json) {
    const path = url.pathname;

    // ── Health ─────────────────────────────────────────────────────────────
    if (path === "/healthz") {
      json(200, { ok: true });
      return;
    }

    // ── Test control surface ────────────────────────────────────────────────
    // Tests run in Playwright's worker process while this mock lives in the
    // webServer bootstrap's, so the Claude double is steered over HTTP:
    //   POST /e2e/claude  { rules: [{status, payload, onlyWhenTextIncludes?}], default?: {status, payload} }
    //   DELETE /e2e/claude  — reset to the inert default
    if (path === "/e2e/claude" && (req.method === "POST" || req.method === "DELETE")) {
      if (req.method === "DELETE") {
        claudeRules = [];
        claudeDefault = { status: 200, payload: "{}" };
        json(200, { ok: true });
        return;
      }
      const parsed = typeof body === "object" && body !== null ? body : {};
      if (!Array.isArray(parsed.rules)) {
        json(400, { ok: false, message: "POST { rules: [...] }" });
        return;
      }
      claudeRules = parsed.rules.filter(
        (rule) =>
          rule && typeof rule === "object" &&
          typeof rule.status === "number" &&
          typeof rule.payload === "string",
      );
      claudeDefault =
        parsed.default && typeof parsed.default === "object" &&
        typeof parsed.default.status === "number" &&
        typeof parsed.default.payload === "string"
          ? parsed.default
          : { status: 200, payload: "{}" };
      json(200, { ok: true });
      return;
    }

    // ── Claude Messages API double (ANTHROPIC_BASE_URL points here) ─────────
    // The AI tests set ANTHROPIC_API_KEY and route the adapter's single
    // Haiku call here; `claudeResponseFor` decides what the "model" answers.
    if (path === "/v1/messages" && req.method === "POST") {
      const userText = String(body?.messages?.[0]?.content ?? "");
      const narrowed = claudeRules.filter((rule) => {
        const needle = rule.onlyWhenTextIncludes;
        return typeof needle === "string" && userText.includes(needle);
      });
      const answer = narrowed.length > 0 ? narrowed[0] : claudeDefault;
      if (answer.status !== 200) {
        json(answer.status, { type: "error", error: answer.payload });
        return;
      }
      json(200, {
        id: "msg_e2e",
        type: "message",
        role: "assistant",
        model: body?.model ?? "claude-haiku-latest",
        content: [{ type: "text", text: answer.payload }],
      });
      return;
    }

    // ── GoTrue /auth/v1 ─────────────────────────────────────────────────────
    if (path === "/auth/v1/signup" && req.method === "POST") {
      const email = String(body?.email ?? "").toLowerCase();
      const password = String(body?.password ?? "");
      if (!email || !password) {
        json(400, { code: 400, msg: "invalid request" });
        return;
      }
      if (usersByEmail.has(email)) {
        // The app treats 400/422 as "already registered" → re-authenticate.
        json(400, { code: 400, msg: "User already registered", error: "invalid_grant" });
        return;
      }
      const user = newUser(email, password, body?.options?.data ?? {});
      json(200, userResponse(user));
      return;
    }

    if (path === "/auth/v1/token" && req.method === "POST") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const email = String(body?.email ?? "").toLowerCase();
        const password = String(body?.password ?? "");
        const user = usersByEmail.get(email);
        if (!user || user.password !== password) {
          json(400, { code: 400, msg: "Invalid login credentials", error: "invalid_grant" });
          return;
        }
        user.last_sign_in_at = now();
        json(200, userResponse(user));
        return;
      }
      if (grant === "refresh_token") {
        const refresh = String(body?.refresh_token ?? "");
        const access = accessByRefresh.get(refresh);
        const entry = access && accessTokens.get(access);
        if (!entry) {
          json(400, { code: 400, msg: "Invalid refresh token", error: "invalid_grant" });
          return;
        }
        const user = usersById.get(entry.userId);
        json(200, userResponse(user));
        return;
      }
      json(400, { msg: "unsupported grant" });
      return;
    }

    if (path === "/auth/v1/user" && req.method === "GET") {
      const user = userFromAuth(req);
      if (!user) {
        json(401, { code: 401, msg: "Invalid API key", error: "unauthorized" });
        return;
      }
      json(200, userResponse(user).user);
      return;
    }

    if (path === "/auth/v1/logout" && req.method === "POST") {
      const header = req.headers.authorization ?? "";
      const token = header.replace(/^Bearer\s+/i, "");
      const refresh = refreshByAccess.get(token);
      if (refresh) accessByRefresh.delete(refresh);
      accessTokens.delete(token);
      refreshByAccess.delete(token);
      json(204, {});
      return;
    }

    // ── PostgREST /rest/v1 ──────────────────────────────────────────────────
    const rest = /^\/rest\/v1\/([A-Za-z_][A-Za-z0-9_]*)/.exec(path);
    if (!rest) {
      json(404, notFound(url));
      return;
    }
    const table = rest[1];
    if (!db.has(table)) {
      json(404, notFound(url));
      return;
    }

    const accept = String(req.headers.accept ?? "");
    const wantsObject = accept.includes("vnd.pgrst.object");
    const wantsCount = /count=(exact|planned|estimated)/.test(String(req.headers.prefer ?? ""));
    const filterInfo = parseFilters(url);
    const columns = url.searchParams.get("select");

    // Scoped to route() (not the GET branch): PATCH/POST/DELETE return
    // representations through it too.
    function projectRow(row) {
      if (!columns) return row;
      const cleaned = columns.replace(/\(.*?\)/g, "").split(",").map((c) => c.trim()).filter(Boolean);
      const out = {};
      for (const key of cleaned) out[key] = row[key];
      return out;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      let list = rows(table).filter((row) => matchesFilters(row, filterInfo));
      list = sortRows(list, url);
      const limit = Number(url.searchParams.get("limit") ?? "0");
      if (limit > 0) list = list.slice(0, limit);
      const total = rows(table).filter((row) => matchesFilters(row, filterInfo)).length;
      if (wantsObject) {
        if (list.length > 1) {
          json(406, { code: "PGRST116", details: "multiple rows returned", hint: null, message: "JSON object requested, multiple (or no) rows returned" });
          return;
        }
        const headers = wantsCount ? { "content-range": `0${list.length}/0${total}` } : {};
        json(200, list.length === 1 ? projectRow(list[0]) : null, headers);
        return;
      }
      const headers = wantsCount
        ? { "content-range": `0-${Math.max(0, list.length - 1)}/${total}` }
        : {};
      json(200, list.map(projectRow), headers);
      return;
    }

    if (req.method === "POST" && path.startsWith("/rest/v1/rpc/")) {
      json(404, notFound(url));
      return;
    }

    if (req.method === "POST") {
      const wantsReturn = /return=(representation|minimal)/.test(String(req.headers.prefer ?? ""));
      const inputs = Array.isArray(body) ? body : [body];
      const inserted = [];
      for (const input of inputs) {
        if (input == null || typeof input !== "object") continue;
        let row = withId(table, applyUpsertDefaults(table, { ...input }));
        if (uniqueViolation(table, row)) {
          json(409, UNIQUE_ERROR(`duplicate key value violates unique constraint "${table}"`));
          return;
        }
        db.set(table, [...rows(table), row]);
        inserted.push(row);
      }
      if (!wantsReturn || /return=representation/.test(String(req.headers.prefer ?? ""))) {
        json(201, Array.isArray(body) ? inserted.map(projectRow) : inserted.map(projectRow)[0] ?? null);
      } else {
        json(201, null);
      }
      return;
    }

    if (req.method === "PATCH") {
      const list = rows(table).filter((row) => matchesFilters(row, filterInfo));
      if (list.length === 0) {
        json(200, wantsObject ? null : [], wantsCount ? { "content-range": `0--1/0` } : {});
        return;
      }
      for (const row of list) {
        if (body && typeof body === "object") {
          if (body.id != null && uniqueViolation(table, { ...row, ...body })) {
            json(409, UNIQUE_ERROR(`duplicate key value violates unique constraint "${table}"`));
            return;
          }
          Object.assign(row, body, { updated_at: body.updated_at ?? now() });
        }
      }
      json(200, wantsObject ? (list.length === 1 ? projectRow(list[0]) : null) : list.map(projectRow));
      return;
    }

    if (req.method === "DELETE") {
      const list = rows(table).filter((row) => matchesFilters(row, filterInfo));
      const total = list.length;
      for (const row of list) {
        db.set(
          table,
          rows(table).filter((x) => x !== row),
        );
      }
      json(200, wantsObject ? (total === 1 ? projectRow(list[0]) : null) : list.map(projectRow),
        wantsCount ? { "content-range": `0-${Math.max(0, total - 1)}/${total}` } : {});
      return;
    }

    json(405, { code: "405", message: "method not allowed", details: null, hint: null });
  }

  const listening = new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server.address()));
  });

  return {
    server,
    listening,
    /** The db handle — tests use it for state inspection/reset (same process). */
    get db() {
      return db;
    },
  };
}
