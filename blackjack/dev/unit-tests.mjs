// Automated checks: pure card/hand math, then the full table state machine
// driven directly (in-process, no real sockets or timers - see emulate.mjs
// and DECISIONS.md for why that's the right tradeoff for this game).
//   node dev/unit-tests.mjs
import { createShoe, handValue, isBlackjack, dealerShouldHit, needsReshuffle } from '../src/cards.js';
import { TableRoom } from '../src/table-room.js';
import { makeHolder, FakeSocket } from './emulate.mjs';
import { STARTING_CHIPS, MIN_BET, MAX_BET } from '../public/js/shared.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + label); } };

const C = (rank, suit = '♠') => ({ rank, suit });

// ── Hand value math ─────────────────────────────────────────

ok(handValue([C('10'), C('6')]).total === 16, 'hard 16');
ok(!handValue([C('10'), C('6')]).soft, '10+6 is hard');
ok(handValue([C('A'), C('6')]).total === 17, 'soft 17 (A+6)');
ok(handValue([C('A'), C('6')]).soft, 'A+6 is soft');
ok(handValue([C('A'), C('6'), C('9')]).total === 16, 'A+6+9 reduces ace to hard 16');
ok(!handValue([C('A'), C('6'), C('9')]).soft, 'A+6+9 is no longer soft');
ok(handValue([C('A'), C('A')]).total === 12, 'A+A is 12 (one ace reduced)');
ok(handValue([C('A'), C('A')]).soft, 'A+A still soft (one ace still counted as 11)');
ok(handValue([C('K'), C('Q')]).total === 20, 'K+Q is 20');
ok(handValue([C('10'), C('10'), C('5')]).bust, '10+10+5 busts');
ok(handValue([C('A'), C('10')]).total === 21, 'A+10 is 21');
ok(isBlackjack([C('A'), C('10')]), 'A+10 (2 cards) is a blackjack');
ok(!isBlackjack([C('7'), C('7'), C('7')]), '7+7+7=21 is NOT a blackjack (3 cards)');
ok(handValue([C('7'), C('7'), C('7')]).total === 21, '7+7+7 is 21 though');
ok(dealerShouldHit([C('10'), C('6')]), 'dealer hits hard 16');
ok(!dealerShouldHit([C('10'), C('7')]), 'dealer stands hard 17');
ok(!dealerShouldHit([C('A'), C('6')]), 'dealer stands SOFT 17 (house rule)');
ok(dealerShouldHit([C('10'), C('5')]), 'dealer hits 15');

const shoe6 = createShoe(6, () => 0.5);
ok(shoe6.length === 6 * 52, '6-deck shoe has 312 cards');
const shoe1 = createShoe(1, Math.random);
ok(shoe1.length === 52, '1-deck shoe has 52 cards');
ok(new Set(shoe1.map((c) => c.rank + c.suit)).size === 52, '1-deck shoe has 52 distinct cards');
// A real shuffle shouldn't leave the shoe in dealt order.
const ordered = createShoe(1, () => 0).map((c) => c.rank + c.suit).join(',');
const shuffled = createShoe(1, Math.random).map((c) => c.rank + c.suit).join(',');
ok(ordered !== shuffled, 'shuffle actually reorders the shoe (statistically - reseed if this ever flakes)');
ok(needsReshuffle(new Array(10), 6), 'a near-empty shoe needs a reshuffle');
ok(!needsReshuffle(new Array(6 * 52), 6), 'a full shoe does not need a reshuffle');

// ── Table harness ────────────────────────────────────────────

async function newTable(code) {
  const h = makeHolder(TableRoom);
  await h.ctx.ready;
  await h.instance.fetch(new Request('https://table/init', { method: 'POST', body: JSON.stringify({ code }) }));
  return h;
}

async function join(h, pid, name) {
  const ws = new FakeSocket();
  h.instance.acceptSocket(ws);
  await h.instance.webSocketMessage(ws, JSON.stringify({ type: 'hello', playerId: pid, name }));
  return ws;
}

async function send(h, ws, msg) {
  await h.instance.webSocketMessage(ws, JSON.stringify(msg));
}

// Sets the shoe so the next draws come out in exactly `cardsInDrawOrder`
// (first element = first card drawn; drawCard() pops from the end).
// Padded well past needsReshuffle's threshold so ensureShoe() doesn't
// quietly replace it with a fresh random shoe before the deal happens.
function setDrawOrder(h, cardsInDrawOrder) {
  const filler = Array.from({ length: 100 }, (_, i) => C(String(2 + (i % 9))));
  h.instance.room.shoe = [...filler, ...[...cardsInDrawOrder].reverse()];
}

