#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
helper="${HERDR_SETUP_HELPER:-$script_dir/setup-multi-herdr.mjs}"
if [[ ! -f "$helper" ]]; then
  printf '%s\n' 'Set HERDR_SETUP_HELPER to the installed setup-multi-herdr.mjs helper.' >&2
  exit 2
fi
# Pass the private manifest and approved digest through; never infer approval.
exec node "$helper" bond "$@"
