import {DefaultKeybinds} from './defaults/DefaultKeybinds.mjs';
import {EnvUtils} from '../utils/EnvUtils.mjs';
import {StringUtils} from '../utils/StringUtils.mjs';
import {Utils} from '../utils/Utils.mjs';
import {WebUtils} from '../utils/WebUtils.mjs';
import {DefaultOptions} from './defaults/DefaultOptions.mjs';
import {Localize} from '../modules/Localize.mjs';
import {OptionsStore} from './OptionsStore.mjs';
import {resetSearch, searchWithQuery, initsearch} from '../utils/SearchUtils.mjs';

import {UpdateChecker} from '../utils/UpdateChecker.mjs'; // SPLICER:NO_UPDATE_CHECKER:REMOVE_LINE
import {ClickActions} from './defaults/ClickActions.mjs';
import {VisChangeActions} from './defaults/VisChangeActions.mjs';
import {MiniplayerPositions} from './defaults/MiniplayerPositions.mjs';
import {DefaultSubtitlesSettings} from './defaults/DefaultSubtitlesSettings.mjs';
import {DaltonizerTypes} from './defaults/DaltonizerTypes.mjs';
import {DefaultToolSettings} from './defaults/ToolSettings.mjs';
import {DefaultQualities} from './defaults/DefaultQualities.mjs';
import {ColorThemes} from './defaults/ColorThemes.mjs';

let Options = {};
const analyzeVideos = document.getElementById('analyzevideos');
const playStreamURLs = document.getElementById('playstreamurls');
const playMP4URLs = document.getElementById('playmp4urls');
const downloadAll = document.getElementById('downloadall');
const keybindsList = document.getElementById('keybindslist');
const autoEnableURLSInput = document.getElementById('autoEnableURLs');
const autoSub = document.getElementById('autosub');
const maxSpeed = document.getElementById('maxspeed');
const maxSize = document.getElementById('maxsize');
const seekStepSize = document.getElementById('seekstepsize');
const autoplayYoutube = document.getElementById('autoplayyt');
const autoplayNext = document.getElementById('autoplaynext');
const qualityMenu = document.getElementById('quality');
const importButton = document.getElementById('import');
const exportButton = document.getElementById('export');
const clickAction = document.getElementById('clickaction');
const dblclickAction = document.getElementById('dblclickaction');
const tplclickAction = document.getElementById('tplclickaction');
const visChangeAction = document.getElementById('vischangeaction');
const customSourcePatterns = document.getElementById('customSourcePatterns');
const showWhenMiniSelected = document.getElementById('showWhenMiniSelected');
const storeProgress = document.getElementById('storeprogress');
const miniSize = document.getElementById('minisize');
const miniPos = document.getElementById('minipos');
const daltonizerType = document.getElementById('daltonizerType');
const daltonizerStrength = document.getElementById('daltonizerStrength');
const previewEnabled = document.getElementById('previewenabled');
const replaceDelay = document.getElementById('replacedelay');
const colorTheme = document.getElementById('colortheme');
const ytPlayerID = document.getElementById('ytplayerid');
const optionsSearchBar = document.getElementById('searchbar');
const optionsResetButton = document.getElementById('resetsearch');
// const ytclient = document.getElementById('ytclient');
const maxdownloaders = document.getElementById('maxdownloaders');

// Mobile Controls (Kiwi Browser)
const tapSeekSeconds = document.getElementById('tapseekseconds');
const tapZonePercent = document.getElementById('tapzonepercent');
const tapWindowMs = document.getElementById('tapwindowms');
const tapZoneLockZone = document.getElementById('tapzonelockzone');
const kiwiControlsHideTimeout = document.getElementById('kiwicontrolshidetimeout');
const kiwiGuardEnabled = document.getElementById('kiwiguardenabled');
const kiwiGuardBlockRedirects = document.getElementById('kiwiguardblockedirects');
const kiwiGuardOverlayNeutralize = document.getElementById('kiwiguardoverlayneutralize');
const kiwiGuardOverlayZIndex = document.getElementById('kiwiguardoverlayzindex');
const kiwiGuardSubOptions = document.getElementById('kiwi-guard-sub-options');
const kiwiKeepScreenOn = document.getElementById('kiwakeepscreenon');
const resetMobileOptions = document.getElementById('resetmobileoptions');
// Flow Drag Seek controls
const dragSeekSensitivity = document.getElementById('dragseeksensitivity');
const dragActivationHoldMs = document.getElementById('dragactivationholdms');
const dragSeekTransitionMs = document.getElementById('dragseektransitionms');
autoEnableURLSInput.setAttribute('autocapitalize', 'off');
autoEnableURLSInput.setAttribute('autocomplete', 'off');
autoEnableURLSInput.setAttribute('autocorrect', 'off');
autoEnableURLSInput.setAttribute('spellcheck', false);
autoEnableURLSInput.placeholder = 'https://example.com/movie/\n~^https:\\/\\/example\\.com\\/(movie|othermovie)\\/';

