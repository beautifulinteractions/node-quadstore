
'use strict';

import {
  consumeInBatches,
  consumeOneByOne,
  emptyObject,
  nanoid,
  streamToArray,
  termNames,
  defaultIndexes,
  pFromCallback,
  asPattern,
} from './utils';
import {EventEmitter} from 'events';
import {importPattern, importQuad, importSimpleTerm, serializeImportedQuad} from './serialization';
import {AsyncIterator, EmptyIterator, TransformIterator} from 'asynciterator';
import {DataFactory, Quad, Quad_Graph, Quad_Object, Quad_Predicate, Quad_Subject, Store, Stream, Term} from 'rdf-js';
import {
  DefaultGraphMode,
  DelStreamOpts,
  BatchOpts,
  DelOpts,
  PutOpts,
  PatchOpts,
  GetOpts,
  InternalIndex,
  ImportedPattern,
  PutStreamOpts,
  Binding,
  BindingArrayResult,
  BindingStreamResult, BooleanResult,
  Pattern,
  QuadArrayResult,
  QuadStreamResult,
  StoreOpts,
  VoidResult,
  TSReadable,
  ResultType,
  SparqlOpts,
  TermName, Prefixes,
} from './types';
import {AbstractChainedBatch, AbstractLevelDOWN} from 'abstract-leveldown';
import {getApproximateSize, getStream, compileCanBeUsedWithPatternFn, compileGetKeyFn} from './get';
import {Algebra} from 'sparqlalgebrajs';
import {newEngine, ActorInitSparql} from 'quadstore-comunica';
import {sparql, sparqlStream} from './sparql';
import {DataFactory as RdfDataFactory} from 'rdf-data-factory';
import {Scope} from './scope';


export class Quadstore implements Store {

  readonly db: AbstractLevelDOWN;

  readonly defaultGraph: string;
  readonly indexes: InternalIndex[];
  readonly id: string;

  readonly separator: string;
  readonly boundary: string;

  readonly engine: ActorInitSparql;
  readonly prefixes: Prefixes;

  readonly dataFactory: DataFactory;

  sparqlMode: boolean;
  defaultGraphMode: DefaultGraphMode;

  constructor(opts: StoreOpts) {
    this.dataFactory = opts.dataFactory || new RdfDataFactory();
    this.db = opts.backend;
    this.indexes = [];
    this.id = nanoid();
    this.boundary = opts.boundary || '\uDBFF\uDFFF';
    this.separator = opts.separator || '\u0000\u0000';
    (opts.indexes || defaultIndexes)
      .forEach((index: TermName[]) => this._addIndex(index));
    this.engine = newEngine();
    this.prefixes = opts.prefixes || {
      expandTerm: term => term,
      compactIri: iri => iri,
    };
    this.sparqlMode = false;
    this.defaultGraphMode = opts.defaultGraphMode || DefaultGraphMode.UNION;
    this.defaultGraph = importSimpleTerm(this.dataFactory.defaultGraph(), true, 'urn:rdfstore:dg', this.prefixes);
  }

  fork(opts: { defaultGraphMode?: DefaultGraphMode, sparqlMode?: boolean } = {}): Quadstore {
    const fork = <Quadstore>Object.create(this);
    if (typeof opts.sparqlMode === 'boolean') {
      fork.sparqlMode = opts.sparqlMode;
    }
    if (opts.defaultGraphMode) {
      fork.defaultGraphMode = opts.defaultGraphMode;
    }
    return fork;
  }

  protected ensureReady() {
    if (this.db.status !== 'open') {
      throw new Error(`Store is not ready (status: "${this.db.status}"). Did you call store.open()?`);
    }
  }

