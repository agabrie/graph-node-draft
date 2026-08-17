/* core/services/ranking.js — RankingService.
 *
 * Fractional indexing for sibling order. Structural, not presentational:
 * rank must survive a reset-layout command.
 */
(function (root) {
  'use strict';
  var GC = root.GraphCore = root.GraphCore || {};

  var RANK_A = 'abcdefghijklmnopqrstuvwxyz';

  /** Fractional index: a sortable string strictly between a and b. */
  function rankBetween(a, b) {
    a = a || ''; b = b || '';
    var out = '', i = 0;
    for (;;) {
      var ca = i < a.length ? RANK_A.indexOf(a[i]) : -1;
      var cb = i < b.length ? RANK_A.indexOf(b[i]) : RANK_A.length;
      if (cb - ca > 1) return out + RANK_A[Math.floor((ca + cb) / 2)];
      out += i < a.length ? a[i] : 'a';
      i++;
      if (i > 40) return out + 'm';
    }
  }

  function nextRank(existing) {
    var sorted = existing.slice().sort();
    return sorted.length ? rankBetween(sorted[sorted.length - 1], '') : 'm';
  }

  GC.RankingService = { rankBetween: rankBetween, nextRank: nextRank };
  GC.rankBetween = rankBetween; // kept for API compatibility
  GC.nextRank = nextRank;
})(typeof window !== 'undefined' ? window : globalThis);
