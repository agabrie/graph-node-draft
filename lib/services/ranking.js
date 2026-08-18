/* lib/services/ranking.js — RankingService.
 *
 * Fractional indexing for sibling order, on both nodes (containment order)
 * and edges (a grouping node's edges, e.g. message order in time).
 */

const RANK_A = 'abcdefghijklmnopqrstuvwxyz';

/** Fractional index: a sortable string strictly between a and b. */
export function rankBetween(a, b) {
  a = a || ''; b = b || '';
  let out = '', i = 0;
  for (;;) {
    const ca = i < a.length ? RANK_A.indexOf(a[i]) : -1;
    const cb = i < b.length ? RANK_A.indexOf(b[i]) : RANK_A.length;
    if (cb - ca > 1) return out + RANK_A[Math.floor((ca + cb) / 2)];
    out += i < a.length ? a[i] : 'a';
    i++;
    if (i > 40) return out + 'm';
  }
}

export function nextRank(existing) {
  const sorted = existing.slice().sort();
  return sorted.length ? rankBetween(sorted[sorted.length - 1], '') : 'm';
}

export const RankingService = { rankBetween, nextRank };
