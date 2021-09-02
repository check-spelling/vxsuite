import { strict as assert } from 'assert'
import { EventEmitter } from 'events'
import * as json from '../json-serialization'
import { WorkerOps } from './types'

export class InlineWorkerOps<I, O> implements WorkerOps<I, EventEmitter> {
  private workerInstance: EventEmitter

  public constructor(private readonly call: (input: I) => Promise<O>) {
    this.workerInstance = new EventEmitter()
  }

  public start(): EventEmitter {
    return this.workerInstance
  }

  public stop(worker: EventEmitter): void {
    assert.strictEqual(worker, this.workerInstance)
    worker.removeAllListeners()
  }

  public async send(worker: EventEmitter, message: I): Promise<void> {
    assert.strictEqual(worker, this.workerInstance)
    try {
      const output = await this.call(
        json.deserialize(json.serialize(message)) as I
      )
      worker.emit('message', { output: json.serialize(output) })
    } catch (error) {
      worker.emit('error', error)
    }
  }

  public describe(): string {
    return 'Worker { inline: true }'
  }
}