customSourcePatterns.setAttribute('autocapitalize', 'off');
customSourcePatterns.setAttribute('autocomplete', 'off');
customSourcePatterns.setAttribute('autocorrect', 'off');
customSourcePatterns.setAttribute('spellcheck', false);
customSourcePatterns.placeholder = '# This is a comment. Use the following format.\n[file extension] /[regex]/[flags]';

// Initialize store and then load page controls
OptionsStore.init().then(() => loadOptions(OptionsStore.get()));


if (!EnvUtils.isExtension()) {
  analyzeVideos.disabled = true;
  playStreamURLs.disabled = true;
  playMP4URLs.disabled = true;
  autoSub.disabled = true;
  autoplayYoutube.disabled = true;
  autoEnableURLSInput.disabled = true;
  customSourcePatterns.disabled = true;
  miniSize.disabled = true;
  // ytclient.disabled = true;
  autoplayNext.disabled = true;
}

if (EnvUtils.isSafari()) {
  daltonizerType.disabled = true;
  daltonizerStrength.disabled = true;
}

async function loadOptions(newOptions) {
  newOptions = newOptions || OptionsStore.get();
  Options = newOptions;

  downloadAll.checked = !!Options.downloadAll;
  analyzeVideos.checked = !!Options.analyzeVideos;
  playStreamURLs.checked = !!Options.playStreamURLs;
  playMP4URLs.checked = !!Options.playMP4URLs;
  previewEnabled.checked = !!Options.previewEnabled;
  autoSub.checked = !!Options.autoEnableBestSubtitles;
  autoplayYoutube.checked = !!Options.autoplayYoutube;
  autoplayNext.checked = !!Options.autoplayNext;
  maxSpeed.value = StringUtils.getSpeedString(Options.maxSpeed, true);
  maxSize.value = StringUtils.getSizeString(Options.maxVideoSize);
  seekStepSize.value = Math.round(Options.seekStepSize * 100) / 100;
  customSourcePatterns.value = Options.customSourcePatterns || '';
  miniSize.value = Options.miniSize;
  storeProgress.checked = !!Options.storeProgress;
  replaceDelay.value = Options.replaceDelay;
  maxdownloaders.value = Options.maximumDownloaders;
  ytPlayerID.value = Options.youtubePlayerID;

  // Mobile Controls
  tapSeekSeconds.value = Options.tapSeekSeconds ?? 10;
  clearInputError(tapSeekSeconds);
  tapZonePercent.value = Options.tapZonePercent ?? 40;
  clearInputError(tapZonePercent);
  tapWindowMs.value = Options.tapWindowMs ?? 500;
  clearInputError(tapWindowMs);
  tapZoneLockZone.checked = Options.tapZoneLockZone !== false;
  kiwiControlsHideTimeout.value = Options.kiwiControlsHideTimeout ?? 2000;
  clearInputError(kiwiControlsHideTimeout);
  kiwiGuardEnabled.checked = Options.kiwiGuardEnabled !== false;
  kiwiGuardBlockRedirects.checked = Options.kiwiGuardBlockRedirects !== false;
  kiwiGuardOverlayNeutralize.checked = Options.kiwiGuardOverlayNeutralize !== false;
  kiwiGuardOverlayZIndex.checked = Options.kiwiGuardOverlayZIndex !== false;
  kiwiKeepScreenOn.checked = Options.kiwiKeepScreenOn !== false;
  updateKiwiGuardSubOptions();
  // Flow Drag Seek
  dragSeekSensitivity.value = Options.dragSeekSensitivity ?? 0.3;
  clearInputError(dragSeekSensitivity);
  dragActivationHoldMs.value = Options.dragActivationHoldMs ?? 150;
  clearInputError(dragActivationHoldMs);
  dragSeekTransitionMs.value = Options.dragSeekTransitionMs ?? 150;
  clearInputError(dragSeekTransitionMs);

  setSelectMenuValue(daltonizerType, Options.videoDaltonizerType);
  setSelectMenuValue(clickAction, Options.singleClickAction);
  setSelectMenuValue(dblclickAction, Options.doubleClickAction);
  setSelectMenuValue(tplclickAction, Options.tripleClickAction);
  setSelectMenuValue(visChangeAction, Options.visChangeAction);
  setSelectMenuValue(colorTheme, Options.colorTheme);
  setSelectMenuValue(miniPos, Options.miniPos);
  setSelectMenuValue(qualityMenu, Options.defaultQuality);
  // setSelectMenuValue(ytclient, Options.defaultYoutubeClient);

  document.body.dataset.theme = Options.colorTheme;

  if (Options.visChangeAction === VisChangeActions.MINI_PLAYER) {
    showWhenMiniSelected.style.display = '';
  } else {
    showWhenMiniSelected.style.display = 'none';
  }

  if (Options.videoDaltonizerType === DaltonizerTypes.NONE) {
    daltonizerStrength.style.display = 'none';
  } else {
    daltonizerStrength.style.display = '';
  }

  if (Options.keybinds) {
    keybindsList.replaceChildren();
    for (const keybind in Options.keybinds) {
      if (Object.hasOwn(Options.keybinds, keybind)) {
        createKeybindElement(keybind);
      }
    }
  }

  document.querySelectorAll('.video-option').forEach((option) => {
    const numberInput = option.querySelector('input.number');
    const rangeInput = option.querySelector('input.range');
    const unit = option.dataset.unit || '%';
    const unitMultiplier = parseInt(option.dataset.multiplier || 100);
    const optionKey = option.dataset.option;
    const val = Math.round(Options[optionKey] * unitMultiplier);
    rangeInput.value = val;
    numberInput.value = val + unit;
  });

  autoEnableURLSInput.value = Options.autoEnableURLs.join('\n');

  if (Options.dev) {
    document.getElementById('dev').style.display = '';
  }
  initsearch();
}

