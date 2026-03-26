#!/usr/bin/env bash
set -euo pipefail

# Publish plugins from packages/plugins/ to the Amodal registry.
#
# Usage:
#   ./scripts/publish-plugins.sh                # publish plugins changed since origin/main
#   ./scripts/publish-plugins.sh --all          # publish everything
#   ./scripts/publish-plugins.sh --dry-run      # show what would be published
#   ./scripts/publish-plugins.sh --local        # publish to local Verdaccio instead of production
#   ./scripts/publish-plugins.sh --bump patch   # bump version before publishing (patch|minor|major)
#
# Versioning:
#   - Versions are tracked in each plugin's package.json
#   - New plugins without a package.json default to 0.1.0
#   - If the version already exists in the registry, patch is auto-bumped
#   - Use --bump to explicitly bump before publishing
#
# Requires: npm login to the target registry (unless --local with Verdaccio)

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGINS_DIR="$DIR/packages/plugins"

PROD_REGISTRY="https://registry.amodalai.com"
LOCAL_REGISTRY="${AMODAL_REGISTRY_URL:-http://localhost:4873}"

DRY_RUN=false
PUBLISH_ALL=false
USE_LOCAL=false
BUMP=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --all) PUBLISH_ALL=true ;;
    --local) USE_LOCAL=true ;;
    patch|minor|major) BUMP="$arg" ;;
    --bump) ;; # next arg will be the bump type
  esac
done

if [ "$USE_LOCAL" = true ]; then
  REGISTRY="$LOCAL_REGISTRY"
else
  REGISTRY="$PROD_REGISTRY"
fi

echo "=== Publishing plugins to $REGISTRY ==="

# For local Verdaccio, auto-authenticate
TOKEN=""
if [ "$USE_LOCAL" = true ]; then
  VERDACCIO_USER="${VERDACCIO_USER:-publisher}"
  VERDACCIO_PASS="${VERDACCIO_PASS:-changeme}"
  VERDACCIO_EMAIL="${VERDACCIO_EMAIL:-publisher@localhost}"
  echo "[auth] Authenticating with local registry..."
  AUTH_RESP=$(curl -s -X PUT "$REGISTRY/-/user/org.couchdb.user:$VERDACCIO_USER" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$VERDACCIO_USER\",\"password\":\"$VERDACCIO_PASS\",\"email\":\"$VERDACCIO_EMAIL\"}" || echo "{}")
  TOKEN=$(echo "$AUTH_RESP" | node -e "try { process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).token || '') } catch { process.stdout.write('') }")
  if [ -z "$TOKEN" ]; then
    echo "[error] Failed to get auth token. Is Verdaccio running at $REGISTRY?"
    exit 1
  fi
  echo "[auth] Got auth token."
fi

# Regenerate package.json metadata from spec.json, preserving version
echo ""
echo "[gen] Syncing package.json metadata from spec.json..."
node -e "
const fs = require('fs');
const path = require('path');
const pluginsDir = '$PLUGINS_DIR';
const DEFAULT_VERSION = '0.1.0';

// Type prefix mapping: directory name -> npm package prefix
const TYPE_PREFIXES = {
  connections: 'connection',
  skills: 'skill',
  automations: 'automation',
  knowledge: 'knowledge',
  mcp: 'mcp',
};