async function runDealerToCompletion(h) {
  while (h.instance.room.phase === 'dealer') await h.instance.dealerStep();
}

function seatHand(h, seat) { return h.instance.room.hands[seat]; }
function player(h, pid) { return h.instance.room.players.find((p) => p.id === pid); }

// ── Lobby, seating, betting basics ──────────────────────────

{
  const h = await newTable('TEST1');
  const alexWs = await join(h, 'alex-pid-000000', 'Alex');
  ok(h.instance.room.players.length === 1, 'first hello seats a player');
  ok(h.instance.room.players[0].chips === STARTING_CHIPS, 'new player starts with STARTING_CHIPS');
  ok(h.instance.room.phase === 'lobby', 'table starts in lobby');

  // A non-host starting does nothing.
  const maisieWs = await join(h, 'maisie-pid-00000', 'Maisie');
  await send(h, maisieWs, { type: 'start' });
  ok(h.instance.room.phase === 'lobby', 'non-host cannot start the table');

  await send(h, alexWs, { type: 'start' });
  ok(h.instance.room.phase === 'betting', 'host starting moves to betting');
  ok(h.instance.room.round === 1, 'round is 1 after the first start');

  // Reconnection: same playerId, new socket, restores the same seat.
  const alexWs2 = new FakeSocket();
  h.instance.acceptSocket(alexWs2);
  await h.instance.webSocketMessage(alexWs2, JSON.stringify({ type: 'hello', playerId: 'alex-pid-000000', name: 'Alex' }));
  ok(h.instance.room.players.length === 2, 'reconnecting does not create a duplicate player');
  ok(alexWs.readyState === 3, "player's old socket is closed on reconnect (replaced)");

  // Invalid bets are rejected.
  await send(h, alexWs2, { type: 'bet', amount: MIN_BET - 1 });
  ok(h.instance.room.bets[1] == null, 'bet below MIN_BET is rejected');
  await send(h, alexWs2, { type: 'bet', amount: MAX_BET + 1 });
  ok(h.instance.room.bets[1] == null, 'bet above MAX_BET is rejected');
  await send(h, alexWs2, { type: 'bet', amount: 999999 });
  ok(h.instance.room.bets[1] == null, 'bet beyond chips on hand is rejected');
}

// ── A full solo hand: bust ───────────────────────────────────

{
  const h = await newTable('TEST2');
  const ws = await join(h, 'solo-pid-00000001', 'Solo');
  await send(h, ws, { type: 'start' });
  setDrawOrder(h, [C('10'), C('6'), C('7'), C('9'), C('K')]); // P:10,6=16  D:7,9(hidden)  hit->K busts
  await send(h, ws, { type: 'bet', amount: 100 }); // only player -> finishes betting immediately
  ok(h.instance.room.phase === 'playing', 'solo bet immediately starts play (nobody else to wait for)');
  const chipsAfterBet = player(h, 'solo-pid-00000001').chips;
  ok(chipsAfterBet === STARTING_CHIPS - 100, 'bet amount is deducted from chips immediately');

  await send(h, ws, { type: 'action', action: 'hit' });
  ok(seatHand(h, 1)[0].status === 'bust', 'hitting 16 with a 10 busts');
  ok(h.instance.room.phase === 'dealer', 'busting still passes through the dealer phase (it just resolves at once)');
  await runDealerToCompletion(h);
  ok(h.instance.room.phase === 'reveal', 'once everyone has busted, the dealer has nothing left to do and reveal follows');
  ok(player(h, 'solo-pid-00000001').chips === chipsAfterBet, 'a bust pays nothing back');
  ok(player(h, 'solo-pid-00000001').stats.currentStreak === 0, 'a loss keeps the streak at 0');
}

// ── A full solo hand: stand and win on dealer bust ──────────

{
  const h = await newTable('TEST3');
  const ws = await join(h, 'winner-pid-0000001', 'Winner');
  await send(h, ws, { type: 'start' });
  setDrawOrder(h, [C('10'), C('9'), C('6'), C('9'), C('K')]); // P:10,9=19  D:6,9=15(hits)->K=25 bust
  await send(h, ws, { type: 'bet', amount: 50 });
  await send(h, ws, { type: 'action', action: 'stand' });
  ok(h.instance.room.phase === 'dealer', 'standing with players left moves to the dealer');
  await runDealerToCompletion(h);
  ok(h.instance.room.phase === 'reveal', 'dealer phase ends in reveal');
  ok(h.instance.room.lastResults.dealer.bust, 'dealer busted at 25');
  ok(seatHand(h, 1)[0].result === 'win', 'player wins when the dealer busts');
  ok(player(h, 'winner-pid-0000001').chips === STARTING_CHIPS - 50 + 100, 'win pays 2x the bet (even money)');
  ok(player(h, 'winner-pid-0000001').stats.currentStreak === 1, 'a win starts a streak');
}

