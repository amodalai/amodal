/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
export default async function (
  params: {message: string},
  ctx: {
    request: (conn: string, endpoint: string, params?: unknown) => Promise<unknown>;
    store: (name: string, payload: Record<string, unknown>) => Promise<{key: string}>;
    log: (msg: string) => void;
  },
) {
  ctx.log(`echo_tool called with: ${params.message}`);

  // Test ctx.request() — fetch from mock-api
  const items = await ctx.request('mock-api', '/items');

  // Test ctx.store() — write to test-items store
  const storeResult = await ctx.store('test-items', {
    item_id: 'echo-test',
    name: params.message,
    status: 'active',
  });

  return {
    echoed: params.message,
    itemCount: Array.isArray(items) ? items.length : 0,
    storedKey: storeResult.key,
  };
}
