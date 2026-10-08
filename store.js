// Persistence for accounts and play history.
// Uses Postgres via DATABASE_URL (e.g. Supabase) in production; falls back to an embedded
// PGlite database in ~/.capsa-banting-online for local development so no setup is needed.
const path = require('path');
const crypto = require('crypto');

const SCHEMA = [
  `create table if not exists users (
    id serial primary key,
    username text not null,
    username_lc text not null unique,
    pass_hash text not null,
    name text not null,
    avatar text not null default '🦊',
    created_at timestamptz not null default now()
  )`,
  `create table if not exists auth_sessions (
    token_hash text primary key,
    user_id integer not null references users(id) on delete cascade,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists matches (
    id serial primary key,
    room_code text not null,
    mult integer not null,
    games integer not null default 0,
    started_at timestamptz not null default now(),
    ended_at timestamptz
  )`,
  `create table if not exists match_players (
    match_id integer not null references matches(id) on delete cascade,
    pkey text not null,
    user_id integer references users(id) on delete set null,
    name text not null,
    avatar text,
    is_bot boolean not null default false,
    total_points integer not null default 0,
    wins integer not null default 0,
    games integer not null default 0,
    final_rank integer,
    net_amount double precision,
    primary key (match_id, pkey)
  )`,
  `create table if not exists games (
    id serial primary key,
    match_id integer not null references matches(id) on delete cascade,
    game_no integer not null,
    winner_name text not null,
    played_at timestamptz not null default now()
  )`,
  `create table if not exists game_players (
    game_id integer not null references games(id) on delete cascade,
    pkey text not null,
    user_id integer references users(id) on delete set null,
    name text not null,
    points integer not null,
    cards_left integer not null,
    detail text,
    is_winner boolean not null default false
  )`,
  'create index if not exists game_players_user on game_players(user_id)',
  'create index if not exists match_players_user on match_players(user_id)',
  'create index if not exists games_match on games(match_id)',
];

let db = null;

async function init() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: 5,
    });
    // tables live in their own schema so Supabase's public REST API never exposes them
    const schema = process.env.DB_SCHEMA || 'capsa';
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid DB_SCHEMA');
    pool.on('connect', (client) => client.query('set search_path to ' + schema));
    db = { kind: 'postgres', query: (sql, params) => pool.query(sql, params) };
    await db.query('create schema if not exists ' + schema);
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || path.join(require('os').homedir(), '.capsa-banting-online', 'pglite');
    require('fs').mkdirSync(path.dirname(dir), { recursive: true });
    const lite = new PGlite(dir);
    db = { kind: 'pglite', query: (sql, params) => lite.query(sql, params) };
  }
  for (const stmt of SCHEMA) await db.query(stmt);
  return db.kind;
}

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0] || null;
const inList = (ids, start = 1) => ids.map((_, i) => '$' + (i + start)).join(',');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- users & sessions ----------
async function findUserByUsername(username) {
  return one('select * from users where username_lc = $1', [String(username).toLowerCase()]);
}
async function createUser({ username, passHash, name, avatar }) {
  return one(
    'insert into users (username, username_lc, pass_hash, name, avatar) values ($1, $2, $3, $4, $5) returning id, username, name, avatar',
    [username, username.toLowerCase(), passHash, name, avatar],
  );
}
async function updateUser(id, { name, avatar }) {
  return one('update users set name = coalesce($2, name), avatar = coalesce($3, avatar) where id = $1 returning id, username, name, avatar', [id, name || null, avatar || null]);
}
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q('insert into auth_sessions (token_hash, user_id) values ($1, $2)', [sha(token), userId]);
  return token;
}
async function userByToken(token) {
  if (!token || typeof token !== 'string') return null;
  return one('select u.id, u.username, u.name, u.avatar from auth_sessions s join users u on u.id = s.user_id where s.token_hash = $1', [sha(token)]);
}
async function deleteSession(token) {
  if (token) await q('delete from auth_sessions where token_hash = $1', [sha(token)]);
}

// ---------- matches (one table session = from first game until "Akhiri Permainan") ----------
async function createMatch(roomCode, mult) {
  return (await one('insert into matches (room_code, mult) values ($1, $2) returning id', [roomCode, mult])).id;
}

