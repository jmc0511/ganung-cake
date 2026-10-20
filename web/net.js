// 방 코드 멀티: 방장이 케이크 상태를 들고 있고, 참가자의 변경을 받아 모두에게 다시 뿌리는 별 모양 구조.
// 접속 중계는 PeerJS 공개 서버(0.peerjs.com), 데이터는 WebRTC로 서로 직접 주고받는다.
(function () {
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PREFIX = 'ganungcake-v1-';
  const randomCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

  const Net = {
    role: null,          // null | 'host' | 'guest'
    code: null,
    name: '',
    peer: null,
    conns: new Map(),    // 방장: peerId -> { conn, name }
    hostConn: null,      // 참가자: 방장 연결
    on: {},              // op(op), snapshot() -> state, receiveSnapshot(state), peers(list), joined(name), left(name), closed(reason)

    get active() { return !!this.role; },

    _open(id) {
      return new Promise((resolve, reject) => {
        const p = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
        const fail = (e) => { p.destroy(); reject(e); };
        p.once('error', fail);
        p.once('open', () => {
          p.off('error', fail);
          this.peer = p;
          p.on('disconnected', () => { if (!p.destroyed) p.reconnect(); });
          resolve(p);
        });
      });
    },

    async create(name, fixedCode) {
      this.name = name;
      let lastErr;
      for (let i = 0; i < 5; i++) {
        const c = fixedCode || randomCode();
        try {
          await this._open(PREFIX + c);
          this.code = c;
          this.role = 'host';
          this.peer.on('connection', (conn) => this._accept(conn));
          this.peer.on('error', () => {});
          this._peers();
          return c;
        } catch (e) {
          lastErr = e;
          if (e.type !== 'unavailable-id' || fixedCode) break;
        }
      }
      throw lastErr;
    },

    _accept(conn) {
      conn.on('open', () => {
        const name = String(conn.metadata?.name || '친구').slice(0, 12);
        this.conns.set(conn.peer, { conn, name });
        conn.send({ t: 'snapshot', state: this.on.snapshot() });
        this._peers();
        this.on.joined?.(name);
      });
      conn.on('data', (op) => {
        if (!op || typeof op.t !== 'string' || op.t === 'snapshot' || op.t === 'peers') return;
        // 채팅·알림의 이름은 접속할 때 정한 이름으로 방장이 고정한다
        if (op.t === 'chat' || op.t === 'event') { op.name = this.conns.get(conn.peer)?.name || '친구'; delete op.sys; }
        this.on.op(op);
        this._broadcast(op, conn.peer);
      });
      const gone = () => {
        const e = this.conns.get(conn.peer);
        if (!e) return;
        this.conns.delete(conn.peer);
        this._peers();
        this.on.left?.(e.name);
      };
      conn.on('close', gone);
      conn.on('error', gone);
    },

    join(name, code) {
      this.name = name;
      code = code.trim().toUpperCase();
      return new Promise(async (resolve, reject) => {
        try { await this._open(); } catch (e) { return reject(e); }
        const p = this.peer;
        let settled = false;
        const fail = (msg) => {
          if (settled) return;
          settled = true;
          p.destroy();
          this.peer = null;
          reject(new Error(msg));
        };
        const timer = setTimeout(() => fail('방에 연결하지 못했어요. 코드를 확인하거나 잠시 뒤 다시 해보세요.'), 15000);
        p.on('error', (e) => {
          if (!settled) { clearTimeout(timer); fail(e.type === 'peer-unavailable' ? '그 코드의 방을 못 찾았어요.' : '연결 중 문제가 생겼어요.'); }
        });
        const conn = p.connect(PREFIX + code, { reliable: true, metadata: { name } });
        conn.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.hostConn = conn;
          this.code = code;
          this.role = 'guest';
          resolve(code);
        });
        conn.on('data', (op) => {
          if (!op || typeof op.t !== 'string') return;
          if (op.t === 'peers') this.on.peers?.(op.list);
          else if (op.t === 'snapshot') this.on.receiveSnapshot?.(op.state);
          else this.on.op(op);
        });
        conn.on('close', () => {
          if (this.role !== 'guest') return;
          this._teardown();
          this.on.closed?.('방장이 방을 닫았어요. 지금 케이크는 그대로 남아 있어요.');
        });
      });
    },

    send(op) {
      if (this.role === 'host') this._broadcast(op);
      else if (this.role === 'guest' && this.hostConn?.open) this.hostConn.send(op);
    },

    _broadcast(op, except) {
      for (const [id, { conn }] of this.conns) if (id !== except && conn.open) conn.send(op);
    },

    _peers() {
      const list = [{ name: this.name, host: true }, ...[...this.conns.values()].map((c) => ({ name: c.name }))];
      this.on.peers?.(list);
      this._broadcast({ t: 'peers', list });
    },

    _teardown() {
      for (const { conn } of this.conns.values()) conn.close();
      this.conns.clear();
      this.hostConn = null;
      this.peer?.destroy();
      this.peer = null;
      this.role = null;
      this.code = null;
      this.on.peers?.([]);
    },

    leave() { this._teardown(); },
  };

  window.Net = Net;
})();
