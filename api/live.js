const API_BASE = 'https://v3.football.api-sports.io';
const WORLD_CUP_LEAGUE = process.env.APIFOOTBALL_LEAGUE || '1';
const WORLD_CUP_SEASON = process.env.APIFOOTBALL_SEASON || '2026';

function pad2(n) { return String(n).padStart(2, '0'); }
function dayISO(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

async function api(path) {
  const key = process.env.APIFOOTBALL_KEY || process.env.API_FOOTBALL_KEY;
  if (!key) {
    const err = new Error('APIFOOTBALL_KEY missing');
    err.status = 503;
    throw err;
  }
  const r = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    headers: { 'x-apisports-key': key }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.message || `API-Football HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

function status(short) {
  const s = short || '';
  if (['NS', 'TBD'].includes(s)) return 'NS';
  if (['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD'].includes(s)) return s;
  return s || 'Live';
}

function normaliseFixture(f) {
  return {
    idEvent: `af:${f.fixture.id}`,
    apiFootballFixtureId: f.fixture.id,
    strSource: 'api-football',
    strTimestamp: f.fixture.date,
    dateEvent: (f.fixture.date || '').slice(0, 10),
    strHomeTeam: f.teams.home.name,
    strAwayTeam: f.teams.away.name,
    intHomeScore: f.goals.home == null ? null : String(f.goals.home),
    intAwayScore: f.goals.away == null ? null : String(f.goals.away),
    strStatus: status(f.fixture.status.short),
    strProgress: f.fixture.status.elapsed == null ? '' : String(f.fixture.status.elapsed),
    strVenue: f.fixture.venue && f.fixture.venue.name,
    strCity: f.fixture.venue && f.fixture.venue.city
  };
}

function normaliseEvent(ev) {
  return {
    strTimeline: ev.type || '',
    strTimelineDetail: ev.detail || '',
    intTime: ev.time && ev.time.extra ? `${ev.time.elapsed}+${ev.time.extra}` : String((ev.time && ev.time.elapsed) || ''),
    strHome: ev.team && ev.team.name ? undefined : '',
    strTeam: ev.team && ev.team.name,
    strPlayer: ev.player && ev.player.name,
    strAssist: ev.assist && ev.assist.name
  };
}

function normaliseStat(s) {
  return {
    strStat: s.type,
    intHome: s.home == null ? '' : String(s.home),
    intAway: s.away == null ? '' : String(s.away)
  };
}

async function feed() {
  const dates = [dayISO(-1), dayISO(0), dayISO(1)];
  const responses = await Promise.all(dates.map(d => api(`/fixtures?league=${WORLD_CUP_LEAGUE}&season=${WORLD_CUP_SEASON}&date=${d}`)));
  const byId = new Map();
  for (const data of responses) for (const f of data.response || []) byId.set(f.fixture.id, normaliseFixture(f));
  return { events: [...byId.values()] };
}

async function detail(id) {
  if (!id) return { timeline: [], eventstats: [] };
  const [fixture, events, stats] = await Promise.all([
    api(`/fixtures?id=${encodeURIComponent(id)}`),
    api(`/fixtures/events?fixture=${encodeURIComponent(id)}`),
    api(`/fixtures/statistics?fixture=${encodeURIComponent(id)}`)
  ]);
  const event = (fixture.response || [])[0] ? normaliseFixture(fixture.response[0]) : null;
  const timeline = (events.response || []).map(normaliseEvent);
  const home = (stats.response || [])[0] || { statistics: [] };
  const away = (stats.response || [])[1] || { statistics: [] };
  const names = new Set([...(home.statistics || []), ...(away.statistics || [])].map(x => x.type));
  const eventstats = [...names].map(type => normaliseStat({
    type,
    home: (home.statistics || []).find(x => x.type === type)?.value,
    away: (away.statistics || []).find(x => x.type === type)?.value
  }));
  return { events: event ? [event] : [], timeline, eventstats };
}

export default async function handler(req, res) {
  try {
    const type = req.query.type || 'feed';
    const body = type === 'detail' ? await detail(req.query.id) : await feed();
    res.setHeader('Cache-Control', type === 'detail' ? 's-maxage=10, stale-while-revalidate=10' : 's-maxage=20, stale-while-revalidate=30');
    res.status(200).json(body);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'API-Football failed' });
  }
}
