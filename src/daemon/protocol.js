'use strict';

const fs = require('node:fs');
const net = require('node:net');

const MAX_MESSAGE = 1024 * 1024;

function encodeMessage(value) {
  return `${JSON.stringify(value)}\n`;
}

function createDecoder(onMessage) {
  let buffer = '';
  return (data) => {
    buffer += data;
    if (Buffer.byteLength(buffer) > MAX_MESSAGE) throw new Error('BDFL protocol message is too large');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (line) onMessage(JSON.parse(line));
  };
}

function listen(socketPath, handler, { io = fs, createServer = net.createServer } = {}) {
  try {
    io.unlinkSync(socketPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const server = createServer((socket) => {
    const decode = createDecoder(async (request) => {
      const id = request?.id ?? null;
      try {
        const result = await handler(request, socket);
        socket.write(encodeMessage({ id, ok: true, result }));
      } catch (error) {
        socket.write(encodeMessage({ id, ok: false, error: { code: error.code || 'ERROR', message: error.message } }));
      }
    });
    socket.setEncoding('utf8');
    socket.on('data', (data) => {
      try {
        decode(data);
      } catch (error) {
        socket.end(
          encodeMessage({
            id: null,
            ok: false,
            error: { code: 'INVALID_REQUEST', message: error.message }
          })
        );
      }
    });
  });
  server.listen(socketPath, () => io.chmodSync?.(socketPath, 0o600));
  return server;
}

function request(socketPath, action, params = {}, { connect = net.createConnection, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = `${process.pid}-${Date.now()}-${Math.random()}`;
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      const error = new Error('BDFL supervisor did not respond');
      error.code = 'DAEMON_TIMEOUT';
      reject(error);
    }, timeout);
    timer.unref?.();
    const finish = (callback, value) => {
      clearTimeout(timer);
      socket.end();
      callback(value);
    };
    socket.once('error', (error) => finish(reject, error));
    socket.setEncoding('utf8');
    const decode = createDecoder((response) => {
      if (response.id !== id) return;
      if (response.ok) finish(resolve, response.result);
      else {
        const error = new Error(response.error?.message || 'BDFL supervisor request failed');
        error.code = response.error?.code || 'DAEMON_ERROR';
        finish(reject, error);
      }
    });
    socket.on('data', (data) => {
      try {
        decode(data);
      } catch (error) {
        finish(reject, error);
      }
    });
    socket.once('connect', () => socket.write(encodeMessage({ id, action, params })));
  });
}

function subscribe(socketPath, onState, { connect = net.createConnection } = {}) {
  const socket = connect(socketPath);
  socket.setEncoding('utf8');
  socket.on(
    'data',
    createDecoder((message) => {
      if (message.event === 'state') onState(message.state);
    })
  );
  socket.once('connect', () =>
    socket.write(encodeMessage({ id: `${process.pid}-${Date.now()}`, action: 'subscribe', params: {} }))
  );
  return () => socket.end();
}

module.exports = { MAX_MESSAGE, encodeMessage, createDecoder, listen, request, subscribe };
