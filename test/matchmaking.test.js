import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';

async function harness(t) {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map((c) => c.terminate())); await srv.close(); });
  async function player(name) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    c.id = (await c.hello(name)).playerId;
    return c;
  }
  const roomOf = (c) => srv.lobby.roomOf(srv.registry.byId(c.id));
  const request = async (c, t, fields = {}) => {
    const reply = await c.request({ t, ...fields });
    assert.equal(reply.t, 'ok', JSON.stringify(reply));
  };
  return { srv, player, roomOf, request };
}

test('simultaneous matching joins one room with unique sessions and exactly one host', async (t) => {
  const { srv, player, roomOf, request } = await harness(t);
  const players = await Promise.all(['A', 'B', 'C', 'D'].map(player));
  await Promise.all(players.map((c) => request(c, 'room.matchmake', { difficulty: 'NORMAL' })));
  const room = roomOf(players[0]);
  assert.equal(srv.lobby.rooms.size, 1);
  for (const c of players) assert.equal(roomOf(c), room);
  assert.equal(new Set(room.seats.filter(Boolean).map((s) => s.playerId)).size, 4);
  assert.equal(room.seats.filter((s) => s?.playerId === room.hostId).length, 1);
  await request(players[0], 'room.matchmake', { difficulty: 'NORMAL' });
  assert.equal(roomOf(players[0]), room);
  assert.equal(room.seats.filter(Boolean).length, 4);
  const host = players.find((c) => c.id === room.hostId);
  for (const c of players) if (c !== host) await request(c, 'room.ready', { ready: true });
  await request(host, 'room.start');
  assert.equal(room.matchmaking, false);
});

test('an existing alliance can opt in; guests join it and only its host controls matching', async (t) => {
  const { player, roomOf, request } = await harness(t);
  const host = await player('Host');
  const guest = await player('Guest');
  await request(host, 'room.create', { mode: 'coop', difficulty: 'HARD' });
  const room = roomOf(host);
  assert.equal(room.toState().matchmaking, false);
  await request(host, 'room.setMatchmaking', { enabled: true });
  await request(guest, 'room.matchmake', { difficulty: 'HARD' });
  assert.equal(roomOf(guest), room);
  assert.equal(room.hostId, host.id);
  assert.equal((await guest.request({ t: 'room.setMatchmaking', enabled: false })).code, 'NOT_HOST');
  await request(host, 'room.setMatchmaking', { enabled: false });
  const next = await player('Next');
  await request(next, 'room.matchmake', { difficulty: 'HARD' });
  assert.notEqual(roomOf(next), room);
});

test('matching skips full rooms, different difficulties, and disconnected hosts', async (t) => {
  const { player, roomOf, request } = await harness(t);
  const host = await player('Host');
  await request(host, 'room.matchmake', { difficulty: 'NORMAL' });
  const room = roomOf(host);
  for (let i = 0; i < 3; i++) await request(host, 'room.addBot');
  const next = await player('Next');
  await request(next, 'room.matchmake', { difficulty: 'NORMAL' });
  assert.notEqual(roomOf(next), room);
  const hard = await player('Hard');
  await request(hard, 'room.matchmake', { difficulty: 'HARD' });
  assert.notEqual(roomOf(hard), roomOf(next));
  const nextRoom = roomOf(next);
  await next.close();
  const last = await player('Last');
  await request(last, 'room.matchmake', { difficulty: 'NORMAL' });
  assert.notEqual(roomOf(last), nextRoom);
});

test('matching is disabled for solo rooms and a repeated request preserves an existing seat', async (t) => {
  const { player, roomOf, request } = await harness(t);
  const solo = await player('Solo');
  await request(solo, 'room.create', { mode: 'solo', difficulty: 'NORMAL' });
  const room = roomOf(solo);
  assert.equal((await solo.request({ t: 'room.setMatchmaking', enabled: true })).code, 'BAD_MSG');
  await request(solo, 'room.matchmake', { difficulty: 'NORMAL' });
  assert.equal(roomOf(solo), room);
});