function createSelectMenu(container, options, selected, localPrefix, callback) {
  container.replaceChildren();
  const select = document.createElement('select');
  for (const option of options) {
    const optionElement = document.createElement('option');
    optionElement.value = option;
    optionElement.textContent = localPrefix !== null ? Localize.getMessage(localPrefix + '_' + option) : option;
    if (option === selected) {
      optionElement.selected = true;
    }
    select.appendChild(optionElement);
  }
  select.addEventListener('change', callback);
  container.appendChild(select);
}

function setSelectMenuValue(container, value) {
  const select = container.querySelector('select');
  if (!select) {
    return;
  }
  select.value = value;
}

createSelectMenu(daltonizerType, Object.values(DaltonizerTypes), Options.videoDaltonizerType, 'options_video_daltonizer', (e) => {
  Options.videoDaltonizerType = e.target.value;
  if (Options.videoDaltonizerType === DaltonizerTypes.NONE) {
    daltonizerStrength.style.display = 'none';
  } else {
    daltonizerStrength.style.display = '';
  }
  optionChanged();
});

createSelectMenu(clickAction, Object.values(ClickActions), Options.singleClickAction, 'options_general_clickaction', (e) => {
  Options.singleClickAction = e.target.value;
  optionChanged();
});

createSelectMenu(dblclickAction, Object.values(ClickActions), Options.doubleClickAction, 'options_general_clickaction', (e) => {
  Options.doubleClickAction = e.target.value;
  optionChanged();
});

createSelectMenu(tplclickAction, Object.values(ClickActions), Options.tripleClickAction, 'options_general_clickaction', (e) => {
  Options.tripleClickAction = e.target.value;
  optionChanged();
});

createSelectMenu(visChangeAction, Object.values(VisChangeActions), Options.visChangeAction, 'options_general_vischangeaction', (e) => {
  Options.visChangeAction = e.target.value;
  if (Options.visChangeAction === VisChangeActions.MINI_PLAYER) {
    showWhenMiniSelected.style.display = '';
  } else {
    showWhenMiniSelected.style.display = 'none';
  }
  optionChanged();
});

createSelectMenu(colorTheme, Object.values(ColorThemes), Options.colorTheme, 'options_general_color_theme', (e) => {
  Options.colorTheme = e.target.value;
  optionChanged();
});

createSelectMenu(miniPos, Object.values(MiniplayerPositions), Options.miniPos, 'options_general_minipos', (e) => {
  Options.miniPos = e.target.value;
  optionChanged();
});

createSelectMenu(qualityMenu, Object.values(DefaultQualities), Options.defaultQuality, null, (e) => {
  Options.defaultQuality = e.target.value;
  optionChanged();
});

// createSelectMenu(ytclient, Object.values(YoutubeClients), Options.defaultYoutubeClient, null, (e) => {
//   Options.defaultYoutubeClient = e.target.value;
//   optionChanged();
// });

document.querySelectorAll('.option').forEach((option) => {
  option.addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') {
      const input = option.querySelector('input');
      if (input) {
        if (input.type === 'checkbox') {
          input.click();
        } else {
          input.focus();
        }
      } else {
        const select = option.querySelector('select');
        if (select) {
          select.focus();
        }
      }
    }
  });

  const input = option.querySelector('input');
  if (input) {
    WebUtils.setupTabIndex(input);
  }
});

