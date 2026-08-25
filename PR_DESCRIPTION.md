## Summary

This PR delivers end-to-end work for contract property/invariant testing (#511) and indexed project search (#500):

- **Contracts:** Plain-language money-path invariants, property-based tests across GreenPay, Escrow, and DAO Governance, CI fast/deep property runs, and a coverage script for money paths.
- **Backend:** Postgres full-text + trigram search with ranking, facets, eval harness, benchmark/backfill tooling, and integration tests.
- **Frontend:** Search metadata wired through the API, extracted search UI components, and facet counts on the projects browse page.
- **Docs:** OpenAPI schemas for search `meta`, search architecture notes, and a property-test catalog mapping invariants to tests.

Closes #511  
Closes #500

---

## Issue #511 — Contract property & invariant testing

### Invariants & documentation

- [`contracts/INVARIANTS.md`](contracts/INVARIANTS.md) — conservation, monotonicity, CO₂ arithmetic, escrow release, and governance vote/quorum rules in plain language.
- [`contracts/PROPERTY_TEST_CATALOG.md`](contracts/PROPERTY_TEST_CATALOG.md) — maps each invariant to the proptest/regression that encodes it.
- [`contracts/TESTING_STRATEGY.md`](contracts/TESTING_STRATEGY.md) — updated property-testing workflow and CI guidance.

### Property tests (proptest)

| Contract | Module | Coverage |
|----------|--------|----------|
| **GreenPay** | `fuzz_tests.rs` | Donation sequences, global/project total conservation, badge monotonicity, CO₂ truncation, overflow rollback |
| **GreenPay** | `badge_property_tests.rs` | Badge rank monotonicity, one NFT per tier, transfer ownership |
| **GreenPay** | `overflow_property_tests.rs` | Accumulator sums, CO₂ non-negativity, donation count, zero/max rejection |
| **Escrow** | `property_tests.rs` | Partial/full release conservation, dispute + admin resolve, cancel, odd-stroop stale dispute, overflow on partial release |
| **DAO** | `property_tests.rs` | Lock/withdraw conservation, `total_locked` tracking, voting power ≥ 0, relock after expiry |
| **DAO** | `governance_property_tests.rs` | Proposal ID monotonicity, quorum freeze at snapshot, vote tallies, approval → Execution, defeat paths |

### CI & tooling

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — fast property tests (`PROPTEST_CASES=32`, `--test-threads=1`).
- [`.github/workflows/contracts-property-deep.yml`](.github/workflows/contracts-property-deep.yml) — nightly deep run (`PROPTEST_CASES=2000`) + money-path coverage.
- [`contracts/scripts/money-path-coverage.sh`](contracts/scripts/money-path-coverage.sh) — tarpaulin coverage on donation/escrow/governance paths.
- [`contracts/proptest-regressions/README.md`](contracts/proptest-regressions/README.md) — regression seed workflow.

---

## Issue #500 — Project search

### Database & indexing

- [`backend/src/db/schema.sql`](backend/src/db/schema.sql) — `pg_trgm` extension, `search_vector` column, trigger (english stemming on name/description, simple tokenization on category/location/tags), GIN indexes.

### Search service

- [`backend/src/services/projectSearch.js`](backend/src/services/projectSearch.js) — indexed search (no hot-path `ILIKE`), combined english+simple tsquery, trigram typo tolerance, tunable ranking, facet aggregation.
- [`backend/src/config/searchRanking.js`](backend/src/config/searchRanking.js) — weights via `PROJECT_SEARCH_RANKING` env.
- [`backend/src/routes/projects.js`](backend/src/routes/projects.js) — refactored listing route; returns projects plus `meta` (`total`, `latencyMs`, `facets`, …).

### Evaluation, benchmark & ops

- [`backend/src/services/projectSearchEval.js`](backend/src/services/projectSearchEval.js) — labelled-query nDCG@k harness (11 cases: stemming, typos, location, verified boost, multilingual).
- [`backend/scripts/eval-project-search.js`](backend/scripts/eval-project-search.js) — CLI eval against live Postgres.
- [`backend/scripts/benchmark-project-search.js`](backend/scripts/benchmark-project-search.js) — p50/p95/p99 latency benchmark (150 ms budget).
- [`backend/scripts/backfill-project-search.js`](backend/scripts/backfill-project-search.js) — batch backfill for existing rows after migration.
- [`backend/src/services/projectSearchAnalytics.js`](backend/src/services/projectSearchAnalytics.js) — rolling search metrics snapshot for admin/debug use.
- [`backend/docs/project-search.md`](backend/docs/project-search.md) — architecture, multilingual strategy, ranking formula, latency budget.

### Frontend

- [`frontend/lib/api.ts`](frontend/lib/api.ts) — `fetchProjects` returns `{ projects, meta }`.
- [`frontend/components/ProjectSearchBar.tsx`](frontend/components/ProjectSearchBar.tsx) — search input + autocomplete dropdown.
- [`frontend/components/ProjectSearchFacets.tsx`](frontend/components/ProjectSearchFacets.tsx) — sidebar facets (status, verification, category, location, funding progress, latency).
- [`frontend/hooks/useProjectSearch.ts`](frontend/hooks/useProjectSearch.ts) — debounced filter hook (available for other pages).
- [`frontend/pages/projects/index.tsx`](frontend/pages/projects/index.tsx) — refactored to use extracted components; facet counts from `meta`.
- Updated consumers: home, dashboard, impact, admin pages for new API shape.

### API documentation

- [`docs/openapi.yml`](docs/openapi.yml) — `ProjectSearchMeta`, `ProjectSearchFacets`, and `meta` on `GET /api/projects`.

---

## Test plan

### Contracts

```bash
cd contracts

# Fast property suite (CI profile)
PROPTEST_CASES=32 cargo test --features testutils property prop_ -- --test-threads=1

# Deep run (nightly profile)
PROPTEST_CASES=2000 cargo test --features testutils property prop_ -- --test-threads=1
```

- [ ] All property/regression tests pass across GreenPay, Escrow, and DAO
- [ ] No new proptest regressions without committed seeds under `proptest-regressions/`

### Backend

```bash
cd backend && npm test -- --testPathPatterns="projectSearch|backfill|projects.search"
```

- [ ] Unit tests pass for search parsing, ranking, eval harness, analytics, benchmark helpers
- [ ] Integration tests pass in CI with Postgres (`projectSearch.integration.test.js`)
- [ ] Optional: `node scripts/benchmark-project-search.js --iterations=50` stays within 150 ms p95 at ~1k projects
- [ ] Optional: `node scripts/backfill-project-search.js --dry-run` reports pending rows after migration

### Frontend

```bash
cd frontend && npm test -- --testPathPatterns="ProjectSearch|useProjectSearch"
```

- [ ] Facet component renders counts and fires filter callbacks
- [ ] Projects page loads with search, facets, and autocomplete
- [ ] `fetchProjects` consumers handle `{ projects, meta }` without regression

### Manual smoke

- [ ] Browse `/projects` — filter by status, category, verified; confirm facet counts update
- [ ] Search with typo (e.g. `reforstation`) — relevant project surfaces
- [ ] Confirm `meta.latencyMs` and `meta.total` appear in API response envelope

---

## Notes for reviewers

- **Do not commit** auto-generated Soroban `test_snapshots/` JSON from local proptest runs unless the repo convention requires them for a specific regression.
- GreenPay `prop_many_small_donations` is capped at **16** donations per sequence (longer sequences segfault in the Soroban test harness).
- Property tests should run with **`--test-threads=1`** for stability across all three contracts.
- After deploying the schema migration, run `backfill-project-search.js` once on existing databases before relying on search quality.
