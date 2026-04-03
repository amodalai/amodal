Review the current branch against the engineering standards in CLAUDE.md. Check every changed file.

## What to Check

Run `git diff main...HEAD --name-only` to get changed files, then review each one for:

### Magic Strings

- Raw color values (hex, rgb, hsl) in TSX/CSS instead of design tokens
- Raw `process.env` reads outside the config module
- Inline string literals for event types, route paths, store names, tool names
- Hardcoded IDs or constants that should be named

### Logging

- `console.log`, `console.error`, `process.stderr.write` instead of Logger
- Tool calls without structured logging (tool name, status, duration, session)
- Errors caught without logging
- Credentials or PII in log output

### Error Handling

- **Silent swallows:** `catch (e) { }`, `catch (e) { return null }`, `catch (e) { return [] }`, `catch (e) { log(e) }` without re-throw. These are ALWAYS wrong.
- Functions returning `null` to indicate failure instead of `Result<T, E>`
- Bare `throw new Error('...')` instead of typed error classes
- Missing context on errors (what operation, what inputs, what state)
- try/catch inside store backends, utility functions, or tool implementations (error boundaries belong at module edges only)
- try/catch around code that can't actually throw
- `catch` used for cleanup instead of `finally`

### Async Discipline

- Floating promises: async function called without `await` or `.catch()` (use `void` prefix if intentional fire-and-forget)
- External calls (fetch, database, MCP) without `AbortSignal.timeout()`
- Switch on discriminated union without `default: { const _exhaustive: never = x; }` exhaustive check

### Types

- `any` usage (should be `unknown` with narrowing)
- `as` casts that aren't at system boundaries
- Missing discriminated union where state is represented as strings
- Overly broad interfaces that leak implementation details

### Module Boundaries

- Imports reaching into another module's internal files
- Private field access via `(obj as any)` or bracket notation
- Circular dependencies

### Testing Gaps

- New public behavior without a corresponding test
- Tests that mock internals instead of testing real behavior
- SSE event shape changes without contract test updates

## Output Format

For each issue found, report:

- File path and line number
- Which standard is violated
- What the code does now
- What it should do instead

If no issues found, say so. Don't invent problems.
