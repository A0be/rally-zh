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

  // ---------- 合成指针事件驱动球拍（相对位置控制） ----------
  // Rally 用拖拽手势（位移量）控制球拍：按下保持，移动时按 delta 驱动。
  // 这里用“相对控制”：以掌心的移动增量驱动一个虚拟指针，手小幅移动即可控球拍，
  // 手离开再回来不跳变。用 pointerType:'touch' 绕过游戏的鼠标指针锁定。
  let pointerDown = false;
  let lastCX = 0, lastCY = 0;
  const PID = 991;
  const SENS = 1.7;                 // 灵敏度：掌心移动量 → 球拍位移的放大系数
  let vx = 0, vy = 0;               // 虚拟指针像素位置
  let vInit = false;
  let prevHX = null, prevHY = null; // 上一帧平滑后的掌心归一化位置（相对基准）
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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
      // 轻平滑掌心，减少抖动
      const k = 0.4;
      if (!hand.init) { hand.sx = hand.x; hand.sy = hand.y; hand.init = true; }
      hand.sx += (hand.x - hand.sx) * k;
      hand.sy += (hand.y - hand.sy) * k;

      if (!vInit) { vx = W / 2; vy = H / 2; vInit = true; }        // 初次：从屏幕中心起
      if (prevHX === null) { prevHX = hand.sx; prevHY = hand.sy; } // 重新出现：建立基准，本帧不移动

      // 相对位移：掌心增量 × 灵敏度，累加到虚拟指针
      vx = clamp(vx + (hand.sx - prevHX) * W * SENS, 0, W);
      vy = clamp(vy + (hand.sy - prevHY) * H * SENS, 0, H);
      prevHX = hand.sx; prevHY = hand.sy;

      if (!pointerDown) {
        lastCX = vx; lastCY = vy;
        firePointer("pointerdown", vx, vy);
        pointerDown = true;
      } else {
        firePointer("pointermove", vx, vy);
      }
      statusEl.textContent = `相对控制 ✔  (${vx | 0}, ${vy | 0})`;
    } else {
      if (pointerDown) {
        firePointer("pointerup", lastCX, lastCY);
        pointerDown = false;
      }
      hand.init = false;
      prevHX = prevHY = null; // 重置基准，手回来不跳变
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
