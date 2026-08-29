import {EventEmitter} from '../eventemitter.mjs';
import {FSBlob} from '../FSBlob.mjs';
import {BlobManager} from '../../utils/BlobManager.mjs';
import {Muxer, StreamTarget} from './mp4-muxer.mjs';
import {MP4Demuxer, WebMDemuxer} from './demuxers.mjs';
import {Localize} from '../Localize.mjs';
import {AlertPolyfill} from '../../utils/AlertPolyfill.mjs';

const KEYFRAME_INTERVAL = 10 * 1000 * 1000; // 10 seconds
/**
 * Recode Merger
 *
 * Re-encodes video and audio to MP4. Can be very slow.
 *
 * Currently supports WebM input only.
 *
 * REQUIRES WebCodecs. Not supported in Firefox.
 */
export class Reencoder extends EventEmitter {
  constructor(registerCancel, registerPause) {
    super();
    this.blobManager = new FSBlob();
    this.isPaused = false;
    if (registerCancel) {
      registerCancel(() => {
        this.cancel();
      });
    }
    if (registerPause) {
      registerPause((shouldPause) => {
        if (shouldPause) {
          this.pause();
        } else {
          this.resume();
        }
      });
    }
  }

  cancel() {
    this.cancelled = true;
  }

  pause() {
    this.isPaused = true;
    this.emit('pause');
  }

  resume() {
    this.isPaused = false;
    this.emit('resume');
  }

  arrayEquals(a, b) {
    let i;

    if (a.length !== b.length) {
      return false;
    } // compare the value of each element in the array


    for (i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }

    return true;
  }

  async pushFragment(fragData, demuxer) {
    const entry = await fragData.getEntry();
    const blob = await entry.getData();
    const data = await BlobManager.getDataFromBlob(blob, 'arraybuffer');

    demuxer.appendBuffer(data);
    const videoChunks = demuxer.getVideoChunks();
    const audioChunks = demuxer.getAudioChunks();
    demuxer.clearChunks();

    videoChunks.forEach((chunk) => {
      this.videoDecoder.decode(chunk);
    });

    audioChunks.forEach((chunk) => {
      this.audioDecoder.decode(chunk);
    });

    const waitEncodePromise = new Promise((resolve) => {
      this.resolveRecodePromise = resolve;
    });

    await waitEncodePromise;

    if (this.videoEncoder) {
      if (
        this.videoEncoder.state !== 'configured' ||
        this.videoDecoder.state !== 'configured'
      ) {
        throw new Error('Video encoder/decoder has been closed!');
      }
    }

    if (this.audioEncoder) {
      if (
        this.audioEncoder.state !== 'configured' ||
        this.audioDecoder.state !== 'configured' ||
        !this.resamplerWorker
      ) {
        throw new Error('Audio encoder/decoder/resampler has been closed!');
      }
    }

    if (!this.videoEncoder && !this.audioEncoder) {
      throw new Error('No video or audio encoder');
    }
  }

