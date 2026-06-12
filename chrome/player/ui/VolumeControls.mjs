import {EventEmitter} from '../modules/eventemitter.mjs';
import {Localize} from '../modules/Localize.mjs';
import {EnvUtils} from '../utils/EnvUtils.mjs';
import {Utils} from '../utils/Utils.mjs';
import {WebUtils} from '../utils/WebUtils.mjs';
import {DOMElements} from './DOMElements.mjs';

const MAX_VOLUME = EnvUtils.isWebAudioSupported() ? 3 : 1;

if (!EnvUtils.isWebAudioSupported()) {
  DOMElements.volumeUnity.style.display = 'none';
}

export class VolumeControls extends EventEmitter {
  constructor(client) {
    super();
    this.client = client;
    this.volume = 1;
    this.previousVolume = 1;
    this.muted = false;
    this.autoHideTimeout = null;
  }

  setupUI() {
    DOMElements.volumeContainer.addEventListener('mousedown', this.onVolumeBarMouseDown.bind(this));
    DOMElements.volumeContainer.addEventListener('touchstart', this.onVolumeBarMouseDown.bind(this), { passive: false });
    DOMElements.volumeContainer.addEventListener('dblclick', (e) => {
      this.setVolume(1);
      e.stopPropagation();
    });
    DOMElements.muteBtn.addEventListener('click', this.handleVolumeIconClick.bind(this));
    DOMElements.volumeBlock.tabIndex = 0;
    DOMElements.volumeBlock.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.muteToggle();
        e.stopPropagation();
      } else if (e.key === 'ArrowLeft') {
        this.setVolume(Math.max(0, this.volume - 0.1));
      } else if (e.key === 'ArrowRight') {
        this.setVolume(Math.min(1, this.volume + 0.1));
        e.stopPropagation();
      }
    });

    DOMElements.volumeBlock.addEventListener('wheel', (e) => {
      let delta = e.deltaY;
      if (!EnvUtils.isMacOS()) {
        delta = -delta;
      }
      this.setVolume(Math.max(0, Math.min(3, this.client.volume + Utils.clamp(delta, -1, 1) * 0.01)));
      e.preventDefault();
      e.stopPropagation();
    });

    this.loadVolumeState();
  }

  setVolume(volume, dontSave = false) {
    if (volume < 0) {
      volume = 0;
    }

    if (volume > MAX_VOLUME) {
      volume = max;
    }

    if (volume === 0 && this.volume !== 0) {
      this.previousVolume = this.volume;
    }

    this.muted = volume === 0;
    this.volume = volume;

    this.updateVolumeBar(volume);

    if (!dontSave) {
      this.saveVolumeState();
    }

    this.emit('volume', volume);
  }

  muteToggle() {
    if (0 !== this.volume && !this.muted) {
      this.setVolume(0);
    } else {
      this.setVolume(this.previousVolume);
    }
  }

  onVolumeBarMouseDown(event) {
    if (event.cancelable) {
      event.preventDefault();
    }

    this.clearVolumeAutoHide();
    DOMElements.volumeBlock.classList.add('expanded');

    const { clientX: initX } = this.getCoordinates(event);
    const initialPosition = Math.min(Math.max(initX - WebUtils.getOffsetLeft(DOMElements.volumeContainer) - 10, 0), DOMElements.volumeControlBar.clientWidth);

    const shiftVolume = (volumeBarX) => {
      const totalWidth = DOMElements.volumeControlBar.clientWidth;

      if (totalWidth) {
        const newVolume = volumeBarX / totalWidth * MAX_VOLUME;

        if (newVolume < 0.025) {
          this.setVolume(0);
        } else if (newVolume > 2.975) {
          this.setVolume(3);
        } else if (newVolume > 0.975 && newVolume < 1.025) {
          this.setVolume(1);
        } else {
          this.setVolume(newVolume);
        }
      }
    };

    if (!isNaN(initialPosition)) {
      shiftVolume(initialPosition);
    }

    const onVolumeBarMouseMove = (event) => {
      if (event.cancelable) {
        event.preventDefault();
      }
      this.clearVolumeAutoHide();
      const { clientX } = this.getCoordinates(event);
      const currentX = clientX - WebUtils.getOffsetLeft(DOMElements.volumeContainer) - 10;
      shiftVolume(currentX);
    };

    const onVolumeBarMouseUp = (event) => {
      DOMElements.playerContainer.removeEventListener('mousemove', onVolumeBarMouseMove);
      DOMElements.playerContainer.removeEventListener('touchmove', onVolumeBarMouseMove);
      DOMElements.playerContainer.removeEventListener('mouseup', onVolumeBarMouseUp);
      DOMElements.playerContainer.removeEventListener('touchend', onVolumeBarMouseUp);

      const { clientX } = this.getCoordinates(event);
      let currentX = clientX - WebUtils.getOffsetLeft(DOMElements.volumeContainer) - 10;

      if (isNaN(currentX) && !isNaN(initialPosition)) {
        currentX = initialPosition;
      }

      if (!isNaN(currentX)) {
        shiftVolume(currentX);
      }
      this.queueVolumeAutoHide();
    };

    DOMElements.playerContainer.addEventListener('mouseup', onVolumeBarMouseUp);
    DOMElements.playerContainer.addEventListener('touchend', onVolumeBarMouseUp);
    DOMElements.playerContainer.addEventListener('mousemove', onVolumeBarMouseMove);
    DOMElements.playerContainer.addEventListener('touchmove', onVolumeBarMouseMove);

    event.stopPropagation();
  }

  handleVolumeIconClick(event) {
    event.stopPropagation();
    event.preventDefault();

    const isVisible = DOMElements.volumeContainer && DOMElements.volumeContainer.clientWidth > 0;

    if (!isVisible) {
      DOMElements.volumeBlock.classList.add('expanded');
      this.queueVolumeAutoHide();
    } else {
      this.muteToggle();
      this.queueVolumeAutoHide();
    }
  }

  onPlay() {
    this.queueVolumeAutoHide();
  }

  onPause() {
    this.clearVolumeAutoHide();
  }

  queueVolumeAutoHide() {
    this.clearVolumeAutoHide();
    if (this.client.state && this.client.state.playing) {
      const timeoutMs = this.client.options.kiwiControlsHideTimeout ?? 2000;
      this.autoHideTimeout = setTimeout(() => {
        if (this.client.state && this.client.state.playing) {
          DOMElements.volumeBlock.classList.remove('expanded');
        }
      }, timeoutMs);
    }
  }

  clearVolumeAutoHide() {
    if (this.autoHideTimeout) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
    }
  }

  getCoordinates(event) {
    let clientX = event.clientX;
    let clientY = event.clientY;

    if (event.touches && event.touches.length > 0) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) {
      clientX = event.changedTouches[0].clientX;
      clientY = event.changedTouches[0].clientY;
    }

    return { clientX, clientY };
  }

  updateVolumeBar(volume) {
    const currentVolumeTag = DOMElements.currentVolume;
    const muteButtonTag = DOMElements.muteBtn;

    if (volume === 0) {
      muteButtonTag.classList.add('muted');
    } else {
      muteButtonTag.classList.remove('muted');
    }

    currentVolumeTag.style.width = (volume * 100) / MAX_VOLUME + '%';
    DOMElements.currentVolumeText.textContent = Math.round(volume * 100) + '%';

    DOMElements.volumeBanner.textContent = Math.round(volume * 100) + '%';
    if (volume === 1 || volume === 0) {
      DOMElements.volumeBanner.style.display = 'none';
    } else {
      DOMElements.volumeBanner.style.display = '';
    }

    WebUtils.setLabels(DOMElements.volumeBlock, Localize.getMessage('player_volume_label', [Math.round(volume * 100)]));
  }

  async loadVolumeState() {
    const state = await Utils.loadAndParseOptions('volumeState', {
      volume: 1,
    });
    this.setVolume(state.volume, true);
  }

  async saveVolumeState() {
    await Utils.setConfig('volumeState', JSON.stringify({
      volume: this.volume,
    }));
  }
}
