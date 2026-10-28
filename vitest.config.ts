import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';
import { parse as parseYAML } from 'yaml';

// ── OSS coverage scope ───────────────────────────────────────────────────────
// Premium paths are stripped from the OSS build (.oss-manifest.yaml) and are
// deliberately untested by this campaign — so they're legitimately out of the
// coverage denominator. Derive the premium `src/**` globs straight from the
// manifest (single source of truth; no drift) and drop them from coverage so
// the gate measures the OSS surface we actually ship + test.
const ossManifest = parseYAML(
  readFileSync(path.resolve(__dirname, '.oss-manifest.yaml'), 'utf8'),
) as { exclude?: string[] };
const premiumExcludes = (ossManifest.exclude ?? [])
  .filter((p) => p.startsWith('src/'))
  // Escape route-group parens: vitest's coverage matcher (picomatch) reads a
  // bare `(marketing)` as a group, so `src/app/(marketing)/**` would NOT match
  // the literal `(marketing)`/`(tenant)` dirs and those premium pages would
  // leak into the denominator. Escaped, picomatch matches the literal parens.
  .map((p) => p.replace(/[()]/g, '\\$&'));

// ── Quarantine ──────────────────────────────────────────────────────────────
// General flake/red-test quarantine mechanism (originally PA-273, now the
// house convention documented in TESTING.md's "Flake quarantine" section —
// PA-264): list a file here to exclude it from CI runs ONLY (process.env.CI),
// so the pipeline gates green while it's triaged. It STILL RUNS locally so
// the failures stay visible to anyone working here. De-quarantine by deleting
// its line once fixed; reference the tracking Jira ticket in a comment above
// each entry.
// Quarantine list is empty — all previously-red tests have been fixed
// (gpu-specs via #42, the rest via PA-273). The machinery below is a no-op
// now, ready for the next flake.
const QUARANTINE: string[] = [];

const quarantined = process.env.CI ? QUARANTINE : [];
const sharedExclude = ['tests/e2e/**/*', 'node_modules/**/*'];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    setupFiles: './tests/setup.ts',
    // Retry failed tests in CI only. The full ~4.6k-test suite runs under v8
    // coverage instrumentation in the gate step, which is slow enough that a
    // handful of async UI tests are load-flaky; a retry lets a transient flake
    // pass without reddening the gate, while a genuinely broken test still
    // fails all attempts. Local runs (retry 0) keep flakes visible.
    retry: process.env.CI ? 2 : 0,
    // Coverage is a global (root) concern; both projects report into it.
    coverage: {
      provider: 'v8',
      // text-summary prints the headline totals (the per-file `text` table is
      // unreadable at ~800 included files); json-summary writes
      // coverage/coverage-summary.json so the % is trackable PR-over-PR.
      reporter: ['text-summary', 'json-summary', 'html'],
      // Vitest 4 removed `coverage.all` — `include` is now how untested files
      // get counted. Restricting to ts/tsx also keeps the v8 remapper away
      // from non-code files under src/ (e.g. src/plans/*.md, lib READMEs),
      // which crash it. Without this block the report only counts files the
      // tests happened to load, which wildly inflates the headline number.
      include: ['src/**/*.{ts,tsx}'],
      // Coverage gate (campaign Phase 6, PA-291). Scope is OSS-only (premium
      // excluded below), so these measure the surface we actually ship + test.
      // RATCHET floor — set just below current OSS coverage (lines ~62%,
      // stmts ~60%, branches ~54%, funcs ~51% after the PA-320 deepening) to
      // enforce no-regression now; raise these numbers as coverage climbs
      // toward the 70% north star. Enabled in CI via COVERAGE_GATE=1; a bare
      // `pnpm test:coverage` stays a measurement (exits 0) for local use.
      ...(process.env.COVERAGE_GATE
        ? {
            thresholds: {
              lines: 58,
              functions: 48,
              branches: 51,
              statements: 57,
            },
          }
        : {}),
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/dist/**',
        '.next/**',
        // Premium (stripped from the OSS build) — mirror .oss-manifest.yaml.
        ...premiumExcludes,
      ],
    },
    // Back-end runs under `node`, front-end under `jsdom` so components render;
    // a per-file `// @vitest-environment` docblock still overrides either.
    projects: [
      {
        extends: true,
        test: {
          name: 'backend',
          environment: 'node',
          include: [
            'tests/lib/**/*.test.{ts,tsx}',
            'tests/api/**/*.test.{ts,tsx}',
            'tests/regression/**/*.test.{ts,tsx}',
            'tests/contract/**/*.test.{ts,tsx}',
            'tests/example.test.ts',
          ],
          exclude: [...sharedExclude, ...quarantined],
        },
      },
      {
        extends: true,
        test: {
          name: 'frontend',
          environment: 'jsdom',
          include: [
            'tests/components/**/*.test.{ts,tsx}',
            'tests/hooks/**/*.test.{ts,tsx}',
            'tests/pages/**/*.test.{ts,tsx}',
          ],
          exclude: [...sharedExclude, ...quarantined],
        },
      },
    ],
  },
});