document.querySelectorAll('.video-option').forEach((option) => {
  const numberInput = option.querySelector('input.number');
  const rangeInput = option.querySelector('input.range');
  const unit = option.dataset.unit || '%';
  const unitMultiplier = parseInt(option.dataset.multiplier || 100);

  const optionKey = option.dataset.option;

  function numberInputChanged() {
    const value = parseInt(numberInput.value.replace(unit, '')) || 0;
    rangeInput.value = value;
    Options[optionKey] = (option.dataset.nolimits ? value : parseInt(rangeInput.value)) / unitMultiplier;
    optionChanged();
  }

  function rangeInputChanged() {
    numberInput.value = rangeInput.value + unit;
    Options[optionKey] = parseInt(rangeInput.value) / unitMultiplier;
    optionChanged();
  }

  numberInput.addEventListener('change', numberInputChanged);
  numberInput.addEventListener('input', numberInputChanged);
  rangeInput.addEventListener('change', rangeInputChanged);
  rangeInput.addEventListener('input', rangeInputChanged);
  rangeInput.addEventListener('dblclick', (e) => {
    Options[optionKey] = DefaultOptions[optionKey];
    rangeInput.value = Math.round(Options[optionKey] * unitMultiplier);
    numberInput.value = rangeInput.value + unit;
    optionChanged();
  });
});

function createKeybindElement(keybind) {
  const containerElement = document.createElement('div');
  containerElement.classList.add('keybind-container');
  containerElement.classList.add('search-target-remove-keybind');

  const keybindNameElement = document.createElement('div');
  keybindNameElement.classList.add('keybind-name');
  keybindNameElement.classList.add('search-target-keybind');
  const keybindName = keybind.replace(/([A-Z])/g, ' $1').trim();
  keybindNameElement.textContent = keybindName;
  containerElement.appendChild(keybindNameElement);

  const keybindInput = document.createElement('div');
  keybindInput.classList.add('keybind-input');
  keybindInput.classList.add('search-target-keybind');
  keybindInput.tabIndex = 0;
  keybindInput.title = keybindName;
  keybindInput.role = 'button';
  keybindInput.textContent = Options.keybinds[keybind];

  keybindInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      return;
    } else if (e.key === 'Escape') {
      keybindInput.textContent = Options.keybinds[keybind] = 'None';
      optionChanged();
      keybindInput.blur();
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    keybindInput.textContent = WebUtils.getKeyString(e);
    Options.keybinds[keybind] = keybindInput.textContent;
    optionChanged();
  });

  keybindInput.addEventListener('keyup', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  keybindInput.addEventListener('click', (e) => {
    keybindInput.textContent = 'Press a key';
  });

  keybindInput.addEventListener('blur', (e) => {
    keybindInput.textContent = Options.keybinds[keybind];
  });

  containerElement.appendChild(keybindInput);

  keybindsList.appendChild(containerElement);
}

document.getElementById('welcome').href = EnvUtils.isExtension() ? chrome?.runtime?.getURL('welcome.html') : './../welcome.html';

playMP4URLs.addEventListener('change', () => {
  Options.playMP4URLs = playMP4URLs.checked;
  optionChanged();
});

autoSub.addEventListener('change', () => {
  Options.autoEnableBestSubtitles = autoSub.checked;
  optionChanged();
});

playStreamURLs.addEventListener('change', () => {
  Options.playStreamURLs = playStreamURLs.checked;
  optionChanged();
});

analyzeVideos.addEventListener('change', () => {
  Options.analyzeVideos = analyzeVideos.checked;
  optionChanged();
});

downloadAll.addEventListener('change', () => {
  Options.downloadAll = downloadAll.checked;
  optionChanged();
});

previewEnabled.addEventListener('change', () => {
  Options.previewEnabled = previewEnabled.checked;
  optionChanged();
});

storeProgress.addEventListener('change', () => {
  Options.storeProgress = storeProgress.checked;
  optionChanged();
});

autoplayYoutube.addEventListener('change', () => {
  Options.autoplayYoutube = autoplayYoutube.checked;
  optionChanged();
});

autoplayNext.addEventListener('change', () => {
  Options.autoplayNext = autoplayNext.checked;
  sessionStorage.removeItem('autoplayNext');
  optionChanged();
});

ytPlayerID.addEventListener('change', () => {
  Options.youtubePlayerID = ytPlayerID.value.trim();
  optionChanged();
});

maxSpeed.addEventListener('change', () => {
  // parse value, number unit/s
  Options.maxSpeed = StringUtils.getSpeedValue(maxSpeed.value);
  maxSpeed.value = StringUtils.getSpeedString(Options.maxSpeed, true);
  optionChanged();
});

maxSize.addEventListener('change', () => {
  // parse value, number unit
  Options.maxVideoSize = StringUtils.getSizeValue(maxSize.value);
  maxSize.value = StringUtils.getSizeString(Options.maxVideoSize);
  optionChanged();
});

