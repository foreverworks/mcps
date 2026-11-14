// Preloaded by the entrypoint (node --import). A container's first process
// ignores a signal it has installed no handler for, and Node starts as that
// process: without this, `docker stop` waits out its grace period and kills the
// server. This stops it the way a process outside a container stops, at once,
// with the exit status a shell reports for the signal. The process's exit
// handlers still run (a lock file proper-lockfile holds is released).
for (const [signal, status] of [
  ["SIGTERM", 143],
  ["SIGINT", 130],
]) {
  process.on(signal, () => process.exit(status));
}