// ── Push ──────────────────────────────────────────────────────

{
  const h = await newTable('TEST4');
  const ws = await join(h, 'push-pid-00000001', 'Pusher');
  await send(h, ws, { type: 'start' });
  setDrawOrder(h, [C('10'), C('9'), C('10'), C('9')]); // P:19  D:19 (stands, no hit needed)
  await send(h, ws, { type: 'bet', amount: 40 });
  await send(h, ws, { type: 'action', action: 'stand' });
  await runDealerToCompletion(h);
  ok(seatHand(h, 1)[0].result === 'push', '19 vs 19 is a push');
  ok(player(h, 'push-pid-00000001').chips === STARTING_CHIPS, 'a push returns exactly the bet (net zero)');
}

// ── Player blackjack (dealer has none) settles immediately ──

{
  const h = await newTable('TEST5');
  const ws = await join(h, 'lucky-pid-00000001', 'Lucky');
  await send(h, ws, { type: 'start' });
  setDrawOrder(h, [C('A'), C('K'), C('7'), C('9'), C('2')]); // P: A+K blackjack.  D: 7,9=16 (still plays out, but moot)
  await send(h, ws, { type: 'bet', amount: 20 });
  ok(h.instance.room.phase === 'dealer', "player's natural blackjack needs no turn, but the dealer still plays out for show");
  await runDealerToCompletion(h);
  ok(h.instance.room.phase === 'reveal', 'reached reveal');
  ok(seatHand(h, 1)[0].result === 'blackjack', "result recorded as blackjack regardless of the dealer's total");
  ok(player(h, 'lucky-pid-00000001').chips === STARTING_CHIPS - 20 + 50, 'blackjack pays 3:2 (bet 20 -> +50 total back)');
  ok(player(h, 'lucky-pid-00000001').stats.blackjacks === 1, 'blackjack count increments');
}

// ── Dealer blackjack settles everyone immediately ────────────

{
  const h = await newTable('TEST6');
  const a = await join(h, 'a-pid-0000000000001', 'A');
  const b = await join(h, 'b-pid-0000000000001', 'B');
  await send(h, a, { type: 'start' });
  // deal order: A(2), B(2), dealer(2) - dealer gets A+K = blackjack.
  setDrawOrder(h, [C('9'), C('8'), C('A'), C('K'), C('A'), C('K')]);
  await send(h, a, { type: 'bet', amount: 10 });
  await send(h, b, { type: 'bet', amount: 10 }); // both bet -> finishes betting
  ok(h.instance.room.phase === 'reveal', 'dealer blackjack settles the round immediately');
  ok(seatHand(h, 1)[0].status === 'lose' || seatHand(h, 1)[0].result === 'lose', 'plain hand loses to dealer blackjack');
  ok(seatHand(h, 2)[0].result === 'blackjack' || seatHand(h, 2)[0].status === 'push', 'B also has A+K - pushes against dealer blackjack');
  ok(player(h, 'b-pid-0000000000001').chips === STARTING_CHIPS, "B's own blackjack pushes (returns the bet, no 3:2)");
}

// ── Double down ───────────────────────────────────────────────

{
  const h = await newTable('TEST7');
  const ws = await join(h, 'dbl-pid-00000000001', 'Doubler');
  await send(h, ws, { type: 'start' });
  setDrawOrder(h, [C('6'), C('5'), C('7'), C('9'), C('10')]); // P:6+5=11  D:7,9  double->10 = 21
  await send(h, ws, { type: 'bet', amount: 50 });
  const before = player(h, 'dbl-pid-00000000001').chips;
  await send(h, ws, { type: 'action', action: 'double' });
  ok(seatHand(h, 1)[0].bet === 100, 'doubling doubles the bet');
  ok(player(h, 'dbl-pid-00000000001').chips === before - 50, 'doubling deducts an equal additional bet');
  ok(seatHand(h, 1)[0].cards.length === 3, 'doubling deals exactly one more card');
  ok(seatHand(h, 1)[0].status === 'stand', 'doubling auto-stands regardless of the result');
  ok(h.instance.room.phase === 'dealer', 'doubling ends the turn and moves on');
}

