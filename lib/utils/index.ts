import {TSReadable, TermName} from '../types';
import {EventEmitter} from 'events';
import {nanoid} from './nanoid.js';
import {TransformIterator} from 'asynciterator';
import {flatMap} from './flatmap.js';
import {pReduce} from './p-reduce';
import {AbstractLevelDOWN} from 'abstract-leveldown';
import {DataFactory} from 'rdf-js';

export const termNames: TermName[] = [
  TermName.SUBJECT,
  TermName.PREDICATE,
  TermName.OBJECT,
  TermName.GRAPH,
];

export const isFunction = (f: any): boolean => {
  return typeof(f) === 'function';
};

export const isObject = (o: any): boolean => {
  return typeof(o) === 'object' && o !== null;
};

export const isNil = (n: any): boolean => {
  return n === null || n === undefined;
};

export const streamToArray = <T>(readStream: TSReadable<T>): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    const chunks: T[] = [];
    readStream
      .on('data', (chunk) => { chunks.push(chunk); })
      .on('end', () => { resolve(chunks); })
      .on('error', (err) => { reject(err); });
  });
}

export const isReadableStream = (obj: any): obj is TSReadable<any> => {
  return isObject(obj)
    && isFunction(obj.on)
    && isFunction(obj.read);
}

export const isAbstractLevelDOWNInstance = (obj: any): obj is AbstractLevelDOWN => {
  return isObject(obj)
    && isFunction(obj.put)
    && isFunction(obj.del)
    && isFunction(obj.batch);
}

export const isDataFactory = (obj: any): obj is DataFactory => {
  return (isObject(obj) || isFunction(obj))
    && isFunction(obj.literal)
    && isFunction(obj.defaultGraph)
    && isFunction(obj.blankNode)
    && isFunction(obj.namedNode)
    && isFunction(obj.variable)
    && isFunction(obj.triple)
    && isFunction(obj.quad);
}

export const resolveOnEvent = (emitter: EventEmitter, event: string, rejectOnError?: boolean): Promise<any> => {
  return new Promise((resolve, reject) => {
    emitter.on(event, resolve);
    if (rejectOnError) {
      emitter.on('error', reject);
    }
  });
}

export const waitForEvent = resolveOnEvent;

export const defaultIndexes: TermName[][] = [
  [TermName.SUBJECT, TermName.PREDICATE, TermName.OBJECT, TermName.GRAPH],
  [TermName.OBJECT, TermName.GRAPH, TermName.SUBJECT, TermName.PREDICATE],
  [TermName.GRAPH, TermName.SUBJECT, TermName.PREDICATE, TermName.OBJECT],
  [TermName.OBJECT, TermName.SUBJECT, TermName.PREDICATE, TermName.GRAPH],
  [TermName.PREDICATE, TermName.OBJECT, TermName.GRAPH, TermName.SUBJECT],
  [TermName.GRAPH, TermName.PREDICATE, TermName.OBJECT, TermName.SUBJECT],
];

export { nanoid };

class BatchingIterator<T> extends TransformIterator<T, T> {

  constructor(source: TSReadable<T>, batchSize: number, onEachBatch: (items: T[]) => Promise<void>) {

    // @ts-ignore
    super(source);

    let ind = 0;
    const buf = new Array(batchSize);

    this._transform = (item: T, done: () => void) => {
      buf[ind++] = item;
      if (ind < batchSize) {
        done();
        return;
      }
      ind = 0;
      onEachBatch(buf).then(done.bind(null, null)).catch(done);
    };

    this._flush = (done: () => void) => {
      if (ind === 0) {
        done();
        return;
      }
      onEachBatch(buf.slice(0, ind)).then(done.bind(null, null)).catch(done);
    };

  }

}

export const consumeInBatches = async <T>(iterator: TSReadable<T>, batchSize: number, onEachBatch: (items: T[]) => Promise<any>) => {
  return new Promise((resolve, reject) => {
    new BatchingIterator(iterator, batchSize, onEachBatch)
      .on('end', resolve)
      .on('error', reject);
  });
};

export const consumeOneByOne = async <T>(iterator: TSReadable<T>, onEachItem: (item: T) => Promise<any>) => {
  return new Promise<void>((resolve, reject) => {
    let ended = false;
    let waiting = false;
    let working = false;
    const loop = () => {
      working = false;
      waiting = false;
      const item = iterator.read();
      if (item === null) {
        if (ended) {
          resolve();
        } else {
          waiting = true;
          iterator.once('readable', loop);
        }
        return;
      }
      working = true;
      Promise.resolve(onEachItem(item)).then(loop).catch(reject);
    };
    iterator.once('end', () => {
      ended = true;
      if (waiting) {
        iterator.removeListener('readable', loop);
        resolve();
      }
      if (!working) {
        resolve();
      }
    });
    loop();
  });
};

export { flatMap };
export { pReduce };

export const pFromCallback = <T>(fn: (cb: (err: Error|undefined|null, val?: T) => void) => void): Promise<T|undefined> => {
  return new Promise((resolve, reject) => {
    fn((err: Error|undefined|null, val?: T) => {
      err ? reject(err) : resolve(val);
    });
  });
};

export const emptyArray: any[] = [];
export const emptyObject: { [key: string]: any } = {};

