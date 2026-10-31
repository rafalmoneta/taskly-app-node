---
name: verify-tests
description: Verification protocol for new or changed Vitest unit tests in backend/ or frontend/. Typecheck, repeated runs of the touched tests, a final full run with coverage, then report_result. Use after editing any test file and before reporting.
---

# Verify tests

The harness decides whether the run is verified, not your report. After `report_result`, it formats your changed files, typechecks each changed app, and runs the full suite itself. All three must pass. Your own full `run_tests` is how you find a failure first, so make it your last call for that app, after your final edit.

Change test files only. When a case fails because the source is wrong, leave the source as it is and report `needs_human`.

1. Call `typecheck({ app })` for each app you changed. Fix the errors in your test files.
2. Call `run_tests({ app, files, repeat: 3 })` with the repo-relative paths of the test files you touched.
   - Fix each failing case.
   - A flaky case passes in some repeats and fails in others. Fix its cause or delete it. Real timers, random data, and state shared between cases are the usual causes.
   - Delete a case that still fails because of the test itself, and list its behavior in `not_covered`.
3. Call `run_tests({ app })` without `files` for each app you changed. This full run collects coverage and compares it with `.artifacts/coverage-baseline/<app>.json`, the app's coverage on the PR head before your tests.
   - It passes with zero failed tests and exit code 0. Zero failures with a non-zero exit code means a coverage threshold failed. The output tail names the file.
   - Line coverage must not drop below the baseline. Test the uncovered new lines, or list them in `not_covered` with the reason.
4. After a fix in step 2 or step 3, start again at step 1.
5. Call `report_result` once.
   - `tests_added` when you created a test file, `tests_updated` when you only edited existing ones. Use either only when the final files passed steps 1 to 3.
   - `needs_human` when a check stays red and editing test files cannot fix it. Name the check and the failing case in `reason`.
