#!/usr/bin/env node
'use strict';

const { StateStore } = require('../state/store');
const { frameAt, verbForState } = require('../tui/banner');

const store = new StateStore(process.cwd());
const state = store.load();
const active = state.runs.some((run) => !['completed', 'cancelled', 'archived'].includes(run.status));
if (active) process.stdout.write(`${frameAt(Date.now(), process.stdout.isTTY, verbForState(state))}\n`);
