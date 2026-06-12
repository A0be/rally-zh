/* 手部控制覆盖层：用 MediaPipe Hands 检测掌心，合成指针事件驱动 Rally 球拍。
 * 不改动游戏本体；摄像头可选，未启用时游戏照常用鼠标玩。 */
(function () {
  "use strict";

  // ---------- 注入 UI ----------
  // 配色复用 Rally 主题变量(--you/--ink/--panel/--line),带 fallback;
  // 整组移到左上角,让开右上角游戏自带的设置按钮(.menu-btn)。
  const css = `
    #hc-pip{position:fixed;top:54px;left:14px;width:150px;height:113px;border-radius:18px;
      overflow:hidden;background:#000;z-index:99998;display:none;
      border:1px solid #ffffff8c;
      box-shadow:0 12px 30px #4b403429, inset 0 0 0 1px var(--line,#d0c3aa)}
    #hc-pip video,#hc-pip canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    #hc-pip canvas{pointer-events:none}
    .hc-btn{position:fixed;left:14px;z-index:99999;appearance:none;cursor:pointer;
      border:1px solid #ffffff8c;background:var(--panel,#fffbf3d1);color:var(--ink,#4b4034);
      font:600 12px/1 Inter,system-ui,Segoe UI,sans-serif;letter-spacing:.12em;
      padding:11px 14px;border-radius:999px;width:150px;text-align:center;
      backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      transition:transform .2s,box-shadow .2s,background .2s,color .2s;
      box-shadow:0 10px 28px #4b403424, inset 0 1px #fff9}
    .hc-btn:hover{transform:translateY(-1px);box-shadow:0 14px 34px #4b403333, inset 0 1px #fff9}
    .hc-btn:active{transform:translateY(0)}
    .hc-btn.hc-on{background:var(--you,#e08a3c);color:#fffbf3;border-color:#ffffff66}
    #hc-toggle{top:14px}
    #hc-flip{top:175px;display:none}
    #hc-status{position:fixed;left:14px;top:213px;width:150px;z-index:99999;text-align:center;
      font:600 10px/1.4 Inter,system-ui,Segoe UI,sans-serif;letter-spacing:.14em;
      color:var(--ink-soft,#9f927e);display:none}
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const pip = document.createElement("div");
  pip.id = "hc-pip";
  pip.innerHTML = `<video id="hc-video" autoplay playsinline muted></video><canvas id="hc-overlay"></canvas>`;
  document.body.appendChild(pip);

  const toggleBtn = document.createElement("button");
  toggleBtn.id = "hc-toggle";
  toggleBtn.className = "hc-btn";
  toggleBtn.textContent = "✋ 启用手势控制";
  document.body.appendChild(toggleBtn);

  const flipBtn = document.createElement("button");
  flipBtn.id = "hc-flip";
  flipBtn.className = "hc-btn";
  flipBtn.textContent = "↺ 切换摄像头";
  document.body.appendChild(flipBtn);

  const statusEl = document.createElement("div");
  statusEl.id = "hc-status";
  document.body.appendChild(statusEl);

  const video = document.getElementById("hc-video");
  const overlay = document.getElementById("hc-overlay");
  const octx = overlay.getContext("2d");

  // ---------- 状态 ----------
  let enabled = false;
  let facingMode = "user"; // user=前置(镜像) / environment=后置
  let stream = null;
  let raf = null;
  let hands = null;

  const hand = { x: 0.5, y: 0.5, present: false, sx: 0.5, sy: 0.5, init: false };
  const isMirrored = () => facingMode === "user";

  // ---------- 找到游戏的事件目标（canvas） ----------
  function getTarget() {
    return document.querySelector("canvas") || document.body;
  }

  // ---------- 合成指针事件驱动球拍 ----------
  // Rally 用拖拽手势控制球拍：按下并保持，移动时按位移量驱动。
  // 用 pointerType:'touch' 绕过它的鼠标指针锁定，走绝对坐标/位移路径。
  let pointerDown = false;
  let lastCX = 0, lastCY = 0;
  const PID = 991;

  function firePointer(type, cx, cy) {
    const target = getTarget();
    const ev = new PointerEvent(type, {
      pointerId: PID,
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: cx,
      clientY: cy,
      screenX: cx,
      screenY: cy,
      movementX: type === "pointermove" ? cx - lastCX : 0,
      movementY: type === "pointermove" ? cy - lastCY : 0,
      button: type === "pointerup" ? 0 : 0,
      buttons: type === "pointerup" ? 0 : 1,
      width: 1,
      height: 1,
      pressure: type === "pointerup" ? 0 : 0.5,
    });
    target.dispatchEvent(ev);
    lastCX = cx;
    lastCY = cy;
  }

  function drivePaddle() {
    const W = window.innerWidth, H = window.innerHeight;
    if (hand.present) {
      // 平滑
      const k = 0.25;
      if (!hand.init) { hand.sx = hand.x; hand.sy = hand.y; hand.init = true; }
      hand.sx += (hand.x - hand.sx) * k;
      hand.sy += (hand.y - hand.sy) * k;
      const cx = hand.sx * W;
      const cy = hand.sy * H;

      if (!pointerDown) {
        lastCX = cx; lastCY = cy;
        firePointer("pointerdown", cx, cy);
        pointerDown = true;
      } else {
        firePointer("pointermove", cx, cy);
      }
      statusEl.textContent = `手掌 ✔  (${cx | 0}, ${cy | 0})`;
    } else {
      if (pointerDown) {
        firePointer("pointerup", lastCX, lastCY);
        pointerDown = false;
      }
      hand.init = false;
      statusEl.textContent = "未检测到手";
    }
  }

  // ---------- MediaPipe Hands ----------
  function onResults(results) {
    overlay.width = overlay.clientWidth;
    overlay.height = overlay.clientHeight;
    octx.clearRect(0, 0, overlay.width, overlay.height);

    const lms = results.multiHandLandmarks && results.multiHandLandmarks[0];
    if (lms && lms.length) {
      const palm = lms[9]; // 中指根部 ≈ 掌心
      let nx = palm.x;
      if (isMirrored()) nx = 1 - nx;
      hand.x = nx;
      hand.y = palm.y;
      hand.present = true;

      // PIP 上画关键点
      const w = overlay.width, h = overlay.height;
      octx.save();
      if (isMirrored()) { octx.translate(w, 0); octx.scale(-1, 1); }
      octx.fillStyle = "rgba(224,138,60,.95)"; // --you 陶土橙
      for (const p of lms) {
        octx.beginPath();
        octx.arc(p.x * w, p.y * h, 1.6, 0, Math.PI * 2);
        octx.fill();
      }
      // 掌心高亮:米白填充 + 深棕描边
      octx.fillStyle = "#fffbf3";
      octx.strokeStyle = "#4b4034";
      octx.lineWidth = 1.5;
      octx.beginPath();
      octx.arc(palm.x * w, palm.y * h, 3.8, 0, Math.PI * 2);
      octx.fill();
      octx.stroke();
      octx.restore();
    } else {
      hand.present = false;
    }

    drivePaddle();
  }

  function ensureHands() {
    if (hands) return hands;
    hands = new Hands({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}`,
    });
    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    hands.onResults(onResults);
    return hands;
  }

  // ---------- 摄像头 ----------
  async function startCamera() {
    stopStream();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (e) {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    video.srcObject = stream;
    video.style.transform = isMirrored() ? "scaleX(-1)" : "none";
    await video.play();

    ensureHands();
    const pump = async () => {
      if (!stream) return;
      if (video.readyState >= 2) {
        try { await hands.send({ image: video }); } catch (_) {}
      }
      raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);
  }

  function stopStream() {
    if (raf) cancelAnimationFrame(raf), (raf = null);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  async function enable() {
    if (typeof Hands === "undefined") {
      statusEl.style.display = "block";
      statusEl.textContent = "MediaPipe 未加载";
      return;
    }
    try {
      await startCamera();
      enabled = true;
      pip.style.display = "block";
      flipBtn.style.display = "block";
      statusEl.style.display = "block";
      toggleBtn.textContent = "✋ 关闭手势控制";
      toggleBtn.classList.add("hc-on");
    } catch (e) {
      statusEl.style.display = "block";
      statusEl.textContent = "摄像头失败: " + e.message;
    }
  }

  function disable() {
    stopStream();
    if (pointerDown) { firePointer("pointerup", lastCX, lastCY); pointerDown = false; }
    enabled = false;
    hand.present = false;
    pip.style.display = "none";
    flipBtn.style.display = "none";
    statusEl.style.display = "none";
    toggleBtn.textContent = "✋ 启用手势控制";
    toggleBtn.classList.remove("hc-on");
  }

  toggleBtn.addEventListener("click", () => (enabled ? disable() : enable()));
  flipBtn.addEventListener("click", () => {
    facingMode = facingMode === "user" ? "environment" : "user";
    if (enabled) startCamera();
  });
})();
