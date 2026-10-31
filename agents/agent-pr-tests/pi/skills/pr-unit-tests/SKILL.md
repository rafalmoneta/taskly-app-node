---
name: pr-unit-tests
description: Writes or updates Vitest unit tests for the backend/ and frontend/ changes of a pull request, verifies them, and reports with report_result. Entry point of a PR run, invoked as /skill:pr-unit-tests <pr-number>.
disable-model-invocation: true
---

# PR unit tests

The argument after this skill is the PR number. It only labels the run. The inputs are in `.artifacts/`:

- `changed-files.txt` is `git diff --name-status` from the base to the PR head. Each line is a status letter, a tab, and a path. An `R` or `C` line has a similarity score after the letter and two paths, old then new.
- `pr.diff` is the diff of `backend/` and `frontend/`, without lockfiles.
- `coverage-baseline/<app>.json` is the app's coverage on the PR head, before your tests. `total.lines.pct` is the app total. Every other key is an absolute source path. When the file is absent, skip the comparison.

## Procedure

1. Read `changed-files.txt` and `pr.diff`. Match each changed path under `backend/` or `frontend/` to a row of the decision table.
2. If no path needs a test written or run, call `report_result` with `decision: "no_tests_needed"`, one `changes` entry per changed source with `action: "none"`, and any `not_covered` entries. Stop.
3. Read the `backend-testing` or `frontend-testing` skill for each app you will test.
4. For each source to test, read the source, its current test, and its baseline line coverage. Write cases for the behavior the diff adds or changes. Each case must fail when that behavior breaks. Take each expected value from the intent of the diff, not from what the code returns.
5. Follow the `verify-tests` skill to the end. It calls `report_result`.

## Decision table

| Change | Action |
|---|---|
| New or changed runtime behavior in `backend/src/**` or `frontend/src/**` | Create or update its test |
| An existing test fails because the diff changes that behavior on purpose | Update the assertion and say so in `why` |
| A path in `coverage.exclude` of `backend/vitest.config.ts` or `frontend/vite.config.ts`, `*.css`, a comment-only or format-only diff, config, `package*.json`, `backend/prisma/`, Docker or nginx files, docs | `action: "none"` |
| Renamed source (`R`) | Fix the import path in its test |
| Deleted source (`D`) | Remove the cases that import it. If a whole test file targets it, report `needs_human`, because no tool deletes files |
| A test file the PR adds or changes | Run it with `run_tests` and `files`. Green: add only the cases it misses. Red: report `needs_human` with the failing case |
| A component that renders new text or elements | Test the rendered output with Testing Library |
| Behavior that only a real database, network, or browser shows | List it in `not_covered` with the reason |
| A new case exposes a bug in the source | Leave the source as it is. Report `needs_human` with the failing case |

## File cap

A run writes at most 8 distinct files, fixtures included. The guard refuses the ninth. When more sources qualify, test the largest behavior changes first and list the rest in `not_covered` as over the file cap.

## Report contents

- `changes` has one entry per changed source file. Set `test` when you created or updated a test for it.
- `not_covered` lists each behavior you left untested, with the reason.
