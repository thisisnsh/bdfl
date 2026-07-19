#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourceCli = path.resolve(__dirname, '..', 'src', 'cli');
const packagedCli = path.resolve(__dirname, '..', 'runtime', 'cli');
process.exitCode = require(fs.existsSync(sourceCli) ? sourceCli : packagedCli).main();
