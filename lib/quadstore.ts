
'use strict';

import {
  TSApproximateSizeResult,
  TSBinding,
  TSBindingArrayResult,
  TSDelStreamOpts,
  TSEmptyOpts,
  TSGetOpts,
  TSIndex,
  TSPattern,
  TSPutStreamOpts,
  TSQuad,
  TSQuadArrayResult,
  TSQuadStreamResult,
  TSReadable,
  TSResultType,
  TSSearchOpts,
  TSSearchStage,
  TSStore,
  TSStoreOpts,
  TSTermName,
  TSVoidResult,
} from './types/index.js';
import assert from 'assert';
import {EventEmitter} from 'events';
import levelup from 'levelup';
import {AbstractLevelDOWN} from 'abstract-leveldown';

import {
  consumeInBatches,
  consumeOneByOne,
  genDefaultIndexes,
  isAbstractLevelDOWNInstance,
  isArray,
  isNil,
  isObject,
  isReadableStream,
  isString,
  nanoid,
  serializeQuad,
  streamToArray,
  termNames,
} from './utils/index.js';
import {getApproximateSize, getStream, getInit} from './get/index.js';
import {searchStream} from './search/index.js';

export class QuadStore extends EventEmitter implements TSStore {

  readonly db: AbstractLevelDOWN;
  readonly abstractLevelDOWN: AbstractLevelDOWN;

  readonly defaultGraph: string;
  readonly indexes: TSIndex[];
  readonly id: string;

  readonly separator: string;
  readonly boundary: string;

  /*
   * ==========================================================================
   *                           STORE LIFECYCLE
   * ==========================================================================
   */

  constructor(opts: TSStoreOpts) {
    super();
    assert(isObject(opts), 'Invalid "opts" argument: "opts" is not an object');
    assert(
      isAbstractLevelDOWNInstance(opts.backend),
      'Invalid "opts" argument: "opts.backend" is not an instance of AbstractLevelDOWN',
    );
    this.abstractLevelDOWN = opts.backend;
    this.db = levelup(this.abstractLevelDOWN);
    this.defaultGraph = opts.defaultGraph || 'DEFAULT_GRAPH';
    this.indexes = [];
    this.id = nanoid();
    this.boundary = opts.boundary || '\uDBFF\uDFFF';
    this.separator = opts.separator || '\u0000\u0000';
    (opts.indexes || genDefaultIndexes())
      .forEach((index: TSTermName[]) => this._addIndex(index));
    setImmediate(() => { this._initialize(); });
  }

  _initialize() {
    getInit(this);
    this.emit('ready');
  }

  async close() {
    await new Promise((resolve, reject) => {
      this.db.close((err) => {
        err ? reject(err) : resolve();
      });
    });
  }

  /*
   * ==========================================================================
   *                           STORE SERIALIZATION
   * ==========================================================================
   */

  toString() {
    return this.toJSON();
  }

  toJSON() {
    return `[object ${this.constructor.name}::${this.id}]`;
  }

  /*
   * ==========================================================================
   *                                  INDEXES
   * ==========================================================================
   */

  _addIndex(terms: TSTermName[]): void {
    // assert(hasAllTerms(terms), 'Invalid index (bad terms).');
    const name = terms.map(t => t.charAt(0).toUpperCase()).join('');
    this.indexes.push({
      terms,
      name,
      getKey: eval(
        '(quad) => `'
          + name + this.separator
          + terms.map(term => `\${quad['${term}']}${this.separator}`).join('')
          + '`'
      ),
    });
  }

  /*
   * ==========================================================================
   *                            NON-STREAMING API
   * ==========================================================================
   */

  async put(quad: TSQuad, opts?: TSEmptyOpts): Promise<TSVoidResult> {
    const value = serializeQuad(quad);
    const batch = this.indexes.reduce((indexBatch, i) => {
      return indexBatch.put(i.getKey(quad), value);
    }, this.db.batch());
    // @ts-ignore
    await batch.write();
    return { type: TSResultType.VOID };
  }

