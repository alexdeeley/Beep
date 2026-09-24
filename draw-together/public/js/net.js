// One WebSocket to the game room, with automatic reconnection.
//
// Status callbacks: 'connecting' | 'open' | 'lost' | 'notfound' | 'full' | 'replaced'

export class Net {
  constructor({ code, playerId, name, onMessage, onStatus }) {
    Object.assign(this, { code, playerId, name, onMessage, onStatus });
    this.ws = null;
    this.stopped = false;
    this.attempt = 0;
    this.lastHeard = 0;
    this.retryTimer = 0;
    this.heartbeat = setInterval(() => this.beat(), 10000);
    this.wake = () => this.checkAlive();
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('pageshow', this.wake);
    window.addEventListener('online', this.wake);
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/api/rooms/${encodeURIComponent(this.code)}/ws`;
    this.onStatus?.(this.attempt ? 'lost' : 'connecting');
    let ws;
    try { ws = new WebSocket(url); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.lastHeard = Date.now();
      ws.send(JSON.stringify({ type: 'hello', playerId: this.playerId, name: this.name }));
    };
    ws.onmessage = (e) => {
      this.lastHeard = Date.now();
      if (e.data === 'pong') return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'error') {
        if (msg.code === 'notfound' || msg.code === 'full' || msg.code === 'replaced') {
          this.stop();
          this.onStatus?.(msg.code);
        }
        return;
      }
      if (msg.type === 'state' && this.status !== 'open') { this.status = 'open'; this.onStatus?.('open'); }
      this.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      this.status = 'lost';
      this.onStatus?.('lost');
      this.retry();
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  retry() {
    if (this.stopped) return;
    this.attempt++;
    const delay = Math.min(5000, 400 * 2 ** Math.min(this.attempt, 4)) + Math.random() * 300;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  beat() {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    try { ws.send('ping'); } catch {}
    if (Date.now() - this.lastHeard > 30000) { try { ws.close(); } catch {} }
  }

  // Phones freeze sockets in the background; check as soon as we're visible again.
  checkAlive() {
    if (document.visibilityState === 'hidden' || this.stopped) return;
    if (!this.ws || this.ws.readyState > 1) { this.attempt = Math.max(this.attempt, 1); this.connect(); return; }
    try { this.ws.send('ping'); } catch {}
    const sent = Date.now();
    setTimeout(() => {
      if (this.ws && this.lastHeard < sent) { try { this.ws.close(); } catch {} }
    }, 3000);
  }

  get isOpen() { return this.ws?.readyState === 1 && this.status === 'open'; }

  send(obj) {
    if (this.ws?.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); return true; } catch {}
    }
    return false;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.heartbeat);
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('pageshow', this.wake);
    window.removeEventListener('online', this.wake);
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(1000); } catch {} }
  }
}
