// DRAW TOGETHER — word bank.
//
// Each line:  W(prompt, emoji, 'category category', difficulty, 'also accept|also accept')
//   categories: animals dinosaurs fantasy space food nature toys vehicles places things silly
//   difficulty: easy | medium | silly
//   also: optional alternative answers separated by |
//
// Add words anywhere. The server never sends this list to browsers.

const W = (w, e, c, d, also = '') => ({
  w, e, c: c.split(' '), d, also: also ? also.split('|') : [],
});

export const WORDS = [
  // ── Animals ───────────────────────────────
  W('Cat', '🐱', 'animals', 'easy', 'kitty'),
  W('Kitten', '🐈', 'animals', 'easy', 'cat|kitty'),
  W('Dog', '🐶', 'animals', 'easy', 'doggy'),
  W('Puppy', '🐕', 'animals', 'easy', 'dog|doggy'),
  W('Bunny', '🐰', 'animals', 'easy', 'rabbit'),
  W('Rabbit', '🐇', 'animals', 'easy', 'bunny'),
  W('Hamster', '🐹', 'animals', 'medium'),
  W('Guinea pig', '🐹', 'animals', 'medium'),
  W('Mouse', '🐭', 'animals', 'easy'),
  W('Squirrel', '🐿️', 'animals', 'medium'),
  W('Chipmunk', '🐿️', 'animals', 'medium', 'squirrel'),
  W('Hedgehog', '🦔', 'animals', 'medium'),
  W('Otter', '🦦', 'animals', 'medium'),
  W('Beaver', '🦫', 'animals', 'medium'),
  W('Raccoon', '🦝', 'animals', 'medium'),
  W('Fox', '🦊', 'animals', 'medium'),
  W('Deer', '🦌', 'animals', 'medium'),
  W('Fawn', '🦌', 'animals', 'medium', 'deer|baby deer'),
  W('Bear', '🐻', 'animals', 'easy'),
  W('Panda', '🐼', 'animals', 'easy'),
  W('Koala', '🐨', 'animals', 'medium'),
  W('Sloth', '🦥', 'animals', 'medium'),
  W('Monkey', '🐵', 'animals', 'easy'),
  W('Gorilla', '🦍', 'animals', 'medium', 'monkey'),
  W('Elephant', '🐘', 'animals', 'easy'),
  W('Giraffe', '🦒', 'animals', 'easy'),
  W('Zebra', '🦓', 'animals', 'medium'),
  W('Lion', '🦁', 'animals', 'easy'),
  W('Tiger', '🐯', 'animals', 'medium'),
  W('Leopard', '🐆', 'animals', 'medium', 'cheetah'),
  W('Cheetah', '🐆', 'animals', 'medium', 'leopard'),
  W('Hippo', '🦛', 'animals', 'medium', 'hippopotamus'),
  W('Rhino', '🦏', 'animals', 'medium', 'rhinoceros'),
  W('Kangaroo', '🦘', 'animals', 'medium'),
  W('Llama', '🦙', 'animals', 'medium', 'alpaca'),
  W('Alpaca', '🦙', 'animals', 'medium', 'llama'),
  W('Goat', '🐐', 'animals', 'medium'),
  W('Sheep', '🐑', 'animals', 'easy', 'lamb'),
  W('Cow', '🐮', 'animals', 'easy'),
  W('Pig', '🐷', 'animals', 'easy', 'piggy'),
  W('Horse', '🐴', 'animals', 'easy', 'pony'),
  W('Pony', '🐴', 'animals', 'easy', 'horse'),
  W('Donkey', '🫏', 'animals', 'medium'),
  W('Chicken', '🐔', 'animals', 'easy', 'hen'),
  W('Chick', '🐤', 'animals', 'easy', 'chicken|baby chicken'),
  W('Duck', '🦆', 'animals', 'easy'),
  W('Duckling', '🐥', 'animals', 'easy', 'duck|baby duck'),
  W('Goose', '🪿', 'animals', 'medium'),
  W('Owl', '🦉', 'animals', 'easy'),
  W('Penguin', '🐧', 'animals', 'easy'),
  W('Flamingo', '🦩', 'animals', 'medium'),
  W('Peacock', '🦚', 'animals', 'medium'),
  W('Parrot', '🦜', 'animals', 'medium'),
  W('Bird', '🐦', 'animals', 'easy'),
  W('Hummingbird', '🐦', 'animals', 'medium'),
  W('Butterfly', '🦋', 'animals nature', 'easy'),
  W('Ladybug', '🐞', 'animals nature', 'easy', 'ladybird'),
  W('Bumblebee', '🐝', 'animals nature', 'easy', 'bee'),
  W('Caterpillar', '🐛', 'animals nature', 'easy'),
  W('Snail', '🐌', 'animals nature', 'easy'),
  W('Frog', '🐸', 'animals', 'easy'),
  W('Turtle', '🐢', 'animals', 'easy', 'tortoise'),
  W('Lizard', '🦎', 'animals', 'medium'),
  W('Chameleon', '🦎', 'animals', 'medium', 'lizard'),
  W('Whale', '🐳', 'animals', 'easy'),
  W('Dolphin', '🐬', 'animals', 'medium'),
  W('Shark', '🦈', 'animals', 'medium'),
  W('Octopus', '🐙', 'animals', 'medium'),
  W('Jellyfish', '🪼', 'animals', 'medium'),
  W('Seahorse', '🌊', 'animals', 'medium'),
  W('Starfish', '⭐', 'animals', 'easy', 'sea star'),
  W('Crab', '🦀', 'animals', 'medium'),
  W('Lobster', '🦞', 'animals', 'medium'),
  W('Fish', '🐟', 'animals', 'easy'),
  W('Goldfish', '🐠', 'animals', 'easy', 'fish'),
  W('Narwhal', '🐋', 'animals', 'medium'),
  W('Seal', '🦭', 'animals', 'medium'),

  // ── Dinosaurs ─────────────────────────────
  W('Dinosaur', '🦕', 'dinosaurs', 'easy', 'dino'),
  W('T-Rex', '🦖', 'dinosaurs', 'medium', 'tyrannosaurus|tyrannosaurus rex|dinosaur'),
  W('Triceratops', '🦕', 'dinosaurs', 'medium'),
  W('Stegosaurus', '🦕', 'dinosaurs', 'medium'),
  W('Pterodactyl', '🦕', 'dinosaurs', 'medium', 'pterosaur|pteranodon'),

  // ── Fantasy ───────────────────────────────
  W('Mermaid', '🧜‍♀️', 'fantasy', 'medium'),
  W('Unicorn', '🦄', 'fantasy', 'easy'),
  W('Dragon', '🐉', 'fantasy', 'medium'),
  W('Fairy', '🧚', 'fantasy', 'medium'),
  W('Princess', '👸', 'fantasy', 'medium'),
  W('Prince', '🤴', 'fantasy', 'medium'),
  W('Queen', '👸', 'fantasy', 'medium'),
  W('King', '🤴', 'fantasy', 'medium'),
  W('Wizard', '🧙', 'fantasy', 'medium'),
  W('Robot', '🤖', 'toys fantasy', 'easy'),
  W('Alien', '👽', 'space', 'easy'),
  W('Monster', '👾', 'fantasy', 'easy'),
  W('Ghost', '👻', 'fantasy', 'easy'),
  W('Angel', '😇', 'fantasy', 'medium'),
  W('Castle', '🏰', 'places fantasy', 'medium'),
  W('Crown', '👑', 'fantasy', 'easy'),
  W('Magic wand', '🪄', 'fantasy', 'medium', 'wand'),
  W('Treasure chest', '💰', 'fantasy places', 'medium', 'treasure|chest'),
  W('Treasure map', '🗺️', 'fantasy', 'medium', 'map'),
  W('Pirate ship', '🏴‍☠️', 'vehicles fantasy', 'medium'),
  W('Friendly pirate', '🦜', 'fantasy', 'medium', 'pirate'),
  W('Fairy house', '🍄', 'fantasy places', 'medium'),

  // ── Space & sky ───────────────────────────
  W('Rainbow', '🌈', 'nature', 'easy'),
  W('Cloud', '☁️', 'nature', 'easy'),
  W('Sun', '☀️', 'nature space', 'easy'),
  W('Moon', '🌙', 'space', 'easy'),
  W('Star', '⭐', 'space', 'easy'),
  W('Shooting star', '🌠', 'space', 'medium'),
  W('Planet', '🪐', 'space', 'easy'),
  W('Saturn', '🪐', 'space', 'medium'),
  W('Rocket', '🚀', 'space vehicles', 'medium', 'rocket ship'),
  W('Spaceship', '🛸', 'space vehicles', 'medium', 'ufo|flying saucer|rocket'),
  W('Comet', '☄️', 'space', 'medium'),

  // ── Nature ────────────────────────────────
  W('Flower', '🌸', 'nature', 'easy'),
  W('Rose', '🌹', 'nature', 'medium'),
  W('Daisy', '🌼', 'nature', 'medium'),
  W('Sunflower', '🌻', 'nature', 'medium'),
  W('Tulip', '🌷', 'nature', 'medium'),
  W('Mushroom', '🍄', 'nature', 'easy', 'toadstool'),
  W('Tree', '🌳', 'nature', 'easy'),
  W('Palm tree', '🌴', 'nature', 'medium'),
  W('Cactus', '🌵', 'nature', 'easy'),
  W('Snowman', '☃️', 'nature', 'easy'),
  W('Snowflake', '❄️', 'nature', 'easy'),
  W('Campfire', '🔥', 'nature places', 'medium', 'fire'),

  // ── Food ──────────────────────────────────
  W('Apple', '🍎', 'food', 'easy'),
  W('Banana', '🍌', 'food', 'easy'),
  W('Strawberry', '🍓', 'food', 'easy'),
  W('Watermelon', '🍉', 'food', 'easy'),
  W('Pineapple', '🍍', 'food', 'medium'),
  W('Cherry', '🍒', 'food', 'easy', 'cherries'),
  W('Grapes', '🍇', 'food', 'easy'),
  W('Orange', '🍊', 'food', 'easy'),
  W('Lemon', '🍋', 'food', 'medium'),
  W('Peach', '🍑', 'food', 'medium'),
  W('Carrot', '🥕', 'food', 'easy'),
  W('Pumpkin', '🎃', 'food', 'easy'),
  W('Cupcake', '🧁', 'food', 'easy'),
  W('Birthday cake', '🎂', 'food', 'medium', 'cake'),
  W('Cookie', '🍪', 'food', 'easy', 'biscuit'),
  W('Donut', '🍩', 'food', 'easy', 'doughnut'),
  W('Ice cream cone', '🍦', 'food', 'easy', 'ice cream'),
  W('Popsicle', '🍧', 'food', 'medium', 'ice lolly|ice pop|lolly'),
  W('Lollipop', '🍭', 'food', 'easy', 'lolly'),
  W('Candy', '🍬', 'food', 'easy', 'sweet|sweets|sweetie'),
  W('Chocolate bar', '🍫', 'food', 'medium', 'chocolate'),
  W('Pizza', '🍕', 'food', 'easy'),
  W('Hamburger', '🍔', 'food', 'easy', 'burger'),
  W('French fries', '🍟', 'food', 'medium', 'fries|chips'),
  W('Taco', '🌮', 'food', 'medium'),
  W('Pancakes', '🥞', 'food', 'medium'),
  W('Waffle', '🧇', 'food', 'medium'),
  W('Sandwich', '🥪', 'food', 'medium'),
  W('Hot dog', '🌭', 'food', 'medium'),
  W('Popcorn', '🍿', 'food', 'medium'),
  W('Milkshake', '🥤', 'food', 'medium', 'shake'),

  // ── Toys & party ──────────────────────────
  W('Balloon', '🎈', 'toys', 'easy'),
  W('Birthday present', '🎁', 'toys', 'easy', 'present|gift|birthday gift'),
  W('Party hat', '🥳', 'toys', 'medium'),
  W('Teddy bear', '🧸', 'toys', 'easy', 'teddy'),
  W('Doll', '🪆', 'toys', 'medium'),
  W('Toy car', '🚗', 'toys vehicles', 'easy', 'car'),
  W('Toy train', '🚂', 'toys vehicles', 'medium', 'train'),
  W('Building blocks', '🧱', 'toys', 'medium', 'blocks'),
  W('Kite', '🪁', 'toys', 'easy'),
  W('Yo-yo', '🪀', 'toys', 'medium'),
  W('Rubber duck', '🦆', 'toys', 'easy', 'duck|rubber ducky'),
  W('Beach ball', '🏖️', 'toys', 'easy', 'ball'),
  W('Soccer ball', '⚽', 'toys', 'easy', 'football|ball'),

  // ── Things ────────────────────────────────
  W('Teacup', '🍵', 'things', 'medium', 'cup|cup of tea'),
  W('Heart', '❤️', 'things', 'easy', 'love heart'),
  W('Smiley face', '😊', 'things', 'easy', 'smiley|happy face|face'),
  W('Bow', '🎀', 'things', 'medium', 'ribbon'),
  W('Key', '🔑', 'things', 'easy'),
  W('Diamond', '💎', 'things', 'easy', 'gem|jewel'),
  W('Backpack', '🎒', 'things', 'medium', 'bag|school bag|rucksack'),
  W('Bed', '🛏️', 'things', 'easy'),
  W('Bathtub', '🛁', 'things', 'medium', 'bath'),
  W('Toothbrush', '🪥', 'things', 'medium'),
  W('Umbrella', '☂️', 'things', 'easy'),
  W('Sunglasses', '🕶️', 'things', 'easy', 'glasses'),
  W('Hat', '🎩', 'things', 'easy'),
  W('Boots', '👢', 'things', 'easy', 'wellies|rain boots'),
  W('Mittens', '🧤', 'things', 'medium', 'gloves'),
  W('Picnic basket', '🧺', 'things', 'medium', 'picnic|basket'),

  // ── Vehicles ──────────────────────────────
  W('Bicycle', '🚲', 'vehicles', 'medium', 'bike'),
  W('Scooter', '🛴', 'vehicles', 'medium'),
  W('Skateboard', '🛹', 'vehicles toys', 'medium'),
  W('Roller skate', '🛼', 'vehicles toys', 'medium', 'roller skates|skates'),
  W('Car', '🚗', 'vehicles', 'easy'),
  W('Race car', '🏎️', 'vehicles', 'medium', 'racing car|car'),
  W('Bus', '🚌', 'vehicles', 'easy'),
  W('Fire truck', '🚒', 'vehicles', 'medium', 'fire engine'),
  W('Airplane', '✈️', 'vehicles', 'easy', 'plane|aeroplane'),
  W('Helicopter', '🚁', 'vehicles', 'medium'),
  W('Sailboat', '⛵', 'vehicles', 'easy', 'boat|sailing boat'),
  W('Submarine', '🚢', 'vehicles', 'medium'),
  W('Tractor', '🚜', 'vehicles', 'medium'),

  // ── Places ────────────────────────────────
  W('House', '🏠', 'places', 'easy', 'home'),
  W('Treehouse', '🌳', 'places', 'medium'),
  W('Tent', '⛺', 'places', 'easy'),
  W('Sandcastle', '🏖️', 'places', 'medium', 'sand castle'),
  W('Swing', '🌳', 'places', 'medium', 'swings'),
  W('Slide', '🛝', 'places', 'medium'),
  W('Trampoline', '🤸', 'places toys', 'medium'),
  W('Ferris wheel', '🎡', 'places', 'medium', 'big wheel'),
  W('Roller coaster', '🎢', 'places', 'medium', 'rollercoaster'),
  W('Merry-go-round', '🎠', 'places', 'medium', 'carousel|roundabout'),

  // ── Silly combinations ────────────────────
  W('Unicorn cupcake', '🦄', 'silly fantasy food', 'silly'),
  W('Cat wearing a crown', '😼', 'silly animals', 'silly'),
  W('Dog wearing sunglasses', '😎', 'silly animals', 'silly'),
  W('Dinosaur eating pizza', '🦖', 'silly dinosaurs food', 'silly'),
  W('Bunny holding a balloon', '🎈', 'silly animals', 'silly'),
  W('Mermaid with a starfish', '🧜‍♀️', 'silly fantasy', 'silly'),
  W('Frog wearing a hat', '🐸', 'silly animals', 'silly'),
  W('Penguin eating ice cream', '🐧', 'silly animals food', 'silly'),
  W('Bear having a picnic', '🧺', 'silly animals', 'silly'),
  W('Alien in a spaceship', '🛸', 'silly space', 'silly'),
  W('Pig in a bathtub', '🐷', 'silly animals', 'silly'),
  W('Snail on a skateboard', '🐌', 'silly animals', 'silly'),
  W('Elephant on a bicycle', '🐘', 'silly animals vehicles', 'silly'),
  W('Octopus playing drums', '🐙', 'silly animals', 'silly'),
  W('Giraffe wearing a scarf', '🦒', 'silly animals', 'silly'),
  W('Fish in a teacup', '🐟', 'silly animals', 'silly'),
  W('Robot eating a donut', '🤖', 'silly toys food', 'silly'),
  W('Duck wearing boots', '🦆', 'silly animals', 'silly'),
  W('Monkey on a rocket', '🐵', 'silly animals space', 'silly'),
  W('Owl reading a book', '🦉', 'silly animals', 'silly'),
  W('Cow on the moon', '🐮', 'silly animals space', 'silly'),
  W('Sheep on a trampoline', '🐑', 'silly animals', 'silly'),
  W('Shark wearing a bow', '🦈', 'silly animals', 'silly'),
  W('Snowman at the beach', '⛄', 'silly nature', 'silly'),
  W('Cat in a box', '📦', 'silly animals', 'silly'),
  W('Dragon eating a cupcake', '🐉', 'silly fantasy food', 'silly'),
  W('Lion with a lollipop', '🦁', 'silly animals food', 'silly'),
  W('Panda on a swing', '🐼', 'silly animals', 'silly'),
  W('Turtle wearing a party hat', '🐢', 'silly animals', 'silly'),
  W('Mouse eating cheese', '🧀', 'silly animals food', 'silly'),
  W('Whale with an umbrella', '🐳', 'silly animals', 'silly'),
  W('Unicorn on roller skates', '🦄', 'silly fantasy', 'silly'),
  W('Crab playing guitar', '🦀', 'silly animals', 'silly'),
  W('Chicken on a scooter', '🐔', 'silly animals vehicles', 'silly'),
  W('Bee wearing sunglasses', '🐝', 'silly animals', 'silly'),
  W('Teddy bear in a rocket', '🧸', 'silly toys space', 'silly'),
  W('Pizza with a face', '🍕', 'silly food', 'silly'),
  W('T-Rex brushing its teeth', '🦖', 'silly dinosaurs', 'silly'),
];

