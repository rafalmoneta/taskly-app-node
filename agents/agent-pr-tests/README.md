# PR unit-test agent

When a pull request changes `backend/` or `frontend/`, this agent reads the change, writes or updates Vitest unit tests, and runs them. It runs on the Pi coding-agent SDK (`@earendil-works/pi-coding-agent`), so the model is a setting in `config.json`. The model reports what it did, but `src/run.ts` decides whether the tests are verified. After the session it formats the changed files of each changed app, typechecks the app, and runs its full suite with coverage. It reads the files as they are on disk, so a model that edits after its last green run cannot pass, and the model's own `typecheck` and `run_tests` results do not count. These are the checks that `ci.yml` runs for each app.

## Layout

- `config.json` sets the `pr` role (model, thinking level, turn and cost budgets, wall-clock limit), the write policy (writable globs, forbidden globs, file cap), and the commands for each app.
- `pi/` is the Pi agent directory. It holds `settings.json`, `models.json`, `APPEND_SYSTEM.md`, `extensions/`, and `skills/`. The extensions add the write guard, the budget, and the `run_tests`, `typecheck`, and `report_result` tools.
- `pi/skills/` holds four Agent Skills files. `pr-unit-tests` is the entry point, and it uses `verify-tests`, `backend-testing`, and `frontend-testing`. Only the tool names are specific to Pi, so Claude Code and Codex can load the same files.
- `src/` holds the entry point `run.ts`, the session setup, the harness verification (`agent/verify.ts`), and the result logic. `test/` holds their unit tests.
- `scripts/prepare-inputs.sh` writes the agent's inputs to `.artifacts/`.

## How the workflow uses it

`.github/workflows/pr-unit-tests.yml` runs on every pull request except drafts, forks, and pull requests labelled `skip-test-agent`.

1. The `gate` job has read-only permissions. It skips the agent for a pull request that changes `agents/` or `.github/`, and for one that changes neither `backend/` nor `frontend/`. The first skip stops accidental changes to the agent. It is not a security boundary, because a pull request from this repository can also edit the workflow. Branch protection and CODEOWNERS on `agents/` and `.github/` are the real control.
2. The `agent` job has read-only permissions. It runs `prepare-inputs.sh` against the base commit, then `src/run.ts`, and uploads `.artifacts/` with the test patch. No step that runs code from the pull request or the model gets the secret. The step before the agent writes it to a file under `umask 077`, and the agent reads and deletes that file first (see Model credentials). A process that an earlier step left running, or one that can use `sudo`, can still read the key.
3. The `ci` job runs when the run is verified. It calls `ci.yml` as a reusable workflow on the pull request head plus the agent's test patch, with read-only permissions and no secrets. CI runs before the push, so the commit that `publish` pushes is the code that CI tested. The push itself can start a new run of this workflow, held as `action_required`. Approve it only if you want the agent to run again on its own tests.
4. The `publish` job has write permissions and never runs code from the pull request. It runs its tooling from a separate checkout. If the run is verified and `ci` passed, it applies the patch and checks the staged diff with `git diff --raw -z`. The diff may add or edit regular files on writable paths only, with no renames, deletions, or mode changes. Then it commits the tests as `tests: added by agent - <n> test file(s) for PR #<number>` and pushes them to the pull request branch. The commit is the pull request head plus the patch that `ci` ran on. If `ci` failed, it pushes nothing, and the comment and the check run say so. The job also posts a sticky comment and creates a `Unit test agent` check run.
5. The `skipped` job runs when the gate skipped the agent. It checks out no code. It posts a comment that gives the reason and creates a neutral `Unit test agent` check run, so the pull request does not turn red.

The workflow needs the repository secret `ANTHROPIC_API_KEY`.

## Switch the model

- Edit `roles.pr.model` in `config.json`. The value is `provider/model-id`, for example `anthropic/claude-sonnet-4-5`.
- To use an endpoint that Pi does not include, such as Ollama, vLLM, or a proxy, add a provider to `pi/models.json` and point `roles.pr.model` at it.
- A provider other than Anthropic needs its own secret in the workflow, in place of `ANTHROPIC_API_KEY`.

## Model credentials

`AGENT_API_KEY_FILE` names a file that holds the key. The agent reads the file, deletes it, and keeps the key in memory only. It refuses an empty file. This keeps the key out of the process environment, which the commands that run the model's tests inherit. Without the variable, the agent reads a Pi `auth.json` (`AGENT_AUTH_PATH`, or `pi/auth.json` when it exists), then the provider's environment variable.

## Run it locally

You need Node 24 (`.nvmrc`), and either a Pi login in `~/.pi/agent/auth.json` or the provider's API key in your environment. Run these commands from the repository root.

1. Install the agent and the apps:
   ```sh
   (cd agents/agent-pr-tests && npm ci --ignore-scripts --legacy-peer-deps)
   (cd backend && npm ci) && (cd frontend && npm ci)
   ```
2. Write the inputs for your branch:
   ```sh
   agents/agent-pr-tests/scripts/prepare-inputs.sh origin/main
   ```
3. Run the agent:
   ```sh
   AGENT_AUTH_PATH=~/.pi/agent/auth.json node agents/agent-pr-tests/src/run.ts --pr <n> --model <provider/id>
   ```
   `--model` overrides `roles.pr.model`. Without `AGENT_AUTH_PATH`, the agent reads `pi/auth.json` when it exists, then the provider's environment variable.

The agent writes test files into your working tree. Review them with `git diff`.

## Artifacts

`.artifacts/` holds the inputs (`changed-files.txt`, `pr.diff`, `coverage-baseline/`) and these outputs:

- `result.json` has the outcome, the model's report, the harness verification for each app, and the turns, tokens, cost, and duration.
- `<timestamp>_<session-id>.jsonl` is the Pi session, with every message and tool call.
- `transcript.html` is the same session as HTML.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | The tests are verified, or the change needs no tests |
| 1 | The tests failed or are unverified, or the agent never called `report_result` |
| 2 | The agent needs a human |

## Check the agent itself

Run these in `agents/agent-pr-tests/`:

```sh
npm run typecheck
npm test
```