seekStepSize.addEventListener('change', () => {
  Options.seekStepSize = parseFloat(seekStepSize.value);
  optionChanged();
});

replaceDelay.addEventListener('change', () => {
  Options.replaceDelay = parseInt(replaceDelay.value);
  optionChanged();
});

miniSize.addEventListener('change', () => {
  Options.miniSize = Math.min(Math.max(parseFloat(miniSize.value) || 0.25, 0.01), 1);
  optionChanged();
});

maxdownloaders.addEventListener('change', () => {
  Options.maximumDownloaders = parseInt(maxdownloaders.value) || 0;
  optionChanged();
});

// --- Mobile Controls wiring ---
function updateKiwiGuardSubOptions() {
  kiwiGuardSubOptions.style.display = kiwiGuardEnabled.checked ? '' : 'none';
}

function showInputError(inputEl, message) {
  inputEl.classList.add('input-error-border');
  
  let errorEl = inputEl.parentNode.parentNode.querySelector('.kiwi-error-msg');
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.className = 'kiwi-error-msg';
    errorEl.style.color = '#ff4a4a';
    errorEl.style.fontSize = '0.85em';
    errorEl.style.marginTop = '4px';
    errorEl.style.marginLeft = '4px';
    inputEl.parentNode.after(errorEl);
  }
  errorEl.textContent = message;
}

function clearInputError(inputEl) {
  inputEl.classList.remove('input-error-border');
  const errorEl = inputEl.parentNode.parentNode.querySelector('.kiwi-error-msg');
  if (errorEl) {
    errorEl.remove();
  }
}

function validateNumberInput(inputEl, min, max, name, unit = "") {
  const rawValue = inputEl.value.trim();

  // Allow temporary empty field while typing
  if (rawValue === "") {
    return {
      valid: false,
      empty: true,
      errorMsg: `${name} cannot be empty.`
    };
  }

  // Only accept numbers
  const parsed = parseInt(rawValue, 10);
  if (isNaN(parsed) || !/^\d+$/.test(rawValue)) {
    return {
      valid: false,
      empty: false,
      errorMsg: `Please enter a valid whole number for ${name}.`
    };
  }

  // Range check
  if (parsed < min || parsed > max) {
    return {
      valid: false,
      empty: false,
      errorMsg: `${name} must be between ${min}${unit} and ${max}${unit}.`
    };
  }

  return {
    valid: true,
    value: parsed
  };
}

function validateFloatInput(inputEl, min, max, name, unit = "") {
  const rawValue = inputEl.value.trim();

  if (rawValue === "") {
    return { valid: false, empty: true, errorMsg: `${name} cannot be empty.` };
  }

  const parsed = parseFloat(rawValue);
  if (isNaN(parsed)) {
    return { valid: false, empty: false, errorMsg: `Please enter a valid number for ${name}.` };
  }

  if (parsed < min || parsed > max) {
    return {
      valid: false,
      empty: false,
      errorMsg: `${name} must be between ${min}${unit} and ${max}${unit}.`
    };
  }

  return { valid: true, value: Math.round(parsed * 100) / 100 };
}

function handleMobileFloatEvent(inputEl, key, min, max, name, unit = "", isBlur = false) {
  const result = validateFloatInput(inputEl, min, max, name, unit);

  if (result.valid) {
    clearInputError(inputEl);
    Options[key] = result.value;
    optionChanged();
  } else {
    if (result.empty && !isBlur) {
      clearInputError(inputEl);
    } else {
      showInputError(inputEl, result.errorMsg);
    }
  }
}

function handleMobileInputEvent(inputEl, key, min, max, name, unit = "", isBlur = false) {
  const result = validateNumberInput(inputEl, min, max, name, unit);
  
  if (result.valid) {
    clearInputError(inputEl);
    Options[key] = result.value;
    optionChanged();
  } else {
    if (result.empty && !isBlur) {
      clearInputError(inputEl);
    } else {
      showInputError(inputEl, result.errorMsg);
    }
  }
}

tapSeekSeconds.addEventListener('input', () => handleMobileInputEvent(tapSeekSeconds, 'tapSeekSeconds', 1, 120, 'Tap Seek Duration', 's', false));
tapSeekSeconds.addEventListener('change', () => handleMobileInputEvent(tapSeekSeconds, 'tapSeekSeconds', 1, 120, 'Tap Seek Duration', 's', true));
tapSeekSeconds.addEventListener('blur', () => handleMobileInputEvent(tapSeekSeconds, 'tapSeekSeconds', 1, 120, 'Tap Seek Duration', 's', true));

