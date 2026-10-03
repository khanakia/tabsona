/** Small formatting helpers shared by every surface. Pure, no imports. */

/** Compact relative time: a dense row needs "2h", not "2 hours ago". */
export function shortAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}

/** Drop the scheme and any trailing pattern so a site fits a narrow column. */
export function shortSite(siteOrPattern: string): string {
  return siteOrPattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '');
}