const typeDirs = fs.readdirSync(pluginsDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

for (const typeName of typeDirs) {
  const typeDir = path.join(pluginsDir, typeName);
  const prefix = TYPE_PREFIXES[typeName] || typeName;

  const pluginDirs = fs.readdirSync(typeDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const name of pluginDirs) {
    const dir = path.join(typeDir, name);
    const specPath = path.join(dir, 'spec.json');
    const pkgPath = path.join(dir, 'package.json');

    // Skills and automations don't have spec.json — skip metadata regen for them
    if (!fs.existsSync(specPath)) continue;

    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

    // Preserve existing version from package.json, or default
    let existingVersion = DEFAULT_VERSION;
    try {
      const existing = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (existing.version) existingVersion = existing.version;
    } catch {}

    // Build auth in PackageManifestSchema format
    let auth;
    if (spec.auth) {
      if (spec.auth.type === 'bearer') {
        auth = { type: 'bearer' };
        const envVars = {};
        if (spec.auth.token && spec.auth.token.startsWith('env:')) {
          envVars[spec.auth.token.slice(4)] = (spec.displayName || name) + ' API token';
        }
        if (spec.auth.credentials) {
          for (const cred of spec.auth.credentials) {
            if (cred.token && cred.token.startsWith('env:')) {
              envVars[cred.token.slice(4)] = (spec.displayName || name) + ' credential';
            }
          }
        }
        if (Object.keys(envVars).length > 0) auth.envVars = envVars;
      } else if (spec.auth.type === 'api_key') {
        auth = { type: 'api_key' };
        const headers = {};
        const envVars = {};
        if (spec.auth.credentials) {
          for (const cred of spec.auth.credentials) {
            if (cred.header && cred.token && cred.token.startsWith('env:')) {
              const v = cred.token.slice(4);
              headers[cred.header] = '\${' + v + '}';
              envVars[v] = (spec.displayName || name) + ' credential';
            }
          }
        }
        // Handle non-array auth (token + header directly on auth object)
        if (spec.auth.token && spec.auth.token.startsWith('env:') && spec.auth.header) {
          const v = spec.auth.token.slice(4);
          headers[spec.auth.header] = '\${' + v + '}';
          envVars[v] = (spec.displayName || name) + ' API key';
        }
        if (Object.keys(headers).length > 0) auth.headers = headers;
        if (Object.keys(envVars).length > 0) auth.envVars = envVars;
      } else if (spec.auth.type === 'oauth2') {
        auth = {
          type: 'oauth2',
          authorizeUrl: spec.auth.authorizeUrl || 'https://example.com/oauth/authorize',
          tokenUrl: spec.auth.tokenUrl || 'https://example.com/oauth/token',
        };
        if (spec.auth.scopes) auth.scopes = spec.auth.scopes;
      } else if (spec.auth.type === 'none') {
        // No auth needed
      }
    }

    // Count endpoints from access.json
    let endpointCount = 0;
    const entities = [];
    try {
      const access = JSON.parse(fs.readFileSync(path.join(dir, 'access.json'), 'utf-8'));
      const endpoints = Object.keys(access.endpoints || {});
      endpointCount = endpoints.length;
      const entitySet = new Set();
      for (const ep of endpoints) {
        const parts = ep.split(' ');
        if (parts.length >= 2) {
          const pathParts = parts[1].split('/').filter(Boolean);
          for (const p of pathParts) {
            if (!p.startsWith('{') && !p.startsWith(':') && !p.startsWith('v') && p.length > 2) {
              entitySet.add(p.replace(/s$/, '').toLowerCase());
            }
          }
        }
      }
      entities.push(...[...entitySet].slice(0, 8));
    } catch {}

    const pkg = {
      name: '@amodalai/' + prefix + '-' + name,
      version: existingVersion,
      description: spec.description || (spec.displayName + ' connection for amodal'),
      amodal: {
        type: prefix,
        name: name,
        displayName: spec.displayName || name,
        description: spec.description || '',
        icon: spec.icon || '',
        category: spec.category || 'Other',
        baseUrl: spec.baseUrl || '',
      },
    };

    if (auth) pkg.amodal.auth = auth;
    if (entities.length > 0) pkg.amodal.entities = entities;
    if (endpointCount > 0) pkg.amodal.endpointCount = endpointCount;

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('[gen] ' + pkg.name + '@' + pkg.version + ' (' + endpointCount + ' endpoints)');
  }
}
"

# Publish each plugin
published=0
skipped=0
failed=0
bumped=0

for type_dir in "$PLUGINS_DIR"/*/; do
  [ -d "$type_dir" ] || continue

  for pkg_dir in "$type_dir"/*/; do
    [ -d "$pkg_dir" ] || continue
    [ -f "$pkg_dir/package.json" ] || continue

    pkg_name=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('${pkg_dir}package.json','utf8')).name)")
    pkg_version=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('${pkg_dir}package.json','utf8')).version)")

    # Check if changed (unless --all)
    if [ "$PUBLISH_ALL" = false ]; then
      # Check both tracked changes and untracked (new) files
      changes=$(git diff --name-only origin/main -- "$pkg_dir" 2>/dev/null || echo "")
      untracked=$(git ls-files --others --exclude-standard -- "$pkg_dir" 2>/dev/null || echo "")
      if [ -z "$changes" ] && [ -z "$untracked" ]; then
        skipped=$((skipped + 1))
        continue
      fi
    fi

    # Apply explicit bump if requested
    if [ -n "$BUMP" ]; then
      IFS='.' read -r major minor patch <<< "$pkg_version"
      case "$BUMP" in
        patch) patch=$((patch + 1)) ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        major) major=$((major + 1)); minor=0; patch=0 ;;
      esac
      pkg_version="$major.$minor.$patch"
      node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('${pkg_dir}package.json', 'utf8'));
        pkg.version = '$pkg_version';
        fs.writeFileSync('${pkg_dir}package.json', JSON.stringify(pkg, null, 2) + '\n');
      "
      echo "[bump] $pkg_name -> $pkg_version"
      bumped=$((bumped + 1))
    fi

    # Check if version already exists in registry, auto-bump patch if so
    if [ "$DRY_RUN" = false ]; then
      existing_version=$(npm view "$pkg_name" version --registry "$REGISTRY" 2>/dev/null || echo "")
      if [ "$existing_version" = "$pkg_version" ]; then
        IFS='.' read -r major minor patch <<< "$pkg_version"
        patch=$((patch + 1))
        pkg_version="$major.$minor.$patch"
        node -e "
          const fs = require('fs');
          const pkg = JSON.parse(fs.readFileSync('${pkg_dir}package.json', 'utf8'));
          pkg.version = '$pkg_version';
          fs.writeFileSync('${pkg_dir}package.json', JSON.stringify(pkg, null, 2) + '\n');
        "
        echo "[auto-bump] $pkg_name $existing_version -> $pkg_version (version already in registry)"
        bumped=$((bumped + 1))
      fi
    fi

    if [ "$DRY_RUN" = true ]; then
      echo "[dry-run] Would publish: $pkg_name@$pkg_version"
      published=$((published + 1))
      continue
    fi

    # Publish
    publish_args="--registry $REGISTRY"
    if [ -n "$TOKEN" ]; then
      publish_args="$publish_args --//localhost:4873/:_authToken=$TOKEN"
    fi

    if (cd "$pkg_dir" && npm publish $publish_args 2>&1); then
      echo "[ok] $pkg_name@$pkg_version"
      published=$((published + 1))
    else
      echo "[FAIL] $pkg_name@$pkg_version"
      failed=$((failed + 1))
    fi
  done
done

cd "$DIR"

echo ""
echo "=== Done ==="
echo "  Published: $published"
echo "  Bumped:    $bumped"
echo "  Skipped:   $skipped"
echo "  Failed:    $failed"
echo ""
echo "  Verify with:"
echo "    npm search @amodal --registry $REGISTRY"