tapZonePercent.addEventListener('input', () => handleMobileInputEvent(tapZonePercent, 'tapZonePercent', 10, 45, 'Tap Zone Width', '%', false));
tapZonePercent.addEventListener('change', () => handleMobileInputEvent(tapZonePercent, 'tapZonePercent', 10, 45, 'Tap Zone Width', '%', true));
tapZonePercent.addEventListener('blur', () => handleMobileInputEvent(tapZonePercent, 'tapZonePercent', 10, 45, 'Tap Zone Width', '%', true));

tapWindowMs.addEventListener('input', () => {
  handleMobileInputEvent(tapWindowMs, 'tapWindowMs', 200, 1000, 'Tap Window', 'ms', false);
  // Re-check drag hold whenever tap window changes
  validateDragHoldVsTapWindow(false);
});
tapWindowMs.addEventListener('change', () => {
  handleMobileInputEvent(tapWindowMs, 'tapWindowMs', 200, 1000, 'Tap Window', 'ms', true);
  validateDragHoldVsTapWindow(true);
});
tapWindowMs.addEventListener('blur', () => {
  handleMobileInputEvent(tapWindowMs, 'tapWindowMs', 200, 1000, 'Tap Window', 'ms', true);
  validateDragHoldVsTapWindow(true);
});

tapZoneLockZone.addEventListener('change', () => {
  Options.tapZoneLockZone = tapZoneLockZone.checked;
  optionChanged();
});

kiwiControlsHideTimeout.addEventListener('input', () => handleMobileInputEvent(kiwiControlsHideTimeout, 'kiwiControlsHideTimeout', 500, 10000, 'Controls Auto-Hide Timeout', 'ms', false));
kiwiControlsHideTimeout.addEventListener('change', () => handleMobileInputEvent(kiwiControlsHideTimeout, 'kiwiControlsHideTimeout', 500, 10000, 'Controls Auto-Hide Timeout', 'ms', true));
kiwiControlsHideTimeout.addEventListener('blur', () => handleMobileInputEvent(kiwiControlsHideTimeout, 'kiwiControlsHideTimeout', 500, 10000, 'Controls Auto-Hide Timeout', 'ms', true));

kiwiGuardEnabled.addEventListener('change', () => {
  Options.kiwiGuardEnabled = kiwiGuardEnabled.checked;
  updateKiwiGuardSubOptions();
  optionChanged();
});

kiwiGuardBlockRedirects.addEventListener('change', () => {
  Options.kiwiGuardBlockRedirects = kiwiGuardBlockRedirects.checked;
  optionChanged();
});

kiwiGuardOverlayNeutralize.addEventListener('change', () => {
  Options.kiwiGuardOverlayNeutralize = kiwiGuardOverlayNeutralize.checked;
  optionChanged();
});

kiwiGuardOverlayZIndex.addEventListener('change', () => {
  Options.kiwiGuardOverlayZIndex = kiwiGuardOverlayZIndex.checked;
  optionChanged();
});

kiwiKeepScreenOn.addEventListener('change', () => {
  Options.kiwiKeepScreenOn = kiwiKeepScreenOn.checked;
  optionChanged();
});

// --- Flow Drag Seek cross-validation ---
// dragActivationHoldMs must be <= tapWindowMs so the two gestures don't conflict.
function validateDragHoldVsTapWindow(isBlur) {
  const tapWin = parseInt(tapWindowMs.value, 10);
  const dragHold = parseInt(dragActivationHoldMs.value, 10);
  if (!isNaN(tapWin) && !isNaN(dragHold) && dragHold > tapWin) {
    const msg = `Flow Drag Activation Hold (${dragHold}ms) must be ≤ Tap Window (${tapWin}ms) to avoid gesture conflicts.`;
    showInputError(dragActivationHoldMs, msg);
    if (isBlur) showInputError(tapWindowMs, msg);
  } else {
    clearInputError(dragActivationHoldMs);
  }
}

dragSeekSensitivity.addEventListener('input', () => handleMobileFloatEvent(dragSeekSensitivity, 'dragSeekSensitivity', 0.05, 2.0, 'Flow Drag Sensitivity', 's/px', false));
dragSeekSensitivity.addEventListener('change', () => handleMobileFloatEvent(dragSeekSensitivity, 'dragSeekSensitivity', 0.05, 2.0, 'Flow Drag Sensitivity', 's/px', true));
dragSeekSensitivity.addEventListener('blur', () => handleMobileFloatEvent(dragSeekSensitivity, 'dragSeekSensitivity', 0.05, 2.0, 'Flow Drag Sensitivity', 's/px', true));

