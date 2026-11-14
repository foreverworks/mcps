#!/bin/sh
# Starts one MCP server in the container. The server is named by the first
# argument or, without one, by MCP_SERVER, and must be a folder of /app/servers
# that has been built. It runs from its own folder, as `node dist/index.js` does
# everywhere else. Whatever follows the name goes to the server, and so does
# everything when the first argument starts with `-` (`--health`).
#
#   docker run --env MCP_SERVER=bnr <image>
#   docker run <image> bnr
#
# exit-on-signal.mjs makes `docker stop` end the server at once; see there.
set -eu

apps=/app/servers

available() {
  for dir in "$apps"/*/; do
    [ -f "${dir}dist/index.js" ] && basename "$dir"
  done | tr '\n' ' '
}

case "${1:-}" in
  -* | "") name="${MCP_SERVER:-}" ;;
  *)
    name="$1"
    shift
    ;;
esac

if [ -z "$name" ]; then
  echo "Name the server to run, with MCP_SERVER or as the first argument. Available: $(available)" >&2
  exit 64
fi

# A name is a folder of servers/ and nothing else: no path, no dot.
found=
case "$name" in
  *[!a-z0-9-]* | -*) ;;
  *) if [ -f "$apps/$name/dist/index.js" ]; then found=yes; fi ;;
esac
if [ -z "$found" ]; then
  echo "No server named \"$name\". Available: $(available)" >&2
  exit 64
fi

cd "$apps/$name"
exec node --import /usr/local/lib/mcp/exit-on-signal.mjs dist/index.js "$@"