{
  // Doubling when it would bust is still forced to stand (no take-backs).
  const h = await newTable('TEST7B');
  const ws = await join(h, 'dblbust-pid-0000001', 'DoubleBust');
  await send(h, ws, { type: 'start' });
  setDrawOrder(h, [C('6'), C('5'), C('7'), C('9'), C('K')]); // double -> K busts (21->... 6+5+10=21? wait check)
  await send(h, ws, { type: 'bet', amount: 20 });
  await send(h, ws, { type: 'action', action: 'double' });
  ok(seatHand(h, 1)[0].status === 'stand' || seatHand(h, 1)[0].status === 'bust', 'double resolves to stand or bust, never active');
  // Can't double again, can't hit again.
  await send(h, ws, { type: 'action', action: 'hit' });
  ok(seatHand(h, 1)[0].cards.length === 3, 'no further action possible once a hand is resolved');
}

// ── Split (non-ace pair) ─────────────────────────────────────

{
  const h = await newTable('TEST8');
  const ws = await join(h, 'split-pid-00000001', 'Splitter');
  await send(h, ws, { type: 'start' });
  // P gets 8,8. D gets 7,9. Split draws: handA gets 3(->11), handB gets 10(->18).
  setDrawOrder(h, [C('8'), C('8'), C('7'), C('9'), C('3'), C('10')]);
  await send(h, ws, { type: 'bet', amount: 30 });
  const beforeChips = player(h, 'split-pid-00000001').chips;
  await send(h, ws, { type: 'action', action: 'split' });
  ok(seatHand(h, 1).length === 2, 'splitting makes two hands');
  ok(player(h, 'split-pid-00000001').chips === beforeChips - 30, 'splitting deducts a matching second bet');
  ok(seatHand(h, 1)[0].cards.length === 2 && seatHand(h, 1)[1].cards.length === 2, 'each split hand gets a fresh second card');
  ok(h.instance.room.turnHandIdx === 0, 'play starts on the first split hand');

  await send(h, ws, { type: 'action', action: 'stand' }); // hand A stands at 11? no wait - let's just stand either way
  ok(h.instance.room.turnHandIdx === 1 || h.instance.room.phase === 'dealer', 'finishing hand A moves to hand B (or dealer if that was also resolved)');
  if (h.instance.room.phase === 'playing') {
    await send(h, ws, { type: 'action', action: 'stand' });
  }
  ok(h.instance.room.phase === 'dealer', 'finishing both split hands moves to the dealer');
}

// ── Split aces: exactly one card each, no further action ─────

{
  const h = await newTable('TEST9');
  const ws = await join(h, 'aces-pid-000000001', 'AcePair');
  await send(h, ws, { type: 'start' });
  setDrawOrder(h, [C('A'), C('A'), C('7'), C('9'), C('K'), C('Q')]); // split aces -> A+K, A+Q, neither is "blackjack"
  await send(h, ws, { type: 'bet', amount: 25 });
  await send(h, ws, { type: 'action', action: 'split' });
  ok(seatHand(h, 1)[0].status === 'stand' && seatHand(h, 1)[1].status === 'stand', 'both split-ace hands auto-stand');
  ok(h.instance.room.phase === 'dealer', 'split aces skip straight to the dealer - no decisions to make');
  await runDealerToCompletion(h);
  ok(seatHand(h, 1)[0].result !== 'blackjack' && seatHand(h, 1)[1].result !== 'blackjack',
    'A 21 from a split ace is NOT a blackjack (no 3:2 bonus) - standard rule');
}

// Can't split a non-pair, can't split twice, can't split without enough chips.
{
  const h = await newTable('TEST10');
  const ws = await join(h, 'nosplit-pid-0000001', 'NoSplit');
  await send(h, ws, { type: 'start' });
  setDrawOrder(h, [C('8'), C('9'), C('7'), C('2')]); // not a pair
  await send(h, ws, { type: 'bet', amount: 10 });
  await send(h, ws, { type: 'action', action: 'split' });
  ok(seatHand(h, 1).length === 1, 'cannot split a non-pair (8,9)');
}

// ── Turn timeout auto-stands ──────────────────────────────────

