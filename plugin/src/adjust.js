// Ecom.adjust —— 调色（非破坏：调整图层 / 智能滤镜）（INTERFACE §9）
// 依据手册 C8–C12（调整图层）与 D13–D15（智能滤镜），逐项容错，单项失败不中止其余项。
window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  // state.adjust.items 的合法区间（INTERFACE §3 冻结），computeAuto 用它做 clamp
  var RANGES = {
    saturation: [-100, 100],
    brightness: [-100, 100],
    temperature: [-100, 100],
    contrast: [-100, 100],
    whiteBalance: [-100, 100],
    exposure: [-5, 5],
    sharpness: [0, 300],
    noise: [0, 100]
  };
  var ORDER = ["saturation", "brightness", "temperature", "contrast", "whiteBalance", "exposure", "sharpness", "noise"];

  function clamp(n, lo, hi) {
    if (!isFinite(n)) return 0;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function clampByKey(key, n) {
    var r = RANGES[key] || [-100, 100];
    return clamp(n, r[0], r[1]);
  }

  // 纯函数：无宿主调用；analysis 为 null 时全部返回 0
  function computeAuto(analysis, order) {
    var out = {};
    var keys = order && order.length ? order : ORDER;
    var i;
    for (i = 0; i < keys.length; i++) out[keys[i]] = 0;
    if (!analysis) return out;

    var meanLuma = isFinite(analysis.meanLuma) ? analysis.meanLuma : 0.5;
    var meanSat = isFinite(analysis.meanSat) ? analysis.meanSat : 30;
    var dr = isFinite(analysis.dynamicRange) ? analysis.dynamicRange : 0.6;
    var castRG = isFinite(analysis.castRG) ? analysis.castRG : 0;
    var castBG = isFinite(analysis.castBG) ? analysis.castBG : 0;

    // 亮度：把平均亮度拉向 0.5
    out.brightness = clampByKey("brightness", (0.5 - meanLuma) * 100);
    // 饱和度：偏灰就加，过艳就减
    var sat = 0;
    if (meanSat < 25) sat = Math.min(35, 30 - meanSat);
    else if (meanSat > 60) sat = -Math.min(30, meanSat - 60);
    out.saturation = clampByKey("saturation", sat);
    // 对比度：动态范围过窄就加，过宽就减
    var con = 0;
    if (dr < 0.35) con = (0.35 - dr) * 100;
    else if (dr > 0.85) con = -(dr - 0.85) * 60;
    out.contrast = clampByKey("contrast", con);
    // 色温：BG 为负（偏蓝）→ 加暖；为正（偏黄）→ 加冷
    out.temperature = clampByKey("temperature", -castBG * 2);
    // 白平衡：RG 为正（偏红）→ 向青绿补偿
    out.whiteBalance = clampByKey("whiteBalance", -castRG * 1.5);
    // 曝光度：整幅偏暗就加
    out.exposure = clampByKey("exposure", (0.5 - meanLuma) * 1.2);
    // 锐化 / 降噪：无画面依据，给固定推荐强度（仅在用户启用 auto 时使用）
    out.sharpness = clampByKey("sharpness", 80);
    out.noise = clampByKey("noise", 30);
    return out;
  }

  // 读回「当前活动调整层」自己的调整数据（第 7 轮新增：写完色温必须回读验证键名是否真的生效）。
  //   形式与 AUTO_EVENTS 一致：_ref adjustmentLayer + ordinal targetEnum；返回 null 表示读不到。
  async function readAdjustmentObject(ps) {
    try {
      var r = await ps.runRaw([{
        _obj: "get",
        _target: [{ _ref: "adjustmentLayer", _enum: "ordinal", _value: "targetEnum" }]
      }]);
      if (!r.ok) return null;
      var bad = ps.firstErrorItem(r.data && r.data.results);
      if (bad) return null;
      var e = (r.data && r.data.results && r.data.results[0]) || null;
      if (!e) return null;
      var adj = e.adjustment || (e.to && e.to.adjustment) || null;
      // ★ 真机 11:25 日志：回读回来的可能是「类数组」（Object.keys 只给 ["0"]），值裹在 adj[0] 里。
      //   两种形状都认，免得因形状不同就把「已生效」误判成「键名不匹配」。
      if (Array.isArray(adj) && adj.length && adj[0] && typeof adj[0] === "object") adj = adj[0];
      else if (adj && typeof adj === "object") {
        var ks = Object.keys(adj);
        if (ks.length === 1 && ks[0] === "0" && adj["0"] && typeof adj["0"] === "object") adj = adj["0"];
      }
      return adj;
    } catch (err) {
      return null;
    }
  }

  function activeLayerName(ps) {
    try {
      var m = ps.require();
      var d = m.app.activeDocument;
      var al = d && d.activeLayers && d.activeLayers[0];
      return al ? String(al.name || "") : "";
    } catch (e) {
      return "";
    }
  }

  // 剪贴需要拿到刚建好的调整层 id：DOM 侧同步可读（与 activeLayerName 同源，不需要 AM）。
  function activeLayerIdDom(ps) {
    try {
      var m = ps.require();
      var d = m.app.activeDocument;
      var al = d && d.activeLayers && d.activeLayers[0];
      return (al && typeof al.id === "number") ? al.id : null;
    } catch (e) {
      return null;
    }
  }

  // ★ 用户口径（m02477）：「调色改成只应用到选中的主体图上，而不是调全部图层」。
  //   AM 里就是「创建剪贴蒙版」：调整层只作用于剪贴组最底下的主体层，不再影响主体下方的背景/其它图层。
  //   只对【调整层】做 —— 锐化/降噪那两条链作用在主体自身，不能剪贴。
  //   ★ 写法本身有坑（用户 m03367 真机 + 权威回读定案）：`set {to:{clipping:true}}` 在这台 PS 27.1 上无报错但不生效
  //   （日志「成功 N/N」而图层只有 mask 没有 clipping）；本机可用的是 groupEvent + group:true。
  var CLIP_KEYS = { "saturation": 1, "brightness/contrast": 1, "temperature": 1, "whiteBalance": 1, "exposure": 1 };
  function clipStepFor(layerId) {
    return {
      _obj: "groupEvent",
      _target: [{ _ref: "layer", _id: layerId }],
      group: true
    };
  }

  function itemsOf(opts) {
    opts = opts || {};
    var items = opts.items && typeof opts.items === "object" ? opts.items : {};
    var auto = computeAuto(opts.analysis || null, ORDER);
    var effective = {};
    var enabled = {};
    for (var i = 0; i < ORDER.length; i++) {
      var key = ORDER[i];
      var item = items[key] || {};
      enabled[key] = !!item.enabled;
      if (!item.enabled) { effective[key] = 0; continue; }
      var raw = item.auto ? auto[key] : Number(item.value);
      var lo = isFinite(Number(item.min)) ? Number(item.min) : RANGES[key][0];
      var hi = isFinite(Number(item.max)) ? Number(item.max) : RANGES[key][1];
      effective[key] = clamp(raw, lo, hi);
    }
    return { effective: effective, enabled: enabled, auto: auto };
  }

  function layerMake(typeObj, extraKeys) {
    var using = { _obj: "adjustmentLayer", type: typeObj };
    if (extraKeys) {
      var keys = Object.keys(extraKeys);
      for (var i = 0; i < keys.length; i++) using[keys[i]] = extraKeys[keys[i]];
    }
    return { _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using: using };
  }

  function layerSet(toObj) {
    return {
      _obj: "set",
      _target: [{ _ref: "adjustmentLayer", _enum: "ordinal", _value: "targetEnum" }],
      to: toObj
    };
  }

  async function execStep(ps, key, descriptors) {
    var r;
    try {
      r = await ps.runRaw(descriptors);
    } catch (e) {
      r = { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
    if (!r.ok) return { ok: false, error: "调色项「" + key + "」" + r.error };
    var bad = ps.firstErrorItem(r.data && r.data.results);
    if (bad) return { ok: false, error: "调色项「" + key + "」" + ps.describeErrorItem(bad) };
    return { ok: true, data: r.data };
  }

  async function apply(opts) {
    opts = opts || {};
    var ps = window.Ecom.ps;
    var state = itemsOf(opts);
    var effective = state.effective;
    var enabled = state.enabled;

    var applied = [];
    var skipped = [];
    var layers = [];
    var failureDetail = [];
    var clipIds = [];
    var clipNote = null;

    try {
      // 锐化 / 降噪需要主体层；剪贴调色也需要主体层。只在开始时解析一次（转智能对象后 kind 会变，避免二次解析失败）。
      var needsPixels = (enabled.sharpness && effective.sharpness > 0) || (enabled.noise && effective.noise > 0);
      var clipOn = (opts.clipToSubject === false) ? false : true;
      var subjectId = (typeof opts.subjectLayerId === "number") ? opts.subjectLayerId : null;
      if (subjectId === null && (needsPixels || clipOn)) {
        var found = await ps.findSubjectLayer({});
        if (!found.ok) {
          if (needsPixels) {
            return { ok: false, error: found.error };
          }
          clipOn = false;
          clipNote = "找不到主体层（" + found.error + "）";
          ps.log("warn", "调色剪贴到主体层已放弃：" + clipNote + " → 调整层会作用于下方所有图层");
        } else {
          subjectId = found.data.id;
        }
      }

      for (var i = 0; i < ORDER.length; i++) {
        if (!enabled[ORDER[i]]) skipped.push(ORDER[i]);
      }

      // 剪贴的前提是调整层【紧贴主体层上方】：先选中主体层，之后每个 make 都把新调整层插进它上方，
      // 后续调整层再逐个叠在上一个之上（仍属同一剪贴组，组底还是主体层）。
      if (clipOn && subjectId !== null) {
        var selRes;
        try {
          selRes = await ps.runRaw([{ _obj: "select", _target: [{ _ref: "layer", _id: subjectId }] }]);
        } catch (e) {
          selRes = { ok: false, error: (e && e.message) ? e.message : String(e) };
        }
        if (!selRes.ok) {
          clipOn = false;
          clipNote = "选中主体层失败（" + selRes.error + "）";
          ps.log("warn", "调色剪贴到主体层已放弃：" + clipNote + " → 调整层会作用于下方所有图层");
        }
      }

      function record(key, okStep, layName) {
        if (okStep === true) {
          applied.push(key);
          if (layName) layers.push(layName);
          // 刚建好的调整层就是当前活动图层 → 记下 id，等所有调整项建完后统一剪贴到主体
          if (clipOn && CLIP_KEYS[key]) {
            var lid = activeLayerIdDom(ps);
            if (lid !== null && clipIds.indexOf(lid) < 0) clipIds.push(lid);
          }
          return;
        }
        var msg = (okStep && okStep.error) ? okStep.error : "未知错误";
        failureDetail.push({ key: key, error: msg });
        ps.log("error", "调色项「" + key + "」失败：" + msg);
      }

      // saturation + temperature —— 一个「颜色和自然饱和度」层调两个滑块
      //   ★ 用户 m03252 原话：「图1调色后不要使用照片滤镜了…颜色和自然饱和度创建了两个，改为创建一个调两个滑块就行」。
      //   本机取证：该调整层的 AM 类名就是 vibrance（用户手建的那层 kind=vibrance），
      //   面板＝白平衡/色温/色调/自然饱和度/饱和度；「色温」滑块的调整数据键名取 temperature。
      //   所以饱和度与色温共用【一个】vibrance 层、一次 set 写两个键；
      //   照片滤镜回退链已按用户要求删除（它会在最上层且不受剪贴，正是用户看到的「整幅变暖」）。
      var needSat = !!enabled.saturation;
      var needTemp = !!enabled.temperature;
      if (needSat || needTemp) {
        var vTo = { _obj: "vibrance", vibrance: 0, saturation: needSat ? clamp(effective.saturation, -100, 100) : 0 };
        if (needTemp) vTo.temperature = clamp(effective.temperature, -100, 100);
        var r1 = await execStep(ps, needSat ? (needTemp ? "saturation+temperature" : "saturation") : "temperature", [
          layerMake({ _obj: "vibrance" }),
          layerSet(vTo)
        ]);
        if (r1.ok) {
          var nm1 = activeLayerName(ps);
          if (needSat) applied.push("saturation");
          if (needTemp) applied.push("temperature");
          if (nm1) layers.push(nm1);
          ps.log("info", "「颜色和自然饱和度」一个层两个滑块：饱和度=" + vTo.saturation +
            (needTemp ? "、色温=" + vTo.temperature : "、色温未启用") + "（层「" + nm1 + "」）");
          // 回读只作诊断（确认键名/形状），不再据此回退到照片滤镜
          var adjObj = await readAdjustmentObject(ps);
          if (adjObj) {
            ps.log("info", "回读「颜色和自然饱和度」层数据键 = " + Object.keys(adjObj).join(",") +
              (typeof adjObj.temperature === "number" ? "（色温回读=" + adjObj.temperature + "）" : "（没有 temperature 键）"));
          } else {
            ps.log("warn", "回读「颜色和自然饱和度」层数据失败（只影响诊断，不影响已写入的滑块）");
          }
          if (clipOn) {
            var lid1 = activeLayerIdDom(ps);
            if (lid1 !== null && clipIds.indexOf(lid1) < 0) clipIds.push(lid1);
          }
        } else {
          if (needSat) failureDetail.push({ key: "saturation", error: r1.error });
          if (needTemp) failureDetail.push({ key: "temperature", error: r1.error });
          ps.log("error", "调色项「颜色和自然饱和度」失败：" + r1.error);
        }
      }

      // brightness + contrast —— C9：同一层一次 set，必须显式 useLegacy:false
      if (enabled.brightness || enabled.contrast) {
        var r2 = await execStep(ps, "brightness/contrast", [
          layerMake({ _obj: "brightnessContrast", useLegacy: false }),
          layerSet({
            _obj: "brightnessContrast",
            brightness: enabled.brightness ? effective.brightness : 0,
            contrast: enabled.contrast ? effective.contrast : 0,
            useLegacy: false
          })
        ]);
        // ★ 第 7 轮（用户 m02731：「这里面有自带的自动调整，直接调用就行」）：
        //   亮度/对比度面板的「自动」按钮在脚本接口里没有公开事件名（ExtendScript 实测
        //   autoBrightnessContrast / autoTone / autoBrightness / auto 全被拒；调整层也没有 DOM 自动方法，
        //   只有像素层的 autoContrast() 可用，且历史状态名显示它叫「自动对比度」而不是这个面板的自动）。
        //   所以这里按候选事件名真机各试一次：成功＝用的是 PS 自带自动；全失败＝保留上面按主体统计算出的值。
        //   两条路径都写进 ecom-debug.log，用户下一份日志即可判定。
        if (r2.ok) {
          var AUTO_EVENTS = ["autoBrightnessContrast", "autoBrightness", "autoContrast", "autoTone"];
          var autoUsed = null;
          var autoErrs = [];
          for (var ae = 0; ae < AUTO_EVENTS.length && !autoUsed; ae++) {
            var ar = await ps.runRaw([{
              _obj: AUTO_EVENTS[ae],
              _target: [{ _ref: "adjustmentLayer", _enum: "ordinal", _value: "targetEnum" }]
            }]);
            var badA = ar.ok ? ps.firstErrorItem(ar.data && ar.data.results) : ar;
            if (ar.ok && !badA) autoUsed = AUTO_EVENTS[ae];
            else autoErrs.push(AUTO_EVENTS[ae] + " → " + (ar.ok ? ps.describeErrorItem(badA) : ar.error));
          }
          if (autoUsed) ps.log("info", "亮度/对比度：已调用 PS 自带自动（事件 " + autoUsed + "）");
          else ps.log("warn", "亮度/对比度：PS 的「自动」在脚本接口里不可达（试过 " + AUTO_EVENTS.join("/") + "：☓ " +
            autoErrs.join("；☓ ") + "）→ 保留按主体统计算出的值（亮度=" + effective.brightness + " 对比度=" + effective.contrast + "）");
          var nm2 = activeLayerName(ps);
          if (enabled.brightness) { applied.push("brightness"); }
          if (enabled.contrast) { applied.push("contrast"); }
          if (nm2) layers.push(nm2);
          // ★ 用户 m03482 真机（12:48:26 日志「剪贴到主体：成功 1/1 个调整层（层 id=4）」+ 截图只有上一张剪贴）：
          //   这一支漏了「刚建好的调整层 id 记进 clipIds」—— 于是循环只剪贴了「颜色和自然饱和度」一张。
          //   （另一端：vibrance 那一支在 :283 记了，所以它一直好使。）
          if (clipOn) {
            var lid2 = activeLayerIdDom(ps);
            if (lid2 !== null && clipIds.indexOf(lid2) < 0) clipIds.push(lid2);
          }
        } else {
          var keys2 = [];
          if (enabled.brightness) keys2.push("brightness");
          if (enabled.contrast) keys2.push("contrast");
          for (var k2 = 0; k2 < keys2.length; k2++) failureDetail.push({ key: keys2[k2], error: r2.error });
          ps.log("error", "调色项「brightness/contrast」失败：" + r2.error);
        }
      }

      // temperature：已并入上面的「颜色和自然饱和度」层（一个层两个滑块），
      //   照片滤镜回退链按用户 m03252 要求删除。

      // whiteBalance —— C11：三个 levels 都是 3 元数组
      if (enabled.whiteBalance) {
        var wb = clamp(effective.whiteBalance, -100, 100);
        var r4 = await execStep(ps, "whiteBalance", [
          layerMake({ _obj: "colorBalance" }),
          layerSet({
            _obj: "colorBalance",
            preserveLuminosity: true,
            shadowLevels: [0, 0, 0],
            midtoneLevels: [wb, 0, 0],
            highlightLevels: [0, 0, 0]
          })
        ]);
        record("whiteBalance", r4.ok ? true : { error: r4.error }, r4.ok ? activeLayerName(ps) : null);
      }

      // exposure —— C12：三个参数键名 [推断]，真机首跑须核对
      if (enabled.exposure) {
        var r5 = await execStep(ps, "exposure", [
          layerMake({ _obj: "exposure" }),
          layerSet({ _obj: "exposure", exposure: effective.exposure, offset: 0, gamma: 1 })
        ]);
        if (!r5.ok) {
          ps.log("warn", "曝光度参数键名可能不符（[推断] 项，手册 C12）：" + r5.error);
        }
        record("exposure", r5.ok ? true : { error: r5.error }, r5.ok ? activeLayerName(ps) : null);
      }

      // sharpness / noise —— D13/D14/D15：先转智能对象，滤镜才成为可回改的智能滤镜
      var smartified = false;

      if (enabled.sharpness && effective.sharpness > 0) {
        var chain6 = [];
        if (!smartified) {
          chain6.push({ _obj: "select", _target: [{ _ref: "layer", _id: subjectId }] });
          chain6.push({ _obj: "newPlacedLayer", _isCommand: true, _options: { dialogOptions: "silent" } });
        }
        // unsharpMask 不带 _target（作用于当前激活图层）；threshold 是裸数字
        chain6.push({
          _obj: "unsharpMask",
          amount: { _unit: "percentUnit", _value: effective.sharpness },
          radius: { _unit: "pixelsUnit", _value: 1.2 },
          threshold: 2
        });
        var r6 = await execStep(ps, "sharpness", chain6);
        if (r6.ok) smartified = true;
        record("sharpness", r6.ok ? true : { error: r6.error }, r6.ok ? "智能滤镜 USM" : null);
      }

      if (enabled.noise && effective.noise > 0) {
        var radius = clamp(Math.round(effective.noise / 6), 1, 20);
        var threshold = clamp(Math.round(effective.noise / 3), 0, 100);
        var chain7 = [];
        if (!smartified) {
          chain7.push({ _obj: "select", _target: [{ _ref: "layer", _id: subjectId }] });
          chain7.push({ _obj: "newPlacedLayer", _isCommand: true, _options: { dialogOptions: "silent" } });
        }
        // 主实现用本机取证的 dustAndScratches（reduceNoise 全树 0 命中，[推断]）
        chain7.push({ _obj: "dustAndScratches", radius: radius, threshold: threshold });
        var r7 = await execStep(ps, "noise", chain7);
        if (!r7.ok) {
          var chain7b = [];
          if (!smartified) {
            chain7b.push({ _obj: "select", _target: [{ _ref: "layer", _id: subjectId }] });
            chain7b.push({ _obj: "newPlacedLayer", _isCommand: true, _options: { dialogOptions: "silent" } });
          }
          chain7b.push({ _obj: "median", radius: { _unit: "pixelsUnit", _value: 2 } });
          var r7b = await execStep(ps, "noise", chain7b);
          if (r7b.ok) { ps.log("warn", "降噪改用「中间值」智能滤镜生效"); r7 = r7b; }
          else r7 = { ok: false, error: r7.error + "；备选 median 也失败：" + r7b.error };
        }
        if (r7.ok) smartified = true;
        record("noise", r7.ok ? true : { error: r7.error }, r7.ok ? "智能滤镜 蒙尘与划痕" : null);
      }

      // 统一剪贴：每个调整层各走一次「创建剪贴蒙版」（AM 没有「一次给多个图层剪贴」的写法）
      // ★ 用户 m03445 截图真机定案：只有最上面那张调色层变成了剪贴蒙版，下面的「亮度/对比度」没有。
      //   原因：groupEvent 是作用在【当前活动图层】上的菜单命令，_target 不保证生效 —— 最上层那张刚
      //   被 make 出来时正好是活动层，所以只有它被剪贴。改为「先选中该层，再发 groupEvent」，
      //   并在回读为 false 时重试一次；重试仍失败才如实报错（不再凭「没报错」宣布成功）。
      function selectLayerStep(id) { return { _obj: "select", _target: [{ _ref: "layer", _id: id }] }; }
      var clipped = 0;
      if (clipOn && clipIds.length) {
        for (var ci = 0; ci < clipIds.length; ci++) {
          var clipRes = await execStep(ps, "剪贴到主体", [selectLayerStep(clipIds[ci]), clipStepFor(clipIds[ci])]);
          var vfy = clipRes.ok ? await ps.readLayerClipping(clipIds[ci]) : null;
          var clipGood = !!(clipRes.ok && vfy && vfy.ok && vfy.data && vfy.data.supported && vfy.data.clipped);
          if (!clipGood) {
            var clipRes2 = await execStep(ps, "剪贴到主体（重试）", [selectLayerStep(clipIds[ci]), clipStepFor(clipIds[ci])]);
            var vfy2 = clipRes2.ok ? await ps.readLayerClipping(clipIds[ci]) : null;
            clipGood = !!(clipRes2.ok && vfy2 && vfy2.ok && vfy2.data && vfy2.data.supported && vfy2.data.clipped);
            if (vfy2) vfy = vfy2;
            if (!clipRes2.ok) clipRes = clipRes2;
          }
          if (clipGood) {
            clipped++;
            ps.log("info", "剪贴回读确认：层 id=" + clipIds[ci] + " " + vfy.data.key + "=true");
          } else if (vfy && vfy.ok && vfy.data && vfy.data.supported) {
            if (!clipNote) clipNote = "层 id=" + clipIds[ci] + " 剪贴键 " + vfy.data.key + "=false（两次 groupEvent 都无报错但未生效）";
            ps.log("error", "第 " + (ci + 1) + " 个调整层两次 groupEvent 都无报错，但回读 " + vfy.data.key + "=false → 剪贴未生效");
          } else if (clipRes.ok) {
            clipped++;
            ps.log("info", "剪贴已按 groupEvent 发送（层 id=" + clipIds[ci] + "），本机读不到剪贴键、无法回读确认" +
              (vfy && vfy.error ? "：" + vfy.error : "：返回键=" + (vfy && vfy.data ? vfy.data.keys : "")));
          } else {
            if (!clipNote) clipNote = clipRes.error;
            ps.log("warn", "第 " + (ci + 1) + " 个调整层剪贴到主体失败（调色仍生效，但会影响到主体下方的图层）：" + clipRes.error);
          }
        }
        ps.log("info", "调色剪贴到主体：成功 " + clipped + "/" + clipIds.length + " 个调整层（层 id=" + clipIds.join(",") + "；主体 id=" + subjectId + "）");
      } else if (clipOn) {
        clipNote = "本次没有新建调整层，无需剪贴";
      }

      ps.log("info", "调色完成：生效 " + (applied.length ? applied.join("、") : "无") +
        "；跳过 " + (skipped.length ? skipped.join("、") : "无") +
        "；失败 " + failureDetail.length + " 项");
      return {
        ok: true,
        data: {
          applied: applied,
          skipped: skipped,
          layers: layers,
          effective: effective,
          failureDetail: failureDetail,
          clipped: clipped,
          clipToSubject: (clipOn && clipped > 0),
          clipNote: clipNote
        }
      };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return { ok: false, error: "调色失败：" + msg };
    }
  }

  window.Ecom.adjust = {
    computeAuto: computeAuto,
    apply: apply,
    RANGES: RANGES,
    ORDER: ORDER
  };
})();
