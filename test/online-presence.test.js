// Server-wide browser presence: available on the title before hello and independent of room/session retention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startServer } from '../server/index.js';
import { Network, SessionRegistry } from '../server/net.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';

async function harness(t, options = {}) {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch, ...options });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((c) => c.terminate()));
    await srv.close();
  });
  return {
    srv,
    async connect() {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      clients.push(c);
      return c;
    },
  };
}

const count = async (c, expected) => {
  const msg = await c.waitFor('presence');
  assert.equal(msg.onlineCount, expected);
  assert.deepEqual(Object.keys(msg).sort(), ['onlineCount', 't'], 'only an aggregate is exposed');
};

test('presence counts title visitors immediately and removes disconnected retained sessions', async (t) => {
  const { srv, connect } = await harness(t);
  const title = await connect();
  await count(title, 1);
  const player = await connect();
  await Promise.all([count(title, 2), count(player, 2)]);
  const welcome = await player.hello('Player');
  assert.equal(srv.network.onlineCount, 2, 'hello does not add an extra online client');
  await player.close();
  await count(title, 1);
  assert.equal(srv.registry.byToken(welcome.token).connected, false, 'the offline session is still resumable');
  assert.equal(srv.network.onlineCount, 1);

  const returning = await connect();
  await Promise.all([count(title, 2), count(returning, 2)]);
  const resumed = await returning.hello('Player', welcome.token);
  assert.equal(resumed.playerId, welcome.playerId);
  assert.equal(resumed.resumed, true);
  assert.equal(srv.network.onlineCount, 2, 'resuming does not count the retained session twice');
});

test('AI teammates and room membership do not change the online browser count', async (t) => {
  const { srv, connect } = await harness(t);
  const player = await connect();
  await count(player, 1);
  await player.hello('Host');
  assert.equal((await player.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
  await player.waitFor('room.state');
  assert.equal((await player.request({ t: 'room.addBot' })).t, 'ok');
  const room = await player.waitFor('room.state', (s) => s.seats.some((seat) => seat?.isBot));
  assert.equal(room.seats.filter(Boolean).length, 2);
  assert.equal(srv.network.onlineCount, 1, 'the AI seat has no browser connection');
  await player.expectNone('presence', () => true, 30);
});

test('anonymous browser disconnection is broadcast even without a session', async (t) => {
  const { srv, connect } = await harness(t);
  const title = await connect();
  await count(title, 1);
  const otherTitle = await connect();
  await Promise.all([count(title, 2), count(otherTitle, 2)]);
  assert.equal(srv.registry.size, 0, 'neither visitor has sent hello');
  await otherTitle.close();
  await count(title, 1);
});

test('replacing a live session removes the old socket from presence', async (t) => {
  const { srv, connect } = await harness(t);
  const observer = await connect();
  await count(observer, 1);
  const old = await connect();
  await Promise.all([count(observer, 2), count(old, 2)]);
  const welcome = await old.hello('Player');
  const replacement = await connect();
  await Promise.all([count(observer, 3), count(old, 3), count(replacement, 3)]);
  const resumed = await replacement.hello('Player', welcome.token);
  assert.equal(resumed.resumed, true);
  assert.equal((await old.closed).code, 4001);
  await Promise.all([count(observer, 2), count(replacement, 2)]);
  assert.equal(srv.network.onlineCount, 2);
});

test('a new browser receives presence even when a closing peer leaves the total unchanged', (t) => {
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    frames = [];
    send(data, done) { this.frames.push(JSON.parse(data)); done?.(); }
    close() { this.readyState = 2; }
    terminate() { this.readyState = 3; this.emit('close'); }
  }
  const net = new Network({ registry: new SessionRegistry(), handler: { onMessage() {} } });
  t.after(() => net.close());
  const old = new Socket();
  net.handleConnection(old);
  assert.equal(old.frames.at(-1).onlineCount, 1);
  net.conns.get(old).close(4002, 'hello timeout');
  const fresh = new Socket();
  net.handleConnection(fresh);
  assert.equal(net.onlineCount, 1, 'a closing socket is excluded while its close handshake is pending');
  assert.deepEqual(fresh.frames, [{ t: 'presence', onlineCount: 1 }], 'new browsers always receive a snapshot');
  const observer = new Socket();
  net.handleConnection(observer);
  assert.equal(observer.frames.at(-1).onlineCount, 2);
  net.conns.get(fresh).close(4001, 'session replaced');
  assert.equal(fresh.readyState, 2, 'closing handshake is still pending');
  assert.equal(observer.frames.at(-1).onlineCount, 1, 'closing peers are removed before the close event');
});
