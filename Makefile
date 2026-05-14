# Makefile — ptouch-webapp
#
# Targets:
#   make              → alias for `make dev`
#   make install      → npm install
#   make dev          → Vite dev server with HMR (localhost:5173)
#   make build        → Production build → dist/
#   make preview      → Serve the production build locally (localhost:4173)
#   make clean        → Remove dist/ and node_modules/.vite cache
#   make distclean    → clean + remove node_modules/
#   make scan         → Run BLE/serial diagnostic script via uv

.PHONY: all install dev build preview clean distclean scan

# ─── Config ──────────────────────────────────────────────────────────────────

NODE_MODULES := node_modules
DIST         := dist
VITE         := $(NODE_MODULES)/.bin/vite

# ─── Default target ───────────────────────────────────────────────────────────

all: dev

# ─── Dependencies ─────────────────────────────────────────────────────────────

$(VITE): package.json
	npm install
	@touch $(VITE)   # prevent reinstall if package.json is newer

install: $(VITE)

# ─── Development server (HMR, auto-refresh) ──────────────────────────────────
# Vite serves on http://localhost:5173 by default, which satisfies the
# HTTPS/localhost requirement for Web Serial.

dev: $(VITE)
	$(VITE)

# ─── Production build ─────────────────────────────────────────────────────────
# Output goes to dist/ with base path /ptouch-webapp/ (GitHub Pages).

build: $(VITE)
	$(VITE) build

# ─── Preview production build locally ────────────────────────────────────────
# Serves the contents of dist/ on http://localhost:4173/ptouch-webapp/

preview: build
	$(VITE) preview

# ─── BLE / Serial diagnostic scan ────────────────────────────────────────────

scan:
	uv run scripts/scan_ptouch.py --timeout 15 --all

# ─── Housekeeping ─────────────────────────────────────────────────────────────

clean:
	rm -rf $(DIST) $(NODE_MODULES)/.vite

distclean: clean
	rm -rf $(NODE_MODULES)
