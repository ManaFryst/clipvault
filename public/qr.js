/**
 * ClipVault QR renderer — wraps qr-code-styling
 * Requires: https://unpkg.com/qr-code-styling@1.5.0/lib/qr-code-styling.js
 */
(function (global) {
  'use strict';

  // HashHexagon icon as inline SVG data URI (MynaUI, stroke="currentColor" → dark colour)
  const ICON_SVG = `<svg width="24" height="24" fill="none" viewBox="0 0 24 24"
    stroke-width="1.5" stroke="#0a0a0b" stroke-linecap="round" stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg">
    <path d="M20.5 15.8V8.2a1.91 1.91 0 0 0-.944-1.645l-6.612-3.8a1.88 1.88 0 0 0-1.888 0
    l-6.612 3.8A1.9 1.9 0 0 0 3.5 8.2v7.602a1.91 1.91 0 0 0 .944 1.644l6.612 3.8
    a1.88 1.88 0 0 0 1.888 0l6.612-3.8A1.9 1.9 0 0 0 20.5 15.8
    M10.905 8l-1.437 8m4.937-8-1.437 8m3.314-5.75H7.718m8.564 3.5H7.718"/>
  </svg>`;

  const ICON_DATA_URI = 'data:image/svg+xml;base64,' + btoa(ICON_SVG);

  // Store active instance so we can destroy before re-render
  let _instance = null;

  function render(url, container, opts) {
    opts = opts || {};

    const size         = opts.size         || 200;
    const fg           = opts.fg           || '#0a0a0b';
    const bg           = opts.bg           || '#ffffff';

    // Destroy previous instance if any
    if (_instance) {
      container.innerHTML = '';
      _instance = null;
    }

    _instance = new QRCodeStyling({
      width:  size,
      height: size,
      type:   'canvas',
      data:   url,
      margin: 6,
      qrOptions: {
        errorCorrectionLevel: 'H'
      },
      image: ICON_DATA_URI,
      imageOptions: {
        hideBackgroundDots: true,
        imageSize:          0.3,
        margin:             4,
        crossOrigin:        'anonymous'
      },
      dotsOptions: {
        color: fg,
        type:  'extra-rounded'
      },
      backgroundOptions: {
        color: bg
      },
      cornersSquareOptions: {
        color: fg,
        type:  'extra-rounded'
      },
      cornersDotOptions: {
        color: fg,
        type:  'dot'
      }
    });

    _instance.append(container);
  }

  global.ClipVaultQR = { render };

})(window);
