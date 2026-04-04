/**
 * Mock MCP server for smoke tests (stdio transport).
 *
 * Implements the MCP protocol over stdin/stdout with 3 canned tools:
 * - smoke_search(query) → [{title, url, score}]
 * - smoke_lookup(id) → {id, name, details}
 * - smoke_count() → {count: 42}
 *
 * Uses raw JSON-RPC since we can't depend on @modelcontextprotocol/sdk
 * being available at the fixture path.
 */

import {createInterface} from 'node:readline';

const TOOLS = [
  {
    name: 'smoke_search',
    description: 'Search for items by query',
    inputSchema: {
      type: 'object',
      properties: {
        query: {type: 'string', description: 'Search query'},
      },
      required: ['query'],
    },
  },
  {
    name: 'smoke_lookup',
    description: 'Look up an item by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {type: 'string', description: 'Item ID'},
      },
      required: ['id'],
    },
  },
  {
    name: 'smoke_count',
    description: 'Count all items',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function handleRequest(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: {tools: {listChanged: false}},
        serverInfo: {name: 'smoke-mcp', version: '1.0.0'},
      };

    case 'tools/list':
      return {tools: TOOLS};

    case 'tools/call': {
      const toolName = params?.name;
      switch (toolName) {
        case 'smoke_search':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify([
                {title: 'Result 1', url: 'https://example.com/1', score: 95},
                {title: 'Result 2', url: 'https://example.com/2', score: 82},
              ]),
            }],
          };
        case 'smoke_lookup':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({id: params?.arguments?.id ?? '1', name: 'Test Item', details: 'Looked up successfully'}),
            }],
          };
        case 'smoke_count':
          return {
            content: [{type: 'text', text: JSON.stringify({count: 42})}],
          };
        default:
          return {
            content: [{type: 'text', text: `Unknown tool: ${toolName}`}],
            isError: true,
          };
      }
    }

    default:
      return undefined;
  }
}

// JSON-RPC over stdio
const rl = createInterface({input: process.stdin});
let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();

  // MCP uses Content-Length framing or newline-delimited JSON
  // Try newline-delimited first
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) continue;

    // Skip Content-Length headers
    if (line.startsWith('Content-Length:')) continue;

    try {
      const msg = JSON.parse(line);

      if (msg.method === 'notifications/initialized') {
        // No response needed for notifications
        continue;
      }

      const result = handleRequest(msg.method, msg.params);
      if (result !== undefined && msg.id !== undefined) {
        const response = JSON.stringify({jsonrpc: '2.0', id: msg.id, result});
        process.stdout.write(response + '\n');
      }
    } catch {
      // Skip unparseable lines
    }
  }
});

process.stderr.write('Mock MCP server started (stdio)\n');
