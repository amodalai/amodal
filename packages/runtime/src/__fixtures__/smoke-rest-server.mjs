/* eslint-disable no-undef */
/**
 * Mock REST server for smoke tests.
 * Returns canned data for the smoke-agent's mock-api connection.
 */

import {createServer} from 'node:http';

const ITEMS = [
  {id: '1', name: 'Widget', status: 'active'},
  {id: '2', name: 'Gadget', status: 'archived'},
  {id: '3', name: 'Doohickey', status: 'active'},
];

let nextId = 4;

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/items') {
    res.writeHead(200);
    res.end(JSON.stringify(ITEMS));
    return;
  }

  if (req.method === 'POST' && req.url === '/items') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const item = {id: String(nextId++), ...data};
        ITEMS.push(item);
        res.writeHead(201);
        res.end(JSON.stringify(item));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({error: 'Invalid JSON'}));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({error: 'Not found'}));
});

const PORT = parseInt(process.env.SMOKE_REST_PORT || '9901', 10);
server.listen(PORT, () => {
  process.stderr.write(`Mock REST server on ${PORT}\n`);
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
