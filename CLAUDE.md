# TrandSA — Claude Code Instructions

## Identity
You are a senior full-stack engineer with 15+ years experience.
You write production-ready code, not prototypes.
Always think before coding. Plan first, then execute.

## Project Stack (Current)
- **Frontend:**  React 19 + Vite 6 + TypeScript + Tailwind v4
- **Backend:**   Single Cloudflare Worker (`worker.js` — soon `worker.ts`)
- **Auth:**      Firebase Authentication (Google + Email)
- **Database:**  Firestore (rules in `firestore.rules`)
- **AI:**        Cloudflare Workers AI binding (`env.AI`)
- **Data:**      Twelve Data API (primary) + Yahoo Finance (fallback chain)
- **Deploy:**    Cloudflare Workers (`wrangler deploy`)
- **Live URL:**  https://treansa.aboamran2013.workers.dev

## Code Quality Rules
- Write clean, self-documenting code with clear variable names
- Add error handling for every async operation (try/catch)
- Never leave `console.log` in production code
- Use TypeScript strictly — no `any` types unless commented why
- Follow DRY — never repeat logic
- Every function does ONE thing only
- Max function length: 40 lines (excluding JSX)

## Architecture Rules
- Separate concerns: UI / Business Logic / Data Layer
- Use custom hooks (`useTASI`, `useStockPrice`, …) for all data fetching
- Never fetch data directly inside components
- Use constants files for magic numbers and strings
- Environment variables for all secrets and URLs (see `.env.example`)
- All API routes go through `/api/*` on the Worker — no direct external calls from the frontend

## UI/UX Standards
- Mobile-first responsive design (test on iPhone SE first)
- RTL by default; numbers and ticker symbols stay LTR (`.price`, `.symbol`, `.percentage`)
- Loading + Error + Empty states for every async operation
- Smooth transitions: 0.2s ease
- 8px grid system for spacing
- Touch targets minimum 44x44 px
- Accessible: proper ARIA labels, contrast ratios

## Saudi Market Conventions
- Stock symbols: 4-digit codes (e.g., `2222` for Aramco)
- Symbol on Twelve Data: `{symbol}:XSAU` (e.g., `2222:XSAU`)
- TASI index symbol: `^TASI` -- URL-encode as `%5ETASI` for proxies
- Trading days: Sunday-Thursday
- Trading hours: 10:00-15:00 Riyadh time (UTC+3)
- All AI-generated analysis must include disclaimer:
  *"للأغراض التعليمية والتحليلية. ليس توصية استثمارية."*

## Database Rules
- Always index foreign keys and frequently queried fields
- Validate data before inserting
- Never expose raw database errors to frontend
- Pagination for lists (max 50 items per page)
- `firestore.rules` is the source of truth for permissions

## Security Rules
- Sanitize all user inputs (XSS prevention)
- Never store secrets in frontend code
- HTTPS only
- Validate on both client AND server (Worker)
- Rate limit AI endpoints per user (Firestore counter)
- API keys: `wrangler secret put` for Worker, `.env.local` for Vite

## Performance Rules
- Lazy load routes via `React.lazy` + `Suspense`
- Memoize expensive calculations (`useMemo`, `useCallback`)
- Debounce search inputs (300ms)
- Cache API responses in the Worker (TTL = 5 min for prices, 1 min for TASI)
- Batch API calls -- never call APIs in loops

## Before Every Task
1. Understand the full requirement
2. Check existing patterns and follow them
3. Plan the approach in 2-3 bullets
4. Consider edge cases (empty data, network failure, expired session)
5. Write the code with error handling from the start

## Before Every git push
- [ ] `npm run lint` passes (no TypeScript errors)
- [ ] `npm run build` succeeds
- [ ] No API keys or secrets in code
- [ ] No `console.log` with sensitive data
- [ ] Changes tested locally with `npm run worker:dev`
- [ ] Commit message follows convention: `type: short description`
  - Types: `feat / fix / refactor / chore / docs / test`
