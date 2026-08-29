import {EventEmitter} from '../eventemitter.mjs';
import {MP3AudioEncoder} from './MP3Encoder.mjs';
import {MP4Demuxer, WebMDemuxer} from '../reencoder/demuxers.mjs';
import {BlobManager} from '../../utils/BlobManager.mjs';
import {DownloadStatus} from '../../enums/DownloadStatus.mjs';
import {ReferenceTypes} from '../../enums/ReferenceTypes.mjs';

/**
 * High-performance Audio Extractor and MP3 Converter
 */
export class AudioExtractor extends EventEmitter {
  constructor(registerCancel) {
    super();
    this.cancelled = false;
    if (registerCancel) {
      registerCancel(() => {
        this.cancelled = true;
      });
    }
  }

  cancel() {
    this.cancelled = true;
  }

  /**
   * Extract audio directly from an ArrayBuffer / Blob using Web Audio API
   * @param {Blob|ArrayBuffer} audioData
   * @param {number} [kbps=192]
   * @param {Function} [onProgress]
   * @return {Promise<Blob>}
   */
  async extractFromBuffer(audioData, kbps = 192, onProgress = null) {
    if (this.cancelled) throw new Error('Cancelled');

    let arrayBuffer;
    if (audioData instanceof Blob) {
      arrayBuffer = await BlobManager.getDataFromBlob(audioData, 'arraybuffer');
    } else {
      arrayBuffer = audioData;
    }

    if (this.cancelled) throw new Error('Cancelled');

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      if (this.cancelled) throw new Error('Cancelled');

      const sampleRate = audioBuffer.sampleRate;
      const numChannels = Math.min(2, audioBuffer.numberOfChannels);
      const encoder = new MP3AudioEncoder({
        channels: numChannels,
        sampleRate: sampleRate,
        kbps: kbps,
      });

      const leftChannel = audioBuffer.getChannelData(0);
      const rightChannel = numChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;

      const chunkSize = 1152 * 8;
      const totalSamples = leftChannel.length;

      for (let i = 0; i < totalSamples; i += chunkSize) {
        if (this.cancelled) throw new Error('Cancelled');

        const end = Math.min(i + chunkSize, totalSamples);
        const lSlice = leftChannel.subarray(i, end);
        const rSlice = rightChannel.subarray(i, end);
        encoder.encode(lSlice, rSlice);

        const progress = end / totalSamples;
        this.emit('progress', progress);
        if (onProgress) onProgress(progress);

        // Yield to event loop to keep Kiwi UI silky smooth
        if (i % (chunkSize * 8) === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      return encoder.finish();
    } finally {
      audioCtx.close().catch(() => {});
    }
  }

  /**
   * Extract audio from HLS / DASH stream fragments via WebCodecs AudioDecoder + MP3 Encoder
   * @param {Object} options
   * @return {Promise<Blob>}
   */
  async extractFromFragments({
    audioMimeType,
    audioDuration,
    audioInitSegment,
    fragments,
    kbps = 192,
    onProgress = null,
  }) {
    if (this.cancelled) throw new Error('Cancelled');

    const demuxer = (audioMimeType && audioMimeType.includes('webm')) ? new WebMDemuxer() : new MP4Demuxer();
    if (audioInitSegment) {
      demuxer.initialize(audioInitSegment);
    }

    let encoder = null;
    let audioDecoder = null;
    let decodeError = null;

    try {
      // Decode audio fragments using AudioDecoder
      const pcmChunks = [];
      let sampleRate = 44100;
      let channels = 2;

      audioDecoder = new AudioDecoder({
        output: (audioData) => {
          sampleRate = audioData.sampleRate;
          channels = Math.min(2, audioData.numberOfChannels);

          if (!encoder) {
            encoder = new MP3AudioEncoder({
              channels: channels,
              sampleRate: sampleRate,
              kbps: kbps,
            });
          }

          const format = audioData.format;
          const numFrames = audioData.numberOfFrames;

          if (format.startsWith('f32')) {
            const left = new Float32Array(numFrames);
            audioData.copyTo(left, {planeIndex: 0, format: 'f32-planar'});
            let right = left;
            if (channels > 1) {
              right = new Float32Array(numFrames);
              audioData.copyTo(right, {planeIndex: 1, format: 'f32-planar'});
            }
            encoder.encode(left, right);
          } else {
            const left = new Int16Array(numFrames);
            audioData.copyTo(left, {planeIndex: 0, format: 's16-planar'});
            let right = left;
            if (channels > 1) {
              right = new Int16Array(numFrames);
              audioData.copyTo(right, {planeIndex: 1, format: 's16-planar'});
            }
            encoder.encode(left, right);
          }

          audioData.close();
        },
        error: (e) => {
          console.error('AudioDecoder error:', e);
          decodeError = e;
        },
      });

      let decoderConfigured = false;

      for (let i = 0; i < fragments.length; i++) {
        if (this.cancelled) throw new Error('Cancelled');

        const fragData = fragments[i];
        const entry = await fragData.getEntry();
        const blob = await entry.getData();
        const data = await BlobManager.getDataFromBlob(blob, 'arraybuffer');

        demuxer.appendBuffer(data);

        if (!decoderConfigured) {
          const config = demuxer.getAudioDecoderConfig();
          if (config) {
            const support = await AudioDecoder.isConfigSupported(config);
            if (support) {
              audioDecoder.configure(config);
              decoderConfigured = true;
            }
          }
        }

        if (decoderConfigured) {
          const chunks = demuxer.getAudioChunks();
          demuxer.clearChunks();
          for (const chunk of chunks) {
            audioDecoder.decode(chunk);
          }
        }

        const progress = (i + 1) / fragments.length;
        this.emit('progress', progress * 0.95);
        if (onProgress) onProgress(progress * 0.95);

        if (i % 4 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (decoderConfigured && audioDecoder.state === 'configured') {
        const remaining = demuxer.getAudioChunks(audioDuration);
        for (const chunk of remaining) {
          audioDecoder.decode(chunk);
        }
        await audioDecoder.flush();
      }

      if (decodeError) {
        throw decodeError;
      }

      if (!encoder) {
        encoder = new MP3AudioEncoder({channels: 2, sampleRate: 44100, kbps: kbps});
      }

      const mp3Blob = encoder.finish();
      this.emit('progress', 1.0);
      if (onProgress) onProgress(1.0);
      return mp3Blob;
    } finally {
      if (audioDecoder && audioDecoder.state !== 'closed') {
        audioDecoder.close();
      }
    }
  }
}
