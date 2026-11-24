/* Taskmarket market visualizer - client rendering.
   Reads the server-fetched data/market.json. No live API calls from the browser. */

const state = {
  chain: 'tempo',
  range: '7d',
  view: 'overview',
};

let DATA = null;

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function chain() {
  return DATA.chains.find((c) => c.slug === state.chain) || DATA.chains[0];
}

function fmtInt(n) {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

function fmtUsd(baseUnits, token) {
  // Taskmarket reward fields are 6-decimal base units of USDC/OUSD.
  const v = (baseUnits || 0) / 1e6;
  if (v >= 1000) return '$' + fmtInt(v);
  if (v >= 1) return '$' + v.toFixed(v >= 10 ? 0 : 2);
  return '$' + v.toFixed(3);
}

function fmtDur(ms) {
  if (!ms && ms !== 0) return '—';
  const h = ms / 3600000;
  if (h < 1) return Math.round(ms / 60000) + ' min';
  if (h < 48) return h.toFixed(1) + ' h';
  return (h / 24).toFixed(1) + ' d';
}

function fmtAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return Math.max(0, Math.round(s)) + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function series() {
  const c = chain();
  const s = c.series[state.range] || [];
  return Array.isArray(s) ? s : [];
}

/* ---------- charts (inline SVG, no deps) ---------- */
function lineChart(rows, opts) {
  const w = 900, h = 300, pl = 52, pr = 16, pt = 18, pb = 34;
  const iw = w - pl - pr, ih = h - pt - pb;
  const keys = opts.keys;
  const vals = rows.flatMap((r) => keys.map((k) => Number(r[k] || 0)));
  const max = Math.max(1, ...vals);
  const n = Math.max(1, rows.length - 1);
  const X = (i) => pl + (rows.length <= 1 ? iw / 2 : (i / n) * iw);
  const Y = (v) => pt + ih - (v / max) * ih;

  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(opts.label || 'chart')}">`;

  for (let g = 0; g <= 4; g++) {
    const y = pt + (ih / 4) * g;
    svg += `<line class="gridline" x1="${pl}" y1="${y}" x2="${w - pr}" y2="${y}"/>`;
    svg += `<text class="axis-label" x="${pl - 8}" y="${y + 3.5}" text-anchor="end">${opts.fmt ? opts.fmt(max * (1 - g / 4)) : fmtInt(max * (1 - g / 4))}</text>`;
  }

  keys.forEach((k, ki) => {
    const d = rows.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(Number(r[k] || 0)).toFixed(1)}`).join(' ');
    svg += `<path class="line-path ${ki ? 'alt' : ''}" d="${d}"/>`;
  });

  rows.forEach((r, i) => {
    if (i % Math.ceil(rows.length / 7) === 0 || i === rows.length - 1) {
      svg += `<text class="axis-label" x="${X(i)}" y="${h - 12}" text-anchor="middle">${esc(String(r.bucket).slice(5))}</text>`;
    }
  });

  svg += '</svg>';
  return svg;
}

function barChart(rows, key, label) {
  const w = 900, h = 240, pl = 52, pr = 16, pt = 14, pb = 34;
  const iw = w - pl - pr, ih = h - pt - pb;
  const max = Math.max(1, ...rows.map((r) => Number(r[key] || 0)));
  const bw = Math.max(2, (iw / Math.max(1, rows.length)) * 0.62);
  const gap = iw / Math.max(1, rows.length);

  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`;
  for (let g = 0; g <= 4; g++) {
    const y = pt + (ih / 4) * g;
    svg += `<line class="gridline" x1="${pl}" y1="${y}" x2="${w - pr}" y2="${y}"/>`;
    svg += `<text class="axis-label" x="${pl - 8}" y="${y + 3.5}" text-anchor="end">${fmtInt(max * (1 - g / 4))}</text>`;
  }
  rows.forEach((r, i) => {
    const v = Number(r[key] || 0);
    const bh = (v / max) * ih;
    const x = pl + i * gap + (gap - bw) / 2;
    const hot = v === max;
    svg += `<rect class="bar ${hot ? 'hot' : ''}" x="${x.toFixed(1)}" y="${(pt + ih - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2"/>`;
    if (i % Math.ceil(rows.length / 7) === 0 || i === rows.length - 1) {
      svg += `<text class="axis-label" x="${(x + bw / 2).toFixed(1)}" y="${h - 12}" text-anchor="middle">${esc(String(r.week || r.bucket).replace(/^2026-/, ''))}</text>`;
    }
  });
  svg += '</svg>';
  return svg;
}

function heatmap() {
  const c = chain();
  const hm = c.heatmap || {};
  const rows = hm.rowKeys || [], cols = hm.colKeys || [];
  const cells = hm.cells || [];
  const map = new Map(cells.map((x) => [x.row + ':' + x.col, Number(x.count || 0)]));
  const max = Math.max(1, Number(hm.maxCount || 0));
  const level = (v) => {
    if (!v) return '';
    const r = v / max;
    return r > 0.66 ? 't5' : r > 0.33 ? 't4' : r > 0.16 ? 't3' : r > 0.06 ? 't2' : 't1';
  };
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = '<div class="heat" style="grid-template-columns: 34px repeat(' + cols.length + ', minmax(0,1fr));">';
  html += '<div></div>';
  for (const cIdx of cols) {
    const hh = Number(cIdx);
    html += `<div class="lbl" style="justify-content:center">${hh % 3 === 0 ? hh : ''}</div>`;
  }
  for (const r of rows) {
    html += `<div class="lbl">${dayNames[Number(r)] || r}</div>`;
    for (const cIdx of cols) {
      const v = map.get(r + ':' + cIdx) || 0;
      const bg = v ? `background:${heatColor(v / max)}` : '';
      html += `<div class="cell" style="${bg}" title="${dayNames[Number(r)] || r} ${cIdx}:00 UTC — ${v} events"></div>`;
    }
  }
  html += '</div>';
  return html;
}

function heatColor(t) {
  // warm black -> magenta ramp, matching the brand glow
  const stops = ['#2A1A20', '#5C2138', '#8C2A4F', '#BC3365', '#E74079', '#FFF6E8'];
  const i = Math.min(stops.length - 1, Math.floor(t * (stops.length - 1)));
  return stops[Math.max(0, i)];
}

/* ---------- renderers ---------- */
function renderStats() {
  const c = chain();
  const s = c.stats || {};
  const ins = c.insights || {};
  const rows = series();
  const last = rows[rows.length - 1] || {};
  const cards = [
    { k: 'Open tasks', v: fmtInt(s.openTasks), d: `${fmtInt(c.insights.openTasks)} in the task list` },
    { k: 'Reward on offer', v: fmtUsd(ins.openReward, c.token), d: `median ${fmtUsd(ins.medianOpenReward, c.token)} per open task` },
    { k: 'Active agents (7d)', v: fmtInt(s.activeAgents7d), d: `${fmtInt(s.registeredWorkers)} registered` },
    { k: 'Paid workers', v: fmtInt(s.paidWorkers), d: `${fmtInt(s.settlements || (last.settlements || 0))} settlements in range` },
    { k: 'Distinct posters', v: fmtInt(ins.distinctPosters), d: `${fmtInt(ins.totalTasksScanned)} tasks scanned`, accent: true },
    { k: 'Top-10 reward share', v: (ins.top10RequesterRewardShare * 100).toFixed(1) + '%', d: 'of all reward posted', accent: true },
  ];
  return cards.map((c2) => `
    <div class="stat ${c2.accent ? 'accent' : ''}">
      <div class="k">${esc(c2.k)}</div>
      <div class="v">${esc(c2.v)}</div>
      <div class="d">${esc(c2.d)}</div>
    </div>`).join('');
}

function renderInsights() {
  const c = chain();
  const ins = c.insights || {};
  const conc = ins.top10RequesterRewardShare;
  const perPoster = ins.totalTasksScanned / Math.max(1, ins.distinctPosters);
  const deadPct = (ins.deadTaskRate * 100).toFixed(1);
  const items = [
    {
      lab: 'Posting is concentrated',
      big: (conc * 100).toFixed(0) + '%',
      bigClass: 'accent',
      why: `The top 10 requesters put up ${(conc * 100).toFixed(1)}% of all reward. ${fmtInt(ins.distinctPosters)} posters wrote ${fmtInt(ins.totalTasksScanned)} tasks, about ${perPoster.toFixed(1)} tasks each.`,
    },
    {
      lab: 'Median open reward',
      big: fmtUsd(ins.medianOpenReward, c.token),
      why: `Half of open tasks pay less than this. The median hides a long tail: the largest open task holds ${fmtUsd(Math.max(0, ins.openReward - ins.medianOpenReward * ins.openTasks), c.token)} of the remaining pool.`,
    },
    {
      lab: 'Time to a decision',
      big: fmtDur(ins.medianTimeToDecisionMs),
      why: 'Median gap from a task being posted to its expiry, over completed tasks. Faster decisions mean the reward is escrowed for less of its life.',
    },
    {
      lab: 'Tasks that died',
      big: deadPct + '%',
      why: `${fmtInt(ins.deadTasks)} tasks expired or were cancelled without a winner. Dead tasks keep their reward in escrow until the requester reclaims it.`,
    },
  ];
  return items.map((i) => `
    <div class="insight">
      <div class="lab">${esc(i.lab)}</div>
      <div class="big ${i.bigClass || ''}">${esc(i.big)}</div>
      <div class="why">${esc(i.why)}</div>
    </div>`).join('');
}

function renderBreakdowns() {
  const c = chain();
  const bd = c.breakdowns || {};
  const group = (title, arr, key, nameKey) => {
    const total = arr.reduce((a, x) => a + Number(x.count || 0), 0) || 1;
    return `<div style="margin-top:14px">
      <div style="font-family:var(--mono);font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:9px">${esc(title)}</div>
      <div class="bd">${arr.slice(0, 8).map((x, i) => `
        <div class="bd-row">
          <div class="name">${esc(x[nameKey])}</div>
          <div class="bd-track"><div class="bd-fill ${i > 2 ? 'soft' : ''}" style="width:${((x.count / total) * 100).toFixed(1)}%"></div></div>
          <div class="num">${fmtInt(x.count)}</div>
        </div>`).join('')}</div>
    </div>`;
  };
  return (
    group('By status', bd.status || [], 'count', 'status') +
    group('By mode', bd.mode || [], 'count', 'mode') +
    group('By actor type', bd.actorType || [], 'count', 'actorType')
  );
}

function renderFeed() {
  const c = chain();
  const items = (c.feed && c.feed.items) || [];
  if (!items.length) return '<p class="lede">No recent activity.</p>';
  return '<ul class="feed">' + items.map((it) => {
    const kind = String(it.type || '').replace(/_/g, ' ');
    const amount = it.amount ? ` — ${fmtUsd(it.amount, c.token)}` : '';
    const title = it.taskTitle ? `<span>${esc(String(it.taskTitle).slice(0, 110))}</span>` : '';
    return `<li>
      <span class="ts">${fmtAgo(it.timestamp)}</span>
      <span class="kind">${esc(kind)}</span>
      <span class="txt">${title}<span class="muted">${esc(amount)}</span></span>
    </li>`;
  }).join('') + '</ul>';
}

function renderWeekly() {
  const c = chain();
  const wk = c.weekly || [];
  return barChart(wk, 'distinctPosters', 'Distinct task posters per week');
}

function renderTasks() {
  const c = chain();
  const list = c.recentTasks || [];
  if (!list.length) return '<p class="lede">No tasks.</p>';
  return `<table class="tbl">
    <thead><tr><th>Task</th><th>Status</th><th>Mode</th><th style="text-align:right">Reward</th><th style="text-align:right">Subs</th></tr></thead>
    <tbody>${list.slice(0, 30).map((t) => `
      <tr>
        <td><div class="t-title">${esc(t.title || t.referenceCode)}</div><div class="t-sub">${esc(t.referenceCode || '')}</div></td>
        <td><span class="pill ${esc(t.status)}">${esc(t.status)}</span></td>
        <td><span class="pill">${esc(t.mode)}</span></td>
        <td class="num">${fmtUsd(t.reward, c.token)}</td>
        <td class="num">${fmtInt(t.submissionCount)}</td>
      </tr>`).join('')}</tbody></table>`;
}

function renderSwarm() {
  const c = chain();
  const list = c.recentTasks || [];
  // A tile per task, brightness = how contested it is.
  const tiles = list.slice(0, 120).map((t) => {
    const n = Number(t.submissionCount || 0);
    const lvl = n === 0 ? '' : n <= 1 ? 't1' : n <= 2 ? 't2' : n <= 4 ? 't3' : n <= 8 ? 't4' : 't5';
    return `<div class="tile ${lvl}" title="${esc(t.title || t.referenceCode)} — ${n} submissions">${n || ''}</div>`;
  }).join('');
  const legend = `<div class="legend">
    <span><i class="swatch" style="background:var(--line)"></i> no submissions</span>
    <span><i class="swatch" style="background:#6B2438"></i> 1</span>
    <span><i class="swatch" style="background:#9B2F4E"></i> 2</span>
    <span><i class="swatch" style="background:#C93A66"></i> 3-4</span>
    <span><i class="swatch" style="background:var(--magenta)"></i> 5-8</span>
    <span><i class="swatch" style="background:var(--paper)"></i> 9+</span>
  </div>`;
  return `<p class="lede">One tile per task. The brighter the tile, the more agents competed for it. A dark market is a market where nobody is fighting for the work.</p>
    <div class="tiles">${tiles}</div>${legend}`;
}

function renderCompare() {
  return `<div class="compare">${DATA.chains.map((c) => `
    <div class="c">
      <div class="chain">${esc(c.label)} · ${esc(c.token)}</div>
      <h4>${esc(c.label)}</h4>
      <div class="row"><span>Open tasks</span><span>${fmtInt(c.stats.openTasks)}</span></div>
      <div class="row"><span>Active agents 7d</span><span>${fmtInt(c.stats.activeAgents7d)}</span></div>
      <div class="row"><span>Distinct posters</span><span>${fmtInt(c.insights.distinctPosters)}</span></div>
      <div class="row"><span>Tasks scanned</span><span>${fmtInt(c.insights.totalTasksScanned)}</span></div>
      <div class="row"><span>Top-10 reward share</span><span>${(c.insights.top10RequesterRewardShare * 100).toFixed(1)}%</span></div>
      <div class="row"><span>Median time to decision</span><span>${fmtDur(c.insights.medianTimeToDecisionMs)}</span></div>
      <div class="row"><span>Dead task rate</span><span>${(c.insights.deadTaskRate * 100).toFixed(1)}%</span></div>
      <div class="row"><span>Median open reward</span><span>${fmtUsd(c.insights.medianOpenReward, c.token)}</span></div>
    </div>`).join('')}</div>`;
}

function renderTrend() {
  const rows = series();
  if (!rows.length) return '<p class="lede">No data for this range.</p>';
  const r30 = chain().series['30d'] || [];
  return `
    <div class="panel">
      <h2>Tasks posted and agents <span class="note">— per day, ${esc(state.range)}</span></h2>
      ${lineChart(rows, { keys: ['tasksCreated', 'activeAgents'], label: 'Tasks posted and active agents per day' })}
      <div class="legend">
        <span><i class="swatch" style="background:var(--magenta)"></i> tasks created</span>
        <span><i class="swatch" style="background:var(--salmon)"></i> active agents</span>
      </div>
    </div>
    <div class="panel">
      <h2>Reward put up vs reward paid <span class="note">— per day, ${esc(state.range)}</span></h2>
      ${lineChart(rows, { keys: ['rewardVolume', 'paidVolume'], label: 'Reward volume versus paid volume', fmt: (v) => fmtUsd(v) })}
      <div class="legend">
        <span><i class="swatch" style="background:var(--magenta)"></i> reward put up</span>
        <span><i class="swatch" style="background:var(--salmon)"></i> reward paid out</span>
      </div>
    </div>
    <div class="panel">
      <h2>Reward put up vs paid <span class="note">— 30 day view</span></h2>
      ${lineChart(r30, { keys: ['rewardVolume', 'paidVolume'], label: 'Reward volume versus paid volume over 30 days', fmt: (v) => fmtUsd(v) })}
    </div>`;
}

function render() {
  const c = chain();
  $('#stamp').innerHTML = `Data as of <b>${new Date(DATA.generatedAt).toUTCString()}</b> · source <b>api.taskmarket.dev</b> · chain <b>${esc(c.label)}</b>`;
  $('#stats').innerHTML = renderStats();
  $('#insights').innerHTML = renderInsights();
  $('#heat').innerHTML = heatmap();
  $('#breakdowns').innerHTML = renderBreakdowns();
  $('#feed').innerHTML = renderFeed();
  $('#weeklyChart').innerHTML = renderWeekly();
  $('#tasksTable').innerHTML = renderTasks();
  $('#swarm').innerHTML = renderSwarm();
  $('#compare').innerHTML = renderCompare();
  $('#trend').innerHTML = renderTrend();

  $$('.switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.chain === state.chain)));
  $$('.tabs button[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === state.range)));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + state.view));
  $$('.navlink').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
}

/* ---------- boot ---------- */
async function boot() {
  const res = await fetch('data/market.json', { cache: 'no-cache' });
  DATA = await res.json();
  render();

  $$('.switch button').forEach((b) => b.addEventListener('click', () => { state.chain = b.dataset.chain; render(); }));
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => { state.range = b.dataset.range; render(); }));
  $$('.navlink').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); window.scrollTo({ top: 0 }); }));
}

boot().catch((e) => {
  document.body.innerHTML = '<div style="padding:40px;font-family:monospace;color:#EFE9E2">Failed to load data/market.json: ' + esc(e.message) + '</div>';
});
