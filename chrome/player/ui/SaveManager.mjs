import {SubtitleTrack} from '../SubtitleTrack.mjs';
import {VideoSource} from '../VideoSource.mjs';
import {PlayerModes} from '../enums/PlayerModes.mjs';
import {DownloadStatus} from '../enums/DownloadStatus.mjs';
import {Localize} from '../modules/Localize.mjs';
import {streamSaver} from '../modules/StreamSaver.mjs';
import {AlertPolyfill} from '../utils/AlertPolyfill.mjs';
import {EnvUtils} from '../utils/EnvUtils.mjs';
import {FastStreamArchiveUtils} from '../utils/FastStreamArchiveUtils.mjs';
import {RequestUtils} from '../utils/RequestUtils.mjs';
import {StringUtils} from '../utils/StringUtils.mjs';
import {URLUtils} from '../utils/URLUtils.mjs';
import {Utils} from '../utils/Utils.mjs';
import {WebUtils} from '../utils/WebUtils.mjs';
import {DOMElements} from './DOMElements.mjs';
import {DownloadModal} from './DownloadModal.mjs';
import {AudioExtractor} from '../modules/mp3/AudioExtractor.mjs';

export class SaveManager {
  constructor(client) {
    this.client = client;
    this.downloadURL = null;
    this.reuseDownloadURL = false;
  }

