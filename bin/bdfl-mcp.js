#!/usr/bin/env node
'use strict';
const fs = require('node:fs'); const path = require('node:path');
const base = fs.existsSync(path.resolve(__dirname, '..', 'src')) ? path.resolve(__dirname, '..', 'src') : path.resolve(__dirname, '..', 'runtime');
const { WorkersMcpServer } = require(path.join(base, 'mcp', 'workers'));
if (require.main === module) new WorkersMcpServer().start();
