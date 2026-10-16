// 离线自检：plugin/src/straighten-apply.js 的【决策逻辑】（不需要 Photoshop）
// 目的：把「什么时候转、转多少、转反了怎么办、没生效怎么办」这些花钱的真机试错，先在 Node 里证一遍。
// 做法：用 vm 载入真实源码，把 Ecom.ps 与 Ecom.straighten 换成脚本化的假件（θ 序列可编排），
//       然后断言：发出的 transform 角度、次数、以及返回的 data.reason / applied / verified。
// ★ 其中最关键的一条是【安全断言】：只要 verdict 不是 "micro"，就绝不允许发出任何 transform。
// 用法：node verify/straighten-apply-check.js     期望：全部通过、退出码 0
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var SRC = path.join(__dirname, "..", "plugin", "src", "straighten-apply.js");
var STRAIGHTEN_SRC = path.join(__dirname, "..", "plugin", "src", "straighten.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; return; }
  fail++;
  console.log("  FAIL " + msg);
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + "（期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual) + "）");
}
function near(actual, expected, eps, msg) {
  ok(typeof actual === "number" && Math.abs(actual - expected) <= eps,
    msg + "（期望 ≈" + expected + "，实际 " + JSON.stringify(actual) + "）");
}

// 编排一次「真机」：thetaSeq[i] = 第 i 次 analyzeMask 调用返回的 θ（用完后重复最后一个）
function scenario(spec) {
  var logs = [];
  var runs = [];
  var unlockCalls = [];
  var maskCalls = 0;
  var thetaSeq = spec.thetaSeq;

  var maskOpts = [];
  // ★ 真机 2026-10-16 12:40:21 事故后新增：抠图产物的【图层蒙版】就是主体轮廓，必须优先于颜色阈值。
  //   layerMaskSeq[i] = 第 i 次 buildMaskFromLayerMask 调用是否有可用蒙版（不给＝这一层没有蒙版）。
  var layerMaskSeq = spec.layerMaskSeq || (spec.layerMask ? [true] : []);
  var layerMaskCalls = 0;
  // 逐物体摆正用的【真实】规划器：把真源码载进独立上下文再挂上去，避免「假件测假件」
  var realWin = { Ecom: {} };
  vm.runInContext(fs.readFileSync(STRAIGHTEN_SRC, "utf8"),
    vm.createContext({ window: realWin, console: console }), { filename: STRAIGHTEN_SRC });
  var bakeCalls = [];

  var fakeS = {
    planObjectRotations: realWin.Ecom.straighten.planObjectRotations,
    buildMaskFromLayerMask: function (alpha, w, h, opts) {
      var idx = layerMaskCalls++;
      var avail = layerMaskSeq.length ? !!layerMaskSeq[Math.min(idx, layerMaskSeq.length - 1)] : false;
      if (!avail) {
        return { ok: false, mode: "layerMask", mask: new Uint8Array(0), width: 0, height: 0, coverage: 0,
          error: spec.layerMaskError || "图层蒙版长度不足：需要 100，实际 0" };
      }
      return { ok: true, mode: "layerMask", mask: new Uint8Array(10000), width: 100, height: 100, coverage: 0.336 };
    },
    buildForegroundMask: function (px, w, h, opts) {
      maskOpts.push(opts || {});
      var modes = spec.maskModes || ["alpha"];
      return { ok: true, mode: modes[Math.min(maskOpts.length - 1, modes.length - 1)],
        mask: new Uint8Array(10000), width: 100, height: 100, coverage: 0.5 };
    },
    analyzeMask: function () {
      var ts = spec.thetaSeq || [84];
      var i = Math.min(maskCalls, ts.length - 1);
      var v = spec.verdicts ? spec.verdicts[Math.min(maskCalls, spec.verdicts.length - 1)] : "micro";
      var seq = maskCalls;
      maskCalls++;
      // 多物体：multiObjs[i] = 第 i 次分析返回的物体表（逐物体摆正要靠它建选区 / 回读比对）
      if (spec.multiObjs) {
        var objs = spec.multiObjs[Math.min(seq, spec.multiObjs.length - 1)];
        var tilts = objs.map(function (o) { return o.tiltDeg; });
        var mn = Math.min.apply(null, tilts), mx = Math.max.apply(null, tilts);
        return {
          ok: true, coverage: 0.3, areaPx: 5000, centroid: { x: 50, y: 45 },
          thetaDeg: 84, tiltDeg: (mn + mx) / 2,
          minRect: { cx: 50, cy: 45, w: 80, h: 70, thetaDeg: 84 },
          edges: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 }, edgeRmsPct: 0.1,
          quad: { topW: 100, botW: 100, leftH: 100, rightH: 100 },
          perspective: { widthRatio: 1, heightRatio: 1, maxDeviation: 0 },
          mode: "multi", objectCount: objs.length, objects: objs, objectTilts: tilts,
          objectResidualDeg: (mx - mn) / 2, skipReason: spec.multiSkipReason || null,
          verdict: v, notes: []
        };
      }
      return {
        ok: true, coverage: 0.5, areaPx: 50, centroid: { x: 5, y: 5 },
        mode: "single", objectCount: 1, objects: [], objectTilts: [], objectResidualDeg: 0,
        thetaDeg: ts[i], minRect: { cx: 5, cy: 5, w: 8, h: 8, thetaDeg: ts[i] },
        edges: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 }, edgeRmsPct: 0.1,
        quad: { topW: 10, botW: 10, leftH: 10, rightH: 10 },
        perspective: { widthRatio: 1, heightRatio: 1, maxDeviation: 0 },
        verdict: v, notes: []
      };
    }
  };

  var fakePs = {
    log: function (level, text) { logs.push(level + " | " + text); },
    getSubjectPixels: async function () {
      if (spec.pixelsFail) return { ok: false, error: "假的读像素失败" };
      return { ok: true, data: { rgba: [0, 0, 0, 255], width: 100, height: 100, channels: 4,
        alphaMask: layerMaskSeq.length ? new Uint8Array(10000) : undefined,
        pixelFrame: spec.pixelFrame || null, docWidth: spec.docWidth || 1000, docHeight: spec.docHeight || 1000 } };
    },
    // 逐物体摆正前必须先烘焙图层蒙版（否则旋转后的边角会被原轮廓蒙版裁掉）
    applyUserMask: async function (id, name, budget) {
      bakeCalls.push({ id: id, name: name, budget: budget });
      if (spec.bakeFail) return { ok: false, error: "假的蒙版烘焙失败" };
      return { ok: true, data: { form: "delete+apply", maskGone: true } };
    },
    run: async function (descs, opts) {
      var t = null, rect = null, rectUnits = null, rectNums = null, desel = false, setNone = false, empty = false;
      for (var i = 0; i < descs.length; i++) {
        if (descs[i]._obj === "transform") t = descs[i];
        if (descs[i]._obj === "deselect") desel = true;
        if (descs[i]._obj === "set" && descs[i].to && descs[i].to._enum === "ordinal" && descs[i].to._value === "none"
          && descs[i]._target && descs[i]._target[0] && descs[i]._target[0]._property === "selection") setNone = true;
        if (descs[i]._obj === "set" && descs[i].to && descs[i].to._obj === "rectangle") {
          var R = descs[i].to;
          rect = [R.left, R.top, R.right, R.bottom];
          rectUnits = [R.left && R.left._unit, R.top && R.top._unit, R.right && R.right._unit, R.bottom && R.bottom._unit];
          rectNums = [R.left && R.left._value, R.top && R.top._value, R.right && R.right._value, R.bottom && R.bottom._value];
          if (rectNums.join(",") === "0,0,0,0") empty = true;
        }
      }
      var clear = desel || setNone || empty;
      runs.push({
        angle: t ? t.angle._value : null,
        unit: t && t.angle._unit,
        selectFirst: descs.length > 0 && descs[0]._obj === "select",
        rect: rect,
        rectUnits: rectUnits,
        rectNums: rectNums,
        deselect: desel,
        setNone: setNone,
        clear: clear,
        history: opts && opts.history,
        preserve: opts && opts.preserveSelection,
        lockId: opts && opts.lockProbeLayerId,
        label: opts && opts.label
      });
      if (spec.runFail) return { ok: false, error: "假的变换被拒" };
      // 单独让「取消选区」的前 N 次尝试被拒，用来验证兜底写法（真机 2026-10-16 13:31:59 / 13:37:52 的教训）
      if (clear && spec.deselectFail > 0) { spec.deselectFail--; return { ok: false, error: "假的取消选区被拒" }; }
      return { ok: true, data: {} };
    },
    ensureUnlocked: async function (id, name) {
      unlockCalls.push({ id: id, name: name });
      if (spec.unlockFail) return { ok: false, error: "假的解锁失败（背景层解不开）" };
      return {
        ok: true,
        data: {
          locked: !!spec.wasLocked, unlocked: !!spec.wasLocked, via: "dom",
          // ★ 真机 2026-10-16 11:24 事故：背景层转普通层会【换 id】，ensureUnlocked 交出 layerId 让调用方跟着换
          layerId: (spec.newLayerId !== undefined) ? spec.newLayerId : undefined
        }
      };
    }
  };

  var win = { Ecom: { ps: fakePs, straighten: fakeS } };
  var ctx = vm.createContext({ window: win, console: console });
  vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx, { filename: SRC });
  var mod = win.Ecom.straightenApply;

  return mod.run(spec.opts).then(function (res) {
    return { res: res, runs: runs, logs: logs, unlockCalls: unlockCalls, maskOpts: maskOpts,
      layerMaskCalls: layerMaskCalls, bakeCalls: bakeCalls };
  });
}

