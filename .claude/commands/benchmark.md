Run a benchmark against the current build to measure agent performance. Results go in `benchmarks/` for comparison across phases.

## Measurements

1. **Time to first token (TTFT):**
   - Start `amodal dev` on the content-marketing agent (or another test agent)
   - Send a simple message ("hello") via the API
   - Measure time from request to first `text_delta` SSE event

2. **Total turn time:**
   - Send a message that triggers a tool call ("scan for trending AI content")
   - Measure time from request to `done` SSE event

3. **Token usage for standard conversation:**
   - Run a 5-turn conversation with tool calls
   - Record total input, output, and cache tokens

4. **Automation run cost:**
   - Trigger the scan-trending automation
   - Record total tokens and wall-clock time

## How to Run

```bash
# Build first
pnpm run build

# Start the dev server in background
amodal dev --agent ~/code/content-marketing &
DEV_PID=$!

# Wait for server to be ready
sleep 3

# Run benchmark script
node benchmarks/run.js

# Stop server
kill $DEV_PID
```

## Output

Save results to `benchmarks/results-$(date +%Y%m%d-%H%M).json` with:

```json
{
  "timestamp": "ISO date",
  "gitRef": "commit hash",
  "phase": "current phase label",
  "ttft_ms": number,
  "turn_time_ms": number,
  "tokens": { "input": number, "output": number, "cache": number },
  "automation_tokens": number,
  "automation_time_ms": number
}
```

Compare against previous results in `benchmarks/` to detect regressions.
