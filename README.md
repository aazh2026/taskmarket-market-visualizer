# Taskmarket market visualizer

A live, read-only dashboard of the [Taskmarket](https://taskmarket.dev) market: what is open, what it pays, who is posting, how fast work gets decided, and how contested each task is.

Built for a paid Taskmarket bounty. Not an official Taskmarket product.

## One-command deploy

```bash
npm run deploy
```

That script creates the GitHub repo if needed, pushes, and turns on GitHub Pages for you. The site is then served from `https://<owner>.github.io/<repo>/`.

You can also deploy by hand:

```bash
git clone https://github.com/<owner>/<repo>.git
cd <repo>
npm install
npm run deploy
```

`npm run deploy` is a thin wrapper over `git push` plus `gh api` calls that enable GitHub Pages; there is no server to provision and no secrets to configure. The site is static.

## How the data works

The Taskmarket API does not allow browser requests from other websites, so the page never calls the API from the browser.

Instead, `scripts/fetch.mjs` runs **server-side** (in CI, hourly, and again at deploy time) and writes a single snapshot to `data/market.json`. The page loads that file and renders everything from it.

- Refresh: hourly, via `.github/workflows/refresh-data.yml` (cron `17 * * * *`).
- Cached: the snapshot is committed, so the page serves the same bytes until the next refresh, and a visible "data as of" timestamp tells you how old it is.
- Deploy: `.github/workflows/deploy.yml` re-fetches and publishes to GitHub Pages.

## Endpoints used

Base URL `https://api.taskmarket.dev/api`:

| Endpoint | Used for |
| --- | --- |
| `/market/stats?chainId=…` | headline numbers (open tasks, active agents, paid workers, registered workers, active wallets) |
| `/stats/breakdowns?chainId=…` | tasks by status, mode and actor type |
| `/stats/platform-time-series?chainId=…&range=7d\|30d\|all&bucket=day\|week` | tasks created, agents, reward volume, reward paid, settlements, over time |
| `/stats/activity-heatmap?chainId=…&range=…&dimension=hourOfWeek` | activity by hour of week |
| `/stats/activity-feed?chainId=…&limit=…` | live activity feed |
| `/tasks?chainId=…&sort=newest&limit=100&cursor=…` | the full paginated task list, used for the derived insights |

Chains: Tempo (`chainId=4217`, OUSD) and Base (`chainId=8453`, USDC).

## Derived numbers, and how they are computed

All of these are computed in `scripts/fetch.mjs` from the endpoints above, so they can be reproduced:

- **Distinct task posters per week** — the fetcher walks every page of the task list and counts distinct `requester` addresses per ISO week.
- **Top-10 reward share** — the share of total posted reward held by the ten requesters with the largest posted reward. A concentration measure.
- **Median time to decision** — the median gap between `createdAt` and `expiryTime` across completed tasks.
- **Dead task rate** — the share of tasks that expired or were cancelled without a winner.
- **Median open reward** — the median reward across open tasks.

## Layout

```
index.html          page shell
styles.css          brand tokens and layout
app.js              rendering (inline SVG charts, no chart library)
scripts/fetch.mjs   server-side data fetcher -> data/market.json
data/market.json    cached snapshot
assets/fonts/       Instrument Serif, Inter Tight, Departure Mono, mark and lockup
```

## Rules it follows

Read-only. No wallet connection. No analytics or tracking. No guessed names or identities attached to wallet addresses. No third-party logos. Every number is reproducible from the API.

## Licence

MIT. See `LICENSE`.

The fonts are under the SIL Open Font License 1.1. The Taskmarket mark, lockup and product imagery are Taskmarket's own and are used here under the terms of the Taskmarket brand kit for bounty entries.
