// import {MessageTypes} from '../enums/MessageTypes.mjs';
import {Localize} from '../modules/Localize.mjs';
import {SweetAlert} from '../modules/sweetalert.mjs';
import {EnvUtils} from './EnvUtils.mjs';

/**
 * Polyfill for alert, confirm, prompt, and toast dialogs using SweetAlert.
 */
export class AlertPolyfill {
  /**
   * Shows an alert dialog.
   * @param {string} message - The message to display.
   * @param {string} [icon] - Optional icon type.
   * @return {Promise<any>} Resolves when the dialog is closed.
   */
  static async alert(message, icon = undefined) {
    return SweetAlert.fire({
      text: message,
      icon: icon,
    });
  }

  /**
   * Shows a confirmation dialog.
   * @param {string} message - The message to display.
   * @param {string} [icon] - Optional icon type.
   * @return {Promise<boolean>} Resolves with true if confirmed, false otherwise.
   */
  static async confirm(message, icon = undefined) {
    return (await SweetAlert.fire({
      text: message,
      icon: icon,
      showCancelButton: true,
      confirmButtonText: Localize.getMessage('yes'),
      cancelButtonText: Localize.getMessage('cancel'),
    })).isConfirmed;
  }

  /**
   * Shows a prompt dialog for user input.
   * @param {string} message - The message to display.
   * @param {string} [defaultValue] - Default input value.
   * @param {string} [icon] - Optional icon type.
   * @param {string} [inputType='text'] - Input type.
   * @return {Promise<string>} Resolves with the entered value.
   */
  static async prompt(message, defaultValue = '', icon = undefined, inputType = 'text') {
    return (await SweetAlert.fire({
      text: message,
      icon: icon,
      input: inputType,
      inputValue: defaultValue,
      showCancelButton: true,
      confirmButtonText: Localize.getMessage('ok'),
      cancelButtonText: Localize.getMessage('cancel'),
    })).value;
  }

  /**
   * Shows a toast notification.
   * @param {string} icon - Icon type.
   * @param {string} message - Main message.
   * @param {string} [submessage] - Optional submessage.
   * @return {Promise<any>} Resolves when the toast is closed.
   */
  static async toast(icon, message, submessage = undefined) {
    return await SweetAlert.fire({
      icon: icon,
      title: message,
      text: submessage,
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
      didOpen: (toast) => {
        toast.onmouseenter = SweetAlert.stopTimer;
        toast.onmouseleave = SweetAlert.resumeTimer;
        toast.onclick = SweetAlert.close;
      },
    });
  }

  /**
   * Generates a unique fingerprint for an error to track suppression.
   * @param {Error|string} error - The error object or string.
   * @return {string} Fingerprint string.
   */
  static getErrorFingerprint(error) {
    const msg = error?.message || String(error || 'unknown');
    const stackHead = (error?.stack || '').split('\n').slice(0, 3).map((s) => s.trim()).join('|');
    return `${msg}:::${stackHead}`;
  }

  /**
   * Checks if an error fingerprint is marked as suppressed.
   * @param {string} fingerprint - Error fingerprint.
   * @return {Promise<boolean>} True if suppressed.
   */
  static async isErrorSuppressed(fingerprint) {
    try {
      if (EnvUtils.isExtension() && chrome?.storage?.local) {
        const result = await chrome.storage.local.get({suppressedErrors: []});
        if (Array.isArray(result.suppressedErrors) && result.suppressedErrors.includes(fingerprint)) {
          return true;
        }
      }
      const local = JSON.parse(localStorage.getItem('suppressedErrors') || '[]');
      return Array.isArray(local) && local.includes(fingerprint);
    } catch (e) {
      return false;
    }
  }

  /**
   * Suppresses an error so it will not be displayed again.
   * @param {string} fingerprint - Error fingerprint.
   * @return {Promise<void>}
   */
  static async suppressError(fingerprint) {
    try {
      if (EnvUtils.isExtension() && chrome?.storage?.local) {
        const result = await chrome.storage.local.get({suppressedErrors: []});
        const list = Array.isArray(result.suppressedErrors) ? result.suppressedErrors : [];
        if (!list.includes(fingerprint)) {
          list.push(fingerprint);
          await chrome.storage.local.set({suppressedErrors: list});
        }
      }
      const local = JSON.parse(localStorage.getItem('suppressedErrors') || '[]');
      if (Array.isArray(local) && !local.includes(fingerprint)) {
        local.push(fingerprint);
        localStorage.setItem('suppressedErrors', JSON.stringify(local));
      }
    } catch (e) {
      console.error('Failed to save suppressed error:', e);
    }
  }