  async multiPut(quads: TSQuad[], opts?: TSEmptyOpts): Promise<TSVoidResult> {
    const batch = quads.reduce((quadBatch, quad) => {
      const value = serializeQuad(quad);
      return this.indexes.reduce((indexBatch, index) => {
        return indexBatch.put(index.getKey(quad), value);
      }, quadBatch);
    }, this.db.batch());
    // @ts-ignore
    await batch.write();
    return { type: TSResultType.VOID };
  }

  async del(quad: TSQuad, opts?: TSEmptyOpts): Promise<TSVoidResult> {
    const batch = this.indexes.reduce((batch, i) => {
      return batch.del(i.getKey(quad));
    }, this.db.batch());
    // @ts-ignore
    await batch.write();
    return { type: TSResultType.VOID };
  }

  async multiDel(quads: TSQuad[], opts?: TSEmptyOpts): Promise<TSVoidResult> {
    const batch = quads.reduce((quadBatch, quad) => {
      return this.indexes.reduce((indexBatch, index) => {
        return indexBatch.del(index.getKey(quad));
      }, quadBatch);
    }, this.db.batch());
    // @ts-ignore
    await batch.write();
    return { type: TSResultType.VOID };
  }

  async patch(oldQuad: TSQuad, newQuad: TSQuad, opts?: TSEmptyOpts): Promise<TSVoidResult> {
    const value = serializeQuad(newQuad);
    const batch = this.indexes.reduce((indexBatch, i) => {
      return indexBatch.del(i.getKey(oldQuad)).put(i.getKey(newQuad), value);
    }, this.db.batch());
    // @ts-ignore
    await batch.write();
    return { type: TSResultType.VOID };
  }

  async multiPatch(oldQuads: TSQuad[], newQuads: TSQuad[], opts?: TSEmptyOpts): Promise<TSVoidResult> {
    let batch = this.db.batch();
    batch = oldQuads.reduce((quadBatch, quad) => {
      return this.indexes.reduce((indexBatch, index) => {
        return indexBatch.del(index.getKey(quad));
      }, quadBatch);
    }, batch);
    batch = newQuads.reduce((quadBatch, quad) => {
      const value = serializeQuad(quad);
      return this.indexes.reduce((indexBatch, index) => {
        return indexBatch.put(index.getKey(quad), value);
      }, quadBatch);
    }, batch);
    // @ts-ignore
    await batch.write();
    return { type: TSResultType.VOID };
  }

  async get(pattern: TSPattern, opts?: TSGetOpts): Promise<TSQuadArrayResult> {
    if (isNil(opts)) opts = {};
    if (isNil(pattern)) pattern = {};
    assert(isObject(pattern), 'The "matchTerms" argument is not an object.');
    assert(isObject(opts), 'The "opts" argument is not an object.');
    const results = await this.getStream(pattern, opts);
    const quads = await streamToArray(results.iterator);
    return { type: TSResultType.QUADS, items: quads, sorting: results.sorting };
  }

  async search(stages: TSSearchStage[], opts: TSSearchOpts): Promise<TSQuadArrayResult|TSBindingArrayResult> {
    if (isNil(opts)) opts = {};
    assert(isArray(stages), 'The "patterns" argument is not an array.');
    assert(isObject(opts), 'The "opts" argument is not an object.');
    const results = await this.searchStream(stages, opts);
    switch (results.type) {
      case TSResultType.QUADS:
        return { ...results, items: await streamToArray(results.iterator) };
      case TSResultType.BINDINGS:
        return { ...results, items: await streamToArray(results.iterator) };
      default:
        // @ts-ignore
        throw new Error(`Unsupported result type "${results.type}"`);
    }
  }

  /*
   * ==========================================================================
   *                                COUNTING API
   * ==========================================================================
   */

