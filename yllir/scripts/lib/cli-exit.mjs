// Exit status of the command line tools. Every CLI ends through exitWith, which
// prints `exit: <code>` as the last line of stdout, so callers never need to
// append `; echo "EXIT $?"` to a command. process.exitCode is set instead of
// calling process.exit, so output piped to a reader is never cut short.

/** Prints `exit: <code>` as the last line of stdout and sets the exit status. */
export function exitWith(code) {
  process.stdout.write(`exit: ${code}\n`);
  process.exitCode = code;
}

/**
 * Runs the main function of a CLI. Any uncaught error is reported on stderr and
 * the tool exits with 2 (usage or unexpected failure).
 */
export function runCli(main) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    exitWith(2);
  }
}

/** Removes the trailing `exit: <code>` line that every CLI prints. */
export function stripExitLine(stdout) {
  return stdout.replace(/exit: \d+\n$/, '');
}
