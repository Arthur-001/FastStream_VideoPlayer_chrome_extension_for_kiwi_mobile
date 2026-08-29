import {Localize} from '../modules/Localize.mjs';
import {AlertPolyfill} from '../utils/AlertPolyfill.mjs';

/**
 * Mobile-optimized Touch Download Modal for Kiwi Browser & Desktop
 */
export class DownloadModal {
  static activeModalInstance = null;

  /**
   * Format byte count into human-readable string
   * @param {number} bytes
   * @return {string}
   */
  static formatBytes(bytes) {
    if (!bytes || bytes <= 0 || isNaN(bytes)) return '0 MB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = bytes / Math.pow(k, i);
    return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${sizes[i]}`;
  }

  /**
   * Format seconds remaining into human-readable string
   * @param {number} seconds
   * @return {string}
   */
  static formatTimeRemaining(seconds) {
    if (isNaN(seconds) || seconds <= 0 || !isFinite(seconds)) return 'calculating...';
    if (seconds < 60) return `~${Math.ceil(seconds)}s remaining`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `~${mins}m ${secs}s remaining`;
  }

  /**
   * Estimate video and audio output sizes in O(1) time
   * @param {Object} client
   * @param {number} duration
   * @param {Array} levelsArray
   * @return {Object}
   */
  static estimateSizes(client, duration = 0, levelsArray = []) {
    const dur = (duration && duration > 0) ? duration : (client?.duration || client?.player?.duration || 0);

    // Baseline fallback bitrates (bps)
    const bitratePreset = {
      2160: 16000000,
      1440: 9000000,
      1080: 4800000,
      720: 2500000,
      480: 1200000,
      360: 700000,
    };

    const getBitrateForHeight = (h) => {
      if (h >= 2160) return bitratePreset[2160];
      if (h >= 1440) return bitratePreset[1440];
      if (h >= 1080) return bitratePreset[1080];
      if (h >= 720) return bitratePreset[720];
      if (h >= 480) return bitratePreset[480];
      return bitratePreset[360];
    };

    const calculateVideoOptionSize = (opt) => {
      if (!dur || dur <= 0) return 0;

      // 1. If direct level has manifest bitrate/bandwidth
      if (opt.isDirect && opt.levelId != null) {
        const lvl = levelsArray.find((l) => l.id === opt.levelId);
        const br = lvl?.bitrate || lvl?.bandwidth;
        if (br && br > 0) {
          return Math.round((br * dur) / 8);
        }
      }

      // 2. If downsampled option
      if (!opt.isDirect) {
        const vBitrate = getBitrateForHeight(opt.height);
        const aBitrate = 128000;
        return Math.round(((vBitrate + aBitrate) * dur) / 8);
      }

      // 3. Fallback based on height
      const vBitrate = getBitrateForHeight(opt.height);
      const aBitrate = 128000;
      return Math.round(((vBitrate + aBitrate) * dur) / 8);
    };

    const calculateAudioOptionSize = (kbps) => {
      if (!dur || dur <= 0) return 0;
      return Math.round(((kbps * 1000) / 8) * dur);
    };

    return {
      duration: dur,
      calculateVideoOptionSize,
      calculateAudioOptionSize,
    };
  }

  /**
   * Show the touch download modal
   * @param {Object} options
   * @param {Object} options.client - FastStreamClient instance
   * @param {string} options.suggestedName - Suggested filename
   * @param {number} options.videoWidth - Current video width
   * @param {number} options.videoHeight - Current video height
   * @param {Map<string, Object>} options.videoLevels - Available video quality levels
   * @return {Promise<Object|null>} Resolves with download configuration or null if cancelled
   */
  static async show({client, suggestedName = 'video', videoWidth = 0, videoHeight = 0, videoLevels = new Map()}) {
    return new Promise((resolve) => {
      // Remove any existing modal
      const existing = document.getElementById('kiwi-download-modal');
      if (existing) existing.remove();

      // Extract available stream levels
      const levelsArray = Array.from(videoLevels?.values() || []);
      const currentLevelId = client?.getCurrentVideoLevelID?.();
      const currentLevel = levelsArray.find((l) => l.id === currentLevelId);

      let sourceHeight = videoHeight;
      let sourceWidth = videoWidth;

      if (currentLevel && currentLevel.height > 0) {
        sourceHeight = currentLevel.height;
        sourceWidth = currentLevel.width;
      }

      if (!sourceHeight || sourceHeight <= 0) {
        const videoEl = client?.player?.getVideo?.();
        if (videoEl?.videoHeight > 0) {
          sourceHeight = videoEl.videoHeight;
          sourceWidth = videoEl.videoWidth;
        }
      }

      if (!sourceHeight) {
        sourceHeight = 1080;
        sourceWidth = 1920;
      }

      const duration = client?.duration || client?.player?.duration || 0;
      const estimator = DownloadModal.estimateSizes(client, duration, levelsArray);

      // Build resolution tiers <= sourceHeight
      const tierPresets = [
        {height: 2160, name: '4K (2160p)', key: 'player_download_quality_2160p'},
        {height: 1440, name: '2K (1440p)', key: 'player_download_quality_1440p'},
        {height: 1080, name: '1080p (Full HD)', key: 'player_download_quality_1080p'},
        {height: 720, name: '720p (HD)', key: 'player_download_quality_720p'},
        {height: 480, name: '480p (SD)', key: 'player_download_quality_480p'},
        {height: 360, name: '360p (Compact)', key: 'player_download_quality_360p'},
      ];

      const resolutionOptions = [];

      // 1. Source (Original) option
      const sourceOpt = {
        id: 'source',
        label: `${Localize.getMessage('player_download_quality_source') || 'Source'} (${sourceHeight}p)`,
        height: sourceHeight,
        width: sourceWidth,
        isDirect: true,
        levelId: currentLevel?.id || null,
      };
      sourceOpt.estimatedBytes = estimator.calculateVideoOptionSize(sourceOpt);
      sourceOpt.estimatedSizeFormatted = sourceOpt.estimatedBytes > 0 ? `~${DownloadModal.formatBytes(sourceOpt.estimatedBytes)}` : '';
      resolutionOptions.push(sourceOpt);

      // 2. Downsampling options strictly smaller than sourceHeight
      for (const preset of tierPresets) {
        if (sourceHeight > preset.height + 20) { // allow small margin
          const matchingLevel = levelsArray.find((l) => Math.abs(l.height - preset.height) <= 30);
          const opt = {
            id: `down_${preset.height}`,
            label: Localize.getMessage(preset.key) || preset.name,
            height: preset.height,
            width: Math.round((sourceWidth * (preset.height / sourceHeight)) / 2) * 2,
            isDirect: !!matchingLevel,
            levelId: matchingLevel?.id || null,
          };
          opt.estimatedBytes = estimator.calculateVideoOptionSize(opt);
          opt.estimatedSizeFormatted = opt.estimatedBytes > 0 ? `~${DownloadModal.formatBytes(opt.estimatedBytes)}` : '';
          resolutionOptions.push(opt);
        }
      }

      // Audio bitrates
      const audioBitrateOptions = [
        {kbps: 192, label: Localize.getMessage('player_download_bitrate_192k') || '192 kbps (High Quality)', isDefault: true},
        {kbps: 320, label: Localize.getMessage('player_download_bitrate_320k') || '320 kbps (Extreme)'},
        {kbps: 128, label: Localize.getMessage('player_download_bitrate_128k') || '128 kbps (Standard)'},
      ];

      audioBitrateOptions.forEach((opt) => {
        opt.estimatedBytes = estimator.calculateAudioOptionSize(opt.kbps);
        opt.estimatedSizeFormatted = opt.estimatedBytes > 0 ? `~${DownloadModal.formatBytes(opt.estimatedBytes)}` : '';
      });

      let selectedFormat = 'video'; // 'video' | 'audio'
      let selectedResolution = resolutionOptions[0];
      let selectedBitrate = audioBitrateOptions.find((b) => b.isDefault) || audioBitrateOptions[0];

      // Create modal container DOM
      const overlay = document.createElement('div');
      overlay.id = 'kiwi-download-modal';
      overlay.className = 'kiwi-dl-overlay';

      const sheet = document.createElement('div');
      sheet.className = 'kiwi-dl-sheet';

      sheet.innerHTML = `
        <div class="kiwi-dl-handle-bar">
          <div class="kiwi-dl-handle"></div>
        </div>
        
        <div class="kiwi-dl-header">
          <div class="kiwi-dl-title">
            <svg class="kiwi-dl-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>${Localize.getMessage('player_download_modal_title') || 'Download Options'}</span>
          </div>
          <button type="button" class="kiwi-dl-close-btn" aria-label="Close">&times;</button>
        </div>

        <div class="kiwi-dl-body">
          <!-- Filename Input -->
          <div class="kiwi-dl-field">
            <label class="kiwi-dl-label" for="kiwi-dl-filename">${Localize.getMessage('player_download_filename_label') || 'Filename'}</label>
            <div class="kiwi-dl-input-wrap">
              <input type="text" id="kiwi-dl-filename" class="kiwi-dl-input" value="${suggestedName}" spellcheck="false" autocomplete="off" />
              <span class="kiwi-dl-ext-badge" id="kiwi-dl-ext">.mp4</span>
            </div>
          </div>

          <!-- Format Tabs -->
          <div class="kiwi-dl-field">
            <div class="kiwi-dl-format-tabs">
              <button type="button" class="kiwi-dl-tab active" data-format="video">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="23 7 16 12 23 17 23 7"></polygon>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
                <span>${Localize.getMessage('player_download_format_video') || 'Full Video (MP4)'}</span>
              </button>
              <button type="button" class="kiwi-dl-tab" data-format="audio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 18V5l12-2v13"></path>
                  <circle cx="6" cy="18" r="3"></circle>
                  <circle cx="18" cy="16" r="3"></circle>
                </svg>
                <span>${Localize.getMessage('player_download_format_audio') || 'Audio Only (MP3)'}</span>
              </button>
            </div>
          </div>

          <!-- Video Resolutions Section -->
          <div class="kiwi-dl-section" id="kiwi-dl-video-section">
            <label class="kiwi-dl-label">${Localize.getMessage('player_download_quality_label') || 'Video Resolution'}</label>
            <div class="kiwi-dl-options-grid" id="kiwi-dl-res-grid"></div>
          </div>

          <!-- Audio Bitrate Section -->
          <div class="kiwi-dl-section hidden" id="kiwi-dl-audio-section">
            <label class="kiwi-dl-label">${Localize.getMessage('player_download_audio_bitrate_label') || 'MP3 Audio Quality'}</label>
            <div class="kiwi-dl-options-grid" id="kiwi-dl-bitrate-grid"></div>
          </div>
        </div>

        <div class="kiwi-dl-footer">
          <button type="button" class="kiwi-dl-btn-cancel">${Localize.getMessage('cancel') || 'Cancel'}</button>
          <button type="button" class="kiwi-dl-btn-start">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>${Localize.getMessage('player_download_start_btn') || 'Start Download'}</span>
          </button>
        </div>
      `;

      overlay.appendChild(sheet);
      document.body.appendChild(overlay);

      // Render Resolution chips
      const resGrid = sheet.querySelector('#kiwi-dl-res-grid');
      resolutionOptions.forEach((opt, index) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `kiwi-dl-chip ${index === 0 ? 'selected' : ''}`;
        chip.dataset.id = opt.id;

        const badgeClass = opt.isDirect ? 'badge-direct' : 'badge-transcode';
        const badgeText = opt.isDirect ?
          (Localize.getMessage('player_download_badge_direct') || 'Direct') :
          (Localize.getMessage('player_download_badge_downsample') || 'Downsample');

        chip.innerHTML = `
          <div class="kiwi-dl-chip-main">
            <span class="kiwi-dl-chip-label">${opt.label}</span>
            <span class="kiwi-dl-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="kiwi-dl-chip-sub">
            <span>${opt.width}x${opt.height}</span>
            ${opt.estimatedSizeFormatted ? `<span class="kiwi-dl-chip-size">${opt.estimatedSizeFormatted}</span>` : ''}
          </div>
        `;

        chip.addEventListener('click', (e) => {
          e.preventDefault();
          sheet.querySelectorAll('#kiwi-dl-res-grid .kiwi-dl-chip').forEach((c) => c.classList.remove('selected'));
          chip.classList.add('selected');
          selectedResolution = opt;
        });

        resGrid.appendChild(chip);
      });

      // Render Audio Bitrate chips
      const bitrateGrid = sheet.querySelector('#kiwi-dl-bitrate-grid');
      audioBitrateOptions.forEach((opt) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `kiwi-dl-chip ${opt.isDefault ? 'selected' : ''}`;
        chip.dataset.kbps = opt.kbps;

        chip.innerHTML = `
          <div class="kiwi-dl-chip-main">
            <span class="kiwi-dl-chip-label">${opt.label}</span>
            <span class="kiwi-dl-badge badge-mp3">MP3</span>
          </div>
          <div class="kiwi-dl-chip-sub">
            <span>~${Math.round(opt.kbps / 8 * 60 / 1024 * 10) / 10} MB/min</span>
            ${opt.estimatedSizeFormatted ? `<span class="kiwi-dl-chip-size">${opt.estimatedSizeFormatted}</span>` : ''}
          </div>
        `;

        chip.addEventListener('click', (e) => {
          e.preventDefault();
          sheet.querySelectorAll('#kiwi-dl-bitrate-grid .kiwi-dl-chip').forEach((c) => c.classList.remove('selected'));
          chip.classList.add('selected');
          selectedBitrate = opt;
        });

        bitrateGrid.appendChild(chip);
      });

      // Tab switching
      const tabs = sheet.querySelectorAll('.kiwi-dl-tab');
      const videoSection = sheet.querySelector('#kiwi-dl-video-section');
      const audioSection = sheet.querySelector('#kiwi-dl-audio-section');
      const extBadge = sheet.querySelector('#kiwi-dl-ext');

      tabs.forEach((tab) => {
        tab.addEventListener('click', (e) => {
          e.preventDefault();
          tabs.forEach((t) => t.classList.remove('active'));
          tab.classList.add('active');
          selectedFormat = tab.dataset.format;

          if (selectedFormat === 'video') {
            videoSection.classList.remove('hidden');
            audioSection.classList.add('hidden');
            extBadge.textContent = '.mp4';
          } else {
            videoSection.classList.add('hidden');
            audioSection.classList.remove('hidden');
            extBadge.textContent = '.mp3';
          }
        });
      });

      // Animate in
      requestAnimationFrame(() => {
        overlay.classList.add('active');
        sheet.classList.add('active');
      });

      const cleanup = (result) => {
        overlay.classList.remove('active');
        sheet.classList.remove('active');
        setTimeout(() => {
          overlay.remove();
          resolve(result);
        }, 220);
      };

      // Close / Cancel events
      sheet.querySelector('.kiwi-dl-close-btn').addEventListener('click', () => cleanup(null));
      sheet.querySelector('.kiwi-dl-btn-cancel').addEventListener('click', () => cleanup(null));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(null);
      });

      // Start Download event
      sheet.querySelector('.kiwi-dl-btn-start').addEventListener('click', () => {
        const inputName = sheet.querySelector('#kiwi-dl-filename').value.trim() || suggestedName;
        const result = {
          format: selectedFormat,
          filename: inputName,
          resolution: selectedResolution,
          bitrate: selectedBitrate.kbps,
          isDownsample: selectedFormat === 'video' && selectedResolution.id !== 'source' && !selectedResolution.isDirect,
          isDirectTrack: selectedFormat === 'video' && selectedResolution.isDirect,
          targetLevelId: selectedResolution.levelId,
          targetHeight: selectedResolution.height,
          targetWidth: selectedResolution.width,
          estimatedBytes: selectedFormat === 'video' ? selectedResolution.estimatedBytes : selectedBitrate.estimatedBytes,
        };
        cleanup(result);
      });
    });
  }

  /**
   * Open the Active Download Task Bottom Sheet
   * @param {Object} taskState
   */
  static showActiveTask(taskState) {
    if (!taskState) return;

    // If modal already open for this active task, simply update and bring into view
    const existing = document.getElementById('kiwi-download-modal');
    if (existing && DownloadModal.activeModalInstance?.type === 'activeTask') {
      DownloadModal.updateActiveTask(taskState);
      existing.classList.add('active');
      return;
    }

    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'kiwi-download-modal';
    overlay.className = 'kiwi-dl-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'kiwi-dl-sheet';

    const formatPct = (p) => `${Math.min(100, Math.max(0, Math.round((p || 0) * 100)))}%`;

    sheet.innerHTML = `
      <div class="kiwi-dl-handle-bar">
        <div class="kiwi-dl-handle"></div>
      </div>
      
      <div class="kiwi-dl-header">
        <div class="kiwi-dl-title">
          <svg class="kiwi-dl-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span id="kiwi-dl-active-header-title">${taskState.title || 'Active Download'}</span>
        </div>
        <button type="button" class="kiwi-dl-close-btn" aria-label="Close">&times;</button>
      </div>

      <div class="kiwi-dl-body">
        <div class="kiwi-dl-active-card">
          <div class="kiwi-dl-task-meta">
            <div class="kiwi-dl-task-info">
              <div class="kiwi-dl-task-title" id="kiwi-dl-task-title">${taskState.title || 'Processing media...'}</div>
              <div class="kiwi-dl-task-file">
                <span id="kiwi-dl-task-name">${taskState.filename || 'video'}</span>
                <span class="kiwi-dl-ext-badge" id="kiwi-dl-task-ext">.${taskState.extension || 'mp4'}</span>
              </div>
            </div>
            <div class="kiwi-dl-status-badge ${taskState.isPaused ? 'status-paused' : 'status-running'}" id="kiwi-dl-status-badge">
              ${taskState.isPaused ? 'Paused' : 'Active'}
            </div>
          </div>

          <div class="kiwi-dl-progress-box">
            <div class="kiwi-dl-progress-track">
              <div class="kiwi-dl-progress-fill ${taskState.isPaused ? 'paused' : ''}" id="kiwi-dl-progress-fill" style="width: ${formatPct(taskState.progress)};"></div>
            </div>
            <div class="kiwi-dl-progress-labels">
              <span class="kiwi-dl-progress-phase" id="kiwi-dl-progress-phase">${taskState.phase || 'Downloading...'}</span>
              <span class="kiwi-dl-progress-pct" id="kiwi-dl-progress-pct">${formatPct(taskState.progress)}</span>
            </div>
          </div>

          <div class="kiwi-dl-metrics-grid">
            <div class="kiwi-dl-metric-card">
              <span class="kiwi-dl-metric-label">Data</span>
              <span class="kiwi-dl-metric-val" id="kiwi-dl-metric-size">${DownloadModal.formatBytes(taskState.currentBytes || 0)} / ~${DownloadModal.formatBytes(taskState.totalBytes || 0)}</span>
            </div>
            <div class="kiwi-dl-metric-card">
              <span class="kiwi-dl-metric-label">Speed</span>
              <span class="kiwi-dl-metric-val" id="kiwi-dl-metric-speed">${taskState.speedFormatted || (taskState.isPaused ? '0 KB/s' : '--')}</span>
            </div>
            <div class="kiwi-dl-metric-card">
              <span class="kiwi-dl-metric-label">Remaining</span>
              <span class="kiwi-dl-metric-val" id="kiwi-dl-metric-eta">${taskState.isPaused ? 'Paused' : (taskState.etaFormatted || 'calculating...')}</span>
            </div>
          </div>

          <div class="kiwi-dl-active-actions">
            <button type="button" class="kiwi-dl-btn-action ${taskState.isPaused ? 'kiwi-dl-btn-resume' : 'kiwi-dl-btn-pause'}" id="kiwi-dl-btn-pause-toggle">
              ${taskState.isPaused ? `
                <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Resume</span>
              ` : `
                <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                <span>Pause</span>
              `}
            </button>
            <button type="button" class="kiwi-dl-btn-action kiwi-dl-btn-stop" id="kiwi-dl-btn-stop-task">
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
              <span>Stop</span>
            </button>
          </div>

          <div class="kiwi-dl-bg-hint">
            ${Localize.getMessage('player_download_bg_hint') || 'Closing this sheet keeps the download running in the background.'}
          </div>
        </div>
      </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    DownloadModal.activeModalInstance = {
      type: 'activeTask',
      overlay,
      sheet,
      taskState,
    };

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('active');
      sheet.classList.add('active');
    });

    const hide = () => {
      overlay.classList.remove('active');
      sheet.classList.remove('active');
      setTimeout(() => {
        if (DownloadModal.activeModalInstance?.overlay === overlay) {
          DownloadModal.activeModalInstance = null;
        }
        overlay.remove();
      }, 220);
    };

    // Close button / backdrop tap: closes sheet, task continues in background
    sheet.querySelector('.kiwi-dl-close-btn').addEventListener('click', hide);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hide();
    });

    // Pause/Resume button
    const pauseBtn = sheet.querySelector('#kiwi-dl-btn-pause-toggle');
    pauseBtn.addEventListener('click', () => {
      if (taskState.togglePause) {
        taskState.togglePause();
      }
      DownloadModal.updateActiveTask(taskState);
    });

    // Stop button
    const stopBtn = sheet.querySelector('#kiwi-dl-btn-stop-task');
    stopBtn.addEventListener('click', async () => {
      const confirmMsg = Localize.getMessage('player_download_stop_confirm') || 'Stop and cancel the active download?';
      const ok = await AlertPolyfill.confirm(confirmMsg, 'warning');
      if (ok) {
        if (taskState.cancel) {
          taskState.cancel();
        }
        hide();
      }
    });
  }

  /**
   * Update active download task sheet in real-time
   * @param {Object} taskState
   */
  static updateActiveTask(taskState) {
    if (!taskState) return;

    const overlay = document.getElementById('kiwi-download-modal');
    if (!overlay) return;

    const formatPct = (p) => `${Math.min(100, Math.max(0, Math.round((p || 0) * 100)))}%`;

    const fill = overlay.querySelector('#kiwi-dl-progress-fill');
    const phaseEl = overlay.querySelector('#kiwi-dl-progress-phase');
    const pctEl = overlay.querySelector('#kiwi-dl-progress-pct');
    const sizeEl = overlay.querySelector('#kiwi-dl-metric-size');
    const speedEl = overlay.querySelector('#kiwi-dl-metric-speed');
    const etaEl = overlay.querySelector('#kiwi-dl-metric-eta');
    const badgeEl = overlay.querySelector('#kiwi-dl-status-badge');
    const pauseBtn = overlay.querySelector('#kiwi-dl-btn-pause-toggle');
    const titleEl = overlay.querySelector('#kiwi-dl-task-title');

    if (titleEl && taskState.title) titleEl.textContent = taskState.title;

    if (fill) {
      fill.style.width = formatPct(taskState.progress);
      if (taskState.isPaused) {
        fill.classList.add('paused');
      } else {
        fill.classList.remove('paused');
      }
    }

    if (phaseEl && taskState.phase) phaseEl.textContent = taskState.phase;
    if (pctEl) pctEl.textContent = formatPct(taskState.progress);

    if (sizeEl) {
      const cur = DownloadModal.formatBytes(taskState.currentBytes || 0);
      const tot = DownloadModal.formatBytes(taskState.totalBytes || 0);
      sizeEl.textContent = `${cur} / ~${tot}`;
    }

    if (speedEl) {
      speedEl.textContent = taskState.isPaused ? '0 KB/s' : (taskState.speedFormatted || '--');
    }

    if (etaEl) {
      etaEl.textContent = taskState.isPaused ? 'Paused' : (taskState.etaFormatted || 'calculating...');
    }

    if (badgeEl) {
      badgeEl.className = `kiwi-dl-status-badge ${taskState.isPaused ? 'status-paused' : 'status-running'}`;
      badgeEl.textContent = taskState.isPaused ? 'Paused' : 'Active';
    }

    if (pauseBtn) {
      pauseBtn.className = `kiwi-dl-btn-action ${taskState.isPaused ? 'kiwi-dl-btn-resume' : 'kiwi-dl-btn-pause'}`;
      pauseBtn.innerHTML = taskState.isPaused ? `
        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>Resume</span>
      ` : `
        <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
        <span>Pause</span>
      `;
    }
  }

  /**
   * Close active task modal if open
   */
  static closeActiveTask() {
    const existing = document.getElementById('kiwi-download-modal');
    if (existing && DownloadModal.activeModalInstance?.type === 'activeTask') {
      existing.classList.remove('active');
      setTimeout(() => {
        existing.remove();
        DownloadModal.activeModalInstance = null;
      }, 220);
    }
  }
}
