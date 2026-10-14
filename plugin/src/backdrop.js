// Ecom.backdrop —— 背景与投影（INTERFACE §8）
// B5 纯色填充层 + B6 层序（本机取证）
// ★ v4：投影不再靠 duplicate/fill/blur/move 链条，改为对主体层设 dropShadow 图层样式（真机 27.1 实测唯一可用形态）。
window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  var BG_NAME = "背景";

  // 新图层对象一定是「当前激活图层」→ 用 DOM 取 id，避开 duplicate/make 返回结构字段名未实测的不确定性
  function activeLayerInfo(ps) {
    try {
      var m = ps.require();
      var d = m.app.activeDocument;
      var al = d && d.activeLayers && d.activeLayers[0];
      if (!al) return null;
      var vis = true;
      try { vis = al.visible !== false; } catch (eVis) { vis = true; }
      return { id: al.id, name: String(al.name || ""), kind: String(al.kind || ""), visible: vis };
    } catch (e) {
      return null;
    }
  }

  // 列出所有同名层（含组内）；kind 传 null/"" 表示不按 kind 过滤，也可传数组（kind 枚举在不同版本的拼写可能不同）
  function listLayersByName(ps, name, kind) {
    try {
      var m = ps.require();
      var d = m.app.activeDocument;
      var kinds = kind ? (Object.prototype.toString.call(kind) === "[object Array]" ? kind : [kind]) : null;
      var out = [];
      function walk(list) {
        for (var i = 0; i < list.length; i++) {
          var l = list[i];
          if (!l) continue;
          var lk = String(l.kind || "");
          if (lk !== "group" && String(l.name || "") === name && (!kinds || kinds.indexOf(lk) >= 0)) {
            var vis = true;
            try { vis = l.visible !== false; } catch (eVis) { vis = true; }
            out.push({ id: l.id, name: String(l.name), kind: lk, visible: vis });
          }
          if (lk === "group" && l.layers) walk(l.layers);
        }
      }
      walk(d.layers || []);
      return out;
    } catch (e) {
      return [];
    }
  }

  // 从候选里挑「新建出来的那一层」：新建层一定是激活层且可见，旧层刚被隐藏
  function pickNewLayer(ps, info, name) {
    if (info && info.name === name) return info;
    var list = listLayersByName(ps, name, null);
    for (var i = 0; i < list.length; i++) {
      if (list[i].visible) return list[i];
    }
    return list.length ? list[0] : null;
  }

  // v3 语义：隐藏旧的、显示新的（不是删除）
  async function hideLayers(ps, ids, label) {
    var hidden = [];
    for (var i = 0; i < ids.length; i++) {
      var r = await ps.run([{
        _obj: "set",
        _target: [{ _ref: "layer", _id: ids[i] }],
        to: { _obj: "layer", visible: false }
      }], { history: "suspend", preserveSelection: true, label: label });
      if (r.ok) hidden.push(ids[i]);
      else ps.log("warn", label + "失败（id=" + ids[i] + "）：" + r.error);
    }
    return hidden;
  }

  function visibleIds(layers) {
    var ids = [];
    for (var i = 0; i < layers.length; i++) {
      if (layers[i].visible) ids.push(layers[i].id);
    }
    return ids;
  }

  async function setSolid(opts) {
    opts = opts || {};
    var ps = window.Ecom.ps;
    // ★ v3（真机缺陷 #9）：只接受 {hex}，图层名一律固定 BG_NAME。
    // 绝不接受调用方传颜色名 —— v2 把颜色名当图层名传进来（层名叫「自定义色」），
    // 于是既找不到旧背景层、也无法隐藏它，每换一次色就多一个图层。
    var hex = opts.hex ? String(opts.hex) : "#FFFFFF";
    try {
      var docRes = await ps.activeDoc();
      if (!docRes.ok) return { ok: false, error: docRes.error };

      var rgb = ps.hexToRGB(hex);

      // 建新层【之前】隐藏所有已有背景层，否则「换背景」只是叠加
      var oldIds = visibleIds(listLayersByName(ps, BG_NAME, ["solidColor", "solid"]));
      var hiddenIds = [];
      if (oldIds.length) {
        hiddenIds = await hideLayers(ps, oldIds, "电商图片制作 · 隐藏旧背景");
        ps.log("info", "背景：已隐藏 " + hiddenIds.length + " 个旧背景层（id=" + hiddenIds.join(",") + "）");
      }

      // B5：填充层默认插到当前图层上方；层序在第二次 batchPlay 里单独处理（同批次拿不到新层 id）
      var r1 = await ps.run([{
        _obj: "make",
        _target: [{ _ref: "contentLayer" }],
        using: {
          _obj: "contentLayer",
          type: { _obj: "solidColorLayer", color: { _obj: "RGBColor", red: rgb.red, green: rgb.green, blue: rgb.blue } },
          name: BG_NAME
        }
      }], { history: "suspend", preserveSelection: true, label: "电商图片制作 · 背景" });
      if (!r1.ok) return { ok: false, error: "背景：新建填充层失败：" + r1.error };

      var info = activeLayerInfo(ps);
      if (!info || (info.kind !== "solidColor" && info.kind !== "solid")) {
        info = pickNewLayer(ps, info, BG_NAME);
        if (!info) return { ok: false, error: "背景填充层已创建但无法定位其图层 id（激活层=" + ps.safeJson(info) + "）" };
      }

      // B6：一律用 to:{_ref:"layer",_enum:"ordinal",_value:"back"}（官方枚举），绝不用 _place / _index
      var r2 = await ps.run([{
        _obj: "move",
        _target: [{ _ref: "layer", _id: info.id }],
        to: { _ref: "layer", _enum: "ordinal", _value: "back" },
        version: 5
      }], { history: "suspend", preserveSelection: true, label: "电商图片制作 · 背景置底" });
      if (!r2.ok) return { ok: false, error: "背景：置底失败：" + r2.error };

      ps.log("info", "背景：已创建纯色填充层「" + BG_NAME + "」" + hex + "（id=" + info.id +
        "，已置底，隐藏旧层 " + hiddenIds.length + " 个）");
      return { ok: true, data: { layerId: info.id, layerName: BG_NAME, hiddenIds: hiddenIds } };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return { ok: false, error: "创建背景失败：" + msg };
    }
  }

  // ★ v4：投影改为「对主体层设图层样式 dropShadow」——真机（PS 27.1）实测的唯一可用形态。
  //   旧链条（duplicate → rasterize → fill → gaussianBlur → transform 压扁 → transform 下移 → move）
  //   在真机上必然产出「黑色矩形 + 层序错」，机理：真机取证 fill 只要带 _target（layer/document）就被拒
  //   （「命令"填充"当前不可用」），move 的 to:{_ref:"layer",_offset:-1} 同样被拒。
  //   dropShadow 由 PS 自己按该层的 alpha/蒙版派生影子形状 → 贴合轮廓、向下柔和，一次 set 完成。
  //   参数映射：opacity→percentUnit；blur→size(px)；offsetY→distance(px)，配 localLightingAngle:90 使正值向下；choke 固定 0。
  function layerNameById(ps, id) {
    try {
      var m = ps.require();
      var d = m.app.activeDocument;
      var found = null;
      function walk(list) {
        for (var i = 0; i < list.length; i++) {
          var l = list[i];
          if (!l) continue;
          if (l.id === id) { found = String(l.name || ""); return; }
          if (String(l.kind || "") === "group" && l.layers) { walk(l.layers); if (found) return; }
        }
      }
      walk(d.layers || []);
      return found;
    } catch (e) {
      return null;
    }
  }

  // subjectLayerId 缺省时退回「找主体层」，两条路径（设投影 / 关投影）共用
  async function resolveSubjectId(ps, subjectLayerId) {
    if (subjectLayerId) return { ok: true, id: subjectLayerId };
    var found = await ps.findSubjectLayer({});
    if (!found.ok) return { ok: false, error: found.error };
    return { ok: true, id: found.data.id };
  }

  async function addShadow(opts) {
    opts = opts || {};
    var ps = window.Ecom.ps;
    var opacity = isFinite(Number(opts.opacity)) ? Number(opts.opacity) : 30;
    var blur = isFinite(Number(opts.blur)) ? Number(opts.blur) : 40;
    var offsetY = isFinite(Number(opts.offsetY)) ? Number(opts.offsetY) : 12;
    var color = opts.color ? String(opts.color) : "#000000";
    try {
      var docRes = await ps.activeDoc();
      if (!docRes.ok) return { ok: false, error: docRes.error };
      var who = await resolveSubjectId(ps, opts.subjectLayerId);
      if (!who.ok) return { ok: false, error: who.error };
      var subjectId = who.id;
      var rgb = ps.hexToRGB(color);

      // 无图层蒙版 = 没先抠图 → 影子跟随整层像素范围（整层不透明时就是矩形），必须让用户看见原因
      var hasMask = false;
      var maskRes = await ps.hasUserMask(subjectId);
      if (maskRes && maskRes.ok) hasMask = !!maskRes.data.hasMask;
      else ps.log("warn", "阴影：无法判定主体层是否有图层蒙版：" + ((maskRes && maskRes.error) || "未知错误"));
      // ★ 用户 m03510 真机（13:31:32 与 13:31:45 相隔 13 秒、同一图层 id=2）：边缘净化读到「原有蒙版=是」，
      //   紧接着这一步读到 hasMask=false → 面板弹出「投影会呈矩形」的假警告。整层 get 在忙期会谎报无蒙版；
      //   getUserMaskCoverage 里已有「状态说无蒙版 → 再读一次蒙版像素翻案」的兜底，这里复用它。
      if (!hasMask) {
        var covRes = await ps.getUserMaskCoverage(subjectId, 4000);
        if (covRes && covRes.ok && covRes.data && covRes.data.hasMask === true) {
          hasMask = true;
          ps.log("info", "阴影：整层 get 说没有蒙版，但按蒙版像素确认有（覆盖率=" + covRes.data.coverage + "）→ 按有蒙版走");
        }
      }
      var warn = "";
      if (!hasMask) {
        warn = "主体层没有图层蒙版（未先执行抠图），投影会跟随整层像素范围，可能呈矩形";
        ps.log("warn", "阴影：" + warn);
      }

      var r = await ps.run([{
        _obj: "set",
        _target: [{ _ref: "layer", _id: subjectId }],
        to: {
          _obj: "layer",
          layerEffects: {
            _obj: "layerEffects",
            dropShadow: {
              _obj: "dropShadow",
              enabled: true,
              present: true,
              showInDialog: true,
              mode: { _enum: "blendMode", _value: "normal" },
              color: { _obj: "RGBColor", red: rgb.red, green: rgb.green, blue: rgb.blue },
              opacity: { _unit: "percentUnit", _value: opacity },
              useGlobalAngle: false,
              localLightingAngle: { _unit: "angleUnit", _value: 90 },
              distance: { _unit: "pixelsUnit", _value: offsetY },
              choke: { _unit: "percentUnit", _value: 0 },
              size: { _unit: "pixelsUnit", _value: blur }
            }
          }
        }
      }], { history: "suspend", preserveSelection: true, label: "电商图片制作 · 投影（图层样式）" });
      if (!r.ok) return { ok: false, error: "阴影：设置投影图层样式失败：" + r.error };

      ps.log("info", "阴影：主体层 id=" + subjectId + " 已设 dropShadow 不透明度=" + opacity + "% 模糊=" + blur +
        "px 距离=" + offsetY + "px 颜色=" + color + " 有蒙版=" + hasMask + (warn ? "（" + warn + "）" : ""));
      var data = {
        layerId: subjectId,
        layerName: layerNameById(ps, subjectId) || "dropShadow",
        style: "dropShadow",
        opacity: opacity,
        blur: blur,
        offsetY: offsetY,
        color: color,
        hasMask: hasMask
      };
      if (warn) data.warn = warn;
      return { ok: true, data: data };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return { ok: false, error: "创建阴影失败：" + msg };
    }
  }

  // ★ v4：「关闭投影」——真机实测 disableLayerStyle 可用
  async function removeShadow(opts) {
    opts = opts || {};
    var ps = window.Ecom.ps;
    try {
      var docRes = await ps.activeDoc();
      if (!docRes.ok) return { ok: false, error: docRes.error };
      var who = await resolveSubjectId(ps, opts.subjectLayerId);
      if (!who.ok) return { ok: false, error: who.error };
      var r = await ps.run([{
        _obj: "disableLayerStyle",
        _target: [{ _ref: "layer", _id: who.id }]
      }], { history: "suspend", preserveSelection: true, label: "电商图片制作 · 关闭投影" });
      if (!r.ok) return { ok: false, error: "关闭投影失败：" + r.error };
      ps.log("info", "阴影：已关闭主体层 id=" + who.id + " 的图层样式（投影）");
      return {
        ok: true,
        data: { layerId: who.id, layerName: layerNameById(ps, who.id) || "dropShadow", style: "dropShadow", disabled: true }
      };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return { ok: false, error: "关闭投影失败：" + msg };
    }
  }

  window.Ecom.backdrop = {
    setSolid: setSolid,
    addShadow: addShadow,
    removeShadow: removeShadow,
    BG_NAME: BG_NAME
  };
})();