  async setup(videoMimeType, videoDuration, videoInitSegment, audioMimeType, audioDuration, audioInitSegment, transcodeOptions = {}, isPreinitialized = false) {
    if (!videoDuration && !audioDuration) {
      throw new Error('no video or audio');
    }

    let videoOutput;
    let audioOutput;
    if (videoDuration && !isPreinitialized) {
      this.videoDuration = videoDuration;
      this.videoDemuxer = videoMimeType.includes('webm') ? new WebMDemuxer() : new MP4Demuxer();
      if (videoInitSegment) {
        this.videoDemuxer.initialize(videoInitSegment);
      }
    }

    const requeue = (e) => {
      if (this.audioEncoder) {
        if (this.audioDecoder.decodeQueueSize >= 10) {
          return;
        }

        if (this.audioEncoder.encodeQueueSize >= 10) {
          return;
        }

        if (this.resamplerWorkerTasks >= 500) {
          return;
        }
      }

      if (this.videoEncoder) {
        if (this.videoDecoder.decodeQueueSize >= 10) {
          return;
        }

        if (this.videoEncoder.encodeQueueSize >= 10) {
          return;
        }
      }

      if (this.resolveRecodePromise) {
        this.resolveRecodePromise();
        this.resolveRecodePromise = null;
      }
    };

    if (this.videoDemuxer && this.videoDemuxer.getVideoDecoderConfig()) {
      const decoderConfig = this.videoDemuxer.getVideoDecoderConfig();
      const sourceWidth = decoderConfig.codedWidth || decoderConfig.displayAspectWidth || 1920;
      const sourceHeight = decoderConfig.codedHeight || decoderConfig.displayAspectHeight || 1080;

      let targetWidth = sourceWidth;
      let targetHeight = sourceHeight;
      let targetBitrate = transcodeOptions.targetBitrate;

      if (transcodeOptions.targetHeight && transcodeOptions.targetHeight < sourceHeight) {
        targetHeight = transcodeOptions.targetHeight;
        targetWidth = Math.round((sourceWidth * (targetHeight / sourceHeight)) / 2) * 2;
      }

      if (!targetBitrate) {
        if (targetHeight >= 1080) targetBitrate = 4800000;
        else if (targetHeight >= 720) targetBitrate = 2500000;
        else if (targetHeight >= 480) targetBitrate = 1200000;
        else if (targetHeight >= 360) targetBitrate = 700000;
        else targetBitrate = 1500000;
      }

      const candidateCodecs = [
        'avc1.42e01f', // Constrained Baseline Profile (broadest mobile hardware support)
        'avc1.4d001f', // Main Profile Level 3.1
        'avc1.4d002a', // Main Profile Level 4.2
        'avc1.4d003e', // Main Profile Level 6.2
        'avc1.64001f', // High Profile Level 3.1
        'avc1.640028', // High Profile Level 4.0
      ];

      let encoderConfig = null;
      for (const candidate of candidateCodecs) {
        const testConfig = {
          codec: candidate,
          width: targetWidth,
          height: targetHeight,
          bitrate: targetBitrate,
        };
        try {
          const res = await VideoEncoder.isConfigSupported(testConfig);
          if (res && res.supported) {
            encoderConfig = testConfig;
            break;
          }
        } catch (e) {}
      }

      if (!encoderConfig) {
        encoderConfig = {
          codec: 'avc1.42e01f',
          width: targetWidth,
          height: targetHeight,
          bitrate: targetBitrate,
        };
      }

      console.log('Video decoder config: ', decoderConfig);
      console.log('Video encoder config (downsampled): ', encoderConfig);

      videoOutput = {
        codec: 'avc',
        width: targetWidth,
        height: targetHeight,
      };

      try {
        const support = await VideoDecoder.isConfigSupported(decoderConfig);
        if (support && !support.supported) {
          console.warn('VideoDecoder report not supported for:', decoderConfig);
        }
      } catch (e) {}

      this.needsScale = (targetWidth !== sourceWidth || targetHeight !== sourceHeight);
      if (this.needsScale) {
        this.offscreenCanvas = new OffscreenCanvas(targetWidth, targetHeight);
        this.offscreenCtx = this.offscreenCanvas.getContext('2d', {alpha: false});
      }

      this.lastVideoKeyframe = 0;

      this.videoEncoder = new VideoEncoder({
        output: (chunk, meta) => {
          try {
            this.muxer.addVideoChunk(chunk, meta);
          } catch (err) {
            console.error('Muxer addVideoChunk error:', err);
            this.videoEncoderError = err;
          }
          requeue();
        },
        error: (e) => {
          console.error('VideoEncoder error:', e);
          this.videoEncoderError = e;
          this.videoEncoder?.close();
        },
      });
      this.videoEncoder.configure(encoderConfig);

      this.videoDecoder = new VideoDecoder({
        output: (frame) => {
          const timestamp = frame.timestamp; // frame.timestamp is in microseconds
          let encodeFrame = frame;
          let scaledFrame = null;

          try {
            if (this.needsScale && this.offscreenCtx) {
              this.offscreenCtx.drawImage(frame, 0, 0, targetWidth, targetHeight);
              scaledFrame = new VideoFrame(this.offscreenCanvas, {
                timestamp: timestamp,
                duration: frame.duration || 0,
              });
              encodeFrame = scaledFrame;
            }

            if (timestamp - this.lastVideoKeyframe > KEYFRAME_INTERVAL) {
              this.lastVideoKeyframe = timestamp;
              this.videoEncoder.encode(encodeFrame, {keyFrame: true});
            } else {
              this.videoEncoder.encode(encodeFrame);
            }
          } catch (err) {
            console.error('Frame scale/encode error:', err);
            this.videoDecoderError = err;
          } finally {
            frame.close();
            if (scaledFrame) {
              scaledFrame.close();
            }
          }
          requeue();
        },
        error: (e) => {
          console.error('VideoDecoder error:', e);
          this.videoDecoderError = e;
          this.videoDecoder?.close();
        },
      });
      this.videoDecoder.configure(decoderConfig);
    }

    const videoHasAudio = this.videoDemuxer && this.videoDemuxer.getAudioDecoderConfig();
    if (audioDuration && !isPreinitialized) {
      if (videoHasAudio) {
        throw new Error('Video already has audio');
      }

      this.audioDuration = audioDuration;
      this.audioDemuxer = (audioMimeType && audioMimeType.includes('webm')) ? new WebMDemuxer() : new MP4Demuxer();
      if (audioInitSegment) {
        this.audioDemuxer.initialize(audioInitSegment);
      }
    }

    if (videoHasAudio || (this.audioDemuxer && this.audioDemuxer.getAudioDecoderConfig())) {
      const decoderConfig = this.audioDemuxer ? this.audioDemuxer.getAudioDecoderConfig() : this.videoDemuxer.getAudioDecoderConfig();

      if (decoderConfig) {
        audioOutput = {
          codec: 'aac',
          sampleRate: decoderConfig.sampleRate || 44100,
          numberOfChannels: decoderConfig.numberOfChannels || 2,
        };
      }

      // If NOT preinitialized (e.g. WebM conversion), setup audio decoder/encoder/resampler
      if (!isPreinitialized) {
        const encoderConfig = {
          codec: 'mp4a.40.2',
          sampleRate: 44100,
          numberOfChannels: decoderConfig.numberOfChannels,
        };

        const support = await AudioDecoder.isConfigSupported(decoderConfig);
        if (!support) {
          throw new Error('unsupported input audio codec');
        }

        const support2 = await AudioEncoder.isConfigSupported(encoderConfig);
        if (!support2) {
          throw new Error('unsupported output audio codec');
        }

        this.lastAudioKeyframe = 0;
        this.audioEncoder = new AudioEncoder({
          output: (chunk, meta) => {
            this.muxer.addAudioChunk(chunk, meta);
            requeue();
          },
          error: (e) => {
            console.error(e);
            this.audioEncoder.close();
          },
        });
        this.audioEncoder.configure(encoderConfig);

        const currentScript = import.meta;
        let basePath = '';
        if (currentScript) {
          basePath = currentScript.url
              .replace(/#.*$/, '')
              .replace(/\?.*$/, '')
              .replace(/\/[^\/]+$/, '/');
        }
        this.resamplerWorker = new Worker(basePath + 'resampler-worker.mjs', {
          type: 'module',
        });

        this.resamplerWorkerTasks = 0;
        this.resamplerWorker.postMessage({
          type: 'init',
          oldSampleRate: decoderConfig.sampleRate,
          newSampleRate: encoderConfig.sampleRate,
          numChannels: decoderConfig.numberOfChannels,
        });

        this.resamplerWorker.addEventListener('message', (event) => {
          const data = event.data;
          if (data.type === 'resampled') {
            this.resamplerWorkerTasks--;

            const frame = data.data;
            const timestamp = frame.timestamp; // frame.timestamp is in microseconds
            if (timestamp - this.lastAudioKeyframe > KEYFRAME_INTERVAL) {
              this.lastAudioKeyframe = timestamp;
              this.audioEncoder.encode(frame, {keyFrame: true});
            } else {
              this.audioEncoder.encode(frame);
            }

            requeue();

            if (this.resamplerWorkerTasks === 0 && this.resamplerWorkerPromiseResolve) {
              this.resamplerWorkerPromiseResolve();
              this.resamplerWorkerPromiseResolve = null;
            }
          }
        });

        this.resamplerWorker.addEventListener('error', (e) => {
          console.error(e);
          this.resamplerWorker.terminate();
          this.resamplerWorker = null;
        });

        this.audioDecoder = new AudioDecoder({
          output: (data) => {
            this.resamplerWorkerTasks++;
            this.resamplerWorker.postMessage({
              type: 'pushSample',
              data: data,
            }, [data]);

            requeue();
          },
          error: (e) => {
            console.error(e);
            this.audioDecoder.close();
          },
        });
        this.audioDecoder.configure(decoderConfig);
      }
    }
    this.chunks = [];
    // 16mb
    const chunkSize = 16 * 1024 * 1024;

    this.muxer = new Muxer({
      fastStart: 'fragmented',
      firstTimestampBehavior: 'cross-track-offset',
      video: videoOutput,
      audio: audioOutput,

      // target: new ArrayBufferTarget(),
      //   fastStart: 'in-memory',
      target: new StreamTarget({
        onData: (data, position) => { // Store in memory until full, then write to disk
          const startPos = position;
          const endPos = position + data.byteLength;
          const startChunk = Math.floor(startPos / chunkSize);
          const endChunk = Math.floor((endPos - 1) / chunkSize);

          for (let i = startChunk; i <= endChunk; i++) {
            let chunk = this.chunks[i];
            if (!chunk) {
              chunk = {
                filledRanges: [],
                data: new Uint8Array(chunkSize),
                flushed: false,
              };
              this.chunks[i] = chunk;
            }

            if (chunk.flushed) {
              throw new Error('chunk already flushed');
            }

            const start = Math.max(startPos, i * chunkSize);
            const end = Math.min(endPos, (i + 1) * chunkSize);
            const offset = start - i * chunkSize;
            const length = end - start;

            chunk.data.set(data.subarray(start - startPos, end - startPos), offset);
            chunk.filledRanges.push([offset, offset + length]);

            // Merge filled ranges
            const newFilledRanges = [];
            const ranges = chunk.filledRanges;
            let last;
            ranges.sort(function(a, b) {
              return a[0]-b[0] || a[1]-b[1];
            });
            ranges.forEach(function(r) {
              if (!last || r[0] > last[1]) {
                newFilledRanges.push(last = r);
              } else if (r[1] > last[1]) {
                last[1] = r[1];
              }
            });
            chunk.filledRanges = newFilledRanges;

            // Check if chunk is full
            if (chunk.filledRanges.length === 1 && chunk.filledRanges[0][0] === 0 && chunk.filledRanges[0][1] === chunkSize) {
              chunk.data = this.blobManager.createBlob(chunk.data);
              chunk.flushed = true;
            }
          }
        },
      }),
    });
  }

  async finalize(skipDemuxerFlush = false) {
    if (this.audioDecoder) {
      if (this.audioDemuxer && !skipDemuxerFlush) {
        const left = this.audioDemuxer.getAudioChunks(this.audioDuration);
        left.forEach((chunk) => {
          this.audioDecoder.decode(chunk);
        });
      }

      await this.audioDecoder.flush();
      await this.audioEncoder.flush();
    }

    if (this.videoDecoder) {
      if (this.videoDemuxer && !skipDemuxerFlush) {
        const left = this.videoDemuxer.getVideoChunks(this.videoDuration);
        left.forEach((chunk) => {
          this.videoDecoder.decode(chunk);
        });
      }

      await this.videoDecoder.flush();
      await this.videoEncoder.flush();
    }

    this.muxer.finalize();

    // Check empty chunks
    for (let i = 0; i < this.chunks.length; i++) {
      if (!this.chunks[i]) {
        throw new Error('empty chunk');
      }
    }

    const dataChunks = await Promise.all(this.chunks.map((chunk, i) => {
      if (chunk.flushed) {
        return this.blobManager.getBlob(chunk.data);
      } else if (i === this.chunks.length - 1) {
        // Last chunk
        // Find size
        const end = chunk.filledRanges[chunk.filledRanges.length - 1][1];
        return chunk.data.slice(0, end);
      } else {
        throw new Error('chunk not flushed');
      }
    }));

    return new Blob(dataChunks, {
      type: 'video/mp4',
    });
  }

  async convertMP4Blob(mp4Blob, transcodeOptions = {}, onProgress = null) {
    if (!window.VideoDecoder || !window.VideoEncoder) {
      throw new Error('WebCodecs not supported');
    }

    const arrayBuffer = await BlobManager.getDataFromBlob(mp4Blob, 'arraybuffer');
    if (this.cancelled) throw new Error('Cancelled');

    this.videoDemuxer = new MP4Demuxer();
    this.videoDemuxer.initialize(arrayBuffer);

    const decoderConfig = this.videoDemuxer.getVideoDecoderConfig();
    if (!decoderConfig) {
      return mp4Blob;
    }

    const duration = (this.videoDemuxer.info?.duration && this.videoDemuxer.info?.timescale) ?
      (this.videoDemuxer.info.duration / this.videoDemuxer.info.timescale) : 0;
    this.videoDuration = duration;

    await this.setup('video/mp4', duration, null, null, 0, null, transcodeOptions, true);

    const videoChunks = this.videoDemuxer.getVideoChunks(duration);
    const audioChunks = this.videoDemuxer.getAudioChunks(duration);
    console.log(`[Reencoder] Starting downsampling: ${videoChunks.length} video chunks, ${audioChunks.length} audio chunks, duration: ${duration}s`);

    if (audioChunks && audioChunks.length > 0) {
      for (const chunk of audioChunks) {
        this.muxer.addAudioChunk(chunk);
      }
    }

    const totalChunks = videoChunks.length || 1;
    let processed = 0;

    for (let i = 0; i < videoChunks.length; i++) {
      while (this.isPaused && !this.cancelled) {
        await new Promise((r) => setTimeout(r, 100));
      }

      if (this.cancelled) {
        this.destroy();
        this.blobManager.close();
        throw new Error('Cancelled');
      }

      if (this.videoDecoderError) {
        const msg = this.videoDecoderError.message || this.videoDecoderError.name || String(this.videoDecoderError);
        this.destroy();
        this.blobManager.close();
        throw new Error(`VideoDecoder failed: ${msg}`);
      }

      if (this.videoEncoderError) {
        const msg = this.videoEncoderError.message || this.videoEncoderError.name || String(this.videoEncoderError);
        this.destroy();
        this.blobManager.close();
        throw new Error(`VideoEncoder failed: ${msg}`);
      }

      this.videoDecoder.decode(videoChunks[i]);
      processed++;

      // Strict mobile RAM & GPU queue management:
      // Never let decoder or encoder queue exceed 4 frames on mobile
      while (this.videoDecoder && (this.videoDecoder.decodeQueueSize >= 4 || (this.videoEncoder && this.videoEncoder.encodeQueueSize >= 4))) {
        await new Promise((r) => setTimeout(r, 10));
      }

      if (i % 10 === 0) {
        const prog = processed / totalChunks;
        this.emit('progress', prog);
        if (onProgress) onProgress(prog);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (this.videoDecoder) {
      try {
        await this.videoDecoder.flush();
      } catch (e) {
        console.warn('VideoDecoder flush warning:', e);
      }
      try {
        await this.videoEncoder.flush();
      } catch (e) {
        console.warn('VideoEncoder flush warning:', e);
      }
    }

    const blob = await this.finalize(true);
    this.destroy();
    return blob;
  }

  async convert(videoMimeType, videoDuration, videoInitSegment, audioMimeType, audioDuration, audioInitSegment, zippedFragments, transcodeOptions = {}, skipConfirm = false) {
    // Check webcodec support
    if (!window.VideoDecoder || !window.VideoEncoder || !window.AudioDecoder || !window.AudioEncoder) {
      throw new Error('Webcodecs not supported');
    }

    if (!skipConfirm) {
      const answer = await AlertPolyfill.confirm(Localize.getMessage('player_savevideo_reencode'), 'warning');
      if (!answer) {
        throw new Error('Cancelled');
      }
    }

    await this.setup(videoMimeType, videoDuration, videoInitSegment, audioMimeType, audioDuration, audioInitSegment, transcodeOptions);

    let lastProgress = 0;
    for (let i = 0; i < zippedFragments.length; i++) {
      while (this.isPaused && !this.cancelled) {
        await new Promise((r) => setTimeout(r, 100));
      }

      if (this.cancelled) {
        this.destroy();
        this.blobManager.close();
        throw new Error('Cancelled');
      }
      if (zippedFragments[i].track === 0) {
        await this.pushFragment(zippedFragments[i], this.videoDemuxer);
      } else {
        await this.pushFragment(zippedFragments[i], this.audioDemuxer);
      }
      const newProgress = Math.floor((i + 1) / zippedFragments.length * 100);
      if (newProgress !== lastProgress) {
        lastProgress = newProgress;
        this.emit('progress', newProgress / 100);
      }
    }

    const blob = await this.finalize();
    this.destroy();

    return blob;
  }

  destroy() {
    if (this.videoDecoder) {
      this.videoDecoder.close();
      this.videoDecoder = null;
    }

    if (this.audioDecoder) {
      this.audioDecoder.close();
      this.audioDecoder = null;
    }

    if (this.videoEncoder) {
      this.videoEncoder.close();
      this.videoEncoder = null;
    }

    if (this.audioEncoder) {
      this.audioEncoder.close();
      this.audioEncoder = null;
    }

    if (this.resamplerWorker) {
      this.resamplerWorker.terminate();
      this.resamplerWorker = null;
    }

    this.videoDemuxer = null;
    this.audioDemuxer = null;

    this.muxer = null;
    this.chunks = null;

    setTimeout(() => {
      this.blobManager.close();
      this.blobManager = null;
    }, 120000);
  }
}
