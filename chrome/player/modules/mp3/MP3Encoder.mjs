import {Mp3Encoder} from './lame.mjs';

/**
 * Standard MP3 Audio Encoder
 */
export class MP3AudioEncoder {
  /**
   * @param {Object} options
   * @param {number} [options.channels=2]
   * @param {number} [options.sampleRate=44100]
   * @param {number} [options.kbps=192]
   */
  constructor(options = {}) {
    this.channels = options.channels || 2;
    this.sampleRate = options.sampleRate || 44100;
    this.kbps = options.kbps || 192;
    this.encoder = new Mp3Encoder(this.channels, this.sampleRate, this.kbps);
    this.chunks = [];
  }

  /**
   * Convert Float32Array PCM [-1.0, 1.0] to Int16Array [-32768, 32767]
   * @param {Float32Array} float32
   * @return {Int16Array}
   */
  static floatToInt16(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      let s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  /**
   * Encode planar or interleaved PCM audio
   * @param {Float32Array|Int16Array} leftChannel
   * @param {Float32Array|Int16Array} [rightChannel]
   */
  encode(leftChannel, rightChannel) {
    const left = leftChannel instanceof Float32Array ? MP3AudioEncoder.floatToInt16(leftChannel) : leftChannel;
    const right = rightChannel ? (rightChannel instanceof Float32Array ? MP3AudioEncoder.floatToInt16(rightChannel) : rightChannel) : left;

    const mp3Buf = this.encoder.encodeBuffer(left, right);
    if (mp3Buf && mp3Buf.length > 0) {
      this.chunks.push(mp3Buf);
    }
  }

  /**
   * Finalize and return standard .mp3 Blob
   * @return {Blob}
   */
  finish() {
    const last = this.encoder.flush();
    if (last && last.length > 0) {
      this.chunks.push(last);
    }
    const blob = new Blob(this.chunks, {type: 'audio/mp3'});
    this.chunks = [];
    return blob;
  }
}