  async getApproximateSize(pattern: TSPattern, opts?: TSEmptyOpts): Promise<TSApproximateSizeResult> {
    if (isNil(pattern)) pattern = {};
    if (isNil(opts)) opts = {};
    assert(isObject(pattern), 'The "matchTerms" argument is not a function..');
    assert(isObject(opts), 'The "opts" argument is not an object.');
    return await getApproximateSize(this, pattern, opts);
  }

  /*
   * ==========================================================================
   *                            STREAMING API
   * ==========================================================================
   */

  async getStream(pattern: TSPattern, opts?: TSGetOpts): Promise<TSQuadStreamResult> {
    if (isNil(pattern)) pattern = {};
    if (isNil(opts)) opts = {};
    assert(isObject(pattern), 'The "matchTerms" argument is not an object.');
    assert(isObject(opts), 'The "opts" argument is not an object.');
    return await getStream(this, pattern, opts);
  }

  async searchStream(stages: TSSearchStage[], opts?: TSSearchOpts) {
    if (isNil(opts)) opts = {};
    assert(isArray(stages), 'The "patterns" argument is not an array.');
    assert(isObject(opts), 'The "opts" argument is not an object.');
    return await searchStream(this, stages, opts);
  }

  async putStream(source: TSReadable<TSQuad>, opts?: TSPutStreamOpts): Promise<TSVoidResult> {
    if (isNil(opts)) opts = {};
    assert(isReadableStream(source), 'The "source" argument is not a readable stream.');
    assert(isObject(opts), 'The "opts" argument is not an object.');
    const batchSize = (opts && opts.batchSize) || 1;
    if (batchSize === 1) {
      await consumeOneByOne<TSQuad>(source, quad => this.put(quad));
    } else {
      await consumeInBatches<TSQuad>(source, batchSize, quads => this.multiPut(quads));
    }
    return { type: TSResultType.VOID };
  }

  async delStream(source: TSReadable<TSQuad>, opts?: TSDelStreamOpts): Promise<TSVoidResult> {
    if (isNil(opts)) opts = {};
    assert(isReadableStream(source), 'The "source" argument is not a readable stream.');
    assert(isObject(opts), 'The "opts" argument is not an object.');
    const batchSize = (opts && opts.batchSize) || 1;
    if (batchSize === 1) {
      await consumeOneByOne(source, quad => this.del(<TSQuad>quad, opts));
    } else {
      await consumeInBatches(source, batchSize, quads => this.multiDel(<TSQuad[]>quads));
    }
    return { type: TSResultType.VOID };
  }

  protected _isQuad(obj: any): boolean {
    return isString(obj.subject)
      && isString(obj.predicate)
      && isString(obj.object)
      && isString(obj.graph);
  }

  /*
   * ==========================================================================
   *                            LOW-LEVEL DB HELPERS
   * ==========================================================================
   */

  getTermComparator(): (a: string, b: string) => -1|0|1 {
    return (a: string, b: string) => {
      if (a < b) return -1;
      else if (a === b) return 0;
      else return 1;
    }
  }

  getQuadComparator(_termNames: TSTermName[] = termNames): (a: TSQuad, b: TSQuad) => -1|0|1 {
    const termComparator = this.getTermComparator();
    return (a: TSQuad, b: TSQuad) => {
      for (let i = 0, n = _termNames.length, r: -1|0|1; i < n; i += 1) {
        r = termComparator(a[_termNames[i]], b[_termNames[i]]);
        if (r !== 0) return r;
      }
      return 0;
    };
  }

  getBindingComparator(_termNames: string[]): (a: TSBinding, b: TSBinding) => -1|0|1 {
    const termComparator = this.getTermComparator();
    return (a: TSBinding, b: TSBinding) => {
      for (let i = 0, n = _termNames.length, r: -1|0|1; i < n; i += 1) {
        r = termComparator(a[_termNames[i]], b[_termNames[i]]);
        if (r !== 0) return r;
      }
      return 0;
    };
  }

}
