#!/usr/bin/env node
/**
 * Taskmarket market visualizer - server-side data fetcher.
 * Pulls every number the dashboard shows from the public Taskmarket API.
 * Run: node scripts/fetch.mjs   (writes data/market.json)
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.TASKMARKET_API || 'https://api.taskmarket.dev/api';
const CHAINS = [
  { id: 4217, slug: 'tempo', token: 'OUSD', label: 'Tempo' },
  { id: 8453, slug: 'base', token: 'USDC', label: 'Base' },
];
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'market.json');

async function get(path, tries = 4) {
  const url = `${API}/${path}`;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/** ISO week key like 2026-W47 */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function fetchAllTasks(chainId) {
  const tasks = [];
  let cursor = null;
  let guard = 0;
  do {
    const q = new URLSearchParams({ chainId: String(chainId), sort: 'newest', limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const data = await get(`tasks?${q}`);
    const list = data.tasks || [];
    tasks.push(...list);
    cursor = data.hasMore ? data.nextCursor : null;
    guard++;
  } while (cursor && guard < 60);
  return tasks;
}

async function chainData(chain) {
  const [stats, breakdowns, series7, series30, seriesAll, heatmap, feed, tasks] = await Promise.all([
    get(`market/stats?chainId=${chain.id}`),
    get(`stats/breakdowns?chainId=${chain.id}`),
    get(`stats/platform-time-series?chainId=${chain.id}&range=7d&bucket=day`),
    get(`stats/platform-time-series?chainId=${chain.id}&range=30d&bucket=day`),
    get(`stats/platform-time-series?chainId=${chain.id}&range=all&bucket=week`),
    get(`stats/activity-heatmap?chainId=${chain.id}&range=7d&dimension=hourOfWeek`),
    get(`stats/activity-feed?chainId=${chain.id}&limit=40`),
    fetchAllTasks(chain.id),
  ]);

  // Distinct task posters per ISO week, from the task list.
  const postersByWeek = new Map();
  const tasksByWeek = new Map();
  for (const t of tasks) {
    if (!t.createdAt) continue;
    const wk = isoWeek(new Date(t.createdAt));
    if (!postersByWeek.has(wk)) { postersByWeek.set(wk, new Set()); tasksByWeek.set(wk, 0); }
    postersByWeek.get(wk).add((t.requester || '').toLowerCase());
    tasksByWeek.set(wk, tasksByWeek.get(wk) + 1);
  }
  const weekly = [...postersByWeek.keys()].sort().map((wk) => ({
    week: wk,
    distinctPosters: postersByWeek.get(wk).size,
    tasks: tasksByWeek.get(wk),
  }));

  // Concentration: how much of posted reward sits with the top requesters.
  const byRequester = new Map();
  let totalReward = 0;
  for (const t of tasks) {
    const r = Number(t.reward || 0);
    totalReward += r;
    const k = (t.requester || 'unknown').toLowerCase();
    byRequester.set(k, (byRequester.get(k) || 0) + r);
  }
  const sorted = [...byRequester.values()].sort((a, b) => b - a);
  const top = sorted.slice(0, 10);
  const top10Share = totalReward ? top.reduce((a, b) => a + b, 0) / totalReward : 0;

  // Time to a decision for completed tasks.
  const decisionTimes = tasks
    .filter((t) => t.status === 'completed' && t.createdAt && t.expiryTime)
    .map((t) => new Date(t.expiryTime) - new Date(t.createdAt))
    .filter((ms) => ms > 0);
  const medianDecisionMs = decisionTimes.length
    ? decisionTimes.sort((a, b) => a - b)[Math.floor(decisionTimes.length / 2)]
    : null;

  // Tasks that died without a winner.
  const dead = tasks.filter((t) => ['expired', 'cancelled'].includes(t.status)).length;

  const openTasks = tasks.filter((t) => t.status === 'open');
  const openReward = openTasks.reduce((a, t) => a + Number(t.reward || 0), 0);

  return {
    chainId: chain.id,
    slug: chain.slug,
    token: chain.token,
    label: chain.label,
    stats,
    breakdowns,
    series: { '7d': series7, '30d': series30, all: seriesAll },
    heatmap,
    feed,
    weekly,
    insights: {
      totalTasksScanned: tasks.length,
      distinctPosters: byRequester.size,
      top10RequesterRewardShare: Number(top10Share.toFixed(4)),
      medianTimeToDecisionMs: medianDecisionMs,
      deadTasks: dead,
      deadTaskRate: tasks.length ? Number((dead / tasks.length).toFixed(4)) : 0,
      openTasks: openTasks.length,
      openReward,
      medianOpenReward: openTasks.length
        ? openTasks.map((t) => Number(t.reward || 0)).sort((a, b) => a - b)[Math.floor(openTasks.length / 2)]
        : 0,
    },
    recentTasks: tasks.slice(0, 60).map((t) => ({
      id: t.id,
      referenceCode: t.referenceCode,
      title: (t.description || '').split('\n')[0].slice(0, 160),
      status: t.status,
      mode: t.mode,
      reward: Number(t.reward || 0),
      createdAt: t.createdAt,
      expiryTime: t.expiryTime,
      submissionCount: t.submissionCount || 0,
      awardCount: t.awardCount || 0,
      requesterDisplayName: t.requesterDisplayName || null,
    })),
  };
}

const chains = [];
for (const c of CHAINS) chains.push(await chainData(c));

const payload = {
  generatedAt: new Date().toISOString(),
  api: API,
  chains,
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload, null, 2));
console.log(`wrote ${OUT} (${chains.length} chains, as of ${payload.generatedAt})`);
for (const c of chains) {
  console.log(`  ${c.label}: tasks=${c.insights.totalTasksScanned} posters=${c.insights.distinctPosters} top10share=${c.insights.top10RequesterRewardShare}`);
}
