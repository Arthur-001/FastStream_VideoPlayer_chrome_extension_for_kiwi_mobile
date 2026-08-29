import {Localize} from '../modules/Localize.mjs';

/**
 * Mobile-optimized Touch Download Modal for Kiwi Browser & Desktop
 */
export class DownloadModal {
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
      resolutionOptions.push({
        id: 'source',
        label: `${Localize.getMessage('player_download_quality_source') || 'Source'} (${sourceHeight}p)`,
        height: sourceHeight,
        width: sourceWidth,
        isDirect: true,
        levelId: currentLevel?.id || null,
      });

      // 2. Downsampling options strictly smaller than sourceHeight
      for (const preset of tierPresets) {
        if (sourceHeight > preset.height + 20) { // allow small margin
          // Check if manifest already has a stream matching this resolution
          const matchingLevel = levelsArray.find((l) => Math.abs(l.height - preset.height) <= 30);
          resolutionOptions.push({
            id: `down_${preset.height}`,
            label: Localize.getMessage(preset.key) || preset.name,
            height: preset.height,
            width: Math.round((sourceWidth * (preset.height / sourceHeight)) / 2) * 2,
            isDirect: !!matchingLevel,
            levelId: matchingLevel?.id || null,
          });
        }
      }

      // Audio bitrates
      const audioBitrateOptions = [
        {kbps: 192, label: Localize.getMessage('player_download_bitrate_192k') || '192 kbps (High Quality)', isDefault: true},
        {kbps: 320, label: Localize.getMessage('player_download_bitrate_320k') || '320 kbps (Extreme)'},
        {kbps: 128, label: Localize.getMessage('player_download_bitrate_128k') || '128 kbps (Standard)'},
      ];

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
          <div class="kiwi-dl-chip-sub">${opt.width}x${opt.height}</div>
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
          <div class="kiwi-dl-chip-sub">~${Math.round(opt.kbps / 8 * 60 / 1024 * 10) / 10} MB/min</div>
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
        };
        cleanup(result);
      });
    });
  }
}
