'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { controlRequest, ControlApplicationError, transportError } = require('./bridge');

function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

class CapabilityDescriptor {
  constructor(file, { io = fs } = {}) { if (!file) throw new Error('BDFL capability descriptor is required'); this.file = file; this.io = io; this.signature = null; this.value = null; }
  load(force = false) {
    const stat = this.io.statSync(this.file); if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('BDFL capability descriptor must use mode 0600');
    const signature = `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}`; if (!force && this.value && signature === this.signature) return this.value;
    const value = JSON.parse(this.io.readFileSync(this.file, 'utf8')); const target = new URL(value.url);
    if (value.schema !== 1 || target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(target.hostname) || typeof value.token !== 'string' || !value.token || !value.scope?.sessionId || !value.scope?.workstreamId) throw new Error('Invalid BDFL capability descriptor');
    this.signature = signature; this.value = value; return value;
  }
}

class BridgeProxy {
  constructor(descriptor, { request, retries = 5, heartbeatInterval = 5000, proxyId = crypto.randomUUID() } = {}) { this.descriptor = descriptor instanceof CapabilityDescriptor ? descriptor : new CapabilityDescriptor(descriptor); this.request = request; this.retries = retries; this.heartbeatInterval = heartbeatInterval; this.proxyId = proxyId; this.registeredSignature = null; }
  async call(body, { initial = false, register = true } = {}) {
    let last;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      let capability; try { capability = this.descriptor.load(attempt > 0); } catch (error) { if (initial || attempt === this.retries) throw error; last = error; await sleep(Math.min(1000, 50 * 2 ** attempt)); continue; }
      try {
        const value = await controlRequest(capability.url, capability.token, body, { request: this.request, retries: 0 });
        if (register && body.method !== 'proxy.register' && this.registeredSignature !== this.descriptor.signature) await this.register();
        return value;
      } catch (error) {
        if (error instanceof ControlApplicationError) { const before = this.descriptor.signature; try { this.descriptor.load(true); } catch {} if (error.statusCode !== 401 || before === this.descriptor.signature || attempt === this.retries) throw error; continue; }
        if (!transportError(error)) throw error;
        last = error; if (attempt === this.retries) break; await sleep(Math.min(1000, 50 * 2 ** attempt));
      }
    }
    const error = new Error(`BDFL bridge transport unavailable: ${last?.message || 'connection failed'}`); error.code = 'BDFL_BRIDGE_UNAVAILABLE'; throw error;
  }
  async register() { const capability = this.descriptor.load(); await controlRequest(capability.url, capability.token, { method: 'proxy.register', proxyId: this.proxyId }, { request: this.request, retries: 0 }); this.registeredSignature = this.descriptor.signature; }
  async initialize() { this.descriptor.load(true); const tools = await this.call({ method: 'tools' }, { initial: true, register: false }); await this.register(); this.startHeartbeat(); return tools; }
  startHeartbeat() { if (this.heartbeatTimer) return; this.heartbeatTimer = setInterval(() => { void this.call({ method: 'proxy.heartbeat', proxyId: this.proxyId }).catch(() => {}); }, this.heartbeatInterval); this.heartbeatTimer.unref?.(); }
  close() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
}

module.exports = { CapabilityDescriptor, BridgeProxy, sleep };