function handleDragHoldInput(isBlur) {
  handleMobileInputEvent(dragActivationHoldMs, 'dragActivationHoldMs', 50, 500, 'Flow Drag Activation Hold', 'ms', isBlur);
  validateDragHoldVsTapWindow(isBlur);
}
dragActivationHoldMs.addEventListener('input', () => handleDragHoldInput(false));
dragActivationHoldMs.addEventListener('change', () => handleDragHoldInput(true));
dragActivationHoldMs.addEventListener('blur', () => handleDragHoldInput(true));

dragSeekTransitionMs.addEventListener('input', () => handleMobileInputEvent(dragSeekTransitionMs, 'dragSeekTransitionMs', 0, 300, 'Drag Seek Transition', 'ms', false));
dragSeekTransitionMs.addEventListener('change', () => handleMobileInputEvent(dragSeekTransitionMs, 'dragSeekTransitionMs', 0, 300, 'Drag Seek Transition', 'ms', true));
dragSeekTransitionMs.addEventListener('blur', () => handleMobileInputEvent(dragSeekTransitionMs, 'dragSeekTransitionMs', 0, 300, 'Drag Seek Transition', 'ms', true));

resetMobileOptions.addEventListener('click', () => {
  const mobileDefaults = {
    tapSeekSeconds: 10,
    tapZonePercent: 40,
    tapWindowMs: 500,
    tapZoneLockZone: true,
    kiwiControlsHideTimeout: 2000,
    kiwiGuardEnabled: true,
    kiwiGuardBlockRedirects: true,
    kiwiGuardOverlayNeutralize: true,
    kiwiGuardOverlayZIndex: true,
    kiwiKeepScreenOn: true,
    dragSeekSensitivity: 0.3,
    dragActivationHoldMs: 150,
    dragSeekTransitionMs: 150,
  };
  Object.assign(Options, mobileDefaults);
  loadOptions(Options);
  optionChanged();
});

optionsSearchBar.placeholder = Localize.getMessage('options_search_placeholder');


optionsSearchBar.addEventListener('keyup', () => {
  if (optionsSearchBar.value == '') {
    console.log('Reset search called from searchbar keyup');
    resetSearch();
  } else {
    const searchVal = optionsSearchBar.value;
    console.log(searchWithQuery(searchVal));
  }
});

optionsSearchBar.addEventListener('keydown', () => {
  if (optionsSearchBar.value == '') {
    console.log('Reset search called from searchbar keydown');
    resetSearch();
  } else {
    const searchVal = optionsSearchBar.value;
    console.log(searchWithQuery(searchVal));
  }
});

optionsResetButton.addEventListener('click', () => {
  optionsSearchBar.value = '';
  resetSearch();
});

document.getElementById('resetdefault').addEventListener('click', () => {
  Options.keybinds = JSON.parse(JSON.stringify(DefaultKeybinds));
  keybindsList.replaceChildren();
  for (const keybind in Options.keybinds) {
    if (Object.hasOwn(Options.keybinds, keybind)) {
      createKeybindElement(keybind);
    }
  }
  optionChanged();
});

WebUtils.setupTabIndex(document.getElementById('resetdefault'));

autoEnableURLSInput.addEventListener('change', (e) => {
  Options.autoEnableURLs = autoEnableURLSInput.value.split('\n').map((o)=>o.trim()).filter((o)=>o.length);
  optionChanged();
});

customSourcePatterns.addEventListener('change', (e) => {
  Options.customSourcePatterns = customSourcePatterns.value;
  optionChanged();
});

importButton.addEventListener('click', () => {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json';
  picker.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const newOptionsObj = JSON.parse(text);
      const newOptions = Utils.mergeOptions(DefaultOptions, newOptionsObj);
      const subtitlesSettings = Utils.mergeOptions(DefaultSubtitlesSettings, newOptionsObj.subtitlesSettings || {});
      const toolSettings = Utils.mergeOptions(DefaultToolSettings, newOptionsObj.toolSettings || {});
      loadOptions(newOptions);
      optionChanged();

      Utils.setConfig('subtitlesSettings', JSON.stringify(subtitlesSettings));
      Utils.setConfig('toolSettings', JSON.stringify(toolSettings));
    };
    reader.readAsText(file);
  });
  document.body.appendChild(picker);
  picker.click();
  picker.remove();
});

