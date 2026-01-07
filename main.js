<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Electron Remote Assist Demo</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0;
      padding: 0;
      background: #f5f5f5;
    }

    .container {
      background: #ffffff;
      padding: 32px 40px;
      border-radius: 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
      width: 360px;
      margin: 40px auto;
    }

    h1 { margin: 0 0 20px; text-align: center; }

    label {
      font-weight: 600;
      margin-top: 10px;
      display: block;
      text-align: left;
    }

    input {
      width: 100%;
      padding: 10px;
      margin-top: 6px;
      border: 1px solid #ccc;
      border-radius: 8px;
      font-size: 14px;
      box-sizing: border-box;
    }

    /* --- Custom dropdown styles --- */
    .dropdown {
      position: relative;
      margin-top: 6px;
      width: 100%;
      border: 1px solid #ccc;
      border-radius: 8px;
      font-size: 14px;
      background: #fff;
      cursor: pointer;
      box-sizing: border-box;
    }

    .dropdown:focus {
      outline: 2px solid #0066ff;
      outline-offset: 2px;
    }

    .dropdown-selected {
      padding: 10px;
      user-select: none;
    }

    .dropdown-menu {
      position: absolute;
      left: 0;
      right: 0;
      top: 100%;
      margin-top: 2px;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      z-index: 1000;
      display: none;
      max-height: 150px;
      overflow-y: auto;
    }

    .dropdown-item {
      padding: 8px 10px;
      cursor: pointer;
      user-select: none;
    }

    .dropdown-item:hover,
    .dropdown-item.highlight {
      background: #eef4ff;
    }

    button {
      width: 100%;
      padding: 10px;
      margin-top: 12px;
      background-color: #0066ff;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      cursor: pointer;
    }

    button:hover { background-color: #0053d6; }

    .button-secondary { background-color: #777; }
    .button-secondary:hover { background-color: #555; }

    .result-container {
      background: #eef4ff;
      border-radius: 10px;
      padding: 15px;
      margin-top: 25px;
      display: none;
    }

    .result-container h3 { margin: 0 0 10px; }
    .result-item { margin: 5px 0; font-size: 14px; }

    .remote-status { margin-top: 10px; font-size: 12px; color: #555; }

    .share-select {
      width: 100%;
      padding: 10px;
      margin-top: 6px;
      border: 1px solid #ccc;
      border-radius: 8px;
      font-size: 14px;
      background: #fff;
      box-sizing: border-box;
    }

    .share-warning {
      margin-top: 6px;
      font-size: 12px;
      color: #c0392b;
      background: #fff3e0;
      border-radius: 6px;
      padding: 6px 8px;
      border: 1px solid #ffcc80;
    }

    /* ✅ Dot in VIEWPORT coordinates (matches webContents sendInputEvent coords) */
    #remote-debug-dot {
      position: fixed;
      width: 10px;
      height: 10px;
      background: red;
      border-radius: 50%;
      pointer-events: none;
      z-index: 99999;
      display: none;
      transform: translate(-50%, -50%);
    }
  </style>
</head>

<body>
  <div class="container">
    <h1>User Information</h1>

    <label for="firstName">First Name</label>
    <input id="firstName" type="text" placeholder="Enter First Name" />

    <label for="lastName">Last Name</label>
    <input id="lastName" type="text" placeholder="Enter Last Name" />

    <label for="sexDropdown">Sex</label>
    <div id="sexDropdown" class="dropdown" tabindex="0">
      <div id="sexSelected" class="dropdown-selected">Select Sex</div>
      <div id="sexMenu" class="dropdown-menu">
        <div class="dropdown-item" data-value="Male">Male</div>
        <div class="dropdown-item" data-value="Female">Female</div>
        <div class="dropdown-item" data-value="Other">Other</div>
      </div>
    </div>
    <input type="hidden" id="sex" value="" />

    <button onclick="submitForm()">Submit</button>

    <div class="result-container" id="resultBox">
      <h3>Submitted Details</h3>
      <div class="result-item" id="res-fname"></div>
      <div class="result-item" id="res-lname"></div>
      <div class="result-item" id="res-sex"></div>
    </div>

    <hr style="margin-top: 25px; margin-bottom: 10px; border: none; border-top: 1px solid #eee;" />

    <label for="sessionIdInput">Session Key</label>
    <input id="sessionIdInput" type="text" placeholder="e.g. customer-123" />

    <label for="shareModeSelect">Share mode</label>
    <select id="shareModeSelect" class="share-select">
      <option value="app" selected>Share App only</option>
      <option value="desktop">Share Desktop screen</option>
    </select>

    <div id="shareWarning" class="share-warning" style="display:none;">
      ⚠️ You’re sharing your entire screen
    </div>

    <button id="startRemoteBtn" onclick="startRemoteAssist()">Start Remote Assist</button>
    <button class="button-secondary" id="stopRemoteBtn" onclick="stopRemoteAssist()" disabled>
      Stop Remote Assist
    </button>

    <div class="remote-status" id="remoteStatus">Remote assist is not active.</div>
  </div>

  <div id="remote-debug-dot"></div>

  <script>
    const electron = require('electron');
    const { ipcRenderer } = electron;
    const io = require('socket.io-client');

    const socket = io('http://135.13.10.157:4000');

    let sessionId = null;
    let pc = null;
    let localStream = null;

    let captureMode = 'app'; // 'app' | 'desktop'
    let remoteActive = false;
    let isPrimed = false;

    // geometry (DIP)
    let windowWidth = 0, windowHeight = 0;
    let contentWidth = 0, contentHeight = 0;
    let windowOffsetTop = 0, windowOffsetLeft = 0;
    let windowPosX = 0, windowPosY = 0;

    // desktop capture metrics
    // NOTE: scaleFactor is OS scale (retina / DPI). The CAPTURED VIDEO is often downscaled.
    // We must use effective pixels-per-DIP derived from stream dimensions.
    let desktopScaleFactor = 1;
    let desktopDisplayBounds = { x: 0, y: 0, width: 0, height: 0 }; // DIP global origin
    let desktopPxPerDipX = 1;
    let desktopPxPerDipY = 1;

    // capture dims in pixels (from stream track settings)
    let captureWidthPx = null, captureHeightPx = null;

    const shareModeSelect = document.getElementById('shareModeSelect');
    const shareWarning = document.getElementById('shareWarning');

    function refreshShareWarning() {
      shareWarning.style.display = (captureMode === 'desktop') ? 'block' : 'none';
    }

    captureMode = shareModeSelect.value;
    refreshShareWarning();
    shareModeSelect.addEventListener('change', () => {
      captureMode = shareModeSelect.value;
      refreshShareWarning();
    });

    // Dot helpers (viewport coords)
    let debugDot = null;
    function ensureDebugDot() {
      if (!debugDot) debugDot = document.getElementById('remote-debug-dot');
      return debugDot;
    }

    function showDotViewport(x, y) {
      const dot = ensureDebugDot();
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.style.display = 'block';
    }

    function hideDot() {
      ensureDebugDot().style.display = 'none';
    }

    function setStatus(msg) {
      document.getElementById('remoteStatus').innerText = msg;
    }

    function createPeerConnection() {
      const newPc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      newPc.onicecandidate = (event) => {
        if (event.candidate && sessionId) {
          socket.emit('ice-candidate', { sessionId, candidate: event.candidate });
        }
      };

      return newPc;
    }

    // ---------------------------
    // Custom dropdown wiring (Sex)
    // ---------------------------
    const sexHiddenInput = document.getElementById('sex');
    const sexDropdown = document.getElementById('sexDropdown');
    const sexSelected = document.getElementById('sexSelected');
    const sexMenu = document.getElementById('sexMenu');
    const sexItems = Array.from(sexMenu.querySelectorAll('.dropdown-item'));

    let sexOpen = false;
    let sexHighlightIndex = -1;

    function openSexDropdown() {
      sexMenu.style.display = 'block';
      sexOpen = true;
      highlightSexItem(0);
    }

    function closeSexDropdown() {
      sexMenu.style.display = 'none';
      sexOpen = false;
      clearSexHighlight();
    }

    function setSex(value, label) {
      sexHiddenInput.value = value;
      sexSelected.textContent = label;
      closeSexDropdown();
    }

    function clearSexHighlight() {
      sexHighlightIndex = -1;
      sexItems.forEach(item => item.classList.remove('highlight'));
    }

    function highlightSexItem(index) {
      if (index < 0 || index >= sexItems.length) return;
      sexHighlightIndex = index;
      sexItems.forEach((item, i) => item.classList.toggle('highlight', i === sexHighlightIndex));
    }

    sexDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!sexOpen) openSexDropdown();
      else closeSexDropdown();
    });

    sexItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        setSex(item.dataset.value, item.textContent);
      });
    });

    document.addEventListener('click', () => {
      if (sexOpen) closeSexDropdown();
    });

    sexDropdown.addEventListener('keydown', (e) => {
      if (!sexOpen && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
        openSexDropdown();
        e.preventDefault();
        return;
      }
      if (!sexOpen) return;

      switch (e.key) {
        case 'ArrowDown':
          highlightSexItem(Math.min(sexItems.length - 1, sexHighlightIndex + 1));
          e.preventDefault();
          break;
        case 'ArrowUp':
          highlightSexItem(Math.max(0, sexHighlightIndex - 1));
          e.preventDefault();
          break;
        case 'Enter':
          if (sexHighlightIndex >= 0) {
            const item = sexItems[sexHighlightIndex];
            setSex(item.dataset.value, item.textContent);
          }
          e.preventDefault();
          break;
        case 'Escape':
          closeSexDropdown();
          e.preventDefault();
          break;
      }
    });

    // ---------------------------
    // Form
    // ---------------------------
    function submitForm() {
      const firstName = document.getElementById('firstName').value.trim();
      const lastName = document.getElementById('lastName').value.trim();
      const sex = document.getElementById('sex').value;

      if (!firstName || !lastName || !sex) {
        alert('Please fill all fields.');
        return;
      }

      document.getElementById('res-fname').innerText = 'First Name: ' + firstName;
      document.getElementById('res-lname').innerText = 'Last Name: ' + lastName;
      document.getElementById('res-sex').innerText = 'Sex: ' + sex;
      document.getElementById('resultBox').style.display = 'block';
    }

    // ---------------------------
    // Capture helpers
    // ---------------------------
    async function getAppWindowStream() {
      const sourceId = await ipcRenderer.invoke('get-app-window-source-id');
      if (!sourceId) throw new Error('App window source not found');

      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
      });
    }

    async function getDesktopStreamForWindow() {
      const info = await ipcRenderer.invoke('get-desktop-source-for-window');
      if (!info || !info.sourceId) throw new Error('Desktop screen source not found for window');

      desktopScaleFactor = info.scaleFactor || 1;
      desktopDisplayBounds = info.bounds || { x: 0, y: 0, width: 0, height: 0 };

      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: info.sourceId } }
      });
    }

    function readCapturePxFromStream(stream) {
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      captureWidthPx = settings.width || null;
      captureHeightPx = settings.height || null;
      console.log('CLIENT: capture settings:', settings);
    }

    function computeDesktopPxPerDip() {
      // Effective pixels-per-DIP derived from actual captured stream size.
      // This fixes drift when the captured video is downscaled.
      if (
        captureMode === 'desktop' &&
        captureWidthPx &&
        captureHeightPx &&
        desktopDisplayBounds &&
        desktopDisplayBounds.width &&
        desktopDisplayBounds.height
      ) {
        desktopPxPerDipX = captureWidthPx / desktopDisplayBounds.width;
        desktopPxPerDipY = captureHeightPx / desktopDisplayBounds.height;
      } else {
        desktopPxPerDipX = desktopScaleFactor || 1;
        desktopPxPerDipY = desktopScaleFactor || 1;
      }

      console.log('CLIENT: desktopPxPerDipX/Y=', { desktopPxPerDipX, desktopPxPerDipY });
    }

    async function startRemoteAssist() {
      try {
        setStatus('Starting remote assist...');

        remoteActive = false;
        isPrimed = false;
        hideDot();

        // cleanup any previous
        if (pc) { try { pc.close(); } catch {} pc = null; }
        if (localStream) { try { localStream.getTracks().forEach(t => t.stop()); } catch {} localStream = null; }

        pc = createPeerConnection();

        const inputVal = document.getElementById('sessionIdInput').value.trim();
        if (!inputVal) {
          alert('Please enter a Session Key before starting remote assist.');
          setStatus('Remote assist is not active.');
          return;
        }

        sessionId = inputVal;
        socket.emit('register', { role: 'customer', sessionId });

        captureMode = shareModeSelect.value;
        refreshShareWarning();

        // capture stream
        if (captureMode === 'desktop') {
          console.log('CLIENT: capturing desktop display that contains the window');
          localStream = await getDesktopStreamForWindow();
        } else {
          console.log('CLIENT: capturing app window only');
          localStream = await getAppWindowStream();
          desktopScaleFactor = 1;
          desktopDisplayBounds = { x: 0, y: 0, width: 0, height: 0 };
        }

        readCapturePxFromStream(localStream);

        // geometry from main (DIP)
        const winBounds = await ipcRenderer.invoke('get-window-bounds');
        windowPosX = winBounds.x;
        windowPosY = winBounds.y;
        windowWidth = winBounds.width;
        windowHeight = winBounds.height;

        const content = await ipcRenderer.invoke('get-content-bounds');
        contentWidth = content.width;
        contentHeight = content.height;

        const offsetInfo = await ipcRenderer.invoke('get-window-offset');
        windowOffsetTop = offsetInfo.offsetTop || 0;
        windowOffsetLeft = offsetInfo.offsetLeft || 0;

        computeDesktopPxPerDip();

        console.log('CLIENT: winBounds(DIP)=', winBounds);
        console.log('CLIENT: contentBounds(DIP)=', content);
        console.log('CLIENT: offsets(DIP)=', { windowOffsetTop, windowOffsetLeft });
        console.log('CLIENT: desktop scaleFactor=', desktopScaleFactor, 'displayBounds(DIP)=', desktopDisplayBounds);

        // ✅ Tell agent what coordinate system to use
        // Desktop mode: agent sends VIDEO PIXELS => send captureWidthPx/captureHeightPx
        // App mode: agent sends WINDOW DIP => send windowWidth/windowHeight
        let sendW, sendH;
        if (captureMode === 'desktop') {
          sendW = captureWidthPx || Math.round(desktopDisplayBounds.width * desktopPxPerDipX);
          sendH = captureHeightPx || Math.round(desktopDisplayBounds.height * desktopPxPerDipY);
        } else {
          sendW = windowWidth;
          sendH = windowHeight;
        }

        socket.emit('app-dimensions', { sessionId, width: sendW, height: sendH });
        console.log('CLIENT: sent app-dimensions to agent:', { width: sendW, height: sendH, mode: captureMode });

        // Add tracks + offer
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { sessionId, offer });

        remoteActive = true;

        document.getElementById('startRemoteBtn').disabled = true;
        document.getElementById('stopRemoteBtn').disabled = false;
        setStatus('Remote assist started. Support can now see your app window.');
      } catch (err) {
        console.error('startRemoteAssist failed:', err);
        setStatus('Start failed: ' + (err?.message || String(err)));

        document.getElementById('startRemoteBtn').disabled = false;
        document.getElementById('stopRemoteBtn').disabled = true;

        remoteActive = false;
        isPrimed = false;
        hideDot();
        if (pc) { try { pc.close(); } catch {} pc = null; }
        if (localStream) { try { localStream.getTracks().forEach(t => t.stop()); } catch {} localStream = null; }
      }
    }

    function stopRemoteAssist() {
      remoteActive = false;
      hideDot();

      if (sessionId) socket.emit('end-session', { sessionId });

      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
      }

      if (pc) {
        try { pc.getSenders().forEach(s => pc.removeTrack(s)); } catch {}
        try { pc.close(); } catch {}
        pc = null;
      }

      isPrimed = false;

      document.getElementById('startRemoteBtn').disabled = false;
      document.getElementById('stopRemoteBtn').disabled = true;
      setStatus('Remote assist stopped.');
    }

    socket.on('answer', async ({ answer }) => {
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      if (!pc) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (e) { console.error('Error adding ICE candidate', e); }
    });

    // ---------------------------
    // Keyboard handling
    // ---------------------------
    function handleRemoteKeyboard(ev) {
      const active = document.activeElement;
      if (!active) return;

      const eventType = ev.subtype === 'keyDown' ? 'keydown' : 'keyup';
      const domEvent = new KeyboardEvent(eventType, {
        key: ev.key, code: ev.code,
        altKey: ev.altKey, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey,
        bubbles: true, cancelable: true
      });
      active.dispatchEvent(domEvent);

      if (eventType !== 'keydown') return;
      if (active.id === 'sexDropdown') return;

      const tag = active.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') return;

      const value = active.value;
      const start = active.selectionStart ?? value.length;
      const end = active.selectionEnd ?? value.length;

      const setValueAndCaret = (newValue, newPos) => {
        active.value = newValue;
        active.selectionStart = active.selectionEnd = newPos;
      };

      if (ev.key && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const before = value.slice(0, start);
        const after = value.slice(end);
        setValueAndCaret(before + ev.key + after, start + 1);
        return;
      }

      switch (ev.key) {
        case 'Backspace':
          if (start === end && start > 0) setValueAndCaret(value.slice(0, start - 1) + value.slice(end), start - 1);
          else if (start !== end) setValueAndCaret(value.slice(0, start) + value.slice(end), start);
          break;
        case 'Delete':
          if (start === end && start < value.length) setValueAndCaret(value.slice(0, start) + value.slice(start + 1), start);
          else if (start !== end) setValueAndCaret(value.slice(0, start) + value.slice(end), start);
          break;
        case 'ArrowLeft':
          active.selectionStart = active.selectionEnd = Math.max(0, start - 1);
          break;
        case 'ArrowRight':
          active.selectionStart = active.selectionEnd = Math.min(value.length, end + 1);
          break;
        case 'Home':
          active.selectionStart = active.selectionEnd = 0;
          break;
        case 'End':
          active.selectionStart = active.selectionEnd = value.length;
          break;
      }
    }

    // ---------------------------
    // Mouse handling
    // ---------------------------
    let lastMoveSend = 0;
    const MOVE_SEND_THROTTLE_MS = 16; // ~60fps injection throttle

    socket.on('control-event', ({ event }) => {
      if (!remoteActive) return;

      if (event.type === 'keyboard') {
        handleRemoteKeyboard(event);
        return;
      }
      if (event.type !== 'mouse') return;

      const rawX = event.x;
      const rawY = event.y;

      // Compute CONTENT coordinates in DIP (what webContents.sendInputEvent expects)
      let contentX = 0;
      let contentY = 0;

      if (captureMode === 'desktop') {
        // rawX/rawY are CAPTURE VIDEO PIXELS relative to the captured DISPLAY's top-left.
        // Use effective px-per-DIP (derived from stream size) to avoid drift.

        // Where is the window inside the captured display (in CAPTURE PIXELS)?
        const winLeftPx = (windowPosX - desktopDisplayBounds.x) * desktopPxPerDipX;
        const winTopPx  = (windowPosY - desktopDisplayBounds.y) * desktopPxPerDipY;

        // Where is the webContents (content) inside that window (in CAPTURE PIXELS)?
        const contentLeftPx = winLeftPx + (windowOffsetLeft * desktopPxPerDipX);
        const contentTopPx  = winTopPx  + (windowOffsetTop  * desktopPxPerDipY);

        // Convert CAPTURE PIXELS -> CONTENT DIP
        contentX = (rawX - contentLeftPx) / desktopPxPerDipX;
        contentY = (rawY - contentTopPx)  / desktopPxPerDipY;
      } else {
        // app share: rawX/rawY are WINDOW DIP
        contentX = rawX - windowOffsetLeft;
        contentY = rawY - windowOffsetTop;
      }

      // Debug dot (clamped for visibility only)
      const dotX = Math.max(0, Math.min(contentWidth - 1, contentX));
      const dotY = Math.max(0, Math.min(contentHeight - 1, contentY));
      showDotViewport(dotX, dotY);

      // Prime focus (do NOT drop the event)
      if (!isPrimed) {
        ipcRenderer.send('focus-window');
        isPrimed = true;
      }

      // Clamp for injection safety
      const injX = Math.max(0, Math.min(contentWidth - 1, contentX));
      const injY = Math.max(0, Math.min(contentHeight - 1, contentY));

      // wheel
      if (event.subtype === 'mouseWheel') {
        ipcRenderer.send('remote-control-event', {
          type: 'mouse',
          subtype: 'mouseWheel',
          x: injX,
          y: injY,
          deltaX: event.deltaX || 0,
          deltaY: event.deltaY || 0
        });
        return;
      }

      // throttle move injection only
      if (event.subtype === 'mouseMove') {
        const now = performance.now();
        if (now - lastMoveSend < MOVE_SEND_THROTTLE_MS) return;
        lastMoveSend = now;
      }

      // click/move injection
      ipcRenderer.send('remote-control-event', {
        type: 'mouse',
        subtype: event.subtype,
        x: injX,
        y: injY,
        button: event.button || 'left'
      });
    });

    // expose
    window.submitForm = submitForm;
    window.startRemoteAssist = startRemoteAssist;
    window.stopRemoteAssist = stopRemoteAssist;
  </script>
</body>
</html>