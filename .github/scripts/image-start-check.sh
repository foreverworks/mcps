#!/usr/bin/env bash
# Starts a built image target and proves it does what its stage exists for.
# One source of truth: ci.yml (every pull request) and image.yml (before a
# publish) both call this, with the image they just built loaded into Docker.
#
#   .github/scripts/image-start-check.sh <target> <image>
#
# <target> is a stage of the Dockerfile: image, printer, anafspv or devices.
# Every target must start the server entrypoint (`docker run -i <image> bnr`,
# over stdio) and answer MCP's `initialize` and `tools/list`, which every server
# does with no credentials; the stages that add programs also run each of them.
set -euo pipefail

target="${1:?usage: image-start-check.sh <image|printer|anafspv|devices> <image>}"
image="${2:?usage: image-start-check.sh <image|printer|anafspv|devices> <image>}"

# Runs a program of the image in place of its entrypoint.
run() {
  local program="$1"
  shift
  echo "+ $program $*"
  docker run --rm --entrypoint "$program" "$image" "$@"
}

# Starts the bnr server (it needs nothing besides Node) over stdio, asks it to
# initialize and list its tools, and fails unless both answer.
start_server() {
  local out
  echo "+ docker run -i $image bnr  (initialize, tools/list)"
  out="$(
    {
      printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"image-start-check","version":"0"}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
      # Stdin stays open until both answers are in: a closed stdin ends the server.
      sleep 5
    } | timeout 30 docker run --rm -i "$image" bnr 2>/dev/null || true
  )"
  grep -q '"serverInfo"' <<<"$out" || {
    echo "The server did not answer initialize. Output was:" >&2
    echo "$out" >&2
    return 1
  }
  grep -q '"tools":\[{"name"' <<<"$out" || {
    echo "The server did not answer tools/list. Output was:" >&2
    echo "$out" >&2
    return 1
  }
  echo "The server started and listed its tools."
}

start_server

case "$target" in
  image) ;;
  printer)
    run pdftoppm -v
    run pdfinfo -v
    ;;
  anafspv)
    run java -version
    ;;
  devices)
    run ssh -V
    run incus --version
    run jq --version
    run bash --version
    run setsid --version
    run awk -W version
    ;;
  *)
    echo "Unknown target: $target" >&2
    exit 64
    ;;
esac
