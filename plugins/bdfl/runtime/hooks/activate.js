#!/usr/bin/env node
'use strict';

const { StateStore } = require('../state/store');
const { statusline } = require('./statusline');

const store = new StateStore(process.cwd());
const state = store.load();
const active = state.runs.some((run) => !['completed', 'cancelled', 'archived'].includes(run.status));
if (active) process.stdout.write(`${statusline({ state, color: Boolean(process.stdout.isTTY) })}\n`);
