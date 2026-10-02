// A readable random seed, e.g. "quiet harbor 42" - the only place the site
// uses Math.random(), and only to suggest something to start from.
const A = ['quiet', 'amber', 'velvet', 'hollow', 'gentle', 'electric', 'paper', 'silver', 'wild', 'slow', 'bright', 'secret', 'drifting', 'golden', 'lunar', 'mossy', 'salty', 'sleepy', 'tiny', 'violet'];
const B = ['harbor', 'orchard', 'comet', 'lantern', 'meadow', 'echo', 'canyon', 'ribbon', 'garden', 'tide', 'engine', 'island', 'museum', 'thunder', 'window', 'forest', 'planet', 'river', 'carousel', 'cloud'];

export function randomSeed() {
  const r = () => Math.floor(Math.random() * 1e9);
  return `${A[r() % A.length]} ${B[r() % B.length]} ${1 + (r() % 99)}`;
}
