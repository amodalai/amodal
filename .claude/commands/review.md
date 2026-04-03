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

- Empty catch blocks or catch blocks that swallow errors
- Bare `throw new Error('...')` instead of typed error classes
- Missing context on errors (what operation, what inputs)
- try/catch around code that can't actually throw

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
