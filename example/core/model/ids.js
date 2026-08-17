/* core/model/ids.js — identity value object.
 *
 * Opaque, immutable, never reused. ULID-shaped (Crockford base32) so ids sort
 * lexicographically by creation time, matching the schema's id pattern.
 */

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford, no I L O U

export function newId() {
  let t = Date.now(), time = '';
  for (let i = 9; i >= 0; i--) { time = B32[t % 32] + time; t = Math.floor(t / 32); }
  let rand = '';
  for (let j = 0; j < 16; j++) rand += B32[Math.floor(Math.random() * 32)];
  return time + rand; // 26 chars, matches the schema's id pattern
}
