import {DefaultPlayerEvents} from '../enums/DefaultPlayerEvents.mjs';
import {EmitterRelay, EventEmitter} from '../modules/eventemitter.mjs';
import {VideoUtils} from '../utils/VideoUtils.mjs';

export default class DirectVideoPlayer extends EventEmitter {
  constructor(client, config) {
    super();
    this.client = client;

    this.video = document.createElement(config?.isAudioOnly ? 'audio' : 'video');
  }

  load() {

  }

  getClient() {
    return this.client;
  }


  async setup() {
    const preEvents = new EventEmitter();
    const emitterRelay = new EmitterRelay([preEvents, this]);
    VideoUtils.addPassthroughEventListenersToVideo(this.video, emitterRelay);
  }


  getVideo() {
    return this.video;
  }

  async setSource(source) {
    this.source = source;
    this.video.src = source.url;
  }

  getSource() {
    return this.source;
  }

  get buffered() {
    return this.video.buffered;
  }

  async play() {
    return this.video.play();
  }

  async pause() {
    return this.video.pause();
  }

  destroy() {
    VideoUtils.destroyVideo(this.video);
    this.video = null;

    this.emit(DefaultPlayerEvents.DESTROYED);
  }


  set currentTime(value) {
    this.video.currentTime = value;
  }

  get currentTime() {
    return this.video.currentTime;
  }

  get readyState() {
    return this.video.readyState;
  }

  get paused() {
    return this.video.paused;
  }

  get levels() {
    return null;
  }

  get duration() {
    return this.video.duration;
  }

  get currentFragment() {
    return null;
  }

  canSave() {
    return {
      canSave: true,
      canStream: false,
      isComplete: true,
    };
  }

  async saveVideo(options = {}) {
    const src = this.video.src || this.source?.url;
    if (!src) throw new Error('No source URL');

    const {RequestUtils} = await import('../utils/RequestUtils.mjs');
    const buffer = await RequestUtils.httpGetLarge(src, {}, (progress) => {
      if (options.onProgress && !options.transcodeOptions) {
        options.onProgress(progress);
      }
    });

    if (options.transcodeOptions) {
      const {Reencoder} = await import('../modules/reencoder/reencoder.mjs');
      const reencoder = new Reencoder(options.registerCancel);
      reencoder.on('progress', (progress) => {
        if (options.onProgress) options.onProgress(progress);
      });
      const blob = await reencoder.convert(
          'video/mp4',
          this.duration || 0,
          buffer,
          'audio/mp4',
          this.duration || 0,
          buffer,
          [{
            track: 0,
            getEntry: async () => ({getData: async () => new Blob([buffer])}),
          }],
          options.transcodeOptions,
          true,
      );
      return {
        extension: 'mp4',
        blob: blob,
      };
    }

    return {
      extension: 'mp4',
      blob: new Blob([buffer], {type: 'video/mp4'}),
    };
  }

  get volume() {
    return this.video.volume;
  }

  set volume(value) {
    this.video.volume = value;
    if (value === 0) this.video.muted = true;
    else this.video.muted = false;
  }

  get playbackRate() {
    return this.video.playbackRate;
  }

  set playbackRate(value) {
    this.video.playbackRate = value;
  }

  getVideoLevels() {
    return null;
  }

  getAudioLevels() {
    return null;
  }

  getCurrentVideoLevelID() {
    return null;
  }

  getCurrentAudioLevelID() {
    return null;
  }

  setCurrentVideoLevelID(levelID) {
  }

  setCurrentAudioLevelID(levelID) {
  }
}
