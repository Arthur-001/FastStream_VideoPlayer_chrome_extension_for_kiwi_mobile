import {MP4Box, DataStream} from '../mp4box.mjs';
import {JsWebm} from './webm.mjs';

class AbstractDemuxer {
  constructor() {

  }
  initialize(initSegment) {
    throw new Error('Not implemented');
  }
  appendBuffer(buffer) {
    throw new Error('Not implemented');
  }
  getVideoDecoderConfig() {
    throw new Error('Not implemented');
  }
  getAudioDecoderConfig() {
    throw new Error('Not implemented');
  }
  getVideoChunks(duration) {
    throw new Error('Not implemented');
  }
  getAudioChunks(duration) {
    throw new Error('Not implemented');
  }
  clearChunks() {
    throw new Error('Not implemented');
  }
}

export class WebMDemuxer extends AbstractDemuxer {
  constructor() {
    super();
    this.demuxer = new JsWebm();
    this.MAX_ITERATIONS = 10000;
  }

  process() {
    let count = 0;
    while (this.demuxer.demux()) {
      count++;
      if (count > this.MAX_ITERATIONS) {
        throw new Error('too many iterations');
      }
    }
  }

  initialize(initSegment) {
    this.appendBuffer(initSegment);
    this.demuxer.validateMetadata();
  }

  appendBuffer(buffer) {
    this.demuxer.queueData(buffer);
    this.process();
  }

  getVideoDecoderConfig() {
    const videoTrack = this.demuxer.videoTrack;
    if (!videoTrack) {
      return null;
    }

    const config = {
      codec: this.demuxer.videoCodec,
      codedWidth: videoTrack.width,
      codedHeight: videoTrack.height,
      displayAspectWidth: videoTrack.displayWidth,
      displayAspectHeight: videoTrack.displayHeight,
    };

    const colour = videoTrack.colour;
    if (colour) {
      config.colorSpace = {
        primaries: colour.webReadyPrimaries || null,
        transfer: colour.webReadyTransferCharacteristics || null,
        matrix: colour.webReadyMatrixCoefficients || null,
        fullRange: colour.range ? (colour.range === 'full') : null,
      };
    }

    return config;
  }

  getAudioDecoderConfig() {
    const audioTrack = this.demuxer.audioTrack;
    if (!audioTrack) {
      return null;
    }
    return {
      codec: this.demuxer.audioCodec,
      description: audioTrack.codecPrivate,
      sampleRate: audioTrack.rate,
      numberOfChannels: audioTrack.channels,
    };
  }

  getVideoChunks(duration) {
    const packets = this.demuxer.videoPackets;

    // delete any packets out of order
    let dropped = 0;
    for (let i = 1; i < packets.length; ) {
      if (packets[i].timestamp < packets[i - 1].timestamp) {
        packets.splice(i, 1);
        dropped++;
      } else {
        i++;
      }
    }

    if (dropped > 0) {
      console.warn(`WebMDemuxer: dropped ${dropped} out of order video packets`);
    }

    const chunks = [];
    for (let i = 0; i < packets.length - 1; i++) {
      const packet = packets[i];
      const nextPacket = packets[i + 1];
      const currentTimestamp = Math.floor(packet.timestamp * 1000000);
      const nextTimestamp = Math.floor(nextPacket.timestamp * 1000000);
      const chunk = new EncodedVideoChunk({
        type: packet.isKeyframe ? 'key' : 'delta',
        timestamp: currentTimestamp,
        duration: nextTimestamp - currentTimestamp,
        data: packet.data,
      });
      chunks.push(chunk);
    }

    if (duration) {
      const lastPacket = packets[packets.length - 1];
      const lastTimestamp = Math.floor(lastPacket.timestamp * 1000000);
      const lastDuration = Math.floor(duration * 1000000) - lastTimestamp;
      const lastChunk = new EncodedVideoChunk({
        type: lastPacket.isKeyframe ? 'key' : 'delta',
        timestamp: lastTimestamp,
        duration: lastDuration,
        data: lastPacket.data,
      });
      chunks.push(lastChunk);
    }
    return chunks;
  }

