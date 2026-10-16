// Ecom.cutout —— 抠图与边缘净化（INTERFACE §7）
// 主路径＝真机实测可用的 removeBackground 事件（第 6 轮追加 A：PS 2026 ExecuteAction 实测一步建好图层蒙版，
//   bounds 与 autoCutout 选区逐位相同 1240,610,2925,1176）；被拒时回退＝autoCutout 等价链（手册 A1b 逐字取证）：
//   select 主体层 → rasterizeLayer → autoCutout{sampleAllLayers:false}
//   → [contract 选区] → [feather 选区] → make channel mask revealSelection
//   → deselect 取消选区（第 6 轮真机取证：这一步【绝不能】用 delete，见下）
// ★ 链尾为什么是 deselect 而不是 delete channel targetEnum（第 6 轮真机受控实验 A/B/C/D 四组）：
//   make … at:{_ref:"channel",_enum:"channel",_value:"mask"} 之后【当前通道就是刚建好的图层蒙版】，
//   因此 delete targetEnum 删掉的是蒙版本身（hasUserMask 由 true 变 false；带不带 apply 都一样），
//   抠图于是从未生效、且一键流程会在下一步 refine（依赖蒙版）立刻停。
//   旧注释「delete 不可省，否则弹原生对话框卡死」已被实验证伪：deselect 同样不弹对话框，且蒙版保持 true。
window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  var SELECTION = { _ref: "channel", _property: "selection" };

  function selectionRef() {
    return { _ref: "channel", _property: "selection" };
  }

  function selectLayer(id) {
    return { _obj: "select", _target: [{ _ref: "layer", _id: id }] };
  }

  // 抠图链本身【只有一种形状】：算选区 → 建图层蒙版 → deselect。
  //   面板开关「抠图后自动应用蒙版」不改变这条链，只在链跑完之后决定「要不要把刚建好的蒙版启用」
  //   （用户原话：「扣完图不是会新建一个蒙版吗，如果勾选了选项就自动应用这个蒙版」）。
  function buildCutoutChain(docId, subjectLayerId, contractPx, featherPx, sampleAllLayers) {
    var chain = [];
    chain.push(selectLayer(subjectLayerId));
    chain.push({ _obj: "rasterizeLayer", _target: { _ref: "document", _id: docId } });
    chain.push({ _obj: "autoCutout", sampleAllLayers: !!sampleAllLayers, _target: { _ref: "document", _id: docId } });
    if (contractPx > 0) {
      chain.push({
        _obj: "contract",
        _target: [selectionRef()],
        by: { _unit: "pixelsUnit", _value: contractPx },
        selectionModifyEffectAtCanvasBounds: false
      });
    }
    if (featherPx > 0) {
      chain.push({
        _obj: "feather",
        _target: [selectionRef()],
        radius: { _unit: "pixelsUnit", _value: featherPx },
        selectionModifyEffectAtCanvasBounds: false
      });
    }
    chain.push({
      _obj: "make",
      new: { _class: "channel" },
      at: { _ref: "channel", _enum: "channel", _value: "mask" },
      using: { _enum: "userMaskEnabled", _value: "revealSelection" },
      documentTarget: { _ref: "document", _id: docId }
    });
    // 只取消选区、绝不 delete：描述符逐字对齐真机 B 组（OK 且 hasUserMask 保持 true）
    chain.push({ _obj: "deselect", _target: [selectionRef()] });
    // ★ 真机 2026-10-16 13:37:52：上面这条返回 ok，但**画布上的选区原样还在**（静默无效）。app.js 自己的
    //   deselect 是「把 selection 通道 set 成 ordinal none」（docs/RESEARCH-descriptors.md 取证，偏移 16884）
    //   ⇒ 再补这一发权威写法（不碰通道，蒙版仍为 true，与上面那条的目的完全一致）。
    chain.push({ _obj: "set", _target: [selectionRef()], to: { _enum: "ordinal", _value: "none" } });
    return chain;
  }

  // 显式意图：删除【图层蒙版】本身（不是选区）—— 只用于「autoCutout 造出近空蒙版，回退前先清掉」。
  // 这里保留 delete 是安全的：误删蒙版的是 targetEnum 形式（当前通道 = 蒙版），而本描述符明确指向 mask 通道。
  function deleteMaskChain() {
    return [{ _obj: "delete", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }] }];
  }

  // 第 6 轮追加 A：真机实测 removeBackground 是真实 AM 事件（不是 UXP 通知事件名），一步建好图层蒙版。
  // dialogOptions:dontDisplay 对齐真机 ExecuteAction 的 DialogModes.NO，避免无头批处理弹窗卡住一键流程。
  function removeBackgroundChain() {
    return [{ _obj: "removeBackground", _options: { dialogOptions: "dontDisplay" } }];
  }

  // 启用/停用图层蒙版（非破坏性：蒙版本身仍在，只是图层显示时不用它）。
  //   AM 原语出处：PS 脚本圈通行的「停用图层蒙版」配方 = set(null→Lyr) + Lyr{UsrM:false}，
  //   字符 ID `UsrM` 反查得到字符串 ID `userMaskEnabled`，与整层 get 真机返回的键名一致（已取证）。
  //   ❗绝不能用 delete——真机已证明它会删掉蒙版本身（第 6 轮那条 bug）。这里只是 set 一个布尔。
  //   withChannelTarget：回退形式 —— 把 set 的目标显式收窄到 mask 通道（整层 set 被拒时用）。
  function setMaskEnabledChain(layerId, enabled, withChannelTarget) {
    var target = [{ _ref: "layer", _id: layerId }];
    if (withChannelTarget) target.push({ _ref: "channel", _enum: "channel", _value: "mask" });
    return [{
      _obj: "set",
      _target: target,
      to: { _obj: "layer", userMaskEnabled: enabled !== false }
    }];
  }

  // 整层 set 先试；被拒再用「目标=蒙版通道」的回退形式（两种形式都只用 set 布尔，永不 delete）。
  async function setMaskEnabled(ps, layerId, enabled) {
    var label = enabled ? "电商图片制作 · 启用蒙版" : "电商图片制作 · 停用蒙版";
    var r = await ps.run(setMaskEnabledChain(layerId, enabled, false), {
      history: "suspend", preserveSelection: true, label: label
    });
    if (r.ok) return r;
    ps.log("warn", "整层 set 改蒙版启用状态被拒，改用「目标=蒙版通道」的回退形式：" + r.error);
    return await ps.run(setMaskEnabledChain(layerId, enabled, true), {
      history: "suspend", preserveSelection: true, label: label + "（回退）"
    });
  }

  // CUTOUT_BUSY_BUDGET_MS：抠图刚刚成功 → 蒙版存在这件事已经由链路本身保证，覆盖率只是写给用户的诊断数字。
  // 真机取证 17:59:17：紧接着读状态会被 PS 拒（"获取"当前不可用）可达数十秒；旧代码在这里等满 21s，
  // 用户看到的就是「有蒙版了还在检测」。故这条路径只给 2s，超时按「未知」继续（coverage=null 本身已是非致命分支）。
  var CUTOUT_BUSY_BUDGET_MS = 2000;
  // 边缘净化：这是一键流程里的下一步，只要别卡住即可；6s 是「等一会儿」和「别让用户以为死了」的折中。
  // 一键流程里 index.js 已经在抠图后等过「宿主空闲」（waitHostIdle），这里的预算只是兜底：
  //   单独点「执行边缘净化」时不会经过那道闸门，给 20s 免得又像 09:46 那样白等 6s 就判不确定。
  // ★ 用户 m03252：不要等那么久。精修步骤的读数只是诊断，12s 足够；需要等的 set 由 ps.run() 退避重试接管。
  var REFINE_BUSY_BUDGET_MS = 12000;

  // MASK_REREAD_IDLE_MS：蒙版状态【回读失败】时再等一次宿主空闲的上限（见 remove() 末尾）。
  //   只在「读数失败」时用；已经拿到「整层 get 报无蒙版」这种明确答案就不再等。
  // ★ 用户 m03252：「不用等那么久了，明明都生成完了，还是读不到」。
  //   90s → 8s：蒙版像素签名（getLayerMask + imageData）真机 11:27 已能读到，
  //   这条只是「读不到时再等一下」的兜底，没必要把面板卡住。
  var MASK_REREAD_IDLE_MS = 8000;
  async function readCoverage(layerId, ps, nameHint) {
    // ★ m03578：读蒙版一律带图层名字 —— rasterizeLayer 会换 id，ps 侧靠名字把 id 自愈回去（ps.js selfHealLayerId）。
    var cov = await ps.getUserMaskCoverage(layerId, CUTOUT_BUSY_BUDGET_MS, nameHint);
    if (!cov.ok) return { ok: false, error: cov.error };
    return { ok: true, data: cov.data };
  }

  // ★ 真机事故（09:32:43）：同一次一键里抠图建蒙版的是「背景」，紧接着接地投影却按图层顺序选了「图层 0」(id=3) ——
  //   各步自行解析主体层，选中的不是同一图层（蒙版落在 A、投影/构图落在 B），用户看到的效果就是「没有应用蒙版」。
  //   编排层一旦锁定主体 id 就传进来，这里不再自行解析。
  async function resolveSubject(opts) {
    if (opts && typeof opts.subjectLayerId === "number") {
      return { ok: true, data: { id: opts.subjectLayerId, name: opts.subjectLayerName || "?", kind: opts.subjectLayerKind || "" } };
    }
    return await window.Ecom.ps.findSubjectLayer({});
  }

  async function remove(opts) {
    opts = opts || {};
    var ps = window.Ecom.ps;
    var contractPx = Number(opts.contract) > 0 ? Number(opts.contract) : 0;
    var featherPx = Number(opts.feather) > 0 ? Number(opts.feather) : 0;
    try {
      var docRes = await ps.activeDoc();
      if (!docRes.ok) return { ok: false, error: docRes.error };
      var docId = docRes.data.id;

      var layerRes = await resolveSubject(opts);
      if (!layerRes.ok) return { ok: false, error: layerRes.error };
      var subject = layerRes.data;

      // ★ 面板开关「抠图后自动应用蒙版」= state.cutout.autoMask（默认开）只决定【蒙版建好之后要不要启用】，
      //   抠图链本身两种模式完全一样 —— 见本函数末尾的 setMaskEnabledChain 调用。

      // ★ 用户 m03446：「先恢复刚开始对话的那个无蒙版抠图的代码，再加上现在这个保留蒙版的功能」
      //   → 主路先用 removeBackground 把背景像素擦掉（原始做法、用户认可的结果），
      //     成功后再用同一条选区链给主体层 make 出图层蒙版（「保留蒙版」：可见、可回读、可羽化）。
      //   两条链的选区逐位一致（第 6 轮实测），组合起来不损失精度。真机事实（副本实测）：removeBackground
      //   自己【不建蒙版】（跑完四个图层 mask 全 none，只有 bounds 变化）—— 蒙版是第二跳 make 出来的。
      //   任一跳被拒都继续往下走（保留已拿到的那一跳的结果），两跳都失败才判失败。
      var method = "";
      var pixelCut = false;
      // ★ 用户 m03510 真机日志定案（13:06:48→13:08:48）：removeBackground 排第一跳时，跑完它 PS 会把描述符
      //   通道锁死 ≥16 分钟（第 37..40 次重试仍是「命令"选择"当前不可用」），第二跳「建蒙版」根本没机会跑 ——
      //   这正是用户反复看到的「抠图还是有问题 / 读不到蒙版」。而 12:31、12:48、13:31 三次真机里
      //   「原有蒙版=是」的蒙版，全部是选区链（select→rasterize→autoCutout→make mask）在宿主空闲时建出来的。
      //   ⇒ 顺序对调：**先跑选区链**（空闲时几秒内就删背景像素 + 建好蒙版），removeBackground 只在它被拒时兜底。
      var r = await ps.run(buildCutoutChain(docId, subject.id, contractPx, featherPx), {
        history: "suspend", preserveSelection: true, label: "电商图片制作 · 抠图（选区+蒙版）",
        busyRetries: 10, busyBudgetMs: 120000
      });
      if (r.ok) {
        method = "mask";
        ps.log("info", "抠图主路：图层「" + subject.name + "」已按选区删背景并建好图层蒙版（按设置" +
          (opts.autoMask === false ? "随后停用" : "并启用") + "）");
      } else {
        ps.log("warn", "抠图主路（选区+蒙版）被拒，改用 removeBackground 兜底：" + r.error);
      }
      // ★ 真机 12:40:45（用户 m03482）：第一跳完成后 PS 仍锁死描述符通道（命令「选择」当前不可用）≥30s，
      //   默认 8 次重试只够 30s → 建蒙版被放弃、蒙版没建成（用户看到的正是「抠图还是有问题」）。
      //   这里给第二跳 40 次重试 / 10 分钟预算（退避递增，实际锁死 30s~数分钟都会等到）。
      if (!r.ok) {
        var rBg = await ps.run(removeBackgroundChain(), {
          history: "suspend", preserveSelection: true, label: "电商图片制作 · 抠图（移除背景兜底）",
          busyRetries: 6, busyBudgetMs: 60000
        });
        if (rBg.ok) {
          pixelCut = true;
          r = rBg;
          method = "removeBackground";
          ps.log("info", "抠图兜底：removeBackground 完成（擦除背景像素；它不建图层蒙版，蒙版状态按未知处理）");
        } else {
          ps.log("error", "抠图两条链都失败（选区链 / removeBackground）：" + rBg.error);
        }
      }

      // ★ 用户 m03578 真机定案（13:47:16 → 13:47:55）：抠图链里的 rasterizeLayer 会把图层【换成一个新 id】
      //   （日志：主体层锁定「背景」id=1；13:47:55 读到的蒙版像素却属于 id=2），于是后续所有按旧 id 读蒙版
      //   都抛 `Error: Unknown layer`（全日志 454 次）—— 面板就只能显示「未测出 / 待确认」。
      //   PS 还会顺手把「背景」改名成「图层 0」，所以不能只靠名字找 → 用与编排层同一个解析器重挑主体层，
      //   拿到新 id 后再接着读（名字也一并更新，后续各步的 nameHint 才是有效的）。
      //   注意：只有【旧 id 真的不存在了】才改 —— 否则会破坏「抠图/边缘净化/投影/构图必须是同一图层」这条
      //   来之不易的不变式（真机事故 09:32:43：蒙版落在 A、投影落在 B）。
      var idStillThere = (typeof ps.layerExistsById === "function") ? await ps.layerExistsById(subject.id) : true;
      var reSubj = idStillThere ? { ok: false, error: "旧 id 仍在，保持锁定" } : await ps.findSubjectLayer({});
      if (reSubj.ok && reSubj.data && reSubj.data.id && reSubj.data.id !== subject.id) {
        ps.log("warn", "抠图后图层 id 变了（rasterizeLayer 会重建图层）：主体 id " + subject.id + "（「" + subject.name +
          "」）→ id " + reSubj.data.id + "（「" + reSubj.data.name + "」）→ 后续读数一律用新 id");
        subject.id = reSubj.data.id;
        subject.name = reSubj.data.name || subject.name;
      }

      // ★ 真机定案（09:46:06→09:46:33 + 09:48 三次读数）：removeBackground 受理之后 PS 还要算几十秒。
      //   这期间 (a) 一切描述符被拒（读「获取」、写「设置」当前不可用），(b) 蒙版虽然已经建出来但**还是全白的**
      //   —— 09:48:44 量到 coverage=1（全白）就是这么来的；同一图层 12s 后再量才是真的 0.0939。
      //   所以「量覆盖率」之前必须先等宿主空闲（waitHostIdle 用整层 get 当探针），否则量到的只是半成品。
      // 预算 300s：09:55 真机日志里 4080x1836 图的 removeBackground 让 PS 锁死描述符通道 >150s
      // （09:55:19→09:57:54 探测 26 次全被拒），120s 不够用；退避表已加长 + busyGap 会把最后一跳
      // 裁到剩余预算，日志里的「上限」现在是真的上限。
      async function settleHost(ps, layerId, why) {
        // ★ 用户 m03252：不要等那么久。300s → 30s：等不到就交给 ps.run() 的「轮询退避 + 重跑」（已提到 8 次）。
    var idle = await ps.waitHostIdle(layerId, 30000);
        if (!idle.ok) {
          ps.log("warn", "等待 Photoshop 完成" + why + "失败（" + idle.error + "）→ 继续，读数可能不准");
        } else if (idle.data && idle.data.waitedMs > 0) {
          ps.log("info", "Photoshop 已完成" + why + "：等了 " + idle.data.waitedMs + "ms → 现在才去量蒙版");
        }
        return idle;
      }

      var usedFallback = false;
      var coverage = null;
      if (r.ok) {
        await settleHost(ps, subject.id, "抠图运算");
        var cov = await readCoverage(subject.id, ps);
        // ★ 覆盖率终于量得出来了（09:32:43 那条 bug 修好后）→ 它是最便宜的自证：
        //   占比≈1 说明蒙版几乎整张画布都保留 = 抠图没切掉任何东西（用户会看到「没有应用蒙版」的表象）。
        if (cov.ok && cov.data.coverage !== null && cov.data.coverage > 0.98) {
          ps.log("warn", "蒙版非零占比 " + Number(cov.data.coverage).toFixed(4) +
            " ≈ 整张画布都保留 → 抠图可能没有切掉任何区域；请查看图层蒙版缩览图确认（也可能是原图确实没有可去掉的背景）");
        }
        if (cov.ok) {
          coverage = cov.data.coverage;
          if (coverage === null) {
            // ❗措辞必须跟着 cov.data.hasMask 走：hasMask=false 是「状态判不出来、按未知继续」，
            //   不能写成「蒙版已确认存在」—— 那是另一条分支（整层 get 正面确认）才成立的事实。
            ps.log("warn", "抠图链已成功，但蒙版占比量不出来（hasMask=" + String(cov.data.hasMask) +
              (cov.data.readError ? "，读数报错：" + cov.data.readError : "") +
              "）→ 按「未知」继续，不重做抠图、不判失败");
          }
        } else {
          // ★ 真机取证：抠图链成功、只是「量不出覆盖率」时绝不能把抠图判失败 ——
          //   那正是「一键生成全部卡在抠图」的第二条路径（读数被拒 / 返回形态不认识）。
          ps.log("warn", "抠图链已成功，但蒙版覆盖率读不出来 → 按「未知」继续，不重做抠图、不判失败：" + cov.error);
        }
      } else {
        ps.log("warn", "抠图链（method=" + method + "）被宿主拒绝，转 sampleAllLayers:true 回退：" + r.error);
      }

      // 只有【确知】近空（coverage 是数字且 < 0.001）才走破坏性的「删蒙版 + 重抠」回退；
      // coverage === null 表示「量不出来」，不是「空」—— 旧代码把两者混为一谈是 bug。
      if (!r.ok || (coverage !== null && coverage < 0.001)) {
        // 空选区会让 revealSelection 造出「全隐藏蒙版」（图层看起来消失）→ 回退到整篇合成取样
        if (r.ok) {
          ps.log("warn", "抠图蒙版非零占比 " + coverage + "（近空，method=" + method + "），回退 sampleAllLayers:true");
          ps.log("info", "回退前显式删除近空图层蒙版（意图：清掉全隐藏蒙版以免图层看起来消失；_target=mask 通道，不是选区）");
          var delRes = await ps.run(deleteMaskChain(), {
            history: "suspend", preserveSelection: true, label: "电商图片制作 · 清除空蒙版"
          });
          if (!delRes.ok) ps.log("warn", "清除空蒙版失败：" + delRes.error);
        }

        method = "autoCutout";
        // ★ 第 5 参 sampleAllLayers=true 必须保留：我上一版重写时误删它，sampleAllLayers 变成 undefined
        //   → 回退链其实还是「只用当前图层取样」，等于没有回退（hostsim 那条 ac[0].sampleAllLayers===true 断言抓住了）。
        var r2 = await ps.run(buildCutoutChain(docId, subject.id, contractPx, featherPx, true), {
          history: "suspend", preserveSelection: true, label: "电商图片制作 · 抠图（回退）"
        });
        if (!r2.ok) {
          return {
            ok: false,
            error: "PS 未能完成抠图（" + (r.ok ? "蒙版非零占比 " + coverage : "链路被拒：" + r.error) +
              "；回退 autoCutout{sampleAllLayers:true} 也失败：" + r2.error +
              "）。请手动使用「选择主体」或「移除背景」后再试。"
          };
        }

        await settleHost(ps, subject.id, "回退抠图运算");
        var cov2 = await readCoverage(subject.id, ps);
        usedFallback = true;
        if (cov2.ok) {
          coverage = cov2.data.coverage;
          if (coverage !== null && coverage < 0.001) {
            return {
              ok: false,
              error: "PS 未找到主体（抠图链与回退 autoCutout{sampleAllLayers:true} 的蒙版非零占比均近 0）。请手动使用「选择主体」或「移除背景」后再试。"
            };
          }
        } else {
          coverage = null;
          ps.log("warn", "回退抠图已执行，但覆盖率仍读不出来 → 按「未知」继续（不判失败）：" + cov2.error);
        }
      }

      // ★ 面板开关：抠图链【总是】建蒙版；未勾选时只把刚建好的蒙版停用（非破坏性，蒙版仍在）。
      //   用户原话：「不勾选就是只执行抠图，扣完图不是会新建一个蒙版吗，如果勾选了选项就自动应用这个蒙版」。
      var maskEnabled = opts.autoMask === false ? false : true;
      if (!maskEnabled) {
        var disRes = await setMaskEnabled(ps, subject.id, false);
        if (!disRes.ok) {
          maskEnabled = true;
          ps.log("warn", "按设置要停用图层蒙版，但宿主拒绝了（蒙版仍在且为启用状态）：" + disRes.error +
            "；可自行在图层面板 Shift+点击蒙版缩略图停用");
        } else {
          ps.log("info", "抠图完成：图层「" + subject.name + "」的蒙版已按设置【停用】（未勾选「自动应用蒙版」）。" +
            "蒙版本身保留，图层面板 Shift+点击蒙版缩略图即可随时重新启用。");
          ps.log("warn", "提醒：蒙版停用期间图层是【整层不透明】的，后续「边缘净化以外的步骤」（背景/投影/居中/调色统计）会按整张画布算，" +
            "不是按抠出的主体算。需要它们按抠图结果算，请勾选「抠图后自动应用蒙版」。");
        }
      }

      // ★ 第 7 轮（用户 m02731「还是无法检测蒙版」）：蒙版状态在这台机上就是读不稳（忙碌期整层 get 会被拒），
      //   抠图结果改用更硬的证据 —— 主体图层自己的像素 alpha（getPixels + applyAlpha + layerID）。
      //   按用户口径：面板主结论显示「已抠图（主体像素占比 X%）」，不再拿「待确认」当主结论。
      var alphaCov = null;
      var alphaErr = null;
      var alphaSource = null;
      // ★ 判据来源（第 11 轮定案：真机 + Adobe 官方标注）：本插件主路抠图是「按选区建图层蒙版」——图层【像素】
      //   本身仍然不透明，只有蒙版说明剪掉了哪里；官方法标注原文（imaging getPixels.options.applyAlpha）：
      //   "If true, then RGBA pixels will be converted to RGB by matting on white. The returned imageData
      //    property will not contain an alpha channel." ⇒ 传 true 永远拿不到 alpha（真机 channels=3）。
      //   所以先读【蒙版像素占比】（这才是「剪掉了多少」的真值，真机 9.37%），读不到再退回像素 alpha
      //   （只有 removeBackground 那种「直接擦像素」的抠法，像素 alpha 才有意义）。
      var mc0 = await ps.getUserMaskCoverage(subject.id, 30000, subject.name);
      if (mc0.ok && mc0.data && mc0.data.hasMask && typeof mc0.data.coverage === "number") {
        alphaCov = mc0.data.coverage;
        alphaSource = "mask";
        ps.log("info", "[抠图核对] 图层「" + subject.name + "」蒙版像素非零占比=" + (Math.round(alphaCov * 10000) / 100) +
          "%（" + (mc0.data.maskWidth || "?") + "x" + (mc0.data.maskHeight || "?") + "；判别来源=蒙版像素）");
      } else {
        var ac = await ps.subjectAlphaCoverage(subject.id, 30000, subject.name);
        if (ac.ok) {
          alphaCov = ac.data.coverage;
          alphaSource = "alpha";
          ps.log("info", "[抠图核对] 图层「" + subject.name + "」像素 alpha 非零占比=" +
            (Math.round(alphaCov * 10000) / 100) + "%（采样 " + ac.data.sampled + " 像素，" + ac.data.components + " 通道；判别来源=像素 alpha）");
          if (alphaCov > 0.995) ps.log("warn", "像素 alpha 几乎全是非零 → 抠图可能没有切掉任何区域（整层仍不透明）");
        } else {
          alphaErr = ac.error;
          ps.log("warn", "抠图结果量不出来（不影响抠图本身，面板显示「未测出」）：蒙版没读到（" + ((mc0 && mc0.error) || "无蒙版或读数失败") + "），像素 alpha 也没读到（" + alphaErr + "）");
        }
      }

      // ★ 真机事故（09:17:48）：面板显示「已应用=是」，但用户看图层面板时【还没有蒙版缩略图】。
      //   原因：removeBackground 是延迟执行命令，旧代码的「已应用」是被【复选框】推出来的，不是被证据推出来的。
      //   现在只认证据：回读一次蒙版状态，读得到才算「已应用」，读不到就如实说「待确认」。
      var maskVerified = false;
      var verifyNote = "";
      var ver = await readCoverage(subject.id, ps, subject.name);
      // ★ 第 7 轮补充（用户截屏 m03177：手点「移除背景」后该图层确实生成了蒙版缩览图 → 蒙版是有的，
      //   是我们读不到）：忙期整层 get 会被拒（文案可能是「非法参数」，见 ps.js BUSY_RE 真机取证），
      //   所以「读不到」不能直接当成「没有蒙版」显示给用户。这里只在【读数失败】时再等一次宿主空闲回读；
      //   若整层 get 已经明确回了「无蒙版」，就不再白等。
      if (!ver.ok) {
        var idle2 = await ps.waitHostIdle(subject.id, MASK_REREAD_IDLE_MS);
        if (idle2.ok) {
          var ver2 = await readCoverage(subject.id, ps, subject.name);
          if (ver2.ok) ver = ver2;
          else ps.log("warn", "宿主已空闲，蒙版状态仍回读不到（" + ver2.error +
            "）→ 面板按「未确认」显示；请直接看图层面板的蒙版缩览图");
        } else {
          ps.log("warn", "蒙版状态回读失败后等宿主空闲也超时（" + idle2.error + "）→ 面板按「未确认」显示");
        }
      }
      if (maskEnabled) {
        if (ver.ok && ver.data.hasMask && ver.data.maskEnabled !== false) {
          maskVerified = true;
          verifyNote = ver.data.coverage === null ? "（蒙版已确认存在，覆盖率未知）" : "（已回读确认）";
        } else {
          verifyNote = "（回读不到蒙版状态：" + ((ver.ok ? "整层 get 报无蒙版" : ver.error) || "宿主仍忙") + "）";
        }
      } else if (ver.ok && ver.data.maskEnabled === false) {
        maskVerified = true;
        verifyNote = "（已回读确认停用）";
      } else {
        verifyNote = "（无法确认停用是否生效：" + (ver.ok ? "回读仍显示有蒙版" : ver.error) + "）";
      }
      if (!maskVerified) {
        ps.log("warn", "抠图链已完成，但蒙版状态回读不到" + verifyNote + "→ 面板按「待确认」显示；请直接看图层面板上的蒙版缩览图。");
      }
      ps.log("info", "抠图完成：图层「" + subject.name + "」蒙版非零占比=" +
        (coverage === null ? "未知（读数失败，按成功继续）" : coverage.toFixed(4)) +
        "，蒙版已应用=" + (maskEnabled ? (maskVerified ? "是" : "待确认") : (maskVerified ? "否（已停用）" : "否（待确认）")) +
        verifyNote +
        "（method=" + method + (usedFallback ? "，已回退 sampleAllLayers:true" : "") + "）");
      return {
        ok: true,
        data: {
          layerName: subject.name,
          layerId: subject.id,
          hasMask: maskVerified ? true : null,
          maskApplied: maskVerified ? maskEnabled : null,
          maskEnabled: maskEnabled,
          maskVerified: maskVerified,
          maskVerifyNote: verifyNote,
          method: method,
          usedFallback: usedFallback,
          maskCoverage: coverage,
          alphaCoverage: alphaCov,
          alphaSource: alphaSource,
          alphaError: alphaErr
        }
      };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return { ok: false, error: "抠图失败：" + msg };
    }
  }

  async function refine(opts) {
    opts = opts || {};
    var ps = window.Ecom.ps;
    var featherPx = Number(opts.feather);
    if (!isFinite(featherPx) || featherPx < 0) featherPx = 0;
    try {
      var layerRes = await resolveSubject(opts);
      if (!layerRes.ok) return { ok: false, error: layerRes.error };
      var subject = layerRes.data;

      // 边缘净化在一键流程里紧跟抠图 → 状态 get 同样可能被 PS 拒（"获取"当前不可用）。
      // 这里用覆盖率读数代替纯状态判定：它自带「直接读蒙版像素」兜底，且只等 REFINE_BUSY_BUDGET_MS，
      // 不会为一条判定把面板卡住 21s；真没有蒙版时仍如实报错（判不出来则放行，下一步自己会报错）。
      var cov = await ps.getUserMaskCoverage(subject.id, REFINE_BUSY_BUDGET_MS, subject.name);
      if (!cov.ok) return { ok: false, error: cov.error };
      // ★ 真机定案：抠图链的 rasterizeLayer 换过图层 id 后，单独点「边缘净化」时传入的 id 可能已失效；
      //   getUserMaskCoverage 会按名字把 id 自愈（Report 「按名字…重解析为 id=N」）并把新 id 带回来。
      //   下面这条 set 必须用新 id，否则读得到蒙版、写羽化却打在空气上（报 Unknown layer）。
      if (cov.data && typeof cov.data.layerId === "number" && cov.data.layerId !== subject.id) {
        ps.log("warn", "边缘净化：图层 id 已失效（旧 id=" + subject.id + "）→ 按名字「" + subject.name + "」改用 id=" + cov.data.layerId);
        subject.id = cov.data.layerId;
      }
      if (!cov.data.hasMask && !cov.data.verdictUncertain) {
        return { ok: false, error: "图层「" + subject.name + "」没有图层蒙版，请先抠图" };
      }
      if (cov.data.verdictUncertain) {
        ps.log("warn", "蒙版状态判不出来（PS 仍忙）→ 按「有蒙版」继续羽化；若确实没蒙版，下一步会如实报错");
      }
      if (featherPx === 0) {
        return { ok: true, data: { applied: false, feather: 0, hadMask: true } };
      }

      var r = await ps.run([{
        _obj: "set",
        _target: [{ _ref: "layer", _id: subject.id }],
        to: { _obj: "layer", userMaskFeather: { _unit: "pixelsUnit", _value: featherPx } }
      }], {
        history: "suspend", preserveSelection: true, label: "电商图片制作 · 边缘净化（羽化）",
        // ★ 真机 13:56 取证：大图（4080x1836）抠图链跑完，PS 仍会忙 40s 以上 —— 默认 8 次重试（约 25s）用尽后
        //   报「命令"设置"当前不可用」→ 整条一键流程停下（日志「已停止后续步骤（边缘净化 失败）」）。
        //   羽化是一条 set，重试代价只是等待，所以给它 40 次 / 3 分钟：宁等不误停。
        busyRetries: 40, busyBudgetMs: 180000
      });
      if (!r.ok) return { ok: false, error: r.error };

      ps.log("info", "边缘净化：图层「" + subject.name + "」蒙版羽化 " + featherPx + "px");
      return { ok: true, data: { applied: true, feather: featherPx, hadMask: true } };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return { ok: false, error: "边缘净化失败：" + msg };
    }
  }

  async function subjectBounds() {
    var ps = window.Ecom.ps;
    try {
      var layerRes = await ps.findSubjectLayer({});
      if (!layerRes.ok) return { ok: false, error: layerRes.error };

      // 优先 DOM boundsNoEffects（★ 真机实测：bounds 含图层样式）。本插件的 backdrop.addShadow 正是把
      // dropShadow 加在【主体层本身】上，所以投影之后主体层的 bounds 会把影子框进去（600×600 的层套上
      // dropShadow(distance=18,size=25) 后 bounds 从 0,0,600,600 变 -5,0,605,623）；boundsNoEffects 才是像素范围。
      // UXP 侧取证：Required\UXP\photoshop.js 与 app.js 的 Layer.prototype.boundsNoEffects getter 内部就是
      // getProperties(ref, ["boundsNoEffects"])[0].boundsNoEffects，键名有效且返回值带 left/top/bottom/right。
      try {
        var m = ps.require();
        var d = m.app.activeDocument;
        var al = d && d.activeLayers && d.activeLayers[0];
        var src = "boundsNoEffects";
        var b = al && al.boundsNoEffects;
        if (!b || typeof b.left !== "number" || b.right === undefined) {
          src = "bounds";
          b = al && al.bounds;
        }
        if (b && typeof b.left === "number" && b.right !== undefined) {
          var box = {
            left: Math.round(b.left), top: Math.round(b.top),
            right: Math.round(b.right), bottom: Math.round(b.bottom)
          };
          box.width = box.right - box.left;
          box.height = box.bottom - box.top;
          if (box.width > 0 && box.height > 0) {
            if (src !== "boundsNoEffects") ps.log("warn", "主体边界：DOM 无 boundsNoEffects，退回 bounds（可能含图层样式）");
            return { ok: true, data: box };
          }
        }
      } catch (eDom) {
        ps.log("warn", "DOM 读取图层 bounds 失败，改用蒙版像素求 bbox：" + (eDom && eDom.message ? eDom.message : String(eDom)));
      }

      var px = await ps.getSubjectPixels({ maxDim: 1024 });
      if (!px.ok) return { ok: false, error: px.error };
      var data = px.data;
      if (!data.alphaMask) {
        return { ok: false, error: "图层「" + layerRes.data.name + "」没有蒙版，无法求主体边界（请先抠图）" };
      }
      var w = data.width, h = data.height, mask = data.alphaMask;
      var minX = w, minY = h, maxX = -1, maxY = -1;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (mask[y * w + x] === 0) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (maxX < 0) return { ok: false, error: "蒙版全为 0，无法求主体边界" };
      var sx = data.docWidth / w, sy = data.docHeight / h;
      var out = {
        left: Math.round(minX * sx), top: Math.round(minY * sy),
        right: Math.round((maxX + 1) * sx), bottom: Math.round((maxY + 1) * sy)
      };
      out.width = out.right - out.left;
      out.height = out.bottom - out.top;
      return { ok: true, data: out };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return { ok: false, error: "求主体边界失败：" + msg };
    }
  }

  // ★ 用户 m03873（选择「把蒙版烘焙进像素」）：抠图/边缘净化用完的图层蒙版，最后烘焙成像素透明度。
  //   放在「边缘净化」之后 —— 羽化改的是蒙版，先烘焙羽化就吃不到。
  async function applyMask(opts) {
    var o = opts || {};
    var id = (typeof o.subjectLayerId === "number") ? o.subjectLayerId : null;
    var name = o.subjectLayerName || null;
    var out = { applyMaskStep: true, layerId: id, layerName: name };
    if (id === null) return { ok: false, error: "应用蒙版需要主体图层 id（编排层没给）" };
    var ps = window.Ecom.ps;   // 本文件的惯例：模块内不直接 require，运行时从 window.Ecom 取
    var has = await ps.hasUserMask(id, CUTOUT_BUSY_BUDGET_MS, name);
    if (has.ok && has.data && typeof has.data.layerId === "number") id = has.data.layerId;
    if (has.ok && has.data && has.data.hasMask !== true) {
      ps.log("info", "应用蒙版：图层「" + (name || id) + "」当前没有蒙版 → 跳过烘焙（不报错）");
      out.applied = false; out.reason = "no-mask";
      return { ok: true, data: out };
    }
    var r = await ps.applyUserMask(id, name, 120000);
    if (!r.ok) return { ok: false, error: "应用图层蒙版（烘焙）失败：" + r.error };
    ps.log("info", "已应用图层蒙版（烘焙进像素）：图层「" + (name || id) + "」id=" + id + " → 蒙版缩览图消失、主体外为真透明");
    out.applied = true; out.layerId = id;
    return { ok: true, data: out };
  }
  window.Ecom.cutout = {
    remove: remove,
    refine: refine,
    applyMask: applyMask,
    subjectBounds: subjectBounds,
    SELECTION: SELECTION
  };
})();

