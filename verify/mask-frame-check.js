// 用法：node verify/mask-frame-check.js <mask.raw> <maskW> <maskH> <gridW> <gridH> <L> <T> <R> <B>
//
// 目的：用【地面真值掩膜】（Photoshop 自己的 Remove Background，全分辨率）+ 插件同一套数学，
// 离线复现真机 12:49 的两种取景框，证明「非等比缩放网格」就是逐物体角度被系统性放大的原因：
//   旧路 = 整幅画布 1844x4096 直接塞进 624x1024（x 缩放 0.3384 / y 缩放 0.25 ⇒ tan 放大 1.354 倍）
//   新路 = 先裁到图层 bounds（L188 T882 R1600 B3198 = 1412x2316）再等比重采样
// 期望：旧路复现真机日志的 0.95°/2.93°（极差/2 0.99 ⇒ confirm 不转）；
//       新路给出真值 0.66°/2.04°（极差/2 0.69 ⇒ micro，应当旋转）。
"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const SRC = path.join(__dirname, "..", "plugin", "src", "straighten.js");
const sandbox = { window: { Ecom: {} }, console: console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, "utf8"), sandbox, { filename: "straighten.js" });
const S = sandbox.window.Ecom.straighten;

const a = process.argv.slice(2);
if (a.length < 9) {
  console.log("用法：node verify/mask-frame-check.js <mask.raw> <maskW> <maskH> <gridW> <gridH> <L> <T> <R> <B>");
  process.exit(2);
}
const raw = a[0];
const MW = +a[1];
const MH = +a[2];
const GW = +a[3];
const GH = +a[4];
const L = +a[5];
const T = +a[6];
const R = +a[7];
const B = +a[8];

// 与 plugin/src/ps.js 的 resampleMask 逐行同构（同一算法，含 frame 裁剪）
function resample(mask, w, h, frame) {
  const mw = mask.width;
  const mh = mask.height;
  const src = mask.gray;
  let sx0 = 0;
  let sy0 = 0;
  let sw = mw;
  let sh = mh;
  if (frame) {
    sx0 = Math.max(0, Math.min(mw - 1, frame.left));
    sy0 = Math.max(0, Math.min(mh - 1, frame.top));
    sw = Math.max(1, Math.min(mw, frame.right) - sx0);
    sh = Math.max(1, Math.min(mh, frame.bottom) - sy0);
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = sy0 + Math.min(sh - 1, Math.floor((y + 0.5) * sh / h));
    const rowSrc = sy * mw;
    const rowDst = y * w;
    for (let x = 0; x < w; x++) {
      const sx = sx0 + Math.min(sw - 1, Math.floor((x + 0.5) * sw / w));
      out[rowDst + x] = src[rowSrc + sx];
    }
  }
  return out;
}

function report(title, alpha, w, h) {
  console.log(title);
  const fm = S.buildMaskFromLayerMask(alpha, w, h, {});
  if (!fm.ok) {
    console.log("   → 掩膜不可用：" + fm.error);
    return;
  }
  const an = S.analyzeMask(fm.mask, w, h, {});
  if (!an.ok) {
    console.log("   → 分析失败：" + an.reason);
    return;
  }
  console.log("   前景 " + (fm.coverage * 100).toFixed(2) + "% · mode=" + an.mode + " n=" + an.objectCount +
    " θ=" + an.thetaDeg.toFixed(2) + " tilt=" + an.tiltDeg.toFixed(2) +
    " 极差/2=" + (an.objectResidualDeg || 0).toFixed(2) + " → " + an.verdict);
  (an.objects || []).forEach(function (o, i) {
    console.log("   #" + (i + 1) + " " + o.w + "x" + o.h + " 中心(" + Math.round(o.cx) + "," + Math.round(o.cy) +
      ") tilt=" + o.tiltDeg.toFixed(2) + " 长宽方差比=" + o.elongation.toFixed(2));
  });
}

const buf = fs.readFileSync(raw);
if (buf.length < MW * MH) {
  console.log("掩膜长度不足：" + buf.length + " < " + MW * MH);
  process.exit(2);
}
const full = new Uint8Array(MW * MH);
for (let i = 0; i < MW * MH; i++) full[i] = buf[i] >= 128 ? 255 : 0;

report("【基准】全分辨率画布 " + MW + "x" + MH + "（PS Remove Background 地面真值）", full, MW, MH);
report("【旧路】整幅画布 → " + GW + "x" + GH + "（x " + (GW / MW).toFixed(4) + " / y " + (GH / MH).toFixed(4) +
  "，比值 " + ((GW / MW) / (GH / MH)).toFixed(4) + "）",
  resample({ width: MW, height: MH, gray: full }, GW, GH, null), GW, GH);
const CW = R - L;
const CH = B - T;
report("【新路】裁到图层 bounds " + CW + "x" + CH + " → " + GW + "x" + GH + "（等比 " +
  (GW / CW).toFixed(4) + " / " + (GH / CH).toFixed(4) + "）",
  resample({ width: MW, height: MH, gray: full }, GW, GH, { left: L, top: T, right: R, bottom: B }), GW, GH);
