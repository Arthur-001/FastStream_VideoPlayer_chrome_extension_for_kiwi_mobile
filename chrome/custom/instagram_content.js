function safeSendMessage(message, callback) {
  if (chrome.runtime && chrome.runtime.id) {
    try {
      if (callback) {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            callback(null);
            return;
          }
          callback(response);
        });
      } else {
        chrome.runtime.sendMessage(message);
      }
    } catch (e) {
      if (callback) {
        callback(null);
      }
    }
  } else {
    if (callback) {
      callback(null);
    }
  }
}

// Listen for messages
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) {
    return;
  }

  if (typeof event.data !== 'object') {
    return;
  }


  if (event.data?.type === 'fs_source_detected') {
    const value = (event.data?.value || '').toString();
    const ext = (event.data?.ext || '').toString();
    const mpd = value;
    const url = `data:application/dash+xml;base64,${btoa(mpd)}`;
    safeSendMessage({
      type: 'DETECTED_SOURCE',
      url,
      ext: ext,
      headers: {
        'Referer': location.href,
        'Origin': location.origin,
      },
    });

    console.log('Detected source', event.data);
  }
});

const sc = document.createElement('script');
sc.src = chrome.runtime.getURL('custom/instagram_inject.js');
const it = document.head || document.documentElement;

it.appendChild(sc);
sc.remove();
