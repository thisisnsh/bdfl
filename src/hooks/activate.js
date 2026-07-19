#!/usr/bin/env node
'use strict';

const { StateStore } = require('../state/store');
const { frameAt } = require('../tui/banner');

const store = new StateStore(process.cwd());
const active = store.load().runs.some((run) => !['completed', 'cancelled', 'archived'].includes(run.status));
if (active) process.stdout.write(`${frameAt(Date.now(), process.stdout.isTTY)}\n`);