  getAudioChunks(duration) {
    const packets = this.demuxer.audioPackets;

    // delete any packets out of order
    let dropped = 0;
    for (let i = 1; i < packets.length; ) {
      if (packets[i].timestamp <= packets[i - 1].timestamp) {
        packets.splice(i, 1);
        dropped++;
      } else {
        i++;
      }
    }

    if (dropped > 0) {
      console.warn(`WebMDemuxer: dropped ${dropped} out of order audio packets`);
    }


    const chunks = [];
    for (let i = 0; i < packets.length - 1; i++) {
      const packet = packets[i];
      const nextPacket = packets[i + 1];
      const currentTimestamp = Math.floor(packet.timestamp * 1000000);
      const nextTimestamp = Math.floor(nextPacket.timestamp * 1000000);
      const chunk = new EncodedAudioChunk({
        type: packet.isKeyframe ? 'key' : 'delta',
        timestamp: currentTimestamp,
        duration: nextTimestamp - currentTimestamp,
        data: packet.data,
      });

      chunks.push(chunk);
    }

    if (duration) {
      const lastPacket = packets[packets.length - 1];
      const lastTimestamp = Math.floor(lastPacket.timestamp * 1000000);
      const lastDuration = Math.floor(duration * 1000000) - lastTimestamp;
      const lastChunk = new EncodedAudioChunk({
        type: lastPacket.isKeyframe ? 'key' : 'delta',
        timestamp: lastTimestamp,
        duration: lastDuration,
        data: lastPacket.data,
      });
      chunks.push(lastChunk);
    }
    return chunks;
  }

  clearChunks() {
    // clear all but the last packet
    this.demuxer.audioPackets.splice(0, this.demuxer.audioPackets.length - 1);
    this.demuxer.videoPackets.splice(0, this.demuxer.videoPackets.length - 1);
  }
}


export class MP4Demuxer extends AbstractDemuxer {
  constructor() {
    super();
    this.videoSamples = [];
    this.audioSamples = [];
    this.nextPos = 0;
  }

  createFile(buffer) {
    const file = MP4Box.createFile(false);
    file.onError = (e) => {
      console.log('mp4box error', e);
    };
    return file;
  }

  initialize(initSegment) {
    this.file = this.createFile();
    this.videoSamples = [];
    this.audioSamples = [];

    this.file.onReady = (info) => {
      this.info = info;
      this.videoTrack = info.videoTracks[0];
      this.audioTrack = info.audioTracks[0];

      if (this.videoTrack) {
        this.file.setExtractionOptions(this.videoTrack.id, 'video', {nbSamples: 100000});
      }
      if (this.audioTrack) {
        this.file.setExtractionOptions(this.audioTrack.id, 'audio', {nbSamples: 100000});
      }
      this.file.start();
    };

    this.file.onSamples = (id, user, samples) => {
      if (user === 'video' || (this.videoTrack && id === this.videoTrack.id)) {
        this.videoSamples.push(...samples);
      } else if (user === 'audio' || (this.audioTrack && id === this.audioTrack.id)) {
        this.audioSamples.push(...samples);
      }
    };

    initSegment.fileStart = 0;
    this.file.appendBuffer(initSegment);
    this.nextPos = initSegment.byteLength;
    this.file.flush();

    if (!this.info) {
      try {
        this.info = this.file.getInfo();
        this.videoTrack = this.info.videoTracks[0];
        this.audioTrack = this.info.audioTracks[0];
        if (this.videoTrack) {
          this.file.setExtractionOptions(this.videoTrack.id, 'video', {nbSamples: 100000});
        }
        if (this.audioTrack) {
          this.file.setExtractionOptions(this.audioTrack.id, 'audio', {nbSamples: 100000});
        }
        this.file.start();
        this.file.flush();
      } catch (e) {}
    }
  }

  appendBuffer(buffer) {
    buffer.fileStart = this.nextPos;
    this.file.appendBuffer(buffer);
    this.nextPos += buffer.byteLength;
    this.file.flush();
  }

  getVideoDecoderConfig() {
    const videoTrack = this.videoTrack;
    if (!videoTrack) {
      return null;
    }
    const description = this.getTrackDescription(this.videoTrack.id);
    const config = {
      codec: videoTrack.codec,
      codedWidth: videoTrack.video?.width || videoTrack.track_width,
      codedHeight: videoTrack.video?.height || videoTrack.track_height,
      displayAspectWidth: videoTrack.track_width,
      displayAspectHeight: videoTrack.track_height,
    };
    if (description && description.byteLength > 0) {
      config.description = description;
    }
    console.log('[MP4Demuxer] VideoDecoderConfig description length:', description ? description.byteLength : 0);
    return config;
  }

