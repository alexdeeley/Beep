// Game logic: which character to ask next, which wrong answers to offer,
// and what happens when the player answers. No DOM; the presentation in
// app.js drives this and draws what it returns.
//
// A session is a fixed number of questions (default 20). Every answer is
// recorded in Stats so the next question can lean towards what the learner
// gets wrong, and so the letters pool can grow as they settle.

import {
  ALPHABET, DIGITS, LEARNING_ORDER, NUMBER_SIGN,
  cellsFor, cellsForNumber, dotsFor, hamming, isDigit, kindOf,
} from './braille.js';

export const MODES = Object.freeze({
  letters: { name: 'Letters', short: 'Letters', blurb: 'The 26 letters, a few at a time. New ones arrive as you settle the old ones.' },
  numbers: { name: 'Numbers', short: 'Numbers', blurb: 'The digits 0-9. Each one is the number sign ⠼ followed by the cell for A-J.' },
  mixed: { name: 'Mixed Practice', short: 'Mixed', blurb: 'Letters and numbers together. Every question says which it is asking for.' },
  review: { name: 'Review Mistakes', short: 'Review', blurb: 'Only the characters you have missed, until each one is mastered.' },
  touch: { name: 'Practice by Touch', short: 'By touch', blurb: 'The game names a character; you pick its pattern from three cells.' },
});

export const DEFAULT_SESSION = 20;
export const MILESTONES = [5, 10, 20, 50];

// How the letters pool grows: start with a few, add a few more each time
// every letter so far has been seen a couple of times and mostly got right.
export const INTRO = Object.freeze({ start: 6, step: 3, minAttempts: 2, minAccuracy: 0.75 });

export function introducedLetters(stats) {
  let n = INTRO.start;
  while (n < LEARNING_ORDER.length) {
    const group = LEARNING_ORDER.slice(0, n);
    let seen = 0, right = 0, everyone = true;
    for (const k of group) {
      const c = stats.char(k);
      if (c.attempts < INTRO.minAttempts) everyone = false;
      seen += c.recent.length; right += c.recent.reduce((a, b) => a + b, 0);
    }
    if (!everyone || !seen || right / seen < INTRO.minAccuracy) break;
    n = Math.min(LEARNING_ORDER.length, n + INTRO.step);
  }
  return LEARNING_ORDER.slice(0, n);
}

// 0..1: how hard the wrong answers should be, from recent form.
export function difficultyFrom(stats) {
  const acc = stats.recentOverall(20);
  if (acc == null) return 0.3;
  return Math.max(0.2, Math.min(1, (acc - 0.55) / 0.4));
}

const pickWeighted = (items, weight, rng) => {
  const ws = items.map(weight);
  const sum = ws.reduce((a, b) => a + b, 0);
  let r = rng() * sum;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
};

const shuffle = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Two wrong answers of the same kind. The harder the setting, the more often
// they are the characters that look most like the right one.
export function distractors(answer, candidates, difficulty, rng) {
  const others = candidates.filter((c) => c !== answer);
  if (others.length < 2) throw new Error('need at least three characters to make a question');
  const byLook = others
    .map((c) => ({ c, d: hamming(dotsFor(c), dotsFor(answer)) }))
    .sort((a, b) => a.d - b.d || (rng() - 0.5));
  const out = [];
  while (out.length < 2) {
    const lookalike = rng() < difficulty;
    const pool = lookalike ? byLook.slice(0, Math.min(4, byLook.length)).map((x) => x.c) : others;
    const pick = pool[Math.floor(rng() * pool.length)];
    if (!out.includes(pick)) out.push(pick);
  }
  return out;
}

// A number of 2-3 digits, plus two near misses (one digit changed).
function numberInContext(rng, difficulty) {
  const len = rng() < 0.5 + difficulty * 0.3 ? 3 : 2;
  const digits = Array.from({ length: len }, (_, i) => DIGITS[Math.floor(rng() * (i === 0 ? 9 : 10))]);
  const answer = digits.join('');
  const wrong = new Set();
  while (wrong.size < 2) {
    const d = digits.slice();
    const i = Math.floor(rng() * len);
    let r;
    do { r = DIGITS[Math.floor(rng() * (i === 0 ? 9 : 10))]; } while (r === d[i]);
    d[i] = r;
    const s = d.join('');
    if (s !== answer) wrong.add(s);
  }
  return { answer, wrong: [...wrong] };
}

