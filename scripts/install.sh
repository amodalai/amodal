#!/bin/bash
# Amodal CLI installer
# Usage: curl -fsSL https://releases.amodalai.com/install.sh | bash
set -euo pipefail

CDN_BASE="${AMODAL_CDN:-https://releases.amodalai.com}"
INSTALL_DIR="${AMODAL_INSTALL_DIR:-$HOME/.amodal}"
BIN_NAME="amodal"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${BOLD}%s${RESET}\n" "$*"; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${RESET} %s\n" "$*"; }
error() { printf "${RED}✗${RESET} %s\n" "$*" >&2; exit 1; }

# --- Pre-flight checks -------------------------------------------------------

command -v node >/dev/null 2>&1 || error "Node.js is required but not found. Install it from https://nodejs.org (v20+)"

NODE_MAJOR=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 20 ]; then
  error "Node.js v20+ is required (found v$(node -v | tr -d 'v'))"
fi

command -v curl >/dev/null 2>&1 || error "curl is required but not found"
command -v tar >/dev/null 2>&1 || error "tar is required but not found"

# --- Resolve version ----------------------------------------------------------

VERSION="${AMODAL_VERSION:-latest}"

if [ "$VERSION" = "latest" ]; then
  info "Fetching latest release..."
  VERSION=$(curl -fsSL "${CDN_BASE}/latest-version" 2>/dev/null || true)
  if [ -z "$VERSION" ]; then
    error "Could not determine latest version. Set AMODAL_VERSION=v0.1.0 to install a specific version."
  fi
fi

# Normalize — ensure version starts with v
case "$VERSION" in
  v*) ;; # already prefixed
  *)  VERSION="v${VERSION}" ;;
esac

info "Installing amodal ${VERSION}..."

# --- Download & extract -------------------------------------------------------

TARBALL_URL="${CDN_BASE}/releases/${VERSION}/amodal-${VERSION#v}.tar.gz"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$TARBALL_URL" -o "$TMP_DIR/amodal.tar.gz" \
  || error "Download failed. Check that ${VERSION} exists at ${CDN_BASE}/releases/"

tar -xzf "$TMP_DIR/amodal.tar.gz" -C "$TMP_DIR" \
  || error "Failed to extract archive"

# --- Install ------------------------------------------------------------------

mkdir -p "$INSTALL_DIR/bin"

# Copy the bundled JS
cp "$TMP_DIR/amodal.js" "$INSTALL_DIR/bin/amodal.js"
chmod +x "$INSTALL_DIR/bin/amodal.js"

# Copy runtime app if present
if [ -d "$TMP_DIR/app" ]; then
  rm -rf "$INSTALL_DIR/app"
  cp -r "$TMP_DIR/app" "$INSTALL_DIR/app"
fi

# Create wrapper script
# Drop a package.json so Node knows it's ESM (suppresses MODULE_TYPELESS_PACKAGE_JSON warning)
cat > "$INSTALL_DIR/bin/package.json" << 'PKG'
{"type":"module"}
PKG

cat > "$INSTALL_DIR/bin/${BIN_NAME}" << 'WRAPPER'
#!/bin/bash
exec node "$(dirname "$0")/amodal.js" "$@"
WRAPPER
chmod +x "$INSTALL_DIR/bin/${BIN_NAME}"

ok "Installed amodal ${VERSION} to ${INSTALL_DIR}"

# --- PATH setup ---------------------------------------------------------------

BIN_PATH="$INSTALL_DIR/bin"
case ":${PATH}:" in
  *":${BIN_PATH}:"*)
    ok "${BIN_NAME} is already in your PATH"
    ;;
  *)
    warn "${BIN_PATH} is not in your PATH"

    SHELL_NAME=$(basename "$SHELL")
    case "$SHELL_NAME" in
      zsh)  RC_FILE="$HOME/.zshrc" ;;
      bash)
        if [ -f "$HOME/.bash_profile" ]; then
          RC_FILE="$HOME/.bash_profile"
        else
          RC_FILE="$HOME/.bashrc"
        fi
        ;;
      fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
      *)    RC_FILE="" ;;
    esac

    EXPORT_LINE="export PATH=\"${BIN_PATH}:\$PATH\""
    if [ "$SHELL_NAME" = "fish" ]; then
      EXPORT_LINE="set -gx PATH ${BIN_PATH} \$PATH"
    fi

    if [ -n "$RC_FILE" ]; then
      if ! grep -qF "$BIN_PATH" "$RC_FILE" 2>/dev/null; then
        printf '\n# Amodal CLI\n%s\n' "$EXPORT_LINE" >> "$RC_FILE"
        ok "Added ${BIN_PATH} to ${RC_FILE}"
      fi
      info "Run: source ${RC_FILE}  (or open a new terminal)"
    else
      info "Add this to your shell profile:"
      printf '  %s\n' "$EXPORT_LINE"
    fi
    ;;
esac

printf "\n${GREEN}${BOLD}amodal ${VERSION} installed!${RESET}\n"
printf "Run ${BOLD}amodal --help${RESET} to get started.\n"