  getTrackDescription(trackId) {
    if (!this.file || !trackId) return undefined;
    try {
      const trak = this.file.getTrackById(trackId);
      if (!trak?.mdia?.minf?.stbl?.stsd?.entries) return undefined;
      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
        const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
        if (box) {
          const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
          box.write(stream);
          if (stream.position > 8) {
            // Slice the exact byte array from byte 8 to stream.position
            return new Uint8Array(stream.buffer.slice(8, stream.position));
          }
        }
        // Fallback: If entry.avcC has SPS/PPS arrays directly
        if (entry.avcC?.SPS?.length && entry.avcC?.PPS?.length) {
          const spsList = entry.avcC.SPS;
          const ppsList = entry.avcC.PPS;
          let totalLen = 6;
          for (const s of spsList) totalLen += 2 + s.nalu.byteLength;
          totalLen += 1;
          for (const p of ppsList) totalLen += 2 + p.nalu.byteLength;

          const desc = new Uint8Array(totalLen);
          let offset = 0;
          desc[offset++] = entry.avcC.configurationVersion || 1;
          desc[offset++] = entry.avcC.AVCProfileIndication || 0x42;
          desc[offset++] = entry.avcC.profile_compatibility || 0x00;
          desc[offset++] = entry.avcC.AVCLevelIndication || 0x1f;
          desc[offset++] = (entry.avcC.lengthSizeMinusOne ?? 3) | 0xfc;
          desc[offset++] = spsList.length | 0xe0;

          for (const s of spsList) {
            desc[offset++] = (s.nalu.byteLength >> 8) & 0xff;
            desc[offset++] = s.nalu.byteLength & 0xff;
            desc.set(s.nalu, offset);
            offset += s.nalu.byteLength;
          }

          desc[offset++] = ppsList.length;
          for (const p of ppsList) {
            desc[offset++] = (p.nalu.byteLength >> 8) & 0xff;
            desc[offset++] = p.nalu.byteLength & 0xff;
            desc.set(p.nalu, offset);
            offset += p.nalu.byteLength;
          }

          return desc;
        }
      }
    } catch (e) {
      console.warn('Could not extract track description:', e);
    }
    return undefined;
  }

  getAudioDecoderConfig() {
    const audioTrack = this.audioTrack;
    if (!audioTrack) {
      return null;
    }
    return {
      codec: audioTrack.codec,
      description: undefined,
      sampleRate: audioTrack.audio?.sample_rate || audioTrack.timescale || 44100,
      numberOfChannels: audioTrack.audio?.channel_count || 2,
    };
  }

  getVideoChunks(duration) {
    if (!this.videoTrack) {
      return [];
    }
    const trak = this.file.getTrackById(this.videoTrack.id);
    const samples = (this.videoSamples && this.videoSamples.length > 0) ? this.videoSamples : (trak?.samples_stored || []);
    if (!samples || samples.length === 0) {
      return [];
    }

    const chunks = [];
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const nextSample = samples[i + 1];

      const timescale = sample.timescale || this.videoTrack.timescale || 90000;
      const currentTimestamp = Math.floor(sample.cts * 1000000 / timescale);
      const sampleDuration = nextSample ?
        Math.floor((nextSample.cts - sample.cts) * 1000000 / timescale) :
        Math.floor((sample.duration || timescale / 30) * 1000000 / timescale);

      // WebCodecs requires the first decoded chunk to be a keyframe
      const isKey = (i === 0) ? true : !!sample.is_sync;

      const chunk = new EncodedVideoChunk({
        type: isKey ? 'key' : 'delta',
        timestamp: currentTimestamp,
        duration: sampleDuration > 0 ? sampleDuration : 33333,
        data: sample.data,
      });
      chunks.push(chunk);
    }

    return chunks;
  }

  getAudioChunks(duration) {
    if (!this.audioTrack) {
      return [];
    }
    const trak = this.file.getTrackById(this.audioTrack.id);
    const samples = (this.audioSamples && this.audioSamples.length > 0) ? this.audioSamples : (trak?.samples_stored || []);
    if (!samples || samples.length === 0) {
      return [];
    }

    const chunks = [];
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const nextSample = samples[i + 1];

      const timescale = sample.timescale || this.audioTrack.timescale || 44100;
      const currentTimestamp = Math.floor(sample.cts * 1000000 / timescale);
      const sampleDuration = nextSample ?
        Math.floor((nextSample.cts - sample.cts) * 1000000 / timescale) :
        Math.floor((sample.duration || 1024) * 1000000 / timescale);

      const chunk = new EncodedAudioChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: currentTimestamp,
        duration: sampleDuration > 0 ? sampleDuration : 23220,
        data: sample.data,
      });
      chunks.push(chunk);
    }

    return chunks;
  }

  clearChunks() {
    // clear all but the last packet
    if (this.videoTrack) {
      const videoTrak = this.file.getTrackById(this.videoTrack.id);
      const samples = videoTrak.samples_stored;
      for (let i = 0; i < samples.length - 1; i++) {
        this.file.releaseSample(videoTrak, samples[i].number);
      }
      samples.splice(0, samples.length - 1);
    }

    if (this.audioTrack) {
      const audioTrak = this.file.getTrackById(this.audioTrack.id);
      const samples = audioTrak.samples_stored;
      for (let i = 0; i < samples.length - 1; i++) {
        this.file.releaseSample(audioTrak, samples[i].number);
      }
      samples.splice(0, samples.length - 1);
    }
  }
}