// ── Word picking ─────────────────────────────────────────────

export function pickWord(settings, used, rand = Math.random) {
  const cats = settings.categories || ['everything'];
  const all = cats.includes('everything');
  const inCats = (x) => all || x.c.some((c) => cats.includes(c));
  const diffOk = (x) =>
    settings.difficulty === 'easy' ? x.d === 'easy'
    : settings.difficulty === 'silly' ? x.d === 'silly'
    : true;
  const usedSet = new Set(used);
  const tries = [
    (x, i) => !usedSet.has(i) && inCats(x) && diffOk(x),
    (x, i) => !usedSet.has(i) && inCats(x),
    (x, i) => !usedSet.has(i) && diffOk(x),
    (x, i) => !usedSet.has(i),
  ];
  for (const ok of tries) {
    const pool = [];
    WORDS.forEach((x, i) => { if (ok(x, i)) pool.push(i); });
    if (pool.length) return { index: pool[Math.floor(rand() * pool.length)], reset: false };
  }
  // Every word has been used: start over.
  return { index: Math.floor(rand() * WORDS.length), reset: true };
}

// ── Length hint for guessers ─────────────────────────────────

// The word blanked out but with its shape intact, for guessers who
// can't see the word itself: letters become null (render as a blank),
// everything else (spaces, hyphens, apostrophes) stays literal so word
// boundaries and punctuation are visible without giving any letter away.
// "T-Rex" -> [null, '-', null, null, null]
export function wordShape(w) {
  return [...w].map((ch) => (/[a-zA-Z]/.test(ch) ? null : ch));
}