// game: { gameNo, winnerName, mult, rows: [{pkey, userId, name, points, left, detail, winner}], totals: [{pkey, userId, name, avatar, bot, score, wins, games}] }
async function recordGame(matchId, game) {
  const g = await one('insert into games (match_id, game_no, winner_name) values ($1, $2, $3) returning id', [matchId, game.gameNo, game.winnerName]);
  for (const r of game.rows) {
    await q('insert into game_players (game_id, pkey, user_id, name, points, cards_left, detail, is_winner) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [g.id, r.pkey, r.userId || null, r.name, r.points, r.left, r.detail, !!r.winner]);
  }
  for (const t of game.totals) {
    await q(`insert into match_players (match_id, pkey, user_id, name, avatar, is_bot, total_points, wins, games)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             on conflict (match_id, pkey) do update set name = excluded.name, avatar = excluded.avatar,
               total_points = excluded.total_points, wins = excluded.wins, games = excluded.games`,
      [matchId, t.pkey, t.userId || null, t.name, t.avatar, !!t.bot, t.score, t.wins, t.games]);
  }
  await q('update matches set games = $2, mult = $3 where id = $1', [matchId, game.gameNo, game.mult]);
}

// final: { mult, players: [{pkey, rank, net}] }
async function finishMatch(matchId, final) {
  await q('update matches set ended_at = now(), mult = $2 where id = $1', [matchId, final.mult]);
  for (const p of final.players) {
    await q('update match_players set final_rank = $3, net_amount = $4 where match_id = $1 and pkey = $2', [matchId, p.pkey, p.rank, p.net]);
  }
}

// ---------- profile & history ----------
async function stats(userId) {
  const g = await one(`select count(*)::int as games, (count(*) filter (where is_winner))::int as wins, coalesce(sum(points), 0)::int as points
                       from game_players where user_id = $1`, [userId]);
  const m = await one(`select count(*)::int as matches, coalesce(sum(net_amount), 0)::float8 as net
                       from match_players where user_id = $1`, [userId]);
  return { ...g, ...m };
}

async function history(userId, limit = 30) {
  const matches = await q(`select m.id, m.room_code, m.mult, m.games, m.started_at, m.ended_at,
                                  mp.total_points, mp.final_rank, mp.net_amount::float8 as net
                           from match_players mp join matches m on m.id = mp.match_id
                           where mp.user_id = $1 order by m.started_at desc limit $2`, [userId, limit]);
  if (matches.length) {
    const ids = matches.map((m) => m.id);
    const players = await q(`select match_id, name, avatar, is_bot, user_id, total_points, wins, final_rank, net_amount::float8 as net
                             from match_players where match_id in (${inList(ids)}) order by total_points desc`, ids);
    for (const m of matches) m.players = players.filter((p) => p.match_id === m.id);
  }
  const friends = await q(`select o.user_id, max(o.name) as name, max(o.avatar) as avatar, count(distinct o.match_id)::int as matches,
                                  coalesce(sum(o.games), 0)::int as games
                           from match_players me
                           join match_players o on o.match_id = me.match_id and o.user_id is not null and o.user_id <> me.user_id
                           where me.user_id = $1 group by o.user_id order by matches desc, games desc limit 10`, [userId]);
  return { matches, friends };
}

async function matchDetail(matchId, userId) {
  const member = await one('select 1 as ok from match_players where match_id = $1 and user_id = $2', [matchId, userId]);
  if (!member) return null;
  const match = await one('select id, room_code, mult, games, started_at, ended_at from matches where id = $1', [matchId]);
  const players = await q(`select name, avatar, is_bot, user_id, total_points, wins, final_rank, net_amount::float8 as net
                           from match_players where match_id = $1 order by total_points desc`, [matchId]);
  const games = await q('select id, game_no, winner_name, played_at from games where match_id = $1 order by game_no', [matchId]);
  const rows = await q(`select gp.game_id, gp.name, gp.points, gp.cards_left, gp.detail, gp.is_winner
                        from game_players gp join games g on g.id = gp.game_id where g.match_id = $1`, [matchId]);
  for (const g of games) g.rows = rows.filter((r) => r.game_id === g.id);
  return { match, players, games };
}

module.exports = {
  init, kind: () => db && db.kind,
  findUserByUsername, createUser, updateUser, createSession, userByToken, deleteSession,
  createMatch, recordGame, finishMatch, stats, history, matchDetail,
};