exportButton.addEventListener('click', async () => {
  const blob = new Blob([JSON.stringify({
    ...(await Utils.getOptionsFromStorage()),
    subtitlesSettings: await Utils.getSubtitlesSettingsFromStorage(),
    toolSettings: await Utils.loadAndParseOptions('toolSettings', DefaultToolSettings),
  }, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  Utils.downloadURL(url, 'faststream-options.json', true);
  URL.revokeObjectURL(url);
});

function optionChanged() {
  // Centralized save/broadcast
  OptionsStore.replace(Options);
}

const versionDiv = document.getElementById('version');
versionDiv.textContent = `FastStream v${EnvUtils.getVersion()}`;

// if in iframe, add the frame class to body
if (parent !== window) {
  document.body.classList.add('frame');
}

// React to external changes via OptionsStore
OptionsStore.subscribe(() => loadOptions(OptionsStore.get()));

if (EnvUtils.isExtension()) {
  // Also refresh when becoming visible to catch recent changes
  const o = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) loadOptions(OptionsStore.get());
  });
  o.observe(document.body);

  const ratebox = document.getElementById('ratebox');
  document.getElementById('rate').addEventListener('click', (e) => {
    chrome?.storage?.local?.set({
      rateus: 'yes',
    });
    ratebox.style.display = 'none';

    let url;

    if (EnvUtils.isChrome()) {
      url = 'https://chromewebstore.google.com/u/1/detail/faststream-video-player/kkeakohpadmbldjaiggikmnldlfkdfog/reviews';
    } else {
      url = 'https://addons.mozilla.org/en-US/firefox/addon/faststream/reviews/';
    }

    chrome?.tabs?.create({
      url,
    });
  });

  document.getElementById('norate').addEventListener('click', (e) => {
    chrome.storage.local.set({
      rateus: 'no',
    });
    ratebox.style.display = 'none';
  });


  const feedbackbox = document.getElementById('feedbackbox');
  const feedbackyes = document.getElementById('feedback-yes');
  const feedbackno = document.getElementById('feedback-no');

  feedbackyes.addEventListener('click', (e) => {
    chrome.storage.local.set({
      feedback: 'yes',
    });
    feedbackbox.style.display = 'none';
    chrome.tabs.create({
      url: 'https://docs.google.com/forms/d/e/1FAIpQLSfA3T8lmhKO_ih028cP0m67vhH-FaGNkeHE0EsQoyBWztpctA/viewform?usp=sf_link',
    });
  });

  feedbackno.addEventListener('click', (e) => {
    chrome.storage.local.set({
      feedback: 'no',
    });
    feedbackbox.style.display = 'none';
  });

  chrome.storage.local.get('firstuse', (result) => {
    if (!result || !result.firstuse) {
      chrome.storage.local.set({
        firstuse: Date.now(),
      });
    } else {
      // const now = Date.now();
      // const diff = now - result.firstuse;
      // if (diff > 1000 * 60 * 60 * 24 * 3) { // 3 days, ask for feedback
      //   chrome.storage.local.get('feedback', (result) => {
      //     if (!result || !result.feedback) {
      //       feedbackbox.style.display = 'block';
      //     }
      //   });
      // }
    }
  });

  // Don't ask for rating for manual installs
  // SPLICER:NO_PROMO:REMOVE_START
  chrome.storage.local.get('rateus', (result) => {
    if (!result || !result.rateus) {
      ratebox.style.display = 'block';
    }
  });
  // SPLICER:NO_PROMO:REMOVE_END

  // SPLICER:NO_UPDATE_CHECKER:REMOVE_START
  const updatebox = document.getElementById('updatebox');
  const updatetext = document.getElementById('updatetext');
  const updatenotif = parent.document ? parent.document.getElementById('update_notif_banner') : null;

  chrome.storage.local.get({
    updateData: '{}',
  }, async (result) => {
    const data = result?.updateData ? JSON.parse(result.updateData) : {};
    const now = Date.now();
    if (!data.latestVersion || now - data.lastUpdateCheck > 1000 * 60 * 60 * 12) {
      data.latestVersion = await UpdateChecker.getLatestVersion();
      data.lastUpdateCheck = now;
    }

    chrome.storage.local.set({
      updateData: JSON.stringify(data),
    });

    const currentVersion = EnvUtils.getVersion();
    const latestVersion = data.latestVersion;
    const ignoreVersion = data.ignoreVersion;
    if (latestVersion && UpdateChecker.compareVersions(currentVersion, latestVersion) && latestVersion !== ignoreVersion) {
      updatetext.textContent = Localize.getMessage('options_update_body', [latestVersion, currentVersion]);
      updatebox.style.display = 'block';
      if (updatenotif) updatenotif.style.display = 'block';
    }
  });

  document.getElementById('update').addEventListener('click', (e) => {
    chrome.tabs.create({
      url: 'https://github.com/Andrews54757/FastStream',
    });
  });

  document.getElementById('noupdate').addEventListener('click', (e) => {
    updatebox.style.display = 'none';
    if (updatenotif) updatenotif.style.display = 'none';
    chrome.storage.local.get('updateData', (result) => {
      const data = result?.updateData ? JSON.parse(result.updateData) : {};
      data.ignoreVersion = data.latestVersion;
      chrome.storage.local.set({
        updateData: JSON.stringify(data),
      });
    });
  });
  // SPLICER:NO_UPDATE_CHECKER:REMOVE_END
}