  setupUI() {
    DOMElements.playerContainer.addEventListener('drop', this.onFileDrop.bind(this), false);

    DOMElements.download.addEventListener('click', this.saveVideo.bind(this));

    DOMElements.download.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.saveVideo(e, true);
    });

    WebUtils.setupTabIndex(DOMElements.download);

    DOMElements.screenshot.addEventListener('click', this.saveScreenshot.bind(this));
    WebUtils.setupTabIndex(DOMElements.screenshot);
  }

  setStatusMessage(key, message, type, expiry) {
    this.client.interfaceController.setStatusMessage(key, message, type, expiry);
  }

  async saveScreenshot() {
    if (!this.client.player) {
      await AlertPolyfill.alert(Localize.getMessage('player_nosource_alert'), 'error');
      return;
    }

    const suggestedName = (this.client.mediaInfo?.name || 'video').replaceAll(' ', '_') + '@' + StringUtils.formatTime(this.client.currentTime);
    const name = EnvUtils.isIncognito() ? suggestedName : await AlertPolyfill.prompt(Localize.getMessage('player_filename_prompt'), suggestedName);

    if (!name) {
      return;
    }

    this.setStatusMessage('save-screenshot', Localize.getMessage('player_screenshot_saving'), 'info');
    try {
      const video = this.client.player.getVideo();
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const url = canvas.toDataURL('image/png'); // For some reason this is faster than async toBlob
      await Utils.downloadURL(url, name + '.png');
      this.setStatusMessage('save-screenshot', Localize.getMessage('player_screenshot_saved'), 'info', 1000);
    } catch (e) {
      console.error(e);
      this.setStatusMessage('save-screenshot', Localize.getMessage('player_screenshot_fail'), 'error', 2000);
    }
  }

  async saveVideo(e = {}, allowPartial = false) {
    if (!this.client.player) {
      await AlertPolyfill.alert(Localize.getMessage('player_nosource_alert'), 'error');
      return;
    }

    if (this.makingDownload) {
      if (this.downloadCancel) {
        this.downloadCancel();
        DOMElements.saveNotifBanner.style.color = 'gold';
        this.setStatusMessage('save-video', Localize.getMessage('player_savevideo_cancelling'), 'info');
      } else {
        await AlertPolyfill.alert(Localize.getMessage('player_savevideo_inprogress_alert'), 'error');
      }
      return;
    }

    const doPartial = e?.altKey || allowPartial;
    const doDump = e?.shiftKey;
    const player = this.client.player;

    const {canSave, isComplete, canStream} = player.canSave();

    if (!canSave && !doDump) {
      await AlertPolyfill.alert(Localize.getMessage('player_savevideo_unsupported'), 'error');
      return;
    }

    if (doPartial && !isComplete) {
      const res = await AlertPolyfill.confirm(Localize.getMessage('player_savevideo_partial_confirm'), 'warning');
      if (!res) {
        return;
      }
    }

    if (!doPartial && !isComplete && EnvUtils.isIncognito()) {
      const res = await AlertPolyfill.confirm(Localize.getMessage('player_savevideo_incognito_confirm'), 'warning');
      if (!res) {
        return;
      }
    }

    const suggestedName = (this.client.mediaInfo?.name || 'video').replaceAll(' ', '_');

    if (doDump) {
      const name = !EnvUtils.isIncognito() ? await AlertPolyfill.prompt(Localize.getMessage('player_filename_prompt'), suggestedName) : suggestedName;
      if (!name) {
        return;
      }
      this.dumpBuffer(name);
      return;
    }

    const videoWidth = this.client.videoWidth || player.getVideo()?.videoWidth || 1920;
    const videoHeight = this.client.videoHeight || player.getVideo()?.videoHeight || 1080;
    const videoLevels = this.client.getVideoLevels() || new Map();

    const dlConfig = await DownloadModal.show({
      client: this.client,
      suggestedName,
      videoWidth,
      videoHeight,
      videoLevels,
    });

    if (!dlConfig) {
      return;
    }

    if (dlConfig.format === 'audio') {
      await this.saveAudio(dlConfig, doPartial);
      return;
    }

    let url;
    let filestream;
    const name = dlConfig.filename;

    const useDirectStreamSaver = canStream && !dlConfig.isDownsample;
    if (useDirectStreamSaver) {
      filestream = streamSaver.createWriteStream(name + '.mp4');
    }

    const saveOptions = {
      onProgress: (progress) => {
        this.setStatusMessage('save-video', Localize.getMessage('player_savevideo_progress', [Math.floor(progress * 100)]), 'info');
      },
      registerCancel: (cancel) => {
        this.downloadCancel = cancel;
      },
      filestream,
      partialSave: doPartial,
    };

    if (dlConfig.isDownsample) {
      saveOptions.transcodeOptions = {
        targetHeight: dlConfig.targetHeight,
        targetWidth: dlConfig.targetWidth,
      };
    } else if (dlConfig.isDirectTrack && dlConfig.targetLevelId) {
      saveOptions.videoLevelID = dlConfig.targetLevelId;
    }

    if (this.reuseDownloadURL && this.downloadURL && isComplete && !dlConfig.isDownsample) {
      url = this.downloadURL;
    } else {
      this.reuseDownloadURL = isComplete && !dlConfig.isDownsample;
      let result;
      this.makingDownload = true;
      this.setStatusMessage('save-video', Localize.getMessage('player_savevideo_start'), 'info');
      DOMElements.saveNotifBanner.style.display = '';
      DOMElements.saveNotifBanner.style.color = '';
      try {
        const start = performance.now();
        result = await player.saveVideo(saveOptions);
        const end = performance.now();
        console.log('Save took ' + (end - start) / 1000 + 's');
      } catch (e) {
        console.error(e);
        this.setStatusMessage('save-video', Localize.getMessage('player_savevideo_fail'), 'error', 2000);
        this.makingDownload = false;
        this.downloadCancel = null;
        DOMElements.saveNotifBanner.style.display = 'none';

        if (e.message === 'Cancelled') {
          console.error(e);
          this.setStatusMessage('save-video', Localize.getMessage('player_savevideo_cancelled'), 'info', 2000);
        } else {
          if (await AlertPolyfill.confirm(Localize.getMessage('player_savevideo_failed_ask_archive'), 'error')) {
            if (name) {
              this.dumpBuffer(name);
            }
          }
        }
        return;
      }

      DOMElements.saveNotifBanner.style.display = 'none';
      this.downloadCancel = null;
      this.makingDownload = false;

      this.setStatusMessage('save-video', Localize.getMessage('player_savevideo_complete'), 'info', 2000);

      if (!useDirectStreamSaver && result?.blob) {
        url = URL.createObjectURL(result.blob);
      }

      if (this.downloadURL) {
        URL.revokeObjectURL(this.downloadURL);
        this.downloadURL = null;
      }

      this.downloadURL = url;
    }

    if (!useDirectStreamSaver && url) {
      setTimeout(() => {
        if (this.downloadURL !== url) return;

        if (this.downloadURL) {
          URL.revokeObjectURL(this.downloadURL);
          this.downloadURL = null;
          this.reuseDownloadURL = false;
        }
      }, 15000);
      await Utils.downloadURL(url, name + '.mp4');
    }
  }

  async saveAudio(dlConfig, doPartial = false) {
    const player = this.client.player;
    this.makingDownload = true;
    this.setStatusMessage('save-video', Localize.getMessage('player_saveaudio_start') || 'Extracting audio...', 'info');
    DOMElements.saveNotifBanner.style.display = '';
    DOMElements.saveNotifBanner.style.color = '';

    try {
      const audioExtractor = new AudioExtractor((cancel) => {
        this.downloadCancel = cancel;
      });

      const onProgress = (progress) => {
        this.setStatusMessage('save-video', Localize.getMessage('player_saveaudio_progress', [Math.floor(progress * 100)]) || `Encoding MP3 ${Math.floor(progress * 100)}%`, 'info');
      };

      const audioLevelID = player.getCurrentAudioLevelID?.() || null;
      const audioFragments = audioLevelID ? (this.client.getFragments(audioLevelID) || []) : [];
      const videoFragments = player.getCurrentVideoLevelID?.() ? (this.client.getFragments(player.getCurrentVideoLevelID()) || []) : [];

      let mp3Blob = null;

      if (audioFragments.length > 0) {
        let fragments = audioFragments;
        if (doPartial) {
          fragments = fragments.filter((f) => f && f.status === DownloadStatus.DOWNLOAD_COMPLETE);
        }

        const audioInitSegment = fragments[-1] ?
          new Uint8Array(await this.client.downloadManager.getEntry(fragments[-1].getContext()).getDataFromBlob()) : null;

        const wrappedFragments = fragments.filter((f) => f).map((frag) => {
          return {
            fragment: frag,
            getEntry: async () => {
              if (frag.status !== DownloadStatus.DOWNLOAD_COMPLETE) {
                while (true) {
                  try {
                    await player.downloadFragment(frag, -1);
                    break;
                  } catch (e) {
                    if (e.message !== 'Aborted download') throw e;
                  }
                }
              }
              return this.client.downloadManager.getEntry(frag.getContext());
            },
          };
        });

        mp3Blob = await audioExtractor.extractFromFragments({
          audioMimeType: 'audio/mp4',
          audioDuration: player.duration || 0,
          audioInitSegment: audioInitSegment,
          fragments: wrappedFragments,
          kbps: dlConfig.bitrate || 192,
          onProgress,
        });
      } else if (videoFragments.length > 0) {
        let fragments = videoFragments;
        if (doPartial) {
          fragments = fragments.filter((f) => f && f.status === DownloadStatus.DOWNLOAD_COMPLETE);
        }

        const videoInitSegment = fragments[-1] ?
          new Uint8Array(await this.client.downloadManager.getEntry(fragments[-1].getContext()).getDataFromBlob()) : null;

        const wrappedFragments = fragments.filter((f) => f).map((frag) => {
          return {
            fragment: frag,
            getEntry: async () => {
              if (frag.status !== DownloadStatus.DOWNLOAD_COMPLETE) {
                while (true) {
                  try {
                    await player.downloadFragment(frag, -1);
                    break;
                  } catch (e) {
                    if (e.message !== 'Aborted download') throw e;
                  }
                }
              }
              return this.client.downloadManager.getEntry(frag.getContext());
            },
          };
        });

        mp3Blob = await audioExtractor.extractFromFragments({
          audioMimeType: 'video/mp4',
          audioDuration: player.duration || 0,
          audioInitSegment: videoInitSegment,
          fragments: wrappedFragments,
          kbps: dlConfig.bitrate || 192,
          onProgress,
        });
      } else {
        const videoEl = player.getVideo?.();
        const src = videoEl?.src || this.client.source?.url;
        if (!src) throw new Error('No audio source found');

        const buffer = await RequestUtils.httpGetLarge(src);
        mp3Blob = await audioExtractor.extractFromBuffer(buffer, dlConfig.bitrate || 192, onProgress);
      }

      DOMElements.saveNotifBanner.style.display = 'none';
      this.downloadCancel = null;
      this.makingDownload = false;

      this.setStatusMessage('save-video', Localize.getMessage('player_saveaudio_complete') || 'MP3 Download complete!', 'info', 2000);

      const url = URL.createObjectURL(mp3Blob);
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      await Utils.downloadURL(url, dlConfig.filename + '.mp3');
    } catch (e) {
      console.error('saveAudio error:', e);
      this.setStatusMessage('save-video', Localize.getMessage('player_saveaudio_fail') || 'Failed to extract audio!', 'error', 2000);
      this.makingDownload = false;
      this.downloadCancel = null;
      DOMElements.saveNotifBanner.style.display = 'none';
    }
  }

  async dumpBuffer(name) {
    const entries = this.client.downloadManager.getCompletedEntries();
    const filestream = streamSaver.createWriteStream(name + '.fsa');
    try {
      await FastStreamArchiveUtils.writeFSAToStream(filestream, this.client.player, entries, (progress)=>{
        this.setStatusMessage('save-video', Localize.getMessage('player_archiver_progress', [Math.floor(progress * 100)]), 'info');
      });

      this.setStatusMessage('save-video', Localize.getMessage('player_archiver_saved'), 'info', 2000);
    } catch (e) {
      console.error(e);
      this.setStatusMessage('save-video', 'Unreachable Error', 'error', 2000);
      AlertPolyfill.errorSendToDeveloper(e);
    }
  }

  async onFileDrop(e) {
    e.stopPropagation();
    e.preventDefault();

    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length === 0) {
      return;
    }
    const captions = [];
    const audioFormats = [
      'mp3',
      'wav',
      'm4a',
      'm4r',
      'mkv',
      'webm',
    ];

    const subtitleFormats = [
      'vtt',
      'srt',
      'xml',
    ];

    let newSource = null;
    let newEntries = null;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = URLUtils.get_url_extension(file.name);

      if (ext === 'json') {
        const fsprofile = await file.text();
        const data = JSON.parse(fsprofile);

        if (data?.type === 'audioProfile') {
          this.client.audioConfigManager.loadProfileFile(data);
        }
      } else if (subtitleFormats.includes(ext)) {
        captions.push({
          url: window.URL.createObjectURL(file),
          name: file.name.substring(0, file.name.length - 4),
        });
      } else if (audioFormats.includes(ext)) {
        newSource = new VideoSource(window.URL.createObjectURL(file), {}, PlayerModes.DIRECT);
        newSource.identifier = file.name + 'size' + file.size;
      } else if (URLUtils.getModeFromExtension(ext)) {
        let mode = URLUtils.getModeFromExtension(ext);
        if (mode === PlayerModes.ACCELERATED_MP4) {
          mode = PlayerModes.DIRECT;
        }
        newSource = new VideoSource(window.URL.createObjectURL(file), {}, mode);
        newSource.identifier = file.name + 'size' + file.size;
      } else if (ext === 'fsa') {
        const buffer = await RequestUtils.httpGetLarge(window.URL.createObjectURL(file));
        try {
          const {source, entries, currentLevel, currentAudioLevel} = await FastStreamArchiveUtils.parseFSA(buffer, (progress)=>{
            this.setStatusMessage('save-video', Localize.getMessage('player_archive_loading', [Math.floor(progress * 100)]), 'info');
          }, this.client.downloadManager);

          newEntries = entries;

          newSource = new VideoSource(source.url, null, source.mode);
          newSource.identifier = source.identifier;
          newSource.headers = source.headers;
          newSource.loadedFromArchive = true;
          newSource.defaultLevelInfo = {
            level: currentLevel,
            audioLevel: currentAudioLevel,
          };

          this.setStatusMessage('save-video', Localize.getMessage('player_archive_loaded'), 'info', 2000);
        } catch (e) {
          console.error(e);
          this.setStatusMessage('save-video', Localize.getMessage('player_archive_fail'), 'error', 2000);
        }
      }
    }

    if (newSource) {
      if (newEntries) {
        this.client.downloadManager.resetOverride(true);
        this.client.downloadManager.setEntries(newEntries);
      }

      try {
        await this.client.addSource(newSource, true);
      } catch (e) {
        console.error(e);
      }

      if (newEntries) {
        this.client.downloadManager.resetOverride(false);
      }
    }

    (await Promise.all(captions.map(async (file) => {
      const track = new SubtitleTrack(file.name);
      await track.loadURL(file.url);
      return track;
    }))).forEach((track) => {
      const returnedTrack = this.client.loadSubtitleTrack(track);
      this.client.interfaceController.subtitlesManager.activateTrack(returnedTrack);
    });

    this.client.play();
  }

  reset() {
    this.reuseDownloadURL = false;
    if (this.downloadURL) {
      URL.revokeObjectURL(this.downloadURL);
    }
    this.downloadURL = null;
  }

  destroy() {
    if (this.downloadURL) {
      URL.revokeObjectURL(this.downloadURL);
      this.downloadURL = null;
    }
  }
}
