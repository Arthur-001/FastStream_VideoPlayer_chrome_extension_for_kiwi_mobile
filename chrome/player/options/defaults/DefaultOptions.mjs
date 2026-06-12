import {YoutubeClients} from '../../enums/YoutubeClients.mjs';
import {EnvUtils} from '../../utils/EnvUtils.mjs';
import {ClickActions} from './ClickActions.mjs';
import {ColorThemes} from './ColorThemes.mjs';
import {DaltonizerTypes} from './DaltonizerTypes.mjs';
import {DefaultKeybinds} from './DefaultKeybinds.mjs';
import {MiniplayerPositions} from './MiniplayerPositions.mjs';
import {VisChangeActions} from './VisChangeActions.mjs';

export const DefaultOptions = {
  dev: false,
  replaceDelay: 500,
  playMP4URLs: false,
  playStreamURLs: false,
  analyzeVideos: false,
  downloadAll: true,
  previewEnabled: true,
  autoEnableBestSubtitles: false,
  storeProgress: true,
  autoplayYoutube: EnvUtils.isExtension(),
  autoplayNext: false,
  defaultYoutubeClient: YoutubeClients.WEB,
  defaultQuality: `Auto`,
  colorTheme: ColorThemes.DEFAULT,
  autoEnableURLs: [],
  customSourcePatterns: ``,
  keybinds: DefaultKeybinds,
  videoBrightness: 1,
  videoContrast: 1,
  videoSaturation: 1,
  videoGrayscale: 0,
  videoSepia: 0,
  videoInvert: 0,
  videoHueRotate: 0,
  videoDaltonizerType: DaltonizerTypes.NONE,
  videoDaltonizerStrength: 1,
  videoZoom: 1,
  maxSpeed: -1,
  maxVideoSize: 5000000000, // 5GB max size
  seekStepSize: 2,
  singleClickAction: ClickActions.PLAY_PAUSE,
  doubleClickAction: ClickActions.FULLSCREEN,
  tripleClickAction: ClickActions.HIDE_CONTROLS,
  visChangeAction: VisChangeActions.NOTHING,
  miniSize: 0.25,
  miniPos: MiniplayerPositions.BOTTOM_RIGHT,
  videoDelay: 0,
  maximumDownloaders: 6,
  youtubePlayerID: '',

  // --- Mobile Controls (Kiwi Browser) ---
  // Touch gesture seek settings
  tapSeekSeconds: 10,       // Seconds to seek per additional tap
  tapZonePercent: 40,       // Width % of each left/right tap zone (center = 100 - 2*tapZonePercent)
  tapWindowMs: 500,         // Tap accumulation window in milliseconds
  tapZoneLockZone: true,    // When true, zone switches mid-session are ignored (finish original direction)

  // Fullscreen Guard settings
  kiwiGuardEnabled: true,          // Master toggle for all guard features
  kiwiGuardBlockRedirects: true,   // Block JS/HTML auto-redirects while player is active
  kiwiGuardOverlayNeutralize: true, // Make overlay ads non-interactive (pointer-events:none + opacity)
  kiwiGuardOverlayZIndex: true,    // Push overlays behind the player via z-index manipulation
};