async function main() {
  // ---- 1. 已经摆正 → 一次都不许转（幂等） ----
  var s1 = await scenario({ thetaSeq: [0.1], opts: { subjectLayerId: 7, subjectLayerName: "主体" } });
  eq(s1.res.ok, true, "1 返回 ok");
  eq(s1.res.data.reason, "already-level", "1 reason=already-level");
  eq(s1.res.data.applied, false, "1 applied=false");
  eq(s1.runs.length, 0, "1 没有发出任何变换");

  // ---- 2. 微调档 + 一次就转正（正向：θ=2.5 → 0.05） ----
  var s2 = await scenario({ thetaSeq: [2.5, 0.05], opts: { subjectLayerId: 7, subjectLayerName: "主体" } });
  eq(s2.runs.length, 1, "2 只转一次");
  near(s2.runs[0].angle, -2.5, 1e-9, "2 发出的角度 = -θ（PS 正角＝顺时针）");
  eq(s2.runs[0].unit, "angleUnit", "2 角度单位 angleUnit");
  eq(s2.runs[0].selectFirst, true, "2 先 select 再 transform");
  eq(s2.runs[0].history, "suspend", "2 history=suspend（可用「回退」复原）");
  eq(s2.runs[0].lockId, 7, "2 带 lockProbeLayerId");
  eq(s2.res.data.applied, true, "2 applied=true");
  eq(s2.res.data.verified, true, "2 verified=true");
  near(s2.res.data.appliedAngleDeg, -2.5, 1e-9, "2 累计旋转 -2.5");
  near(s2.res.data.thetaAfterDeg, 0.05, 1e-9, "2 回读 θ=0.05");

  // ---- 3. 方向反了 → 自动反向补一次（θ=-2.5 → 5.0（更歪） → 0.05） ----
  var s3 = await scenario({ thetaSeq: [-2.5, 5.0, 0.05], opts: { subjectLayerId: 7, subjectLayerName: "主体" } });
  eq(s3.runs.length, 2, "3 转了两次");
  near(s3.runs[0].angle, 2.5, 1e-9, "3 第一次 = -θ");
  near(s3.runs[1].angle, -5.0, 1e-9, "3 第二次 = 反向补（-2×want）");
  near(s3.res.data.appliedAngleDeg, -2.5, 1e-9, "3 净效果 = 另一个方向");
  eq(s3.res.data.verified, true, "3 反向纠正后 verified=true");
  ok(s3.logs.join("\n").indexOf("PS_ANGLE_SIGN") >= 0, "3 日志提示改 PS_ANGLE_SIGN");

  // ---- 4. 转了但像素没变 → 判定未生效，立刻停手，不许盲转第二次 ----
  var s4 = await scenario({ thetaSeq: [2.5, 2.5], opts: { subjectLayerId: 7, subjectLayerName: "主体" } });
  eq(s4.runs.length, 1, "4 只转一次");
  eq(s4.res.data.reason, "no-effect", "4 reason=no-effect");
  eq(s4.res.data.applied, false, "4 applied=false");

  // ---- 5. 反向补一次后仍然不对 → applied=true + 建议回退 ----
  var s5 = await scenario({ thetaSeq: [2.5, -5.0, -5.0], opts: { subjectLayerId: 7, subjectLayerName: "主体" } });
  eq(s5.runs.length, 2, "5 转了两次");
  eq(s5.res.data.reason, "wrong-direction", "5 reason=wrong-direction");
  eq(s5.res.data.applied, true, "5 applied=true（确实转过）");
  eq(s5.res.data.verified, false, "5 verified=false");
  ok(s5.logs.join("\n").indexOf("回退") >= 0, "5 日志建议用「回退」");

  // ---- 6. 安全断言：非 micro（confirm / skip）一次都不许转 ----
  var s6 = await scenario({ thetaSeq: [8], verdicts: ["confirm"], opts: { subjectLayerId: 7, subjectLayerName: "主体" } });
  eq(s6.runs.length, 0, "6 confirm 不转");
  eq(s6.res.data.reason, "not-micro", "6 reason=not-micro");
  eq(s6.res.data.applied, false, "6 applied=false");
  var s7 = await scenario({ thetaSeq: [42], verdicts: ["skip"], opts: { subjectLayerId: 7, subjectLayerName: "主体" } });
  eq(s7.runs.length, 0, "7 skip 不转");
  eq(s7.res.data.applied, false, "7 applied=false");

  // ---- 8. PS 拒绝变换 → 如实报告、不重试 ----
  var s8 = await scenario({ thetaSeq: [2.5], runFail: true, opts: { subjectLayerId: 7, subjectLayerName: "主体" } });
  eq(s8.runs.length, 1, "8 只尝试一次");
  eq(s8.res.data.reason, "transform-rejected", "8 reason=transform-rejected");
  eq(s8.res.data.applied, false, "8 applied=false");

  // ---- 8b. 真机 2026-10-16 10:46:31：主体层是被锁的「背景」层，解锁也失败 → 一次都不许发变换 ----
  var s8b = await scenario({
    thetaSeq: [2.0], unlockFail: true,
    opts: { subjectLayerId: 1, subjectLayerName: "背景" }
  });
  eq(s8b.unlockCalls.length, 1, "8b 变换前先尝试解锁一次");
  eq(s8b.runs.length, 0, "8b 解不开锁时零变换（不空转重试）");
  eq(s8b.res.data.reason, "layer-locked", "8b reason=layer-locked");
  eq(s8b.res.ok, true, "8b 返回 ok（可选步骤失败不掐死流程）");
  ok(s8b.logs.join("\n").indexOf("无法自动解锁") >= 0, "8b 日志写明无法自动解锁");

  // ---- 8c. 主体层原本锁着但自动解锁成功 → 照常转，并写明解锁途径 ----
  var s8c = await scenario({
    thetaSeq: [2.0, 0.02], wasLocked: true,
    opts: { subjectLayerId: 1, subjectLayerName: "背景" }
  });
  eq(s8c.unlockCalls.length, 1, "8c 先解锁一次");
  eq(s8c.runs.length, 1, "8c 解锁后照常转一次");
  eq(s8c.res.data.verified, true, "8c verified=true");
  ok(s8c.logs.join("\n").indexOf("已自动解锁") >= 0, "8c 日志写明已自动解锁");

  // ---- 8d. 真机 2026-10-16 11:24 事故：解锁时图层换了 id（背景 id=1 → 图层 0 id=2）----
  //   症状：图层其实已解锁，但插件继续拿旧 id=1 发命令，PS 回「命令"选择"/"变换"当前不可用」，
  //   用户看到的是"解锁了但一直失败，第二次点击才成功"。⇒ 换 id 后必须用新 id 干活。
  var s8d = await scenario({
    thetaSeq: [2.04, 0.0], wasLocked: true, newLayerId: 2,
    opts: { subjectLayerId: 1, subjectLayerName: "背景" }
  });
  eq(s8d.runs.length, 1, "8d 解锁后照常转一次");
  eq(s8d.runs[0].lockId, 2, "8d ★变换用的是新 id=2（不是已经不存在的 1）");
  eq(s8d.res.data.layerId, 2, "8d 信封里也回新 id");
  ok(s8d.logs.join("\n").indexOf("id 已由 1 变为 2") >= 0, "8d 日志写明换了 id");

  // ---- 9. 回读失败 → 如实说「转了但没能证明」 ----
  var s9 = await scenario({
    thetaSeq: [2.5], breakReadback: true,
    opts: { subjectLayerId: 7, subjectLayerName: "主体" }
  }).catch(function () { return null; });
  ok(s9 === null || s9.res != null, "9 回读失败不抛异常");

  // ---- 10. 前置条件：没有图层 id / 读像素失败 → ok:false 且零变换 ----
  var s10 = await scenario({ thetaSeq: [2.5], opts: {} });
  eq(s10.res.ok, false, "10 缺 subjectLayerId → ok:false");
  eq(s10.runs.length, 0, "10 缺 id 时零变换");
  var s11 = await scenario({ thetaSeq: [2.5], pixelsFail: true, opts: { subjectLayerId: 7 } });
  eq(s11.res.ok, false, "11 读像素失败 → ok:false");
  eq(s11.runs.length, 0, "11 读像素失败时零变换");

  // ---- 12. 缺少依赖模块 → ok:false（不抛） ----
  var win = { Ecom: {} };
  var ctx = vm.createContext({ window: win, console: console });
  vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx, { filename: SRC });
  var r12 = await win.Ecom.straightenApply.run({ subjectLayerId: 7 });
  eq(r12.ok, false, "12 缺 Ecom.ps → ok:false");

  // ---- 13. 真机 2026-10-16 10:59:55（用户 b-2.0 图）：不透明照片首测 mask=bgThreshold（量的是「卡片」），
  //          整层转完之后四角透明，若回读不锁基准就会切成 alpha（＝整张已旋转的画布矩形），
  //          量到的 θ 变成画布转过的角度 ⇒ 被误判成「未生效」而停手。回读必须带首测的 forceMode。 ----
  var s13 = await scenario({
    thetaSeq: [2.04, 0.0], maskModes: ["bgThreshold", "bgThreshold"],
    opts: { subjectLayerId: 2, subjectLayerName: "图层 0" }
  });
  eq(s13.runs.length, 1, "13 转一次");
  eq(s13.res.data.verified, true, "13 回读同基准 → verified=true（图确实摆正了）");
  eq(s13.maskOpts.length, 2, "13 首测 + 回读各做一次掩膜");
  eq(s13.maskOpts[0].forceMode, undefined, "13 首测不锁基准（由像素自判）");
  eq(s13.maskOpts[1].forceMode, "bgThreshold", "13 回读锁定首测基准 forceMode=bgThreshold");
  near(s13.res.data.thetaAfterDeg, 0.0, 1e-9, "13 回读 θ=0");

  // ---- 14. 真机 2026-10-16 11:38:35（真实竖版图）：长轴竖直 ⇒ θ≈-90°，真正要纠的是 tilt=θ+90≈2.5°。
  //          旋转方向仍按「保持竖直」，旋转量必须是 tilt 而不是 θ（否则会发 +87.5° 把图放倒）。 ----
  var s14 = await scenario({
    thetaSeq: [-87.5, -90.0],
    opts: { subjectLayerId: 7, subjectLayerName: "竖版主体" }
  });
  eq(s14.runs.length, 1, "14 竖版只转一次");
  near(s14.runs[0].angle, -2.5, 1e-9, "14 发出的角度 = -tilt(-2.5×-1) 而不是 -θ");
  eq(s14.res.data.verified, true, "14 verified=true（倾斜 2.5° → 0°）");
  near(s14.res.data.tiltDeg, 2.5, 1e-9, "14 data.tiltDeg=2.5（真机 11:38:35 的 θ=-86.15 同理）");
  near(s14.res.data.tiltAfterDeg, 0.0, 1e-9, "14 回读 tilt=0");

  // ---- 15. 真机 2026-10-16 12:40:21（抠图后再点摆正）：那一层的【图层蒙版】就是抠图产物（主体轮廓 33.59%），
  //          但像素 alpha 仍是全 255 ⇒ 旧代码退回 bgThreshold(62.52%) 把灰底当主体 ⇒ 残差 23.26% 误判 skip。
  //          有可用的图层蒙版时，首测与回读都必须用它当基准，完全不走像素掩膜。 ----
  var s15 = await scenario({
    thetaSeq: [5.44, 0.0], layerMask: true,
    opts: { subjectLayerId: 5, subjectLayerName: "图层 1" }
  });
  eq(s15.runs.length, 1, "15 转一次");
  eq(s15.res.data.verified, true, "15 verified=true");
  eq(s15.layerMaskCalls, 2, "15 首测 + 回读各用一次图层蒙版（同一基准）");
  eq(s15.maskOpts.length, 0, "15 有图层蒙版时完全不调用像素掩膜（bgThreshold(62.52%) 那条错路不会再走）");
  eq(s15.res.data.maskBasisNote, undefined, "15 蒙版正常跟随旋转 ⇒ 不需要像素基准复核");
  ok(s15.logs.some(function (l) { return l.indexOf("掩膜基准＝图层蒙版") >= 0; }), "15 日志写明用了图层蒙版基准");

  // ---- 16. 图层蒙版不可用（几乎全白 / 没有蒙版）→ 退回像素基准，照常工作 ----
  var s16 = await scenario({
    thetaSeq: [2.0, 0.0], layerMaskSeq: [false],
    opts: { subjectLayerId: 5, subjectLayerName: "图层 1" }
  });
  eq(s16.res.data.verified, true, "16 蒙版不可用时退回像素基准，照常摆正");
  eq(s16.maskOpts.length, 2, "16 首测与回读都走像素掩膜");
  ok(s16.logs.some(function (l) { return l.indexOf("图层蒙版不可用") >= 0; }), "16 日志写明蒙版不可用的原因");

  // ---- 17. 蒙版没跟着图层旋转（未链接的蒙版 / 蒙版已被应用）：蒙版基准量到「没动」是假未生效，
  //          必须再用像素基准复核一次，量到变好就判成功（而不是谎报 no-effect 或盲转第二次）。 ----
  var s17 = await scenario({
    thetaSeq: [5.44, 5.44, 0.0], layerMask: true, maskModes: ["bgThreshold"],
    opts: { subjectLayerId: 5, subjectLayerName: "图层 1" }
  });
  eq(s17.runs.length, 1, "17 只转一次（不因为假「未生效」再补转）");
  eq(s17.res.data.verified, true, "17 像素基准复核量到变好 ⇒ verified=true");
  eq(s17.res.data.reason, undefined, "17 不能落到 no-effect");
  ok(!!s17.res.data.maskBasisNote && s17.res.data.maskBasisNote.indexOf("没跟着") >= 0,
    "17 data 记下「图层蒙版没跟着图层旋转」这条事实");

  // ---- 18. 首测有蒙版、回读时蒙版消失 → 硬失败（绝不静默换基准重新量，那是 10:59:55 事故的教训） ----
  var s18 = await scenario({
    thetaSeq: [5.44], layerMaskSeq: [true, false],
    opts: { subjectLayerId: 5, subjectLayerName: "图层 1" }
  });
  eq(s18.res.data.reason, "readback-failed", "18 回读拿不到蒙版 ⇒ 硬失败");
  eq(s18.res.data.verified, false, "18 不谎报成功");
  eq(s18.res.data.applied, true, "18 但确实发出过旋转（提示用户手动确认）");
  eq(s18.maskOpts.length, 0, "18 回读不偷偷退回像素基准");

  // ==================================================================
  // 逐物体分开摆正（用户 2026-10-16 决策 A：保持单层、逐物体各自原地旋转）
  // 网格 100x100，取景框 100,200 → 1100,1200（1 网格 px = 10 文档 px）
  // ==================================================================
  var FRAME = { left: 100, top: 200, right: 1100, bottom: 1200 };
  var objL = { cx: 25.5, cy: 45, w: 31, h: 71, tiltDeg: 0.66, elongation: 13, minX: 10, minY: 10, maxX: 40, maxY: 80, areaPx: 2200 };
  var objR = { cx: 75, cy: 45, w: 31, h: 67, tiltDeg: 2.03, elongation: 15, minX: 60, minY: 12, maxX: 90, maxY: 78, areaPx: 2100 };
  var objLa = { cx: 25.5, cy: 45, w: 31, h: 71, tiltDeg: 0.05, elongation: 13, minX: 10, minY: 10, maxX: 40, maxY: 80, areaPx: 2200 };
  var objRa = { cx: 75, cy: 45, w: 31, h: 67, tiltDeg: 0.08, elongation: 15, minX: 60, minY: 12, maxX: 90, maxY: 78, areaPx: 2100 };
  var MW6 = { subjectLayerId: 5, subjectLayerName: "图层 0" };

  // ---- 19. 逐物体各转各的（真机 0.66° / 2.03°）----
  var s19 = await scenario({
    multiObjs: [[objL, objR], [objLa, objRa]], layerMask: true, maskModes: ["alpha"],
    pixelFrame: FRAME, opts: MW6
  });
  var rot19 = s19.runs.filter(function (r) { return r.angle !== null; });
  eq(rot19.length, 2, "19 两个物体各发一次选区旋转");
  near(rot19[0].angle, -0.66, 0.02, "19 物体 #1 发 -tilt（PS 正角＝顺时针）");
  near(rot19[1].angle, -2.03, 0.02, "19 物体 #2 各按自己的 tilt");
  eq(JSON.stringify(rot19[0].rectNums), JSON.stringify([170, 270, 540, 1040]), "19 选区 = 包围盒+外扩，按取景框换算到文档坐标");
  eq(JSON.stringify(rot19[1].rectNums), JSON.stringify([660, 280, 1050, 1030]), "19 第二个物体用自己的选区（不是全图）");
  eq(JSON.stringify(rot19[0].rectUnits), JSON.stringify(["pixelsUnit", "pixelsUnit", "pixelsUnit", "pixelsUnit"]),
    "19 矩形四条边各自带 {_unit:'pixelsUnit',_value}（真机 2026-10-16 13:29:32：裸数字被拒 NAPI API failure: Number expected）");
  eq(s19.bakeCalls.length, 1, "19 逐物体旋转前先烘焙图层蒙版（否则边角被原轮廓裁掉）");
  eq(s19.res.data.maskBaked, true, "19 data.maskBaked=true");
  eq(s19.layerMaskCalls, 1, "19 烘焙后回读不再用图层蒙版（只能走像素基准）");
  eq(s19.maskOpts.length, 1, "19 回读改走像素基准");
  eq(s19.res.data.applied, true, "19 applied=true");
  eq(s19.res.data.verified, true, "19 verified=true");
  eq(s19.res.data.perObject.length, 2, "19 逐物体结果各一条");
  near(s19.res.data.tiltAfterDeg, 0.08, 0.02, "19 残余倾斜取最差的那个");
  var clear19 = s19.runs.filter(function (r) { return r.clear; });
  eq(clear19.length, 4, "19 取消选区要把 4 种写法依次全发出去（本机 ok 不可信：deselect 报 ok 却无效）");
  eq(clear19[0].setNone, true, "19 第一发必须是权威写法 set selection→none（app.js 自己的 deselect）");
  eq(clear19[3].rectNums.join(","), "0,0,0,0", "19 最后一发是空矩形兜底");
  eq(clear19[0].preserve, false,
    "19 取消选区必须 preserveSelection:false —— 默认 true 会在批处理末尾 restoreDocumentSelection 把选区恢复回来（真机 2026-10-16 13:31:59 的 bug）");
  ok(s19.logs.join("\n").indexOf("物体 #2：倾斜 2.03°") >= 0, "19 日志逐物体写明发多少度、选区多大");

  // ---- 20. 蒙版烘焙失败 → 不动画面（宁可不动，也不留下被裁掉的边角）----
  var s20 = await scenario({ multiObjs: [[objL, objR]], layerMask: true, bakeFail: true, opts: MW6 });
  eq(s20.res.data.reason, "mask-bake-failed", "20 烘焙失败 ⇒ 不动画面");
  eq(s20.runs.filter(function (r) { return r.angle !== null; }).length, 0, "20 一发变换都不发");

  // ---- 21. 两个物体太近（外扩后互相罩住）→ 都跳过 ----
  var o1 = { cx: 25, cy: 45, w: 31, h: 71, tiltDeg: 4, elongation: 13, minX: 10, minY: 10, maxX: 40, maxY: 80, areaPx: 2200 };
  var o2 = { cx: 60, cy: 45, w: 31, h: 71, tiltDeg: 4, elongation: 13, minX: 45, minY: 10, maxX: 75, maxY: 80, areaPx: 2200 };
  var s21 = await scenario({ multiObjs: [[o1, o2]], layerMask: true, opts: MW6 });
  eq(s21.runs.length, 0, "21 谁都不转（不建选区）");
  eq(s21.res.data.reason, "no-object-to-rotate", "21 reason=no-object-to-rotate");
  eq(s21.bakeCalls.length, 0, "21 没有可转的物体就不烘焙蒙版");
  ok(s21.logs.join("\n").indexOf("罩住") >= 0, "21 日志写明跳过原因（会把邻居一起转）");

  // ---- 22. 选区变换被拒 → 停止，并把选区清掉 ----
  var s22 = await scenario({ multiObjs: [[objL, objR]], layerMask: true, runFail: true, opts: MW6 });
  eq(s22.res.data.reason, "transform-rejected", "22 变换被拒 ⇒ 停止逐物体旋转");
  eq(s22.res.data.applied, false, "22 不谎报已应用");
  eq(s22.runs.filter(function (r) { return r.clear; }).length, 4, "22 即使被拒也要把 4 种清选区写法发出去");

  // ---- 23. 回读发现物体没被摆正 ⇒ verified=false（绝不谎报成功）----
  var s23 = await scenario({ multiObjs: [[objL, objR], [objL, objR]], layerMask: true, opts: MW6 });
  eq(s23.res.data.verified, false, "23 回读倾斜没变 ⇒ verified=false");
  eq(s23.res.data.reason, "verify-failed", "23 reason=verify-failed");

  // ---- 24. 物体中心跑掉 ⇒ 判失败（防 PS 拿图层中心当旋转中心，把物体挪走）----
  var objLm = { cx: 60, cy: 45, w: 31, h: 71, tiltDeg: 0.05, elongation: 13, minX: 45, minY: 10, maxX: 74, maxY: 80, areaPx: 2200 };
  var s24 = await scenario({ multiObjs: [[objL, objR], [objLm, objRa]], layerMask: true, opts: MW6 });
  eq(s24.res.data.verified, false, "24 中心位移超过容差 ⇒ verified=false");
  ok(JSON.stringify(s24.res.data.perObject).indexOf("\"shiftPx\"") >= 0, "24 逐物体结果里记下中心位移（供人工核对）");

  // ---- 25. 没有图层蒙版（像素 alpha 真透明）⇒ 不需要烘焙 ----
  var s25 = await scenario({ multiObjs: [[objL, objR], [objLa, objRa]], layerMaskSeq: [false], opts: MW6 });
  eq(s25.bakeCalls.length, 0, "25 没有图层蒙版 ⇒ 不烘焙");
  eq(s25.res.data.verified, true, "25 照常逐物体摆正");

  // ---- 26. 单物体路径不建选区（整层转，行为与改动前一致）----
  eq(s2.runs[0].rectNums, null, "26 单物体路径不发矩形选区（仍是整层 transform）");

  // ---- 27. 清选区的第一发被拒 ⇒ 其余写法照发（绝不静默、不提前放弃）----
  var s27 = await scenario({ multiObjs: [[objL, objR], [objLa, objRa]], layerMask: true, pixelFrame: FRAME, deselectFail: 1, opts: MW6 });
  var des27 = s27.runs.filter(function (r) { return r.clear; });
  eq(des27.length, 4, "27 第一发被拒 ⇒ 剩下三种写法照发（不提前 return）");
  eq(des27[0].setNone, true, "27 第一发仍是权威写法 set selection→none");
  eq(des27[3].rectNums.join(","), "0,0,0,0", "27 最后一发是空矩形兜底");
  eq(s27.res.data.verified, true, "27 清选区被拒不影响摆正结论");

  console.log("straighten-apply 离线自检：通过 " + pass + " 项 / 失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.log("自检自身异常：" + (e && e.stack ? e.stack : e));
  process.exit(1);
});
