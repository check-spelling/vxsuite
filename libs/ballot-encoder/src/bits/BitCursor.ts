import { Uint8Size, Uint8, Uint1, Uint8Index } from './types';
import { makeMasks } from './utils';

export default class BitCursor {
  private offset = 0;

  next(): this {
    return this.advance(1);
  }

  prev(): this {
    return this.advance(-1);
  }

  advance(bitOffset: number): this {
    this.offset += bitOffset;
    return this;
  }

  set(offset: number): this {
    this.offset = offset;
    return this;
  }

  get isByteStart(): boolean {
    return this.offset % Uint8Size === 0;
  }

  get combinedBitOffset(): number {
    return this.offset;
  }

  get bitOffset(): Uint8Index {
    if (this.offset < 0) {
      return (Uint8Size - (-this.offset % Uint8Size)) as Uint8Index;
    }
    return (this.offset % Uint8Size) as Uint8Index;
  }

  get byteOffset(): number {
    return (this.offset - this.bitOffset) / Uint8Size;
  }

  mask(bit: Uint1 = 1): Uint8 {
    return bit ? BitCursor.uint8Masks[this.bitOffset] : 0;
  }

  copy(): BitCursor {
    return new BitCursor().set(this.combinedBitOffset);
  }

  static uint8Masks: readonly [
    Uint8,
    Uint8,
    Uint8,
    Uint8,
    Uint8,
    Uint8,
    Uint8,
    Uint8
  ] = makeMasks(Uint8Size) as [
    Uint8,
    Uint8,
    Uint8,
    Uint8,
    Uint8,
    Uint8,
    Uint8,
    Uint8
  ];
}