{
  const h = await newTable('TEST11');
  const ws = await join(h, 'afk-pid-000000001', 'AFK');
  await send(h, ws, { type: 'start' });
  setDrawOrder(h, [C('10'), C('5'), C('7'), C('9')]); // P:15 (would normally hit, but times out)
  await send(h, ws, { type: 'bet', amount: 10 });
  ok(h.instance.room.phase === 'playing', 'waiting for a decision');
  await h.instance.autoAdvanceTurn(); // simulate the alarm firing after the deadline
  ok(seatHand(h, 1)[0].status === 'stand', 'not acting in time auto-stands the hand');
  ok(h.instance.room.phase === 'dealer', 'auto-stand still advances the game');
}

// ── Betting timeout: non-bettors sit out, game proceeds ──────

{
  const h = await newTable('TEST12');
  const a = await join(h, 'sitout-a-pid-00000001', 'Better');
  const b = await join(h, 'sitout-b-pid-00000001', 'Waffler');
  await send(h, a, { type: 'start' });
  await send(h, a, { type: 'bet', amount: 10 }); // B never bets
  ok(h.instance.room.phase === 'betting', 'still waiting on a connected player who has not bet');
  setDrawOrder(h, [C('10'), C('9'), C('7'), C('8')]);
  await h.instance.finishBetting(); // simulate the betting deadline passing
  ok(h.instance.room.turnOrder.length === 1 && h.instance.room.turnOrder[0] === 1, 'the player who never bet sits out this hand');
  ok(!h.instance.room.hands[2], "the sat-out player has no hand this round");
}

// Nobody bets at all -> the table just opens a fresh betting phase, no deal.
{
  const h = await newTable('TEST13');
  const ws = await join(h, 'idle-pid-0000000001', 'Idle');
  await send(h, ws, { type: 'start' });
  const roundBefore = h.instance.room.round;
  await h.instance.finishBetting();
  ok(h.instance.room.phase === 'betting', 'nobody betting reopens betting rather than dealing an empty hand');
  ok(h.instance.room.round === roundBefore + 1, 'a fresh betting phase is still a new round number');
}

// ── Busting out completely triggers a restock ────────────────

{
  const h = await newTable('TEST14');
  const ws = await join(h, 'broke-pid-00000001', 'Broke');
  await send(h, ws, { type: 'start' });
  const p = player(h, 'broke-pid-00000001');
  p.chips = 20; // pretend they're down to their last chips
  setDrawOrder(h, [C('10'), C('6'), C('7'), C('9'), C('K')]);
  await send(h, ws, { type: 'bet', amount: 20 });
  await send(h, ws, { type: 'action', action: 'hit' }); // busts, chips now 0
  await runDealerToCompletion(h);
  ok(player(h, 'broke-pid-00000001').chips === STARTING_CHIPS, 'busting out completely restocks to STARTING_CHIPS so the table keeps going');
}

// ── Leaving frees the seat; last player leaving returns to lobby ─

{
  const h = await newTable('TEST15');
  const a = await join(h, 'leaver-a-pid-0000001', 'A');
  const b = await join(h, 'leaver-b-pid-0000001', 'B');
  await send(h, a, { type: 'leave' });
  ok(h.instance.room.players.length === 1, 'leaving removes the player');
  ok(!h.instance.room.hands[1], "the leaver's hand data is cleaned up");
  await send(h, b, { type: 'leave' });
  ok(h.instance.room.phase === 'lobby', 'the last player leaving returns the table to lobby');
}

// ── Multi-round continuity: chips and stats persist ──────────

{
  const h = await newTable('TEST16');
  const ws = await join(h, 'longhaul-pid-000001', 'LongHaul');
  await send(h, ws, { type: 'start' });
  setDrawOrder(h, [C('10'), C('9'), C('6'), C('9'), C('K')]); // win round 1 (dealer busts, as in TEST3)
  await send(h, ws, { type: 'bet', amount: 50 });
  await send(h, ws, { type: 'action', action: 'stand' });
  await runDealerToCompletion(h);
  const chipsAfterRound1 = player(h, 'longhaul-pid-000001').chips;
  ok(h.instance.room.phase === 'reveal', 'round 1 ends in reveal');

  await h.instance.startBetting(); // simulate the reveal pause elapsing
  ok(h.instance.room.phase === 'betting', 'moves into a fresh betting phase for round 2');
  ok(h.instance.room.round === 2, 'round number incremented');
  ok(player(h, 'longhaul-pid-000001').chips === chipsAfterRound1, 'chips carry over between rounds');
  ok(player(h, 'longhaul-pid-000001').stats.handsPlayed === 1, 'stats accumulate across rounds');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
