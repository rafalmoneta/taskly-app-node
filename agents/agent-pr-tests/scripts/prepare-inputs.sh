#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <base-sha>" >&2
  exit 2
fi
base="$1"

cd "$(git rev-parse --show-toplevel)"
out=.artifacts
mkdir -p "$out/coverage-baseline"

git diff --name-status "$base...HEAD" > "$out/changed-files.txt"
git diff "$base...HEAD" -- backend frontend ':(exclude)**/package-lock.json' > "$out/pr.diff"

for app in backend frontend; do
  summary="$app/coverage/coverage-summary.json"
  rm -f "$summary"
  (cd "$app" && npx vitest run --reporter=dot --coverage \
    --coverage.reporter=json-summary --coverage.reportOnFailure) \
    || echo "::warning::The $app baseline run failed"
  if [[ -f "$summary" ]]; then
    cp "$summary" "$out/coverage-baseline/$app.json"
  fi
done