  /**
   * Shows an error dialog and optionally sends the error report to the developer via GitHub.
   * @param {Error} error - The error object to report.
   * @return {Promise<void>} Resolves when the dialog is closed and report is sent or cancelled.
   */
  static async errorSendToDeveloper(error) {
    const fingerprint = AlertPolyfill.getErrorFingerprint(error);
    if (await AlertPolyfill.isErrorSuppressed(fingerprint)) {
      console.warn('Suppressed error alert for:', error?.message || error);
      return;
    }

    const fullErrorText = `## Version:\n${EnvUtils.getVersion()}\n\n## Error message:\n${error?.message || error}\n\n## Stack trace:\n\`\`\`\n${error?.stack || 'No stack trace'}\n\`\`\``;

    const errorHtml = document.createElement('div');
    const bodyText = document.createElement('p');
    bodyText.classList.add('error-popup-body');
    bodyText.textContent = Localize.getMessage('error_popup_body');

    const stackText = document.createElement('pre');
    stackText.classList.add('error-popup-stack');
    stackText.textContent = error?.stack || error?.message || String(error);
    errorHtml.appendChild(bodyText);
    errorHtml.appendChild(stackText);

    // Actions: Copy Error Details & Don't Show Again Checkbox
    const actionsContainer = document.createElement('div');
    actionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-top: 12px; align-items: flex-start; text-align: left;';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = '📋 Copy Full Error Details';
    copyButton.style.cssText = 'padding: 6px 12px; font-size: 13px; font-weight: 500; cursor: pointer; border-radius: 4px; border: 1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.08); color: inherit;';
    copyButton.onclick = async (ev) => {
      ev.preventDefault();
      try {
        await navigator.clipboard.writeText(fullErrorText);
        copyButton.textContent = '✓ Copied to Clipboard!';
        setTimeout(() => {
          copyButton.textContent = '📋 Copy Full Error Details';
        }, 2500);
      } catch (err) {
        console.error('Failed to copy error details to clipboard:', err);
      }
    };

    const checkboxLabel = document.createElement('label');
    checkboxLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; user-select: none; margin-top: 4px; opacity: 0.9;';
    const dontShowCheckbox = document.createElement('input');
    dontShowCheckbox.type = 'checkbox';
    dontShowCheckbox.id = 'swal-dont-show-error';
    checkboxLabel.appendChild(dontShowCheckbox);
    const labelSpan = document.createElement('span');
    labelSpan.textContent = 'Do not show this error message again';
    checkboxLabel.appendChild(labelSpan);

    actionsContainer.appendChild(copyButton);
    actionsContainer.appendChild(checkboxLabel);
    errorHtml.appendChild(actionsContainer);

    return await SweetAlert.fire({
      title: Localize.getMessage('error_popup', [error?.message]),
      html: errorHtml,
      icon: 'error',
      showCancelButton: true,
      confirmButtonText: Localize.getMessage('error_popup_send'),
      cancelButtonText: Localize.getMessage('cancel'),
    }).then(async (result) => {
      if (dontShowCheckbox.checked) {
        await AlertPolyfill.suppressError(fingerprint);
      }

      if (result.isConfirmed) {
        const urlBase = `https://github.com/Andrews54757/FastStream/issues/new?`;
        const url = `${urlBase}title=${encodeURIComponent('Error report')}&body=${encodeURIComponent(fullErrorText)}`;

        if (EnvUtils.isExtension()) {
          chrome?.tabs?.create({
            url,
          });
        } else {
          window.open(url, '_blank');
        }
      }
    });
  }

  static async ytUserscriptError(error) {
    const errorHtml = document.createElement('div');
    const bodyText = document.createElement('p');
    bodyText.classList.add('error-popup-body');
    bodyText.textContent = Localize.getMessage('yterror_popup_body');
    errorHtml.appendChild(bodyText);

    if (error) {
      const stackText = document.createElement('pre');
      stackText.classList.add('error-popup-stack');
      stackText.textContent = error;
      errorHtml.appendChild(stackText);
    }

    return await SweetAlert.fire({
      title: Localize.getMessage('yterror_popup', [error?.message]),
      html: errorHtml,
      icon: 'error',
      showCancelButton: true,
      confirmButtonText: Localize.getMessage('yterror_fix'),
      cancelButtonText: Localize.getMessage('cancel'),
    }).then(async (result) => {
      if (result.isConfirmed) {
        const url = `https://github.com/Andrews54757/FastStream/wiki/Enabling-UserScripts-for-Youtube-Playback`;
        if (EnvUtils.isExtension()) {
          try {
            const granted = await chrome.permissions.request({
              permissions: ['userScripts'],
            });

            if (granted) {
              // ask background again
              const result = await chrome.runtime.sendMessage({
                type: MessageTypes.ENSURE_YT_USERSCRIPT,
              });
              if (result.success) {
                AlertPolyfill.toast('success', Localize.getMessage('yterror_permission_granted'));
                return;
              }
            }
          } catch (e) {
            console.error('Failed to request userScripts permission:', e);
          }
          chrome?.tabs?.create({
            url,
          });
        } else {
          window.open(url, '_blank');
        }
      }
    });
  }


  static async ytSlowdownWarning() {
    // check localstorage for a flag to not show this again
    if (localStorage.getItem('ytSlowdownWarningDismissed') === 'true') {
      return;
    }

    const html = document.createElement('div');
    const bodyText = document.createElement('p');
    bodyText.classList.add('error-popup-body');
    bodyText.textContent = Localize.getMessage('ytslowdown_popup_body');
    html.appendChild(bodyText);
    return await SweetAlert.fire({
      title: Localize.getMessage('ytslowdown_popup'),
      html,
      icon: 'warning',
      confirmButtonText: Localize.getMessage('ytslowdown_ok'),
    }).then(async (result) => {
      if (result.isConfirmed) {
        localStorage.setItem('ytSlowdownWarningDismissed', 'true');
      }
    });
  }
}