  protected waitForStatus(status: string, timeout: number = 200) {
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        clearInterval(i);
        clearTimeout(t);
        reject(new Error(`Timeout while waiting for status "${status}"`));
      }, timeout);
      const i = setInterval(() => {
        if (this.db.status === status) {
          clearInterval(i);
          clearTimeout(t);
          resolve();
        }
      }, 10);
    });
  }

  async open() {
    switch (this.db.status) {
      case 'closing':
        await this.waitForStatus('closed');
      case 'new':
      case 'closed':
        await pFromCallback((cb) => { this.db.open(cb); });
        break;
      case 'opening':
        await this.waitForStatus('open');
        break;
      case 'open':
      default:
    }
  }

  async close() {
    switch (this.db.status) {
      case 'opening':
        await this.waitForStatus('open');
      case 'open':
      case 'new':
        await pFromCallback((cb) => { this.db.close(cb); });
        break;
      case 'closing':
        await this.waitForStatus('closed');
        break;
      case 'closed':
      default:
    }
  }

  toString() {
    return this.toJSON();
  }

  toJSON() {
    return `[object ${this.constructor.name}::${this.id}]`;
  }

  _addIndex(terms: TermName[]): void {
    const name = terms.map(t => t.charAt(0).toUpperCase()).join('');
    this.indexes.push({
      terms,
      name,
      getKey: compileGetKeyFn(name, this.separator, terms),
      canBeUsedWithPattern: compileCanBeUsedWithPatternFn(terms),
    });
  }

  match(subject?: Term, predicate?: Term, object?: Term, graph?: Term, opts: GetOpts = emptyObject): Stream<Quad> {
    const pattern = asPattern(subject, predicate, object, graph);
    if (pattern) {
      const iterator = new TransformIterator<Quad, Quad>();
      this.getStream(pattern, opts)
        .then((results) => {
          iterator.source = <AsyncIterator<Quad>>results.iterator;
        })
        .catch((err) => {
          // TODO: is the destroy() method really supported by AsyncIterator?
          // @ts-ignore
          iterator.emit('error', err);
          iterator.destroy();
        });
      return <Stream<Quad>>iterator;
    } else {
      return new EmptyIterator();
    }
  }

  async countQuads(subject?: Term, predicate?: Term, object?: Term, graph?: Term, opts: GetOpts = emptyObject): Promise<number> {
    const pattern = asPattern(subject, predicate, object, graph);
    if (pattern) {
      const results = await this.getApproximateSize(pattern, opts);
      return results.approximateSize;
    } else {
      return 0;
    }
  }

  import(source: Stream<Quad>): EventEmitter {
    const emitter = new EventEmitter();
    this.putStream(<TSReadable<Quad>>source, {})
      .then(() => { emitter.emit('end'); })
      .catch((err) => { emitter.emit('error', err); });
    return emitter;
  }

  remove(source: Stream<Quad>): EventEmitter {
    const emitter = new EventEmitter();
    this.delStream(<TSReadable<Quad>>source, {})
      .then(() => emitter.emit('end'))
      .catch((err) => emitter.emit('error', err));
    return emitter;
  }

  removeMatches(subject?: Term, predicate?: Term, object?: Term, graph?: Term, opts: GetOpts = emptyObject) {
    const source = this.match(subject, predicate, object, graph, opts);
    return this.remove(source);
  }

  deleteGraph(graph: Quad_Graph) {
    return this.removeMatches(undefined, undefined, undefined, graph);
  }

  async getApproximateSize(pattern: Pattern, opts: GetOpts = emptyObject) {
    await this.ensureReady();
    const importedTerms: ImportedPattern = importPattern(pattern, this.defaultGraph, this.prefixes);
    return await getApproximateSize(this, importedTerms, opts);
  }

  async sparql(query: Algebra.Operation|string, opts: SparqlOpts = emptyObject): Promise<QuadArrayResult|BindingArrayResult|VoidResult|BooleanResult> {
    this.ensureReady();
    return sparql(this, query, opts);
  }

  async put(quad: Quad, opts: PutOpts = emptyObject): Promise<VoidResult> {
    this.ensureReady();
    let batch = this.db.batch();
    if (opts.scope) {
      quad = opts.scope.parseQuad(quad, batch);
    }
    const importedQuad = importQuad(quad, this.defaultGraph, this.prefixes);
    const value = serializeImportedQuad(importedQuad);
    batch = this.indexes.reduce((indexBatch, i) => {
      return indexBatch.put(i.getKey(importedQuad), value);
    }, batch);
    await this.writeBatch(batch, opts);
    return { type: ResultType.VOID };
  }

  async multiPut(quads: Quad[], opts: PutOpts = emptyObject): Promise<VoidResult> {
    this.ensureReady();
    let batch = this.db.batch();
    batch = quads.reduce((quadBatch, quad) => {
      if (opts.scope) {
        quad = opts.scope.parseQuad(quad, batch);
      }
      const importedQuad = importQuad(quad, this.defaultGraph, this.prefixes);
      const value = serializeImportedQuad(importedQuad);
      return this.indexes.reduce((indexBatch, index) => {
        return indexBatch.put(index.getKey(importedQuad), value);
      }, quadBatch);
    }, batch);
    await this.writeBatch(batch, opts);
    return { type: ResultType.VOID };
  }

  async del(quad: Quad, opts: DelOpts = emptyObject): Promise<VoidResult> {
    this.ensureReady();
    const batch = this.indexes.reduce((batch, i) => {
      return batch.del(i.getKey(importQuad(quad, this.defaultGraph, this.prefixes)));
    }, this.db.batch());
    await this.writeBatch(batch, opts);
    return { type: ResultType.VOID };
  }

  async multiDel(quads: Quad[], opts: DelOpts = emptyObject): Promise<VoidResult> {
    this.ensureReady();
    const batch = quads.reduce((quadBatch, quad) => {
      const importedQuad = importQuad(quad, this.defaultGraph, this.prefixes);
      return this.indexes.reduce((indexBatch, index) => {
        return indexBatch.del(index.getKey(importedQuad));
      }, quadBatch);
    }, this.db.batch());
    await this.writeBatch(batch, opts);
    return { type: ResultType.VOID };
  }

  async patch(oldQuad: Quad, newQuad: Quad, opts: PatchOpts = emptyObject): Promise<VoidResult> {
    this.ensureReady();
    const importedNewQuad = importQuad(newQuad, this.defaultGraph, this.prefixes);
    const value = serializeImportedQuad(importedNewQuad);
    const batch = this.indexes.reduce((indexBatch, i) => {
      return indexBatch.del(i.getKey(importQuad(oldQuad, this.defaultGraph, this.prefixes)))
        .put(i.getKey(importedNewQuad), value);
    }, this.db.batch());
    await this.writeBatch(batch, opts);
    return { type: ResultType.VOID };
  }

  async multiPatch(oldQuads: Quad[], newQuads: Quad[], opts: PatchOpts = emptyObject): Promise<VoidResult> {
    this.ensureReady();
    let batch = this.db.batch();
    batch = oldQuads.reduce((quadBatch, oldQuad) => {
      return this.indexes.reduce((indexBatch, index) => {
        return indexBatch.del(index.getKey(importQuad(oldQuad, this.defaultGraph, this.prefixes)));
      }, quadBatch);
    }, batch);
    batch = newQuads.reduce((quadBatch, newQuad) => {
      const importedNewQuad = importQuad(newQuad, this.defaultGraph, this.prefixes)
      const value = serializeImportedQuad(importedNewQuad);
      return this.indexes.reduce((indexBatch, index) => {
        return indexBatch.put(index.getKey(importedNewQuad), value);
      }, quadBatch);
    }, batch);
    await this.writeBatch(batch, opts);
    return { type: ResultType.VOID };
  }

  private async writeBatch(batch: AbstractChainedBatch, opts: BatchOpts) {
    if (opts.preWrite) {
      await opts.preWrite(batch);
    }
    await pFromCallback((cb) => { batch.write(cb); });
  }

  async get(pattern: Pattern, opts: GetOpts = emptyObject): Promise<QuadArrayResult> {
    this.ensureReady();
    const results = await this.getStream(pattern, opts);
    const items: Quad[] = await streamToArray(results.iterator);
    return { type: results.type, items };
  }

  async getStream(pattern: Pattern, opts: GetOpts = emptyObject): Promise<QuadStreamResult> {
    this.ensureReady();
    return await getStream(this, importPattern(pattern, this.defaultGraph, this.prefixes), opts);
  }

  async putStream(source: TSReadable<Quad>, opts: PutStreamOpts = emptyObject): Promise<VoidResult> {
    this.ensureReady();
    const batchSize = opts.batchSize || 1;
    if (batchSize === 1) {
      await consumeOneByOne<Quad>(source, quad => this.put(quad, opts));
    } else {
      await consumeInBatches<Quad>(source, batchSize, quads => this.multiPut(quads, opts));
    }
    return { type: ResultType.VOID };
  }

  async delStream(source: TSReadable<Quad>, opts: DelStreamOpts = emptyObject): Promise<VoidResult> {
    this.ensureReady();
    const batchSize = opts.batchSize || 1;
    if (batchSize === 1) {
      await consumeOneByOne<Quad>(source, quad => this.del(quad));
    } else {
      await consumeInBatches<Quad>(source, batchSize, quads => this.multiDel(quads));
    }
    return { type: ResultType.VOID };
  }

  async sparqlStream(query: Algebra.Operation|string, opts: SparqlOpts = emptyObject): Promise<QuadStreamResult|BindingStreamResult|VoidResult|BooleanResult> {
    this.ensureReady();
    return await sparqlStream(this, query, opts);
  }

  async initScope(): Promise<Scope> {
    await this.ensureReady();
    return await Scope.init(this);
  }

  async loadScope(scopeId: string): Promise<Scope> {
    await this.ensureReady();
    return await Scope.load(this, scopeId);
  }

  async deleteScope(scopeId: string): Promise<void> {
    await this.ensureReady();
    await Scope.delete(this, scopeId);
  }

  async deleteAllScopes(): Promise<void> {
    await this.ensureReady();
    await Scope.delete(this);
  }

  getTermComparator(): (a: Term, b: Term) => (-1 | 0 | 1) {
    return (a: Term, b: Term): -1|0|1 => {
      if (a.termType !== b.termType) {
        return a.termType < b.termType ? -1 : 1;
      }
      if (a.termType !== 'Literal' || b.termType !== 'Literal') {
        return a.value < b.value ? -1 : (a.value === b.value ? 0 : 1);
      }
      if (a.datatype !== b.datatype) {
        return a.datatype < b.datatype ? -1 : 1;
      }
      if (a.language !== b.language) {
        return a.language < b.language ? -1 : 1;
      }
      return a.value < b.value ? -1 : (a.value === b.value ? 0 : 1);
    };
  }

  getQuadComparator(_termNames: TermName[] = termNames): (a: Quad, b: Quad) => (-1 | 0 | 1) {
    const termComparator = this.getTermComparator();
    return (a: Quad, b: Quad) => {
      for (let i = 0, n = _termNames.length, r: -1|0|1; i < n; i += 1) {
        r = termComparator(a[_termNames[i]], b[_termNames[i]]);
        if (r !== 0) return r;
      }
      return 0;
    };
  }

  getBindingComparator(_termNames: string[]): (a: Binding, b: Binding) => -1|0|1 {
    const termComparator = this.getTermComparator();
    return (a: Binding, b: Binding) => {
      for (let i = 0, n = _termNames.length, r: -1|0|1; i < n; i += 1) {
        r = termComparator(a[_termNames[i]], b[_termNames[i]]);
        if (r !== 0) return r;
      }
      return 0;
    };
  }

}
