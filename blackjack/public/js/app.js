import { Net } from './net.js';
import * as snd from './sound.js';
import { initInvertToggle } from './a11y.js';
import { CHIP_PRESETS, MIN_BET, MAX_BET, SEAT_COLORS, SUIT_RED } from './shared.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const newPid = () => (crypto.randomUUID ? crypto.randomUUID() : rid() + rid());
const store = {
  get(k, s = localStorage) { try { return JSON.parse(s.getItem(k)); } catch { return null; } },
  set(k, v, s = localStorage) { try { s.setItem(k, JSON.stringify(v)); } catch {} },
  del(k, s = localStorage) { try { s.removeItem(k); } catch {} },
};

const S = { net: null, code: null, pid: null, st: null, clockOffset: 0, lastTickSec: null };

document.addEventListener('pointerdown', () => snd.unlockAudio(), { capture: true });
document.addEventListener('keydown', () => snd.unlockAudio(), { capture: true });
document.addEventListener('click', (e) => {
  if (e.target.closest('.btn, .chip-btn')) snd.play('tap');
}, { capture: true });

// ── Screens ─────────────────────────────────────────────────

const SCREENS = ['home', 'join', 'table'];
function show(name) {
  for (const s of SCREENS) $('scr-' + s).hidden = s !== name;
  S.screen = name;
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

// ── Home & join ─────────────────────────────────────────────

const nameIn = $('in-name'), nameIn2 = $('in-name2'), codeIn = $('in-code');
nameIn.value = nameIn2.value = localStorage.getItem('bj.name') || '';
for (const el of [nameIn, nameIn2]) {
  el.addEventListener('input', () => {
    const v = el.value;
    (el === nameIn ? nameIn2 : nameIn).value = v;
    try { localStorage.setItem('bj.name', v.trim()); } catch {}
  });
}
const myName = () => nameIn.value.trim().slice(0, 14);

function needName(errEl, input) {
  if (myName()) return false;
  errEl.textContent = 'Type your name first!';
  input.focus();
  return true;
}

function refreshRejoin() {
  const last = store.get('bj.last');
  const b = $('btn-rejoin');
  if (last?.code) { b.hidden = false; b.textContent = `Rejoin table ${last.code}`; }
  else b.hidden = true;
}
refreshRejoin();
$('btn-rejoin').addEventListener('click', () => {
  const last = store.get('bj.last');
  if (last?.code) connectTable(last.code, last.pid);
});

$('btn-create').addEventListener('click', async () => {
  if (needName($('home-err'), nameIn)) return;
  $('home-err').textContent = '';
  try {
    const res = await fetch('/api/tables', { method: 'POST' });
    const data = await res.json();
    if (!data.code) throw new Error();
    connectTable(data.code, newPid());
  } catch { $('home-err').textContent = "Couldn't open a table. Try again."; }
});

$('btn-join').addEventListener('click', () => { $('join-err').textContent = ''; codeIn.value = ''; show('join'); codeIn.focus(); });

$('btn-join-go').addEventListener('click', async () => {
  if (needName($('join-err'), nameIn2)) return;
  const code = codeIn.value.trim().toUpperCase();
  if (!/^[A-Z]{3,5}[2-9]$/.test(code)) { $('join-err').textContent = "That doesn't look like a table code."; return; }
  $('join-err').textContent = '';
  try {
    const res = await fetch(`/api/tables/${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!data.exists) { $('join-err').textContent = "Couldn't find that table."; return; }
    if (data.full) { $('join-err').textContent = 'That table is full.'; return; }
    connectTable(code, newPid());
  } catch { $('join-err').textContent = 'Connection problem. Try again.'; }
});

function goHome(message = '', forget = false) {
  leaveNet();
  S.st = null;
  store.del('bj.session', sessionStorage);
  if (forget) store.del('bj.last');
  history.replaceState(null, '', location.pathname);
  $('ov-conn').hidden = true;
  $('ov-confirm').hidden = true;
  refreshRejoin();
  show('home');
  $('home-err').textContent = message;
}

function leaveNet() { S.net?.stop(); S.net = null; }

// ── Connecting ────────────────────────────────────────────────

function connectTable(code, pid) {
  S.code = code; S.pid = pid;
  store.set('bj.session', { code, pid }, sessionStorage);
  store.set('bj.last', { code, pid, t: Date.now() });
  history.replaceState(null, '', '#' + code);
  show('table');
  $('hud-code').textContent = code;
  $('ov-conn').hidden = true;
  leaveNet();
  S.net = new Net({ code, playerId: pid, name: myName(), onMessage, onStatus });
}

function onStatus(status) {
  const conn = $('ov-conn'), msg = $('conn-msg'), homeBtn = $('btn-conn-home');
  if (status === 'open') { conn.hidden = true; return; }
  homeBtn.hidden = true;
  if (status === 'connecting') msg.textContent = 'Connecting…';
  else if (status === 'lost') msg.textContent = 'Reconnecting…';
  else if (status === 'notfound') { msg.textContent = "This table doesn't exist anymore."; homeBtn.hidden = false; }
  else if (status === 'full') { msg.textContent = 'That table is full.'; homeBtn.hidden = false; }
  else if (status === 'replaced') { msg.textContent = 'This table was opened on another screen.'; homeBtn.hidden = false; }
  conn.hidden = false;
}
$('btn-conn-home').addEventListener('click', () => goHome());

function onMessage(m) {
  if (m.type === 'state') applyState(m);
  else if (m.type === 'event') {
    if (m.kind === 'joined' || m.kind === 'back') snd.play('join');
  }
}

// Resume a session already open in this tab (reload) without going through home.
(function autoResume() {
  const sess = store.get('bj.session', sessionStorage);
  if (sess?.code && sess?.pid) connectTable(sess.code, sess.pid);
})();

// ── Leave / quit ──────────────────────────────────────────────

$('btn-quit').addEventListener('click', () => confirmBox('Leave this table?', leaveTable));
function leaveTable() {
  S.net?.send({ type: 'leave' });
  setTimeout(() => goHome('', true), 120);
}
function confirmBox(message, onYes) {
  $('confirm-msg').textContent = message;
  $('ov-confirm').hidden = false;
  $('btn-yes').onclick = () => { $('ov-confirm').hidden = true; onYes(); };
  $('btn-no').onclick = () => { $('ov-confirm').hidden = true; };
}

// ── Header buttons ────────────────────────────────────────────

function renderMute() {
  const m = snd.isMuted();
  $('btn-mute').innerHTML = `<svg aria-hidden="true"><use href="#${m ? 'i-mute' : 'i-sound'}"/></svg>`;
  $('btn-mute').setAttribute('aria-label', m ? 'Turn sounds on' : 'Turn sounds off');
  $('btn-mute').setAttribute('aria-pressed', m ? 'true' : 'false');
}
$('btn-mute').addEventListener('click', () => { snd.setMuted(!snd.isMuted()); renderMute(); });
renderMute();
initInvertToggle($('btn-a11y-home'), $('btn-a11y-hud'));

$('btn-leaderboard').addEventListener('click', async () => {
  $('leaderboard-rows').innerHTML = '<p>Loading…</p>';
  $('ov-leaderboard').hidden = false;
  try {
    const res = await fetch(`/api/tables/${encodeURIComponent(S.code)}/leaderboard`);
    const data = await res.json();
    renderLeaderboard(data.rows || []);
  } catch { $('leaderboard-rows').innerHTML = '<p>Could not load the leaderboard.</p>'; }
});
$('btn-leaderboard-close').addEventListener('click', () => { $('ov-leaderboard').hidden = true; });

function renderLeaderboard(rows) {
  const sorted = [...rows].sort((a, b) => b.biggestBankroll - a.biggestBankroll);
  $('leaderboard-rows').innerHTML = sorted.map((r) => `
    <div class="lb-row">
      <span class="lb-name">${esc(r.name)}</span>
      <span class="lb-stats">💰${r.chips} · best ${r.biggestBankroll} · streak ${r.bestStreak} · 🂡${r.blackjacks}</span>
    </div>`).join('') || '<p>Nobody has played a hand yet.</p>';
}

// ── Actions ───────────────────────────────────────────────────

$('btn-start').addEventListener('click', () => S.net?.send({ type: 'start' }));
for (const amount of CHIP_PRESETS) {
  const b = document.createElement('button');
  b.className = 'chip-btn';
  b.type = 'button';
  b.textContent = amount;
  b.addEventListener('click', () => { S.net?.send({ type: 'bet', amount }); snd.play('chip'); });
  $('bet-presets').append(b);
}
$('btn-hit').addEventListener('click', () => S.net?.send({ type: 'action', action: 'hit' }));
$('btn-stand').addEventListener('click', () => S.net?.send({ type: 'action', action: 'stand' }));
$('btn-double').addEventListener('click', () => S.net?.send({ type: 'action', action: 'double' }));
$('btn-split').addEventListener('click', () => S.net?.send({ type: 'action', action: 'split' }));

// ── Rendering ─────────────────────────────────────────────────

function cardEl(card, faceDown) {
  const d = document.createElement('div');
  if (faceDown) { d.className = 'card back'; return d; }
  d.className = 'card' + (SUIT_RED.has(card.suit) ? ' red' : '');
  d.innerHTML = `<span class="rank">${esc(card.rank)}</span><span class="suit">${esc(card.suit)}</span>`;
  return d;
}

function applyState(st) {
  const prev = S.st;
  S.st = st;
  S.clockOffset = st.serverNow - Date.now();

  if (prev) {
    if (prev.phase === 'betting' && st.phase !== 'betting') snd.play('deal');
    if (prev.phase === 'playing' && st.phase === 'dealer') snd.play('flip');
    if (prev.phase !== 'reveal' && st.phase === 'reveal') playOutcomeSound(st);
  }

  render();
}

function playOutcomeSound(st) {
  const mine = st.lastResults?.players?.find((p) => p.seat === st.you);
  if (!mine) return;
  const results = mine.hands.map((h) => h.result);
  if (results.includes('blackjack')) snd.play('blackjack');
  else if (results.includes('win')) snd.play('win');
  else if (results.includes('push') && !results.includes('lose')) snd.play('push');
  else snd.play('bust');
}

function render() {
  const st = S.st;
  if (!st) return;
  $('hud-round').textContent = st.phase === 'lobby' ? '' : `Round ${st.round}`;

  renderDealer(st);
  renderSeats(st);
  renderBanner(st);
  renderControls(st);
}

function renderDealer(st) {
  const cardsEl = $('dealer-cards');
  cardsEl.replaceChildren();
  for (const c of st.dealer.cards) cardsEl.append(cardEl(c));
  if (st.dealer.holeHidden && st.dealer.cards.length >= 1) cardsEl.append(cardEl(null, true));
  const totalEl = $('dealer-total');
  if (!st.dealer.holeHidden && st.dealer.cards.length) {
    totalEl.textContent = st.dealer.total.bust ? `${st.dealer.total.total} (bust)` : String(st.dealer.total.total);
  } else totalEl.textContent = '';
}

function handTotalLabel(hand) {
  const cards = hand.cards;
  let total = 0, aces = 0;
  for (const c of cards) { total += c.rank === 'A' ? 11 : (['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank)); if (c.rank === 'A') aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  if (hand.status === 'blackjack') return 'Blackjack!';
  if (total > 21) return `${total} (bust)`;
  return String(total);
}

function renderSeats(st) {
  const wrap = $('seats');
  wrap.replaceChildren();
  st.players.forEach((p, i) => {
    const seat = document.createElement('div');
    seat.className = 'seat';
    if (p.seat === st.you) seat.classList.add('you');
    if (p.seat === st.turnSeat) seat.classList.add('your-turn');

    const nameEl = document.createElement('div');
    nameEl.className = 'seat-name';
    nameEl.style.color = SEAT_COLORS[i % SEAT_COLORS.length];
    nameEl.innerHTML = `${esc(p.name)}${p.connected ? '' : ' <span class="away">(away)</span>'}`;
    seat.append(nameEl);

    const chipsEl = document.createElement('div');
    chipsEl.className = 'seat-chips';
    chipsEl.textContent = `💰 ${p.chips}`;
    seat.append(chipsEl);

    const bet = st.bets[p.seat];
    if (bet != null) {
      const betEl = document.createElement('div');
      betEl.className = 'seat-bet';
      betEl.textContent = `Bet: ${bet}`;
      seat.append(betEl);
    }

    const hands = st.hands[p.seat];
    if (hands?.length) {
      const handsEl = document.createElement('div');
      handsEl.className = 'seat-hands';
      hands.forEach((hand, hi) => {
        const hEl = document.createElement('div');
        hEl.className = 'seat-hand';
        if (p.seat === st.turnSeat && hi === st.turnHandIdx && hand.status === 'active') hEl.classList.add('active-hand');
        const cEl = document.createElement('div');
        cEl.className = 'cards';
        for (const c of hand.cards) cEl.append(cardEl(c));
        hEl.append(cEl);
        const totalEl = document.createElement('div');
        totalEl.className = 'hand-total';
        totalEl.textContent = handTotalLabel(hand);
        hEl.append(totalEl);
        if (hand.result) {
          const rEl = document.createElement('div');
          rEl.className = 'hand-result ' + hand.result;
          rEl.textContent = hand.result === 'blackjack' ? `Blackjack! +${hand.payout}`
            : hand.result === 'win' ? `Win +${hand.payout}`
            : hand.result === 'push' ? 'Push'
            : 'Lose';
          hEl.append(rEl);
        }
        handsEl.append(hEl);
      });
      seat.append(handsEl);
    }

    wrap.append(seat);
  });
}

function renderBanner(st) {
  const b = $('phase-banner');
  if (st.phase === 'lobby') b.textContent = st.players.length ? '' : 'Waiting for players to join…';
  else if (st.phase === 'betting') b.textContent = 'Place your bets!';
  else if (st.phase === 'playing') {
    b.textContent = st.turnSeat === st.you ? 'Your turn!' : `Waiting on ${playerName(st, st.turnSeat)}…`;
  } else if (st.phase === 'dealer') b.textContent = 'Dealer is playing…';
  else if (st.phase === 'reveal') {
    const mine = st.lastResults?.players?.find((p) => p.seat === st.you);
    if (mine) {
      const net = mine.hands.reduce((sum, h) => sum + h.payout - (st.bets[st.you] || 0), 0);
      b.textContent = mine.hands.some((h) => h.result === 'blackjack') ? 'Blackjack! 🎉'
        : net > 0 ? `You won ${net}!` : net < 0 ? 'Better luck next hand' : 'Push';
    } else b.textContent = 'Round over';
  }
}

function playerName(st, seat) {
  return st.players.find((p) => p.seat === seat)?.name || 'someone';
}

function renderControls(st) {
  $('ctl-lobby').hidden = st.phase !== 'lobby';
  $('ctl-betting').hidden = st.phase !== 'betting';
  $('ctl-turn').hidden = st.phase !== 'playing';

  if (st.phase === 'lobby') {
    const isHost = st.host === st.you;
    $('btn-start').hidden = !isHost;
    $('lobby-msg').textContent = isHost ? `${st.players.length} at the table. Start whenever you're ready.` : 'Waiting for the host to start…';
  }

  if (st.phase === 'betting') {
    const myBet = st.bets[st.you];
    const chips = st.players.find((p) => p.seat === st.you)?.chips ?? 0;
    $('my-bet').textContent = myBet != null ? `Your bet: ${myBet}` : 'Choose your bet';
    $('bet-presets').querySelectorAll('.chip-btn').forEach((b) => {
      const amt = Number(b.textContent);
      b.disabled = myBet != null || amt > chips || amt < MIN_BET || amt > MAX_BET;
    });
  }

  if (st.phase === 'playing') {
    const isMyTurn = st.turnSeat === st.you;
    const hand = isMyTurn ? st.hands[st.you]?.[st.turnHandIdx] : null;
    $('turn-msg').textContent = isMyTurn ? 'Hit, stand, double, or split?' : `${playerName(st, st.turnSeat)} is deciding…`;
    for (const id of ['btn-hit', 'btn-stand', 'btn-double', 'btn-split']) $(id).hidden = !isMyTurn;
    if (isMyTurn && hand) {
      const chips = st.players.find((p) => p.seat === st.you)?.chips ?? 0;
      $('btn-double').disabled = hand.cards.length !== 2 || hand.doubled || hand.fromSplit || chips < hand.bet;
      const canSplit = st.hands[st.you].length === 1 && hand.cards.length === 2 &&
        hand.cards[0].rank === hand.cards[1].rank && chips >= hand.bet;
      $('btn-split').disabled = !canSplit;
    }
  }

  renderTimer(st);
}

function renderTimer(st) {
  const showTimer = st.phase === 'betting' || st.phase === 'playing';
  const el = st.phase === 'betting' ? $('bet-timer') : $('turn-timer');
  const other = st.phase === 'betting' ? $('turn-timer') : $('bet-timer');
  other.textContent = '';
  if (!showTimer || !st.deadlineAt) { el.textContent = ''; return; }
  tickTimer();
}

function tickTimer() {
  const st = S.st;
  if (!st || !st.deadlineAt || (st.phase !== 'betting' && st.phase !== 'playing')) return;
  const el = st.phase === 'betting' ? $('bet-timer') : $('turn-timer');
  const secLeft = Math.max(0, Math.ceil((st.deadlineAt - (Date.now() - S.clockOffset)) / 1000));
  el.textContent = secLeft + 's';
  el.classList.toggle('low', secLeft <= 5);
  if (secLeft <= 5 && secLeft >= 1 && S.lastTickSec !== secLeft) { snd.play('tick'); S.lastTickSec = secLeft; }
}
setInterval(tickTimer, 300);

window.__bj = { S };