export class Game {
  constructor({ mode, stats, rng = Math.random, sessionLength = DEFAULT_SESSION, context = false }) {
    if (!MODES[mode]) throw new Error('unknown mode ' + mode);
    this.mode = mode;
    this.stats = stats;
    this.rng = rng;
    this.total = sessionLength;
    this.context = context && mode === 'numbers';
    this.n = 0;                               // questions asked so far
    this.q = null;                            // current question
    this.answered = false;
    this.exhausted = false;                   // review mode with nothing to review
    this.session = { answered: 0, correct: 0, streak: 0, longest: 0, ms: 0 };
    this.last = null;
  }

  // The characters this mode may ask about right now.
  pool() {
    switch (this.mode) {
      case 'letters': return introducedLetters(this.stats);
      case 'numbers': return DIGITS.slice();
      case 'mixed': case 'touch': return [...introducedLetters(this.stats), ...DIGITS];
      case 'review': return this.stats.weakChars([...ALPHABET, ...DIGITS]);
      default: return [];
    }
  }

  get done() { return this.n >= this.total && this.answered; }

  weight(k) {
    const level = this.stats.level(k);
    if (level === 'new') return 3;
    if (level === 'mastered') return 0.5;
    return 1 + 4 * this.stats.missRate(k);
  }

  // Build the next question, or null when the session is over or there is
  // nothing left to review.
  next() {
    if (this.n >= this.total) return null;
    const difficulty = difficultyFrom(this.stats);
    const rng = this.rng;
    let q;

    if (this.context) {
      const { answer, wrong } = numberInContext(rng, difficulty);
      q = {
        kind: 'number', answer, choices: shuffle([answer, ...wrong], rng),
        cells: cellsForNumber(answer), prompt: 'Which number is this?',
        instruction: 'A number sign, then one cell per digit.',
      };
    } else {
      let pool = this.pool();
      if (this.mode === 'review' && pool.length === 0) { this.exhausted = true; return null; }
      // Review of only one or two characters still needs wrong answers to choose from.
      const askable = pool.length ? pool : [];
      if (this.last && askable.length > 1) pool = askable.filter((k) => k !== this.last);
      const answer = pickWeighted(pool, (k) => this.weight(k), rng);
      const kind = kindOf(answer);
      const sameKind = kind === 'digit' ? DIGITS : ALPHABET;
      const candidates = this.mode === 'letters' ? introducedLetters(this.stats) : sameKind.slice();
      const wrong = distractors(answer, candidates.length >= 3 ? candidates : sameKind, difficulty, rng);
      const choices = shuffle([answer, ...wrong], rng);
      q = {
        kind, answer, choices,
        cells: cellsFor(answer),
        prompt: kind === 'digit' ? 'Which number is this?' : 'Which letter is this?',
        instruction: kind === 'digit' ? 'Number sign ⠼, then the digit’s cell.' : '',
      };
      if (this.mode === 'touch') {
        q.reverse = true;
        q.choiceCells = choices.map((c) => cellsFor(c));
        q.prompt = kind === 'digit' ? `Find the number ${answer}` : `Find the letter ${answer.toUpperCase()}`;
        q.instruction = kind === 'digit' ? 'Look for the number sign first.' : 'Which cell is it?';
      }
      this.last = answer;
    }
    this.n++;
    q.n = this.n; q.total = this.total; q.mode = this.mode;
    this.q = q;
    this.answered = false;
    return q;
  }

  // The player picked one of the choices. Returns what happened, or null if
  // this question was already answered (a second tap is ignored).
  answer(choice, ms = 0) {
    if (!this.q || this.answered) return null;
    this.answered = true;
    const q = this.q;
    const correct = choice === q.answer;
    const s = this.session;
    s.answered++;
    s.ms += ms;
    if (correct) { s.correct++; s.streak++; s.longest = Math.max(s.longest, s.streak); } else s.streak = 0;

    let streak = 0;
    if (q.kind === 'number') {
      // A multi-digit number: each digit the learner got right counts for it.
      const a = q.answer.split(''), c = String(choice).split('');
      a.forEach((d, i) => {
        if (correct || c[i] === d) streak = this.stats.record({ char: d, correct: true, ms: ms / a.length, mode: this.mode }).streak;
        else streak = this.stats.record({ char: d, correct: false, ms: ms / a.length, mode: this.mode }).streak;
      });
    } else {
      streak = this.stats.record({ char: q.answer, correct, ms, mode: this.mode }).streak;
    }
    const milestone = correct && MILESTONES.includes(streak) ? streak : 0;
    const done = this.n >= this.total;
    if (done) this.stats.addSession();
    return { correct, answer: q.answer, choice, streak, milestone, done, n: q.n, total: q.total, session: { ...s } };
  }
}
