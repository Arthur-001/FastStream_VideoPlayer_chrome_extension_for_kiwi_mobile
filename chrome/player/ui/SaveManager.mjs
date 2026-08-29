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
    this.currentTask = null;
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

  updateTaskProgress({progress, phase, currentBytes, totalBytes}) {
    if (!this.currentTask) return;
    const now = performance.now();
    this.currentTask.progress = Math.min(1.0, Math.max(0, progress || 0));
    if (phase) {
      this.currentTask.phase = phase;
      if (!this.currentTask.isPaused) {
        this.currentTask.lastActivePhase = phase;
      }
    }

    if (totalBytes && totalBytes > 0) this.currentTask.totalBytes = totalBytes;
    if (currentBytes != null && currentBytes > 0) {
      this.currentTask.currentBytes = currentBytes;
    } else if (this.currentTask.totalBytes > 0) {
      this.currentTask.currentBytes = Math.round(this.currentTask.progress * this.currentTask.totalBytes);
    }

    const elapsed = Math.max(0.1, (now - this.currentTask.startTime) / 1000);
    const downloaded = this.currentTask.currentBytes || 0;
    const speed = downloaded / elapsed; // bytes/sec
    this.currentTask.speed = speed;
    this.currentTask.speedFormatted = `${DownloadModal.formatBytes(speed)}/s`;

    const remainingBytes = Math.max(0, (this.currentTask.totalBytes || 0) - downloaded);
    const etaSecs = (speed > 1000) ? remainingBytes / speed : 0;
    this.currentTask.etaFormatted = DownloadModal.formatTimeRemaining(etaSecs);

    DownloadModal.updateActiveTask(this.currentTask);
  }

  toggleCurrentTaskPause() {
    if (!this.currentTask) return;
    this.currentTask.isPaused = !this.currentTask.isPaused;

    if (this.currentTask.onPauseChanged) {
      this.currentTask.onPauseChanged(this.currentTask.isPaused);
    }

    if (this.client?.downloadManager) {
      if (this.currentTask.isPaused) {
        this.client.downloadManager.pause();
      } else {
        this.client.downloadManager.resume();
        this.client.interfaceController.setStatusMessage('download', null);
        this.client.interfaceController.updateDownloadStatus();
      }
    }

    DOMElements.saveNotifBanner.style.color = this.currentTask.isPaused ? 'gold' : '';
    this.updateTaskProgress({
      progress: this.currentTask.progress,
      phase: this.currentTask.isPaused ? 'Paused' : (this.currentTask.lastActivePhase || 'Downloading...'),
    });
  }

  cleanupTaskState(statusMessage = null, messageType = 'info', expiry = 2000) {
    if (this.client?.downloadManager?.paused) {
      this.client.downloadManager.resume();
    }
    this.client?.interfaceController?.setStatusMessage('download', null);
    this.client?.interfaceController?.updateDownloadStatus();

    this.makingDownload = false;
    this.currentTask = null;
    this.downloadCancel = null;
    DOMElements.saveNotifBanner.style.display = 'none';
    DOMElements.saveNotifBanner.style.color = '';
    DownloadModal.closeActiveTask();

    if (statusMessage) {
      this.setStatusMessage('save-video', statusMessage, messageType, expiry);
    }
  }

  cancelCurrentTask() {
    if (this.downloadCancel) {
      this.downloadCancel();
    }
    this.cleanupTaskState(Localize.getMessage('player_savevideo_cancelled') || 'Download cancelled', 'info', 2000);
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
      if (this.currentTask) {
        DownloadModal.showActiveTask(this.currentTask);
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

    const videoLevels = this.client.getVideoLevels() || new Map();
    const levelsArray = Array.from(videoLevels.values());
    const currentLevelId = this.client.getCurrentVideoLevelID?.();
    const currentLevel = levelsArray.find((l) => l.id === currentLevelId);

    let videoWidth = 0;
    let videoHeight = 0;

    if (currentLevel && currentLevel.height > 0) {
      videoHeight = currentLevel.height;
      videoWidth = currentLevel.width;
    } else {
      const videoEl = player?.getVideo?.();
      if (videoEl?.videoHeight > 0) {
        videoHeight = videoEl.videoHeight;
        videoWidth = videoEl.videoWidth;
      } else {
        videoWidth = this.client.videoWidth || 1920;
        videoHeight = this.client.videoHeight || 1080;
      }
    }

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

    this.currentTask = {
      type: 'video',
      title: dlConfig.isDownsample ? `Downsampling to ${dlConfig.targetHeight}p` : `Downloading ${dlConfig.resolution?.label || 'Video'}`,
      filename: dlConfig.filename,
      extension: 'mp4',
      progress: 0,
      phase: dlConfig.isDownsample ? 'Downloading source stream...' : 'Downloading video...',
      lastActivePhase: dlConfig.isDownsample ? 'Downloading source stream...' : 'Downloading video...',
      currentBytes: 0,
      totalBytes: dlConfig.estimatedBytes || 0,
      startTime: performance.now(),
      isPaused: false,
      onPauseChanged: null,
      togglePause: () => this.toggleCurrentTaskPause(),
      cancel: () => this.cancelCurrentTask(),
    };

    const saveOptions = {
      onProgress: (progress) => {
        const overallProgress = dlConfig.isDownsample ? (progress * 0.4) : progress;
        const pct = Math.floor(overallProgress * 100);
        this.setStatusMessage('save-video', Localize.getMessage('player_savevideo_progress', [pct]), 'info');
        this.updateTaskProgress({
          progress: overallProgress,
          phase: dlConfig.isDownsample ? `Downloading source (${Math.floor(progress * 100)}%)` : `Downloading (${Math.floor(progress * 100)}%)`,
        });
      },
      registerCancel: (cancel) => {
        this.downloadCancel = cancel;
      },
      filestream,
      partialSave: doPartial,
    };

    if (dlConfig.isDirectTrack && dlConfig.targetLevelId) {
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
        this.cleanupTaskState(Localize.getMessage('player_savevideo_fail'), 'error', 2000);

        if (e.message === 'Cancelled') {
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

      if (dlConfig.isDownsample) {
        if (!result?.blob) {
          this.cleanupTaskState(Localize.getMessage('player_savevideo_fail'), 'error', 2000);
          return;
        }

        try {
          const {Reencoder} = await import('../modules/reencoder/reencoder.mjs');
          let reencoderPause = null;
          const reencoder = new Reencoder((cancel) => {
            this.downloadCancel = cancel;
          }, (pauseFn) => {
            reencoderPause = pauseFn;
          });

          if (this.currentTask) {
            this.currentTask.title = `Downsampling to ${dlConfig.targetHeight}p`;
            this.currentTask.phase = 'Downsampling video frames...';
            this.currentTask.lastActivePhase = 'Downsampling video frames...';
            this.currentTask.onPauseChanged = (paused) => {
              if (reencoderPause) reencoderPause(paused);
            };
          }

          this.setStatusMessage('save-video', 'Downsampling video...', 'info');
          const downscaledBlob = await reencoder.convertMP4Blob(
            result.blob,
            {
              targetHeight: dlConfig.targetHeight,
              targetWidth: dlConfig.targetWidth,
            },
            (p) => {
              const overallProgress = 0.4 + (p * 0.6);
              const pct = Math.floor(overallProgress * 100);
              this.setStatusMessage('save-video', Localize.getMessage('player_savevideo_progress', [pct]), 'info');
              this.updateTaskProgress({
                progress: overallProgress,
                phase: `Downsampling frames (${Math.floor(p * 100)}%)`,
              });
            }
          );
          result = {blob: downscaledBlob, extension: 'mp4'};
        } catch (e) {
          console.error('Downsampling failed:', e.name, e.message, e.stack || e);
          this.cleanupTaskState(Localize.getMessage('player_savevideo_fail'), 'error', 2000);
          return;
        }
      }

      this.cleanupTaskState(Localize.getMessage('player_savevideo_complete'), 'info', 2000);

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

    this.currentTask = {
      type: 'audio',
      title: `Extracting MP3 (${dlConfig.bitrate || 192} kbps)`,
      filename: dlConfig.filename,
      extension: 'mp3',
      progress: 0,
      phase: 'Downloading audio source...',
      lastActivePhase: 'Downloading audio source...',
      currentBytes: 0,
      totalBytes: dlConfig.estimatedBytes || 0,
      startTime: performance.now(),
      isPaused: false,
      onPauseChanged: null,
      togglePause: () => this.toggleCurrentTaskPause(),
      cancel: () => this.cancelCurrentTask(),
    };

    try {
      let mediaBlob = null;
      const saveResult = await player.saveVideo({
        filestream: null,
        partialSave: doPartial,
        onProgress: (p) => {
          const overallProgress = p * 0.4;
          this.setStatusMessage('save-video', `Downloading ${Math.floor(p * 40)}%`, 'info');
          this.updateTaskProgress({
            progress: overallProgress,
            phase: `Downloading source (${Math.floor(p * 100)}%)`,
          });
        },
        registerCancel: (cancel) => {
          this.downloadCancel = cancel;
        },
      });

      mediaBlob = saveResult?.blob;

      if (!mediaBlob) {
        const videoEl = player.getVideo?.();
        const src = videoEl?.src || this.client.source?.url;
        if (src) {
          const buffer = await RequestUtils.httpGetLarge(src);
          mediaBlob = new Blob([buffer]);
        }
      }

      if (!mediaBlob) {
        throw new Error('No media data available for audio extraction');
      }

      let audioPause = null;
      const audioExtractor = new AudioExtractor((cancel) => {
        this.downloadCancel = cancel;
      }, (pauseFn) => {
        audioPause = pauseFn;
      });

      if (this.currentTask) {
        this.currentTask.phase = 'Encoding MP3 audio...';
        this.currentTask.lastActivePhase = 'Encoding MP3 audio...';
        this.currentTask.onPauseChanged = (paused) => {
          if (audioPause) audioPause(paused);
        };
      }

      this.setStatusMessage('save-video', 'Encoding MP3...', 'info');
      const mp3Blob = await audioExtractor.extractFromBuffer(
        mediaBlob,
        dlConfig.bitrate || 192,
        (p) => {
          const overallProgress = 0.4 + (p * 0.6);
          const pct = Math.floor(overallProgress * 100);
          this.setStatusMessage('save-video', Localize.getMessage('player_saveaudio_progress', [pct]) || `Encoding MP3 ${pct}%`, 'info');
          this.updateTaskProgress({
            progress: overallProgress,
            phase: `Encoding MP3 (${Math.floor(p * 100)}%)`,
          });
        }
      );

      this.cleanupTaskState(Localize.getMessage('player_saveaudio_complete') || 'MP3 Download complete!', 'info', 2000);

      const url = URL.createObjectURL(mp3Blob);
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      await Utils.downloadURL(url, dlConfig.filename + '.mp3');
    } catch (e) {
      console.error('saveAudio error:', e);
      this.cleanupTaskState(Localize.getMessage('player_saveaudio_fail') || 'Failed to extract audio!', 'error', 2000);
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
