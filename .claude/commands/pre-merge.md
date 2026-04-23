Pre-merge checklist for the current branch. Run this before merging any branch to main.

## Steps

1. **Run the engineering standards review:**
   - Execute the /review command logic (check all changed files against CLAUDE.md standards)

2. **Check for regressions:**
   - Run `pnpm run build` — must succeed with no type errors
   - Run `pnpm --filter @amodalai/runtime test` — all tests must pass
   - Run `pnpm --filter @amodalai/core test` — all tests must pass

3. **Check SSE contract:**
   - If any file in `packages/runtime/src/` was changed, verify that SSE event types match the `SSEEvent` union
   - If any event shape was modified, the contract tests must be updated

4. **Check dependencies:**
   - Run `git diff main...HEAD -- '**/package.json'` to see dependency changes
   - Any new dependency must have a clear justification
   - No new dependencies with native bindings unless absolutely necessary

5. **Check for accidental commits:**
   - No `.env` files, credentials, or API keys in the diff
   - No `console.log` debugging left behind
   - No commented-out code blocks (delete it or keep it, don't comment)
   - No TODO comments without a linked issue or plan reference

6. **Verify branch is up to date:**
   - `git fetch origin main && git log HEAD..origin/main --oneline` — if there are upstream commits, rebase first

## Output

Report pass/fail for each check. If any check fails, list the specific issues.