// ── Guess matching ───────────────────────────────────────────

const STOP = new Set(['a', 'an', 'the', 'in', 'on', 'with', 'wearing', 'eating', 'holding',
  'having', 'playing', 'reading', 'brushing', 'its', 'at', 'of', 'and', 'is', 'my', 'some']);

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const squash = (s) => normalize(s).replace(/ /g, '');
const singular = (t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
// How many typos we forgive (little fingers, big words)
const allowance = (len) => (len >= 9 ? 2 : len >= 5 ? 1 : 0);

function tokenMatch(key, tok) {
  const a = singular(key), b = singular(tok);
  if (a === b) return true;
  return lev(a, b, allowance(a.length)) <= allowance(a.length);
}

// Returns 'correct' | 'close' | 'wrong'
export function checkGuess(guess, entry) {
  const g = squash(guess);
  if (!g) return 'wrong';
  const answers = [entry.w, ...entry.also];
  let close = false;
  for (const ans of answers) {
    const a = squash(ans);
    if (g === a || singular(g) === singular(a)) return 'correct';
    const d = lev(g, a, 3);
    if (d <= allowance(a.length)) return 'correct';
    if (a.length >= 4 && d <= allowance(a.length) + 1) close = true;
  }
  // Multi-word prompts: every key word present (any order) counts.
  const keys = normalize(entry.w).split(' ').filter((t) => t && !STOP.has(t));
  if (keys.length > 1) {
    const toks = normalize(guess).split(' ').filter((t) => t && !STOP.has(t));
    const hits = keys.filter((k) => toks.some((t) => tokenMatch(k, t))).length;
    if (hits === keys.length) return 'correct';
    if (hits > 0) close = true;
  }
  return close ? 'close' : 'wrong';
}
