
'use strict';

import {
  IQuadstoreOpts, IQuadstoreQuadStream,
  TEmptyOpts,
  TQuadstoreIndex, TQuadstoreInternalIndex, TQuadstoreMatchTerms,
  TQuadstoreQuad, TQuadstoreSearchFilter, TQuadstoreSearchPattern,
  TQuadstoreTermName, TQuadstoreTermRange,
  TQuadstoreTerms
} from './types';
import assert from 'assert';
import events from 'events';
import encode from 'encoding-down';
import levelup from 'levelup';
import ai from 'asynciterator';
import {AbstractLevelDOWN} from 'abstract-leveldown';
import LevelUp from 'levelup';


const _ = require('./utils/lodash');
const enums = require('./utils/enums');
const utils = require('./utils');
const get = require('./get');
const search = require('./search');


/**
 *
 */
class QuadStore extends events.EventEmitter {

  private _db: AbstractLevelDOWN;
  private _abstractLevelDOWN: AbstractLevelDOWN;

  private _contextKey: string;
  private _defaultContextValue: string;
  private _indexes: TQuadstoreInternalIndex[];
  private _id: string;

  public separator!: string;
  public boundary!: string;

  /*
   * ==========================================================================
   *                           STORE LIFECYCLE
   * ==========================================================================
   */

  constructor(opts: IQuadstoreOpts) {
    super();
    assert(_.isObject(opts), 'Invalid "opts" argument: "opts" is not an object');
    assert(
      utils.isAbstractLevelDOWNInstance(opts.backend),
      'Invalid "opts" argument: "opts.backend" is not an instance of AbstractLevelDOWN',
    );
    this._abstractLevelDOWN = opts.backend;
    this._db = levelup(encode(this._abstractLevelDOWN, {valueEncoding: 'json'}));
    this._contextKey = opts.contextKey || 'graph';
    this._defaultContextValue = opts.defaultContextValue || '_DEFAULT_CONTEXT_';
    this._indexes = [];
    this._id = utils.nanoid();
    utils.defineReadOnlyProperty(this, 'boundary', opts.boundary || '\uDBFF\uDFFF');
    utils.defineReadOnlyProperty(this, 'separator', opts.separator || '\u0000\u0000');
    (opts.indexes || utils.genDefaultIndexes(this._contextKey))
      .forEach((index: TQuadstoreIndex) => this._addIndex(index));
    setImmediate(() => { this._initialize(); });
  }

  _initialize() {
    this.emit('ready');
  }

  close() {
    // @ts-ignore
    return this._db.close();
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
    return `[object ${this.constructor.name}::${this._id}]`;
  }

  /*
   * ==========================================================================
   *                                  INDEXES
   * ==========================================================================
   */

