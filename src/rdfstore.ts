
'use strict';

const _ = require('./utils/lodash');
const enums = require('./utils/enums');
const utils = require('./utils');
const assert = require('assert');
const EventEmitter = require('events').EventEmitter;
const QuadStore = require('./quadstore');
const serialization = require('./rdf/serialization');
const sparql = require('./sparql');
const AsyncIterator = require('asynciterator');

class RdfStore extends QuadStore {

  constructor(opts) {
    assert(_.isObject(opts), 'Invalid "opts" argument: "opts" is not an object');
    assert(utils.isDataFactory(opts.dataFactory), 'Invalid "opts" argument: "opts.dataFactory" is not an instance of DataFactory');
    opts = {
      defaultContextValue: 'urn:quadstore:dg',
      ...opts,
      ...{ contextKey: 'graph' },
    };
    super(opts);
    const store = this;
    store._dataFactory = opts.dataFactory;
  }

  /**
   * RDF/JS.Source.match()
   * @param subject
   * @param predicate
   * @param object
   * @param graph
   * @returns {*}
   */
  match(subject, predicate, object, graph) {
    // if (!_.isNil(subject)) assert(_.isString(subject.termType), 'The "subject" argument is not an Term.');
    // if (!_.isNil(predicate)) assert(_.isString(predicate.termType), 'The "predicate" argument is not an Term.');
    // if (!_.isNil(object)) assert(_.isString(object.termType), 'The "object" argument is not an Term.');
    // if (!_.isNil(graph)) assert(_.isString(graph.termType), 'The "graph" argument is not an Term.');
    const iterator = new AsyncIterator.TransformIterator();
    const matchTerms = { subject, predicate, object, graph };
    this.getStream(matchTerms)
      .then((results) => { iterator.source = results.iterator; })
      .catch((err) => { iterator.destroy(); });
    return iterator;
  }

  /**
   * RDF/JS.Sink.import()
   * @param source
   * @param opts
   * @returns {*|EventEmitter}
   */
  import(source, opts) {
    if (_.isNil(opts)) opts = {};
    assert(utils.isReadableStream(source), 'The "source" argument is not a readable stream.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const emitter = new EventEmitter();
    this.putStream(source, opts)
      .then(() => { emitter.emit('end'); })
      .catch((err) => { emitter.emit('error', err); });
    return emitter;
  }

  /**
   * RDF/JS.Store.remove()
   * @param source
   * @param opts
   * @returns {*|EventEmitter}
   */
  remove(source, opts) {
    if (_.isNil(opts)) opts = {};
    assert(utils.isReadableStream(source), 'The "source" argument is not a readable stream.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const emitter = new EventEmitter();
    this.delStream(source, opts)
      .then(() => emitter.emit('end'))
      .catch((err) => emitter.emit('error', err));
    return emitter;
  }

  /**
   * RDF/JS.Store.removeMatches()
   * @param subject
   * @param predicate
   * @param object
   * @param graph
   * @returns {*}
   */
  removeMatches(subject, predicate, object, graph) {
    const source = this.match(subject, predicate, object, graph);
    return this.remove(source);
  }

  /**
   * RDF/JS.Store.deleteGraph()
   * @param graph
   * @returns {*}
   */
  deleteGraph(graph) {
    return this.removeMatches(null, null, null, graph);
  }

  async getApproximateSize(matchTerms, opts) {
    const importedTerms = serialization.importTerms(matchTerms, this._defaultContextValue, true, false);
    return await super.getApproximateSize(importedTerms, opts);
  }

  async getStream(matchTerms, opts) {
    if (_.isNil(matchTerms)) matchTerms = {};
    if (_.isNil(opts)) opts = {};
    assert(_.isObject(matchTerms), 'The "matchTerms" argument is not an object.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const importedMatchTerms = {};
    if (matchTerms.subject) {
      importedMatchTerms.subject = this._importTerm(matchTerms.subject, false, true, false);
    }
    if (matchTerms.predicate) {
      importedMatchTerms.predicate = this._importTerm(matchTerms.predicate, false, true, false);
    }
    if (matchTerms.object) {
      importedMatchTerms.object = this._importTerm(matchTerms.object, false, true, false);
    }
    if (matchTerms.graph) {
      importedMatchTerms.graph = this._importTerm(matchTerms.graph, true, true, false);
    }
    const results = await QuadStore.prototype.getStream.call(this, importedMatchTerms, opts);
    return { iterator: results.iterator.map(this._createQuadDeserializerMapper()), sorting: results.sorting };
  }

  async searchStream(patterns, filters, opts) {
    if (_.isNil(opts)) opts = {};
    const importedPatterns = patterns.map(
      pattern => serialization.importTerms(pattern, this._defaultContextValue, true, false)
    );
    const importedFilters = filters.map((filter) => {
      return {
        type: filter.type,
        args: filter.args.map(arg => serialization.importTerm(arg, false, this._defaultContextValue, true, false)),
      };
    });
    const results = await QuadStore.prototype.searchStream.call(this, importedPatterns, importedFilters, opts);
    const iterator = results.iterator.map((binding) => {
      return serialization.exportTerms(binding, this._defaultContextValue, this._dataFactory);
    });
    return { type: results.type, variables: results.variables, iterator };
  }

  async sparql(query, opts) {
    if (_.isNil(opts)) opts = {};
    assert(_.isString(query), 'The "query" argument is not an array.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const results = await this.sparqlStream(query, opts);
    switch (results.type) {
      case enums.resultType.BINDINGS: {
        const bindings = await utils.streamToArray(results.iterator);
        return {type: results.type, variables: results.variables, bindings, sorting: results.sorting};
      } break;
      default:
        throw new Error(`Unsupported results type "${results.type}"`);
    }
  }

  async sparqlStream(query, opts) {
    if (_.isNil(opts)) opts = {};
    return await sparql.sparqlStream(this, query, opts);
  }

  async _delput(oldQuads, newQuads, opts) {
    const store = this;
    const importedOldQuads = Array.isArray(oldQuads)
      ? oldQuads.map(quad => store._importQuad(quad)) : null;
    const importedNewQuads = Array.isArray(newQuads)
      ? newQuads.map(quad => store._importQuad(quad)) : null;
    return QuadStore.prototype._delput.call(
      this, importedOldQuads, importedNewQuads, opts,
    );
  }

  _isQuad(obj) {
    return QuadStore.prototype._isQuad.call(this, obj)
      && _.isFunction(obj.equals);
  }

  _importTerm(term, isGraph, rangeBoundaryAllowed = false) {
    return serialization.importTerm(term, isGraph, this._defaultContextValue, rangeBoundaryAllowed);
  }

  _importQuad(quad) {
    return serialization.importQuad(quad, this._defaultContextValue);
  }

  _createQuadDeserializerMapper() {
    return (quad) => {
      return serialization.exportQuad(quad, this._defaultContextValue, this._dataFactory);
    };
  }

  _getTermValueComparator() {
    return (a, b) => {
      const aSerializedValue = a._serializedValue || serialization.importTerm(a, false, this._defaultContextValue, true, false);
      const bSerializedValue = b._serializedValue || serialization.importTerm(b, false, this._defaultContextValue, true, false);
      if (aSerializedValue < bSerializedValue) return -1;
      else if (aSerializedValue === bSerializedValue) return 0;
      else return 1;
    };
  }

}

module.exports = RdfStore;