# Solution: PR unit-test agent

When a pull request changes `backend/` or `frontend/`, a GitHub Actions workflow runs an AI agent. The agent writes or updates Vitest unit tests for the change, and the harness verifies them. If they pass, the workflow commits them to the pull request branch. The agent lives in `agents/agent-pr-tests/`, and the workflow is `.github/workflows/pr-unit-tests.yml`.

## Technical decisions

- **The harness decides the outcome, not the model.** After the session, `src/agent/verify.ts` formats the changed test files, typechecks each changed app, and runs the full suite with coverage. It reads the files from disk. Results that the model reports are not counted. A run is `verified` only when every check passes.
- **The agent has a small set of tools.** It can use `read`, `grep`, `find`, `ls`, `edit`, and `write`, plus three custom tools: `run_tests`, `typecheck`, and `report_result`. It has no shell and no git, so it cannot run arbitrary commands or push.
- **A guard restricts writes.** The `pi/extensions/guard.ts` extension allows only the test globs in `config.json` (`policy.writable`) and refuses source, config, `package.json`, `agents/`, and `.github/`. A run writes at most 8 files. After 3 refused writes, the run ends.
- **The run has a budget.** The `pr` role in `config.json` sets soft and hard limits: 35 and 60 turns, and $2 and $4 of model cost. The wall-clock limit is 25 minutes. At a soft limit, the agent gets a warning to finish.
- **Each job has only the permissions it needs.** `gate` and `agent` can only read. `ci` runs the normal `ci.yml` on the PR head plus the agent's patch, with no secrets. `publish` can write, but it runs tooling only from a separate trusted checkout and never runs code from the PR. Before it commits, it checks that the patch only adds or edits regular files on writable paths.
- **The API key never enters the environment.** The workflow writes the key to a file with `umask 077`. The agent reads the file, deletes it, and keeps the key in memory. So the test commands that the model starts do not inherit the key.
- **The model is a setting.** The agent runs on the Pi coding-agent SDK, and `roles.pr.model` (`provider/model-id`) chooses the model. This run used `anthropic/claude-sonnet-4-5`.
- **The output is structured.** `report_result` records a decision and one entry per changed source file. The workflow turns it into a sticky PR comment and a `Unit test agent` check run. A skipped run gets a neutral check, so the PR does not turn red.

## Run the PR workflow

Prerequisites:

- The repository secret `ANTHROPIC_API_KEY` is set.
- `github-actions[bot]` can push to the PR branch, because `publish` commits the tests there.
- The PR comes from a branch in this repository, not a fork. It is not a draft, and it does not have the `skip-test-agent` label.
- The PR changes `backend/` or `frontend/`. It must not change `agents/` or `.github/`, or the gate skips the agent.

To run it, open or update a pull request that meets these conditions. The workflow runs on `opened`, `synchronize`, `reopened`, and `ready_for_review`. The result appears as a PR comment, a `Unit test agent` check run, and an artifact `pr-unit-tests-<number>`. The artifact holds `result.json`, the session log, `transcript.html`, and `tests.patch`.

To run the agent on your machine, use Node 24 (`.nvmrc`) and follow "Run it locally" in `agents/agent-pr-tests/README.md`.

## Where the agent and skills are defined

| Path | Role |
| --- | --- |
| `agents/agent-pr-tests/src/run.ts` | Entry point. Loads the model and key, runs the session, verifies, and writes `result.json`. |
| `agents/agent-pr-tests/config.json` | Model, budgets, write policy, and the commands for each app. |
| `agents/agent-pr-tests/pi/APPEND_SYSTEM.md` | System prompt: the agent's role, its tools, and hard rules. |
| `agents/agent-pr-tests/pi/extensions/` | Write guard, budget, the `run_tests`, `typecheck`, and `report_result` tools, and the report. |
| `agents/agent-pr-tests/pi/skills/pr-unit-tests/SKILL.md` | Entry skill. The procedure and the decision table for each changed path. |
| `agents/agent-pr-tests/pi/skills/backend-testing/SKILL.md` | Conventions for tests in `backend/` (Express, Prisma spies, supertest). |
| `agents/agent-pr-tests/pi/skills/frontend-testing/SKILL.md` | Conventions for tests in `frontend/` (Testing Library, TanStack Query, the design-system mock). |
| `agents/agent-pr-tests/pi/skills/verify-tests/SKILL.md` | Verification: typecheck, repeated runs of the changed tests, a final full run, then `report_result`. |
| `agents/agent-pr-tests/scripts/prepare-inputs.sh` | Writes `changed-files.txt`, `pr.diff`, and the coverage baseline to `.artifacts/`. |

