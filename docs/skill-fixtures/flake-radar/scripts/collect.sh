#!/usr/bin/env bash
# Fixture only — this file exists to prove the importer refuses to read it.
#
# It is matched as executable twice over (the `scripts/` path segment and the
# `.sh` extension), so it is filtered out on the zip's central directory and its
# bytes are never decompressed. If this text ever shows up in an imported skill
# body, the importer is broken.
set -euo pipefail
echo "if you can read this in a skill body, the import filter regressed"