  _addIndex(terms: TQuadstoreIndex) {
    assert(utils.hasAllTerms(terms, this._contextKey), 'Invalid index (bad terms).');
    const name = terms.map(t => t.charAt(0).toUpperCase()).join('');
    this._indexes.push({
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

  async put(quads: TQuadstoreQuad|TQuadstoreQuad[], opts?: TEmptyOpts) {
    if (_.isNil(opts)) opts = {};
    assert(_.isObject(quads), 'The "quads" argument is not an object.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    // @ts-ignore
    return await this._delput([], quads, opts);
  }

  async del(matchTermsOrOldQuads: TQuadstoreTerms|TQuadstoreQuad|TQuadstoreQuad[], opts: TEmptyOpts) {
    if (_.isNil(opts)) opts = {};
    assert(_.isObject(matchTermsOrOldQuads), 'The "matchTermsOrOldQuads" argument is not an object.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    return (Array.isArray(matchTermsOrOldQuads) || this._isQuad(matchTermsOrOldQuads))
      // @ts-ignore
      ? await this._delput(matchTermsOrOldQuads, [], opts)
      : await this._getdelput(matchTermsOrOldQuads, [], opts);
  }

  /**
   * Returns all quads matching the provided terms.
   * @param matchTerms
   * @param cb
   */
  async get(matchTerms: TQuadstoreTerms, opts: TEmptyOpts) {
    if (_.isNil(opts)) opts = {};
    if (_.isNil(matchTerms)) matchTerms = {};
    assert(_.isObject(matchTerms), 'The "matchTerms" argument is not an object.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const results = await this.getStream(matchTerms, opts);
    const quads = await utils.streamToArray(results.iterator);
    return { quads, sorting: results.sorting };
  }

  async search(patterns: TQuadstoreSearchPattern[], filters: TQuadstoreSearchFilter[], opts: TEmptyOpts) {
    if (_.isNil(opts)) opts = {};
    assert(_.isArray(patterns), 'The "patterns" argument is not an array.');
    assert(_.isArray(filters), 'The "filters" argument is not an array.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const results = await this.searchStream(patterns, filters, opts);
    switch (results.type) {
      case enums.resultType.BINDINGS: {
        const bindings = await utils.streamToArray(results.bindings);
        return {type: results.type, bindings, sorting: results.sorting};
      } break;
      default:
        throw new Error(`Unsupported result type "${results.type}"`);
    }
  }

  async patch(matchTermsOrOldQuads: TQuadstoreTerms|TQuadstoreQuad|TQuadstoreQuad[], newQuads: TQuadstoreQuad|TQuadstoreQuad[], opts: TEmptyOpts) {
    if (_.isNil(opts)) opts = {};
    assert(_.isObject(matchTermsOrOldQuads), 'Invalid type of "matchTermsOrOldQuads" argument.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    return (Array.isArray(matchTermsOrOldQuads) || this._isQuad(matchTermsOrOldQuads))
      // @ts-ignore
      ? await this._delput(matchTermsOrOldQuads, newQuads, opts)
      : await this._getdelput(matchTermsOrOldQuads, newQuads, opts);
  }

  /*
   * ==========================================================================
   *                                COUNTING API
   * ==========================================================================
   */

  async getApproximateSize(matchTerms: TQuadstoreTerms, opts: TEmptyOpts) {
    if (_.isNil(matchTerms)) matchTerms = {};
    if (_.isNil(opts)) opts = {};
    assert(_.isObject(matchTerms), 'The "matchTerms" argument is not a function..');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    return await get.getApproximateSize(this, matchTerms, opts);
  }

  /*
   * ==========================================================================
   *                            STREAMING API
   * ==========================================================================
   */

  async getStream(matchTerms: TQuadstoreTerms, opts: TEmptyOpts) {
    if (_.isNil(matchTerms)) matchTerms = {};
    if (_.isNil(opts)) opts = {};
    assert(_.isObject(matchTerms), 'The "matchTerms" argument is not an object.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    return await get.getStream(this, matchTerms, opts);
  }

  async searchStream(patterns: TQuadstoreSearchPattern[], filters: TQuadstoreSearchFilter[], opts: TEmptyOpts) {
    if (_.isNil(opts)) opts = {};
    assert(_.isArray(patterns), 'The "patterns" argument is not an array.');
    assert(_.isArray(filters), 'The "filters" argument is not an array.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    return await search.searchStream(this, patterns, filters, opts);
  }

  async putStream(source: IQuadstoreQuadStream, opts: TEmptyOpts) {
    if (_.isNil(opts)) opts = {};
    assert(utils.isReadableStream(source), 'The "source" argument is not a readable stream.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const transformOpts = {
      transform: (quad: TQuadstoreQuad, cb: () => void) => {
        this._delput([], [quad], opts)
          .then(cb.bind(null, null))
          .catch(cb);
      },
    };
    const iterator = ai.AsyncIterator.wrap(source).transform(transformOpts);
    await utils.streamToArray(iterator);
  }

  async delStream(source: IQuadstoreQuadStream, opts: TEmptyOpts) {
    if (_.isNil(opts)) opts = {};
    assert(utils.isReadableStream(source), 'The "source" argument is not a readable stream.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const transformOpts = {
      transform: (quad: TQuadstoreQuad, cb: () => void) => {
        this._delput([quad], [], opts)
          .then(cb.bind(null, null))
          .catch(cb);
      },
    };
    const iterator = ai.AsyncIterator.wrap(source).transform(transformOpts);
    await utils.streamToArray(iterator);
  }



  _isQuad(obj: any): boolean {
    return _.isString(obj.subject)
      && _.isString(obj.predicate)
      && _.isString(obj.object)
      && _.isString(obj[this._contextKey]);
  }

  /*
   * ==========================================================================
   *                            LOW-LEVEL DB HELPERS
   * ==========================================================================
   */

  async _delput(oldQuads: TQuadstoreQuad|TQuadstoreQuad[], newQuads: TQuadstoreQuad|TQuadstoreQuad[], opts: TEmptyOpts) {
    if (oldQuads !== null) {
      if (Array.isArray(oldQuads)) {
        // @ts-ignore
        await this._db.batch(_.flatMap(oldQuads, quad => this._quadToBatch(quad, 'del')));
      } else {
        // @ts-ignore
        await this._db.batch(this._quadToBatch(oldQuads, 'del'));
      }
    }
    if (newQuads !== null) {
      if (Array.isArray(newQuads)) {
        // @ts-ignore
        await this._db.batch(_.flatMap(newQuads, quad => this._quadToBatch(quad, 'put')));
      } else {
        // @ts-ignore
        await this._db.batch(this._quadToBatch(newQuads, 'put'));
      }
    }
  }

  async _getdelput(matchTerms: TQuadstoreTerms, newQuads: TQuadstoreQuad|TQuadstoreQuad[], opts: TEmptyOpts) {
    const oldQuads = (await this.get(matchTerms, opts)).quads;
    await this._delput(oldQuads, newQuads, {});
  }

  /**
   * Transforms a quad into a batch of either put or del
   * operations, one per each of the six indexes.
   * @param quad
   * @param type
   * @returns {}
   */
  _quadToBatch(quad: TQuadstoreQuad, type: 'del'|'put') {
    const indexes = this._indexes;
    const contextKey = this._contextKey;
    // @ts-ignore
    if (!quad[contextKey]) {
      // @ts-ignore
      quad = {
        subject: quad.subject,
        predicate: quad.predicate,
        object: quad.object,
        [contextKey]: this._defaultContextValue,
      };
    }
    return indexes.map(i => ({
        type,
        key: i.getKey(quad),
        value: quad,
    }));
  }

  _getTermNames(): TQuadstoreTermName[] {
    // @ts-ignore
    return ['subject', 'predicate', 'object', this._contextKey];
  }

  _getTermValueComparator() {
    return (a: string, b: string) => {
      if (a < b) return -1;
      else if (a === b) return 0;
      else return 1;
    }
  }

  _getQuadComparator(termNames: TQuadstoreTermName[]) {
    if (!termNames) termNames = this._getTermNames();
    const valueComparator = this._getTermValueComparator();
    return (a: TQuadstoreQuad, b: TQuadstoreQuad) => {
      for (let i = 0, n = termNames.length, r; i <= n; i += 1) {
        r = valueComparator(a[termNames[i]], b[termNames[i]]);
        if (r !== 0) return r;
      }
      return 0;
    };
  }

  _mergeTermRanges(a: TQuadstoreTermRange, b: TQuadstoreTermRange): TQuadstoreTermRange {
    const c = {...b};
    if (!_.isNil(a.lt)) {
      if (!_.isNil(c.lt)) {
        // @ts-ignore
        if (a.lt < c.lt) {
          c.lt = a.lt;
        }
      } else {
        c.lt = a.lt;
      }
    }
    if (!_.isNil(a.lte)) {
      if (!_.isNil(c.lte)) {
        // @ts-ignore
        if (a.lte < c.lte) {
          c.lte = a.lte;
        }
      } else {
        c.lte = a.lte;
      }
    }
    if (!_.isNil(a.gt)) {
      if (!_.isNil(c.gt)) {
        // @ts-ignore
        if (a.gt > c.gt) {
          c.gt = a.gt;
        }
      } else {
        c.gt = a.gt;
      }
    }
    if (!_.isNil(a.gte)) {
      if (!_.isNil(c.gte)) {
        // @ts-ignore
        if (a.gte > c.gte) {
          c.gte = a.gte;
        }
      } else {
        c.gte = a.gte;
      }
    }
    return c;
  }

  _mergeMatchTerms(a: TQuadstoreMatchTerms, b: TQuadstoreMatchTerms, termNames: TQuadstoreTermName[]): TQuadstoreMatchTerms {
    if (!termNames) {
      termNames = this._getTermNames();
    }
    const c = { ...b };
    termNames.forEach((termName) => {
      if (_.isNil(c[termName])) {
        if (!_.isNil(a[termName])) {
          c[termName] = a[termName];
        }
      } else {
        if (!_.isNil(a[termName])) {
          if (_.isObject(a[termName]) && _.isObject(c[termName])) {
            // @ts-ignore
            c[termName] = this._mergeTermRanges(a[termName], c[termName]);
          } else {
            throw new Error(`Cannot merge match terms`);
          }
        }
      }
    });
    return c;
  };

}

export default QuadStore;