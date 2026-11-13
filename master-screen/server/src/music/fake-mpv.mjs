#!/usr/bin/env node
// Test double of mpv: speaks the subset of the JSON IPC that playback.ts uses, plays nothing.
// Started like mpv (`--input-ipc-server=<socket>` is required). Every IPC command is appended as
// one JSON line to the file named by FAKE_MPV_LOG, so tests can check what was sent.
// Behaviour by the URL of loadfile: a URL containing "gone" fails as an unavailable video
// (yt-dlp message on stderr, then end-file error), one containing "fail" fails as a technical
// error, one containing "slow" loads after 400 ms, any other loads at once. Duration is 3 s.
import fs from 'node:fs';
import net from 'node:net';

const socketArg = process.argv.find((arg) => arg.startsWith('--input-ipc-server='));
if (!socketArg) {
  process.stderr.write('fake-mpv: --input-ipc-server is required\n');
  process.exit(2);
}
const socketPath = socketArg.slice('--input-ipc-server='.length);
const logFile = process.env.FAKE_MPV_LOG;
const volumeArg = process.argv.find((arg) => arg.startsWith('--volume='));
const loopArg = process.argv.find((arg) => arg.startsWith('--loop-file='));

const state = {
  volume: volumeArg ? Number(volumeArg.slice('--volume='.length)) : 100,
  loop: loopArg ? loopArg.slice('--loop-file='.length) : 'no',
  pause: false,
  idle: true,
  position: 0,
  duration: 0,
  url: null,
  tick: null,
  loadTimer: null,
};

const clients = new Set();

function record(command) {
  if (logFile) fs.appendFileSync(logFile, `${JSON.stringify({ at: Date.now(), command })}\n`);
}

function broadcast(obj) {
  const line = `${JSON.stringify(obj)}\n`;
  for (const socket of clients) socket.write(line);
}

function stopTimers() {
  if (state.tick) clearInterval(state.tick);
  if (state.loadTimer) clearTimeout(state.loadTimer);
  state.tick = null;
  state.loadTimer = null;
}

function startTicking() {
  if (state.tick) return;
  state.tick = setInterval(() => {
    if (state.pause || state.idle) return;
    state.position = Math.min(state.duration, state.position + 0.05);
    broadcast({ event: 'property-change', id: 1, name: 'time-pos', data: state.position });
    if (state.position >= state.duration && state.loop === 'no') {
      state.idle = true;
      stopTimers();
      broadcast({ event: 'end-file', reason: 'eof' });
      broadcast({ event: 'property-change', id: 5, name: 'idle-active', data: true });
    }
  }, 50);
}

function load(url) {
  stopTimers();
  state.url = url;
  state.position = 0;
  state.duration = 0;
  state.idle = false;
  broadcast({ event: 'start-file' });
  if (url.includes('gone')) {
    broadcast({ event: 'log-message', prefix: 'ytdl_hook', level: 'error', text: 'ERROR: [youtube] Video unavailable' });
    process.stderr.write('ERROR: [youtube] Video unavailable\n');
    state.idle = true;
    broadcast({ event: 'end-file', reason: 'error', file_error: 'loading failed' });
    broadcast({ event: 'property-change', id: 5, name: 'idle-active', data: true });
    return;
  }
  if (url.includes('fail')) {
    state.idle = true;
    broadcast({ event: 'end-file', reason: 'error', file_error: 'loading failed' });
    broadcast({ event: 'property-change', id: 5, name: 'idle-active', data: true });
    return;
  }
  const finish = () => {
    state.duration = 3;
    broadcast({ event: 'property-change', id: 2, name: 'duration', data: 3 });
    broadcast({ event: 'property-change', id: 1, name: 'time-pos', data: 0 });
    broadcast({ event: 'file-loaded' });
    startTicking();
  };
  if (url.includes('slow')) state.loadTimer = setTimeout(finish, 400);
  else finish();
}

function handle(command) {
  const [name, ...args] = command;
  record(command);
  switch (name) {
    case 'loadfile':
      load(String(args[0]));
      return { error: 'success' };
    case 'set_property': {
      const [prop, value] = args;
      if (prop === 'volume') state.volume = value;
      if (prop === 'loop-file') state.loop = value;
      if (prop === 'pause') {
        state.pause = value === true;
        broadcast({ event: 'property-change', id: 3, name: 'pause', data: state.pause });
      }
      return { error: 'success' };
    }
    case 'seek': {
      const [target] = args;
      state.position = Math.max(0, Math.min(state.duration || Infinity, Number(target)));
      broadcast({ event: 'property-change', id: 1, name: 'time-pos', data: state.position });
      return { error: 'success' };
    }
    case 'stop':
      stopTimers();
      state.idle = true;
      broadcast({ event: 'end-file', reason: 'stop' });
      broadcast({ event: 'property-change', id: 5, name: 'idle-active', data: true });
      return { error: 'success' };
    case 'observe_property':
      return { error: 'success' };
    case 'quit':
      return { error: 'success', quit: true };
    default:
      return { error: 'invalid parameter' };
  }
}

const server = net.createServer((socket) => {
  clients.add(socket);
  let pending = '';
  socket.on('data', (chunk) => {
    pending += chunk.toString('utf8');
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
      if (line.trim() === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const reply = handle(message.command ?? []);
      if (reply.quit) {
        cleanExit();
        return;
      }
      socket.write(`${JSON.stringify(reply)}\n`);
    }
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

function cleanExit() {
  stopTimers();
  server.close();
  try {
    fs.rmSync(socketPath, { force: true });
  } catch {
    // already removed
  }
  process.exit(0);
}

process.on('SIGTERM', cleanExit);
process.on('SIGINT', cleanExit);

fs.rmSync(socketPath, { force: true });
server.listen(socketPath, () => {
  process.stdout.write('fake-mpv: ready\n');
});