During a run, `run.ts` sends the prompt `/skill:pr-unit-tests <pr>`. The entry skill reads the inputs in `.artifacts/` and assigns an action to each changed path. Before the agent writes tests for an app, it reads that app's testing skill. Then it follows `verify-tests` and finishes with `report_result`. The skills are standard Agent Skills files, so other agents such as Claude Code or Codex can load the same files.

## Example run

PR [#1](https://github.com/rafalmoneta/taskly-app-node/pull/1) adds "clear completed tasks". It adds a `DELETE /api/todos/completed` endpoint and a header button with a confirmation drawer. The PR adds no new tests.

The first run was [run 41198964589](https://github.com/rafalmoneta/taskly-app-node/actions/runs/41198964589), on the feature commit:

- The model was `anthropic/claude-sonnet-4-5`. The run took 25 turns and 35 tool calls, cost $0.44, and took 176 s.
- The session log shows that the agent read all four skills. Its calls included 19 `read`, 7 `run_tests`, and 3 `typecheck` calls.
- The decision was `tests_added`. The agent changed 6 files: `repository.test.ts`, `router.test.ts`, `todos.test.ts`, `TodosHeader.test.tsx`, a new `ClearCompletedDialog.test.tsx`, and a new `useClearCompletedMutation.test.tsx`.
- The agent chose `action: "none"` for `openapi.json`, `types.ts`, and `queryKeys.ts`, because they have no runtime behavior. It also chose `none` for `TodosPage.tsx`, and explained that its child components already test that behavior.
- The harness verified the result. In `backend`, 50 tests passed, and line coverage went from 33.03% to 34.82%. In `frontend`, 30 tests passed, and line coverage went from 43.02% to 50%. `ci` passed, and `publish` committed `0e47fb2`.

That push started a second run, which waited for approval. After approval, [run 41199335705](https://github.com/rafalmoneta/taskly-app-node/actions/runs/41199335705) reviewed the first run's tests. The decision was `tests_updated`, with 28 turns, $0.64, and 230 s. The agent restored two tests that the first run had removed from `todos.test.ts`. It also added 4 cases to `TodosPage.test.tsx`. In `frontend`, 36 tests passed, and line coverage went from 50% to 53.48%. `publish` committed `ae44cba`.

## Assumptions

- Pull requests come from branches in this repository. Fork PRs cannot read the secret, and their code is untrusted.
- Unit tests are in scope. Integration and end-to-end tests are not. Prisma and `fetch` are mocked, as in the existing tests.
- The existing test conventions in each app are correct. The skills copy them.
- Committing to the author's branch is acceptable, if a human reviews the commit like any other code.
- A run costs about $0.40 to $0.70 with Sonnet 4.5. This is based on the two runs above.

## Limitations

- **A passing suite does not prove the tests are good.** The first run recreated `todos.test.ts` with `write` and removed two existing tests. The harness accepted the change because the suite still passed. Total coverage does not detect a lost assertion.
- **The agent's own push starts another run.** `agents/agent-pr-tests/README.md` says that a push with `GITHUB_TOKEN` starts no workflow runs. In this repository, the push started a run that waited for approval (`action_required`). If someone approves that run, the agent runs again on its own tests.
- **Results vary between runs.** For `TodosPage.tsx`, one run chose `none` and the next run added tests, on almost the same input.
- The cap of 8 files leaves large PRs partly covered. The agent lists the rest in `not_covered`.
- The gate is not a security boundary. A PR from this repository can edit the workflow. Branch protection and CODEOWNERS on `agents/` and `.github/` are the real control.
- A process that runs before the key file is deleted, or a process that uses `sudo` on the runner, can read the key.
- Fork PRs get no tests.

## For a production version

- Fail verification when an existing test case disappears and its source file still exists. For existing test files, allow `edit` only.
- Skip runs in the gate when `github-actions[bot]` wrote the head commit, so that the agent does not test its own output.
- Measure diff coverage on the changed lines instead of totals. Add mutation testing, for example Stryker, on changed lines to check that the tests assert something.
- Let the author choose how to receive the tests: a suggestion review or a separate PR, instead of a commit on the author's branch. Require an opt-in label for large PRs.
- Use a GitHub App token with narrow scopes and short-lived credentials from OIDC instead of a long-lived API key. Run the agent on an isolated, ephemeral runner.
- Create an evaluation set from past PRs. Track the rate of verified runs, cost, and the reviewer acceptance rate before you change the model or the skills.
- Add an integration tier with a Postgres service container for behavior that mocks cannot show.
