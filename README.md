
# QUADSTORE [![Build Status](https://travis-ci.org/beautifulinteractions/node-quadstore.svg?branch=master)](https://travis-ci.org/beautifulinteractions/node-quadstore)

![Logo](https://github.com/beautifulinteractions/node-quadstore/blob/master/logo.png?raw=true)
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[![NPM](https://nodei.co/npm/quadstore.png)](https://nodei.co/npm/quadstore/)

A LevelDB-backed graph database for Node.js and the browser, written in Typescript.
Supports quads, RDF/JS interfaces and SPARQL queries.

## Table of contents

- [Introduction](#introduction)
- [Status](#status)
    - [Roadmap](#roadmap)
    - [Changelog](#changelog)
    - [Current version and features](#current-version-and-features)
    - [Notes](#notes)
- [Usage](#usage)
    - [Storage](#storage-backends)
    - [Return Values](#return-values)
    - [Result Types](#result-types)
    - [Streaming](#streaming-vs-non-streaming)
    - [Sorting](#sorting)
    - [Graph Interface](#graph-api)
        - [QuadStore class](#quadstore-class)
        - [QuadStore.prototype.get](#quadstoreprototypeget)
        - [QuadStore.prototype.search](#quadstoreprototypesearch)
        - [QuadStore.prototype.put](#quadstoreprototypeput)
        - [QuadStore.prototype.multiPut](#quadstoreprototypemultiput)
        - [QuadStore.prototype.del](#quadstoreprototypedel)
        - [QuadStore.prototype.multiDel](#quadstoreprototypemultidel)
        - [QuadStore.prototype.patch](#quadstoreprototypepatch)
        - [QuadStore.prototype.multiPatch](#quadstoreprototypemultipatch)
        - [QuadStore.prototype.getStream](#quadstoreprototypegetstream)
        - [QuadStore.prototype.searchStream](#quadstoreprototypesearchstream)
        - [QuadStore.prototype.putStream](#quadstoreprototypeputstream)
        - [QuadStore.prototype.delStream](#quadstoreprototypedelstream)
    - [RDF Interface](#rdf-interface)
        - [SPARQL support](#sparql-support)
        - [RdfStore class](#rdfstore-class)
        - [Graph API, Quad and Term instances](#graph-api-quad-and-term-instances)
        - [RdfStore.prototype.sparql](#rdfstoreprototypesparql)
        - [RdfStore.prototype.sparqlStream](#rdfstoreprototypesparqlstream)
        - [RdfStore.prototype.match](#rdfstoreprototypematch)
        - [RdfStore.prototype.import](#rdfstoreprototypeimport)
        - [RdfStore.prototype.remove](#rdfstoreprototyperemove)
        - [RdfStore.prototype.removeMatches](#rdfstoreprototyperemovematches)
- [Browser usage](#browser-usage)
- [Performance](#performance)
- [License](#license)

## Introduction

In the context of knowledge representation, a statement can often be 
represented as a 3-dimensional `(subject, predicate, object)` tuple,
normally referred to as a `triple`.

```
subject             predicate           object
BOB                 KNOWS               ALICE
BOB                 KNOWS               PAUL
```

A set of statements / triples can also be thought of as a graph:

```
                                        ┌────────┐
              KNOWS (predicate)         │ ALICE  │
     ┌─────────────────────────────────▶│(object)│
     │                                  └────────┘
┌─────────┐                                       
│   BOB   │                                       
│(subject)│                                       
└─────────┘                             ┌────────┐
     │                                  │  PAUL  │
     └─────────────────────────────────▶│(object)│
              KNOWS (predicate)         └────────┘
```                                                      

A `quad` is a triple with an additional term, usually called `graph` or
`context`.

    (subject, predicate, object, graph)

On a semantic level, the `graph` term identifies the graph to which a triple 
belongs. Each identifier can then be used as the `subject` or `object` of 
additional triples, facilitating the representation of metadata such as 
provenance and temporal validity. 

```
subject             predicate           object          graph
BOB                 KNOWS               ALICE           GRAPH-1
BOB                 KNOWS               PAUL            GRAPH-2
GRAPH-1             SOURCE              FACEBOOK
GRAPH-2             SOURCE              LINKEDIN
```

Quadstore is a LevelDB-backed graph database for Node.js and the browser 
with native support for quads, the RDF/JS interface specification, complex
searches and SPARQL queries.

Quadstore heavily borrows from [LevelGraph's approach to storing tuples][i1],
maintaining multiple indexes each of which deals with a different permutation
of quad terms. In that sense, Quadstore is an alternative to [LevelGraph][i3] 
that strikes a different compromise between expressiveness and performance, 
opting to natively supporting quads while working towards minimizing 
[the performance penalty][i4] that comes with the fourth term. 

Whereas previous versions of Quadstore used to maintain a pre-defined set of 
indexes based on the paper [RDF-4X][i2], newer versions allow users to
configure custom set of indexes according to the usage and query patterns 
specific to each use case.

[i1]: http://nodejsconfit.levelgraph.io
[i2]: http://dl.acm.org/citation.cfm?id=3012104
[i3]: https://github.com/levelgraph/levelgraph
[i4]: https://github.com/levelgraph/levelgraph/issues/43#issuecomment-29519727

## Status

Active, under development.

### Changelog

See [CHANGELOG.md](./CHANGELOG.md).

### Current version and features

Current version: **v7.0.1-alpha.6** available on NPM under the `alpha` tag or
as `quadstore@7.0.1-alpha.6`

- fully written in Typescript;
- retrieval, update, insertion and removal of quads;
- foundational support for complex searches;
- foundational support for quad generation;
- foundational support for SPARQL queries;
- [RDF/JS](https://github.com/rdfjs/representation-task-force)' `Store`, `Source` and `Sink` interfaces.

### Roadmap

We're currently working on the following features:

- expanding support for complex searches;
- expanding support for SPARQL queries;
- general performance improvements.

We're also evaluating the following features for future developments:

- [RDF*][rdfstar-blog] (see also [these slides][rdfstar-slides])

[r1]: https://github.com/levelgraph/levelgraph#searches
[r2]: https://github.com/levelgraph/levelgraph#triple-generation
[rdfstar-blog]: https://blog.liu.se/olafhartig/2019/01/10/position-statement-rdf-star-and-sparql-star/
[rdfstar-slides]: http://olafhartig.de/slides/W3CWorkshop2019RDFStarAndSPARQLStar.pdf

### Notes

- uses [Semantic Versioning](https://semver.org), pre-releases are tagged
  accordingly;
- the `production` branch mirrors what is available under the `latest` tag on NPM;
- the `master` branch is the active, development branch;
- requires Node.js >= 10.0.0.

## Usage

### Storage

`quadstore` uses the [`levelup`](https://github.com/level/levelup) package to 
interface with any [LevelDB](http://leveldb.org)-compatible storage backend.

We test `quadstore` using the following backends:

- [`leveldown`](https://github.com/level/leveldown/) for persistent storage
  backed by LevelDB itself
- [`memdown`](https://github.com/level/memdown) for volatile in-memory storage

### Return values

With the exception of RDF/JS interfaces, `quadstore`'s APIs are promise-based
and all methods return objects that include both the actual query results and
relevant metadata such as the sorting criteria used for ordering such results.

```js
const results = await store.get({});
console.log(JSON.stringify(results));
```

```json
{
  "type": "QUADS",
  "items": [
    { "subject":  "a", "predicate": "a", "object": "c", "graph": "d"},
    { "subject":  "a", "predicate": "b", "object": "c", "graph": "d"},
    { "subject":  "b", "predicate": "a", "object": "c", "graph": "d"}
  ],
  "sorting": ["subject", "predicate", "object", "graph"]
} 
```

#### Result types

Objects returned by `quadstore`'s APIs have the `type` property set to one of
the following values:

- `"VOID"` - when there's no data returned by the database, such as with the
  `put` method or `INSERT DATA` SPARQL queries;
- `"QUADS"` - when a query returns a collection of quads;
- `"BINDINGS"` - when a query returns a collection of bindings;
- `"APPROXIMATE_SIZE"` - when a query returns an approximate count of how many
  matching items are present.

#### Streaming vs. non-streaming

For those methods that return objects with the `type` property set to either
`"QUADS"` or `"BINDINGS"`, `quadstore` provides query results either in streaming
mode or in non-streaming mode. 
  
Streaming methods such as `getStream` and `searchStream` return objects with
the `iterator` property set to an instance of [`AsyncIterator`][asynciterator-gh],
a subset of the `stream.Readable` interface. This instance emits either quads
or bindings, depending on the value of the `type` property.

Non-streaming methods such as `get` and `search` return objects with the
`items` property set to an array of either quads or bindings, depending on the
value of the `type` property.

[asynciterator-gh]: https://github.com/RubenVerborgh/AsyncIterator#readme

#### Sorting

All methods returning objects with the `type` property set to either `"QUADS"` or
`"BINDINGS"` also include a `sorting` property set to an array that represents
the sorting criteria by which the database is ordering the provided results. 

### Graph API

#### QuadStore class

    const QuadStore = require('quadstore').QuadStore;
    const store = new QuadStore(opts);

Instantiates a new store. Supported properties for the `opts` argument 
are:

    opts.backend = require('memdown')();    // REQUIRED: level instance
    opts.indexes = [                        // OPTIONAL: custom indexes
        ['subject', 'predicate', 'object', 'graph'],
    ];
    
The `opts.backend` option **must** be an instance of a leveldb backend.

##### Custom indexes

The `opts.indexes` option allows users to configure which indexes will be used
by the store. If not set, the store will default to the following indexes:

```
[
  ['subject', 'predicate', 'object', 'graph'],
  ['object', 'graph', 'subject', 'predicate'],
  ['graph', 'subject', 'predicate', 'object'],
  ['object', 'subject', 'predicate', 'graph'],
  ['predicate', 'object', 'graph', 'subject'],
  ['graph', 'predicate', 'object', 'subject'],
]; 
```

This option, if present, **must** be set to an array of term arrays, each of 
which **must** represent one of the 24 possible permutations of the four terms 
`subject`, `predicate`, `object` and `graph`. Partial indexes are not 
supported.

The store will automatically select which index(es) to use for a given query 
based on the available indexes and the query itself. **If no suitable index is
found for a given query, the store will throw an error**.

#### QuadStore.prototype.get()

    const matchTerms = {graph: 'g'};
    const { items } = await store.get(matchTerms);

Returns an array of all quads within the store matching the specified terms.

##### Range matching

Quadstore supports range-based matching in addition to value-based matching. 
Ranges can be defined using the `gt`, `gte`, `lt`, `lte` properties: 

    const matchTerms = {graph: { gt: 'g' } };
    const { items } = await store.get(matchTerms);

#### QuadStore.prototype.search()

    const pipeline = [
      { type: 'bgp', pattern: {subject: '?s', predicate: 'p1', object: '?o'} },
      { type: 'bgp', pattern: {subject: '?s', predicate: 'p2', object: 'o2'} },
      { type: 'lt', args: ['?o', 'http://example.com/lteBound'] }
    ];
    const { items } = await store.search(pipeline);

Returns an array of all quads within the store matching the specified patterns
and filters. Search methods such as `search()` and `searchStream()` support the
use of variables.

#### QuadStore.prototype.put()

    const quad = {subject: 's', predicate: 'p', object: 'o', graph: 'g'};
    await store.put(quad);

Stores a new quad. Does *not* throw or return an error if the quad already exists.

#### QuadStore.prototype.multiPut()

    const quads = [
        {subject: 's', predicate: 'p', object: 'o', graph: 'g'}
    ];
    await store.multiPut(quads);

Stores new quads. Does *not* throw or return an error if quads already exists.

#### QuadStore.prototype.del()

This method deletes a single quad. It Does *not* throw or return an error if the 
specified quad is not present in the store.

    const quad = {subject: 's', predicate: 'p', object: 'o', graph: 'g'};
    await store.del(quad);
    
#### QuadStore.prototype.multiDel()

This method deletes multiple quads. It Does *not* throw or return an error if
the specified quads are not present in the store.

    const quads = [
        {subject: 's', predicate: 'p', object: 'o', graph: 'g'}
    ];
    await store.multiDel(quads)

#### QuadStore.prototype.patch()

This methods deletes one quad and inserts another quad in a single operation.
It Does *not* throw or return an error if the specified quads are not present
in the store (delete) or already present in the store (update).

    const oldQuad = {subject: 'so', predicate: 'po', object: 'oo', graph: 'go'};
    const newQuads = {subject: 'sn', predicate: 'pn', object: 'on', graph: 'gn'};
    await store.patch(oldQuad, newQuad);
    
#### QuadStore.prototype.multiPatch()

This methods deletes and inserts quads in a single operation. It Does *not* 
throw or return an error if the specified quads are not present in the store 
(delete) or already present in the store (update).

    const oldQuads = [
        {subject: 'so', predicate: 'po', object: 'oo', graph: 'go'}
    ];
    const newQuads = [
        {subject: 'sn', predicate: 'pn', object: 'on', graph: 'gn'}
    ];
    await store.multiPatch(oldQuads, newQUads);

#### QuadStore.prototype.getStream()

    const matchTerms = {graph: 'c'};
    const { iterator } = await store.getStream(matchTerms);

This method supports [range matching](#range-matching). 
See [QuadStore.prototype.get()](#quadstoreprototypeget).

#### QuadStore.prototype.searchStream()

    const pipeline = [
      { type: 'bgp', pattern: {subject: '?s', predicate: 'p1', object: '?o'} },
      { type: 'bgp', pattern: {subject: '?s', predicate: 'p2', object: 'o2'} },
      { type: 'lt', args: ['?o', 'http://example.com/lteBound'] }
    ];
    const { iterator } = await store.searchStream(pipeline);
 
See [QuadStore.prototype.search()](#quadstoreprototypesearch).

#### QuadStore.prototype.putStream()

    await store.putStream(readableStream);

Imports all quads coming through the specified `stream.Readable` into the store.

#### QuadStore.prototype.delStream()

    await store.delStream(readableStream);

Deletes all quads coming through the specified `stream.Readable` from the store.

### RDF Interface

`quadstore` aims to support the 
[RDF/JS](https://github.com/rdfjs/representation-task-force) interface 
specification through the specialized `RdfStore` class, which currently 
implements the `Source`, `Sink` and `Store` interfaces. Additionally, the 
`RdfStore` class also supports `SPARQL` queries.

#### RdfStore class

    const RdfStore = require('quadstore').RdfStore;
    const store = new RdfStore(opts);

Instantiates a new store. The `RdfStore` class extends `QuadStore` and requires
an instance of a leveldb backend as the `opts.backend` argument. In 
addition to all options supported by `QuadStore`, `RdfStore` requires a data factory, e.g. 

    opts.dataFactory = require('@rdf-data-model');  // REQUIRED: instance of RDF/JS' dataFactory 

The `dataFactory` option *must* be an implementation of the
`dataFactory` interface defined in the RDF/JS specification, such as: 

- [@rdfjs/data-model](https://www.npmjs.com/package/@rdfjs/data-model)
- [N3.js' N3.DataFactory](https://www.npmjs.com/package/n3)

Also, `RdfStore` can be configured with a `prefixes` object that defines a
reversible mapping of IRIs to abbreviated forms, with the intention of reducing
the storage cost where common HTTP prefixes are known in advance.

The `prefixes` object defines a bijection using two functions `expandTerm` and
`compactIri`, both of which take a string parameter and return a string, as in
the following example:

    opts.prefixes = {
      expandTerm: term => term.replace(/^ex:/, 'http://example.com/'),
      compactIri: iri => iri.replace(/^http:\/\/example\.com\//, 'ex:')
    }

This will replace the IRI `http://example.com/a` with `ex:a` in storage.

#### Graph API, Quad and Term instances

The `RdfStore` class extends the `QuadStore` class. All methods inherited from
the latter return iterators and/or arrays of `Quad` objects as produced by the
`dataFactory.quad` method (where applicable). 

Matching terms, such as those used in the `get` and `getStream` methods,
must be `Term` objects as produced by the `dataFactory.namedNode`, 
`dataFactory.blankNode` or `dataFactory.literal` methods.

Search methods such as `search` and `searchStream` support the use of variables
via RDF/JS' `Variable` interface as implemented by `dataFactory.variable()`.

#### RDF range matching

The RdfStore class inherits support  for [range-based matching](#range-matching), 
with ranges defined using `Term` instances as produced by `dataFactory.namedNode`, 
`dataFactory.literal` and `dataFactory.blankNode`.

Furthermore, values for literal terms with the following numeric datatypes are
expressed and matched according to their numerical values rather than their 
string representations:

```
http://www.w3.org/2001/XMLSchema#integer
http://www.w3.org/2001/XMLSchema#double
http://www.w3.org/2001/XMLSchema#decimal
```

This is also the case for terms with the following date/time datatypes:

```
http://www.w3.org/2001/XMLSchema#dateTime
```

#### RdfStore.prototype.sparql()

The `sparql()` method provides support for non-streaming SPARQL queries.
Objects returned by `sparql()` have their `type` property set to different
values depending on each specific query:

- `SELECT` queries will result in objects having their `type` property 
  set to `"BINDINGS"`;
- `CONSTRUCT` queries will result in objects objects having their `type`
  property set to `"QUADS"`;
- `UPDATE` queries such as `INSERT DATA`, `DELETE DATA` and 
  `INSERT/DELETE WHERE` will result in objects having their `type` property set
  to `"VOID"`.
  
```js
const { type, items } = await store.sparql(`
  SELECT * WHERE { ?s <ex://knows> <ex://alice> . }
`);
```

The `sparql()` also accepts an optional `opts` parameter with the following
properties:

- `opts.defaultGraphMode`: this can be set to either `default` or `merge` and
  allows client to specify whether the default graph used in queries should be
  the actual default graph or the union of all graphs present in the database.
  
We're using the [`rdf-test-suite`][rdf-test-suite-npm] package to validate our
support for SPARQL queries against official test suites published by the W3C.

We're currently testing against the following manifests:

- [SPARQL 1.0][w3c-sparql10-manifest]: 219/438 tests passing (`npm run test-rdf:sparql10`)
- [SPARQL 1.1][w3c-sparql11-manifest]: 84/271 tests passing (`npm run test-rdf:sparql11`,
limited to the [SPARQL 1.1 Query spec][w3c-sparql11-query-spec])

[w3c-sparql10-manifest]: https://w3c.github.io/rdf-tests/sparql11/data-r2/manifest.ttl
[w3c-sparql11-manifest]: https://w3c.github.io/rdf-tests/sparql11/data-sparql11/manifest-all.ttl
[w3c-sparql11-query-spec]: http://www.w3.org/TR/sparql11-query/
[rdf-test-suite-npm]: https://www.npmjs.com/package/rdf-test-suite
  
#### RdfStore.prototype.sparqlStream()

The `sparqlStream()` method provides support for streaming SPARQL queries.
Objects returned by `sparqlStream()` have their `type` property set to
different values depending on each specific query, as for `sparql()`.

```js
const { iterator } = await store.sparqlStream(`
  SELECT * WHERE { ?s <ex://knows> <ex://alice> . }
`);
```

#### RdfStore.prototype.match()

    const subject = dataFactory.namedNode('http://example.com/subject');
    const graph = dataFactory.namedNode('http://example.com/graph');
    store.match(subject, null, null, graph)
      .on('error', (err) => {})
      .on('data', (quad) => {
        // Quad is produced using dataFactory.quad()
      })
      .on('end', () => {});

Returns an [RDF/JS stream](http://rdf.js.org/stream-spec/#stream-interface) 
stream of `Quad` instances matching the provided terms.
Supports [range-based matching](#rdf-range-matching).
   
See [QuadStore.prototype.get()](#quadstoreprototypeget).

#### RdfStore.prototype.import()

    const readableStream; // A stream.Readable of Quad() instances
    store.import(readableStream)
      .on('error', (err) => {})
      .on('end', () => {});

Consumes the stream storing each incoming quad.

#### RdfStore.prototype.remove()

    const readableStream; // A stream.Readable of Quad() instances
    store.remove(readableStream)
      .on('error', (err) => {})
      .on('end', () => {});

Consumes the stream removing each incoming quad.

#### RdfStore.prototype.removeMatches()

    const subject = dataFactory.namedNode('http://example.com/subject');
    const graph = dataFactory.namedNode('http://example.com/graph');
    store.removeMatches(subject, null, null, graph)
      .on('error', (err) => {})
      .on('end', () => {});

Removes all quads matching the provided terms.
Supports [range-based matching](#rdf-range-matching).

## Browser usage

The [`level-js`](https://github.com/Level/level-js) backend for levelDB offers
support for browser-side persistent storage. Any modern build system / bundler
should be able to work with Quadstore. Support for tree-shaking will come when
we figure out a way to [build an ES version][issues-97].

[issues-97]: https://github.com/beautifulinteractions/node-quadstore/issues/97 

## Performance

Although we've yet to develop proper benchmarks, we do keep an eye on write
speeds by often importing the entire [`21million.rdf`][21mil-rdf] file or a
subset of it.

The testing platform is a 2018 MacBook Pro (Intel Core i7 2.6 Ghz, SSD storage) 
running Node v14.0.0.
 
With the default six indexes and the `leveldown` backend, the `RdfStore` class
clocks at **~15k quads per second** when importing quads one-by-one and at 
**~18k quads per second** when importing quads in batches, with a density of
**~4k quads per MB**. 

    node perf/loadfile.js /path/to/21million.rdf
    
[21mil-rdf]: https://github.com/dgraph-io/benchmarks/blob/master/data/21million.rdf.gz
 
## LICENSE

MIT. See [LICENSE.md](./LICENSE.md).
