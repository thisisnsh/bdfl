'use strict';

class FakeTmux {
  constructor(width = 120) {
    this.width = width;
    this.paneList = [];
    this.windowList = [];
    this.launches = [];
    this.messages = [];
    this.snapshots = new Map();
    this.command = { tryRun() {}, run() {} };
  }
  narrowestClientWidth() {
    return this.width;
  }
  panes() {
    return this.paneList;
  }
  windows() {
    return this.windowList;
  }
  paneFor(id) {
    return this.paneList.find((pane) => pane.sessionId === id);
  }
  openPane(stream, session, invocation) {
    const paneId = `%${this.paneList.length + 1}`;
    let window = this.windowList.find((item) => item.workstreamId === stream.id);
    if (!window) {
      window = { windowId: `@${this.windowList.length + 1}`, workstreamId: stream.id, name: stream.name };
      this.windowList.push(window);
    }
    this.paneList.push({ paneId, windowId: window.windowId, sessionId: session.id, dead: '0', active: '0' });
    this.launches.push({ stream, session, invocation });
    return paneId;
  }
  setLabel() {}
  focus(id) {
    const pane = this.paneFor(id);
    if (!pane) return false;
    for (const item of this.paneList) item.active = item === pane ? '1' : '0';
    return true;
  }
  activePane() {
    return this.paneList.find((pane) => pane.active === '1');
  }
  killPane(id) {
    const index = this.paneList.findIndex((pane) => pane.sessionId === id);
    if (index < 0) return false;
    this.paneList.splice(index, 1);
    return true;
  }
  snapshot(id, destination) {
    this.snapshots.set(id, destination);
    return destination;
  }
  message(value) {
    this.messages.push(value);
  }
}

module.exports = { FakeTmux };
