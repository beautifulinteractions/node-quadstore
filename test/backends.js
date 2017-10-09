
'use strict';

const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const utils = require('../lib/utils');
const shortid = require('shortid');
const memdown = require('memdown');
const levelup = require('levelup');
const factory = require('rdf-data-model');
const RdfStore = require('..').RdfStore;
const QuadStore = require('..').QuadStore;
const leveldown = require('leveldown');
const rdfStoreSuite = require('./rdfstore');
const quadStoreSuite = require('./quadstore');

describe('QuadStore / Auto / MemDOWN', () => {

  beforeEach(function () {
    this.store = new QuadStore(shortid.generate(), { db: memdown });
  });

  quadStoreSuite();

});

describe('RdfStore / Auto / MemDOWN', () => {

  beforeEach(async function () {
    this.store = new RdfStore(shortid.generate(), { db: memdown, dataFactory: factory });
    await utils.resolveOnEvent(this.store, 'ready');
  });

  afterEach(function () {
    return this.store.close();
  });

  rdfStoreSuite();

});

describe('QuadStore / LevelUP / MemDOWN', () => {

  beforeEach(function () {
    this.location = shortid();
    this.db = levelup(this.location, { valueEncoding: QuadStore.valueEncoding, db: memdown });
    this.store = new QuadStore(this.db);
  });

  afterEach(function () {
    return this.store.close();
  });

  quadStoreSuite();

});

describe('RdfStore / LevelUP / MemDOWN', () => {

  beforeEach(async function () {
    this.location = shortid();
    this.db = levelup(this.location, { valueEncoding: QuadStore.valueEncoding, db: memdown });
    this.store = new RdfStore(this.db, { dataFactory: factory });
    await utils.resolveOnEvent(this.store, 'ready');
  });

  afterEach(function () {
    return this.store.close();
  });

  rdfStoreSuite();

});

describe('QuadStore / LevelUP / LevelDOWN', () => {

  beforeEach(function () {
    this.location = path.join(os.tmpdir(), 'node-quadstore-' + shortid.generate());
    this.db = levelup(this.location, { valueEncoding: QuadStore.valueEncoding, db: leveldown });
    this.store = new QuadStore(this.db);
  });

  afterEach(function (done) {
    const context = this;
    context.store.close((closeErr) => {
      if (closeErr) { done(closeErr); return; }
      fs.remove(context.location, done);
    });
  });

  quadStoreSuite();

});

describe('RdfStore / LevelUP / LevelDOWN', () => {

  beforeEach(async function () {
    this.location = path.join(os.tmpdir(), 'node-quadstore-' + shortid.generate());
    this.db = levelup(this.location, { valueEncoding: QuadStore.valueEncoding, db: leveldown });
    this.store = new RdfStore(this.db, { dataFactory: factory });
    await utils.resolveOnEvent(this.store, 'ready');
  });

  afterEach(function (done) {
    const context = this;
    context.store.close((closeErr) => {
      if (closeErr) { done(closeErr); return; }
      fs.remove(context.location, done);
    });
  });

  rdfStoreSuite();

});
