#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Test the npm release smoke test locally using Docker.
# Mirrors the npm-smoke-test job in .github/workflows/release.yml.
#
# Usage: ./scripts/test-npm-release.sh [version]
#   version: npm version to install (default: latest)
# ---------------------------------------------------------------------------
set -euo pipefail

VERSION="${1:-latest}"

echo "=== Testing @amodalai/amodal@${VERSION} from npm ==="

docker run --rm \
  --network host \
  -e DATABASE_URL=postgresql://medplum:medplum@host.docker.internal:5432/amodal \
  node:20-slim bash -c "
    set -e
    apt-get update -qq && apt-get install -y -qq curl > /dev/null 2>&1

    # Install from npm
    echo '--- Installing @amodalai/amodal@${VERSION} ---'
    npm install -g @amodalai/amodal@${VERSION} 2>&1 | tail -3

    # Create test agent
    mkdir -p /tmp/smoke-agent
    echo '{\"name\":\"ci-smoke\",\"version\":\"1.0.0\"}' > /tmp/smoke-agent/amodal.json

    # Find Studio server from npm global prefix
    NPM_ROOT=\$(npm root -g)
    STUDIO_SERVER=\"\${NPM_ROOT}/@amodalai/amodal/node_modules/@amodalai/studio/dist-server/studio-server.js\"
    echo \"Studio server: \$STUDIO_SERVER\"

    # Start Studio
    PORT=13999 REPO_PATH=/tmp/smoke-agent RUNTIME_URL=http://localhost:3847 \
      DATABASE_URL=postgresql://medplum:medplum@host.docker.internal:5432/amodal \
      node \"\$STUDIO_SERVER\" &
    STUDIO_PID=\$!

    # Wait for Studio
    for i in \$(seq 1 30); do
      if curl -sf http://localhost:13999/api/studio/config > /dev/null 2>&1; then break; fi
      sleep 1
    done

    # Verify endpoints
    echo '--- Config ---'
    curl -sf http://localhost:13999/api/studio/config
    echo ''

    echo '--- SPA ---'
    STATUS=\$(curl -sf -o /dev/null -w '%{http_code}' http://localhost:13999/)
    test \"\$STATUS\" = \"200\" && echo \"OK: \$STATUS\" || (echo \"FAIL: \$STATUS\"; exit 1)

    echo '--- Stores ---'
    curl -sf http://localhost:13999/api/studio/stores
    echo ''

    echo '--- Drafts ---'
    curl -sf http://localhost:13999/api/studio/drafts
    echo ''

    echo '=== All checks passed ==='
    kill \$STUDIO_PID 2>/dev/null || true
  "
