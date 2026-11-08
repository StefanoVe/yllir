// Local calendar date, as YYYY-MM-DD. Uses the local time zone on purpose: a
// campaign day is the master's day, not the UTC day.

/** Returns the local date of `now` as YYYY-MM-DD. */
export function today(now = new Date()) {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
