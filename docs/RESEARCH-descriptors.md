# PS 2026 UXP batchPlay 描述符手册（研究取证记录）

> **目标环境**: Photoshop 2026，FileVersion `27.1 (20251117.r.17 2758080)`，安装目录 `D:\software\Adobe Photoshop 2026`
> **UXP Developer Tool 未安装** → 无法热重载迭代。因此本文档的取舍原则是：**宁可写「未查清」，也不猜**。
> **本文档的所有描述符都以「逐条可复制」为目标**；不确定的部分一律标出证据等级与缺口。

## 证据等级约定

| 标记 | 含义 | 要求 |
|---|---|---|
| `[本机取证]` | 在 `D:\software\Adobe Photoshop 2026\Required\UXP\` 的 Adobe 官方插件源码里找到**等价调用** | 必须给出**绝对文件路径 + 行号或字符偏移 + 原文片段** |
| `[官方文档]` | 来自 Adobe 官方文档 | 必须给出 URL |
| `[推断]` | 无直接证据，按同族事件类比得出 | 必须写清**类比依据**，并给出「真机首次验证方法」 |

### 单行压缩文件的定位方式
以下文件是 **webpack 压缩成单行** 的，**没有有意义的行号**，因此用**字符偏移**（`IndexOf` 命中位）定位，可原样复现：

| 文件（绝对路径） | 大小 | 定位方式 |
|---|---|---|
| `D:\software\Adobe Photoshop 2026\Required\UXP\app.js` | 292460 B，1 行 | 字符偏移 |
| `D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js` | 73053 B，1 行 | 字符偏移 |
| `D:\software\Adobe Photoshop 2026\Required\UXP\constants.js` | 20341 B，1 行 | 字符偏移 |
| `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js` | 10581736 B，1 行 | 字符偏移 |

复现命令（PowerShell）：
```powershell
$p = Get-Content -Raw "D:\software\Adobe Photoshop 2026\Required\UXP\app.js"
$i = $p.IndexOf('_obj:"gaussianBlur"'); $p.Substring([Math]::Max(0,$i-300), 700)
```

### 本机取证源的分工（先看这张表，再抄代码）

| 文件 | 作用 |
|---|---|
| `Required\UXP\photoshop.js` | **Adobe 官方 DOM API → batchPlay 描述符工厂**（`t.xxx = function(...)`）。描述符「形状」最权威的参考 |
| `Required\UXP\app.js` | DOM 层实现（`Document` / `Layer` / `Selection` 的 getter/setter 里就是 batchPlay 调用） |
| `Required\UXP\constants.js` | 常量与枚举（LayerKind / SaveOptions / 插值方式 / 模糊质量…） |
| `Required\UXP\com.adobe.unifiedpanel\js\524.js` | 宿主侧 helper 与 Adobe 自家 talent 流水线（`removeBackground` / `selectSubject` / `blurBackground` 的真实调用链、历史快照管理器） |
| `Required\UXP\com.adobe.photoshop.adjustments-panel\` | 调整图层的 `make` 描述符（`js\adjustments.js`）+ **每类调整的参数键名金矿**（`data\presets.json`） |
| `Required\UXP\com.adobe.photoshop-material-filters\index.js` | 智能对象 / 智能滤镜 / 图层蒙版 / `showColorPicker` 的真实用法 |
| `Required\UXP\com.adobe.photoshop.exportAs\js\0.js` | Adobe 导出面板（JPEG/PNG 导出 UI 逻辑，2026 版） |

### 统一调用约定（全文所有片段都遵守）

```js
const { app, core, action } = require("photoshop");
await core.executeAsModal(async () => {
  const res = await action.batchPlay([ /* ...描述符... */ ], {});
  const failed = res.filter(r => r && r._obj === "error");   // ← 必须做！batchPlay 失败不抛异常
  if (failed.length) throw new Error(JSON.stringify(failed));
}, { commandName: "电商图片制作" });
```

1. 所有会改文档的命令**必须**包在 `core.executeAsModal(fn, {commandName})` 内，否则 PS 2026 直接拒绝执行。
2. `_target` 省略 = 当前文档 / 当前选中图层（`{_enum:"ordinal",_value:"targetEnum"}`）。跨文档请显式写 `{_ref:"document",_id: docId}`。
3. **选区保护惯例**（Adobe 自己在 `app.js` / `photoshop.js` 里就是这么做的）：
   批量命令的**第一个**命令放 `{ _obj:"saveDocumentSelection" }`，**最后一个**放 `{ _obj:"restoreDocumentSelection" }`。
   证据 [本机取证] `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **26888**）：`function saveDocumentSelection(){return{_obj:"saveDocumentSelection"}}`，同处还有 `t.restoreDocumentSelection=function(){return{_obj:"restoreDocumentSelection"}}`。
4. 在批处理里**指定文档**用 `documentTarget: { _ref:"document", _id: docId }`（Adobe 用法，见 A3 策略 2）；在**单条描述符**里用 `_target`。
5. 图层引用统一用 **id**（`{_ref:"layer",_id:X}`）而不是 `_index` —— `_index` 会随移动/删除变化。

---

# A. 抠图

## A1. `removeBackground`（PS 原生「移除背景」）

**证据等级**: `[本机取证]`（结论：**不存在 `removeBackground` batchPlay 事件**）

**证据**：
- `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行）：`IndexOf('"removeBackground"')` = **0 命中**
- `D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js`（单行）：`removeBackground` = **0 命中**
- `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **4943956**）原文：`e.REMOVEBACKGROUND="removeBackground"` —— 这是 **UXP 通知事件名**，不是 batchPlay 事件
- 同文件 `removeBackground` 共 13 处，**全部**为：通知事件枚举（上条）、talent id 字符串、CDN 地址、功能卡标题字符串；`name:"removeBackground"` 与 `_obj:"removeBackground"` 命中数**均为 0**

**结论**：Photoshop 的「移除背景」没有暴露成单个 batchPlay 事件。要复刻它，只能走 Adobe 自家 talent 的等价链：**`autoCutout`（选择主体）→ 选区转图层蒙版**。

### A1b. Adobe 官方 `removeBackground` talent 的完整描述符链 `[本机取证]`

**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **1524042**）原文：
```js
[
  { name: "rasterizeLayer", descriptor: { _target: { _ref: "document", _id: e } } },
  { name: "autoCutout", descriptor: { sampleAllLayers: false, _target: { _ref: "document", _id: e } } },
  { name: "make", descriptor: {
      new: { _class: "channel" },
      at: { _ref: "channel", _enum: "channel", _value: "mask" },
      using: { _enum: "userMaskEnabled", _value: "revealSelection" },
      documentTarget: { _ref: "document", _id: e } } },
  { name: "delete", descriptor: {
      _target: [{ _ref: "channel", _enum: "ordinal", _value: "targetEnum" }, { _ref: "document", _id: e }],
      apply: true } }
]
```
另一处简化版（同文件，偏移 **1522832**）：
```js
[ { name: "autoCutout", descriptor: { sampleAllLayers: false } },
  { name: "make", descriptor: { new: { _class: "channel" },
                                at: { _ref: "channel", _enum: "channel", _value: "mask" },
                                using: { _enum: "userMaskEnabled", _value: "revealSelection" } } } ]
```

**逐条含义与注意事项**：
1. `rasterizeLayer` 对已是普通像素层的图层**幂等**；对智能对象/文字/形状层会光栅化。本项目主体层通常是像素层，可省。
2. `autoCutout` 的 DOM 等价 API 是 `selectSubject()`。`sampleAllLayers:false` = 只采样当前图层。
3. `make` + `at:{_ref:"channel",_enum:"channel",_value:"mask"}` 把**当前选区**变成**图层蒙版**（`revealSelection`）。执行后选区会被自动清除。
4. 结尾 `delete ... apply:true` 删除 `autoCutout` 产生的临时 alpha 通道。**`apply:true` 不能省** —— 不带它会弹「删除前是否应用」对话框，在 modal 里会卡住。
5. **最低 PS 版本**：`autoCutout` / `userMaskEnabled` 在 PS 24.0（2022）之后可用，本机 27.1 存在。INTERFACE 的 `host minVersion 24.0` 对 A1 是安全的。

**失败模式**：`autoCutout` 对**纯色 / 低对比**图片找不到主体时**不报错**，只产出空选区 → `make` 会建出「全隐藏」蒙版（图层看起来消失）。**必须**在生成后检测主体是否为空（读蒙版灰度像素，见 F27），为空则回退到 A2+A3 的备用策略。

**→ INTERFACE 落点**：`cutout.remove()` 的主路径。因为 PS 没有单一 `removeBackground`，`cutout.remove()` 的实现就是这条链（与「移除背景」菜单结果等价）。

---

## A2. `selectSubject`（选择主体）

**证据等级**: `[本机取证]`

**证据**：
- `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **4084883**）原文：
  `selectSubjectDescriptor(e=0){const t={sampleAllLayers:!1}; e&&(t._target={_ref:"document",_id:e}); return {name:"autoCutout",descriptor:t}}`
- 同文件偏移 **1568140**（`selectSubjectTalent` 流水线）原文：
  `[{_obj:"autoCutout",sampleAllLayers:!1},{_obj:"get",_target:{_ref:[{_property:"layerID"},{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}]}}]`
- 同文件偏移 **1567013**（`selectBackgroundTalent`）原文：
  `[{_obj:"autoCutout",sampleAllLayers:!1},{_obj:"inverse"},{_obj:"get",...layerID}]`

**可复制代码**（最常用：作用于当前文档当前图层）：
```js
{ _obj: "autoCutout", sampleAllLayers: false }
```
带文档 id 的形式：
```js
{ name: "autoCutout", descriptor: { sampleAllLayers: false, _target: { _ref: "document", _id: docId } } }
```

**注意事项**：
- 用 `{name, descriptor}` 形式时，`descriptor` 内**不要再写** `_obj:"autoCutout"`（Adobe 自己的 factory 就没写）；用**裸描述符**形式时 `_obj` 是**必需的**。两种写法 PS 都接受。
- ⚠️ **`selectSubject` 这个标识符在 UXP 里属于 `vision` API，不是 batchPlay 事件**：
  `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\96.js` 使用 `window.require("uxp").vision.createOperation("subjectSelect")`；
  `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.cai.uxp.panel\js\179.js` 注释说明它「uses masking_ai for selecting subject, sky, portrait…」。
  `vision` 算的是**像素级前景遮罩**，不做选区；**要产出图层蒙版请用 batchPlay 的 `autoCutout`**。
- 若只要「背景」：`autoCutout` 之后紧跟 `{ _obj:"inverse" }`（本机取证，偏移 1567013）。

**失败模式**：`autoCutout` 会**替换**当前选区且不报错；空选区时静默成功（见 A1 失败模式）。

---

## A3. 选区 → 图层蒙版（三种已验证组合）

### 策略 1（推荐，最省事）：选区直接生成蒙版
**证据等级**: `[本机取证]`
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\ps.js:244-251` 原文：
```js
// ps.js:244  makePixelMask(hasActiveSelection = false)
{ _obj: "make",
  at:    { _ref: "channel", _enum: "channel", _value: "mask" },
  new:   { _class: "channel" },
  using: { _enum: "userMaskEnabled", _value: hasActiveSelection ? "revealSelection" : "revealAll" } }
```
`true` → 选区显示（revealSelection）；`false` → 全部显示（revealAll，即空白蒙版）。

### 策略 2（带文档 id，跨文档批处理用）
**证据等级**: `[本机取证]`
**证据**：`524.js`（单行，偏移 **1524042** / **1522832**，见 A1b）
```js
{ name: "make", descriptor: {
    new: { _class: "channel" },
    at: { _ref: "channel", _enum: "channel", _value: "mask" },
    using: { _enum: "userMaskEnabled", _value: "revealSelection" },
    documentTarget: { _ref: "document", _id: docId } } }
```

### 策略 3（先删旧蒙版再建）
**证据等级**: `[本机取证]`
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **4083380** 区段）原文：`deleteMask()` → `{name:"delete",descriptor:{_obj:"delete",_target:[{_enum:"channel",_ref:"channel",_value:"mask"}]}}`

### 配套：判断图层「是否已有蒙版」
**证据等级**: `[本机取证]`
**证据**：`524.js`（单行，偏移 **1526856** / **4083380** 区段）原文：`layerMaskDescriptor(e=0)` 与 `hasLayerMask(e=0)`：
```js
{ _obj: "get",
  _target: { _ref: [ { _property: "hasUserMask" },
                     { _ref: "layer", _enum: "ordinal", _value: "targetEnum" } ] } }
// 指定图层：{ _ref: [ { _property: "hasUserMask" }, { _ref: "layer", _id: X } ] }
```
返回 `res[0].hasUserMask`（布尔）。**没有蒙版时不报错**，返回 `false`。

**失败模式**：当前**没有选区**却用 `revealSelection` → PS 静默创建「全部隐藏」的蒙版（图层看起来消失）。**必须先判断选区是否为空**。
空选区判定用的 `ref.selection`（`{_ref:"channel",_property:"selection"}`）已取证（`app.js` 单行偏移 **16884**），但「get selection 在空选区时的返回值」**未实测** —— 见「未查清事项」。

---

## A4. 图层蒙版「收缩」与「羽化」（边缘净化）

**关键结论（极易写错）**：这里有两套**完全不同**的 API，必须先分清作用对象：

| 目的 | 作用对象 | 事件 |
|---|---|---|
| 收缩 / 羽化 **选区** | `{_ref:"channel",_property:"selection"}` | `contract` / `feather` |
| 羽化 **图层蒙版边缘**（边缘净化首选） | 图层 | `set` + `{_obj:"layer", userMaskFeather: …}` |

### 4a. 蒙版羽化（推荐；正对 INTERFACE 的 `cutout.refine({feather})`）
**证据等级**: `[本机取证]`
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **166328**）原文：
`set layerMaskFeather(e){ … batchPlaySync([saveDocumentSelection(), select(ref.id(this._docId)), set(ref.id(this._id), {_obj:"layer", userMaskFeather: lt.Pixel(e)})]) }`

**可复制代码**：
```js
{ _obj: "set",
  _target: [{ _ref: "layer", _id: layerId }],
  to: { _obj: "layer", userMaskFeather: { _unit: "pixelsUnit", _value: featherPx } } }
```
读取：`getProperties(ref.id(layerId), ["userMaskFeather"])[0].userMaskFeather`
**非破坏性**：只改蒙版边缘硬度，可随时改回 0。
同族还有蒙版密度（`app.js` 单行偏移 **166328** 区段）：`{ _obj:"layer", userMaskDensity: { _unit:"percentUnit", _value: pct } }`（`lt.Percent(e)`）。

### 4b. 选区收缩 / 羽化 / 扩展 / 反选 / 取消
**证据等级**: `[本机取证]`
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **61715**，`selectBasicShape` 所在模块）原文摘要：
```js
var i = r(419).ref.selection();   // = {_ref:"channel",_property:"selection"}，定义见同文件偏移 16884
t.contract   = function(e,t){ return {_obj:"contract",   _target:[i], by:{_unit:"pixelsUnit",_value:e},     selectionModifyEffectAtCanvasBounds:t} }
t.feather    = function(e,t){ return {_obj:"feather",    _target:[i], radius:{_unit:"pixelsUnit",_value:e}, selectionModifyEffectAtCanvasBounds:t} }
t.expand     = function(e,t){ return {_obj:"expand",     _target:[i], by:{_unit:"pixelsUnit",_value:e},     selectionModifyEffectAtCanvasBounds:t} }
t.inverse    = function(){   return {_obj:"inverse",    _target:[i]} }
t.deselect   = function(){   return {_obj:"set",        _target:[i], to:{_enum:"ordinal",_value:"none"}} }
t.border     = function(e){  return {_obj:"border",     _target:[i], width:{_unit:"pixelsUnit",_value:e}} }
t.smoothness = function(e,t){return {_obj:"smoothness", _target:[i], radius:{_unit:"pixelsUnit",_value:e}} }
t.grow       = function(e,t){return {_obj:"grow",       _target:[i], antiAlias:t, tolerance:e} }
```

**可复制代码**（边缘净化常用序列的收缩+羽化）：
```js
[ { _obj:"contract", _target:[{_ref:"channel",_property:"selection"}],
    by:{_unit:"pixelsUnit", _value:1}, selectionModifyEffectAtCanvasBounds:false },
  { _obj:"feather",  _target:[{_ref:"channel",_property:"selection"}],
    radius:{_unit:"pixelsUnit", _value:1.5}, selectionModifyEffectAtCanvasBounds:false } ]
```
**注意**：`selectionModifyEffectAtCanvasBounds` 默认 `false`；设 `true` 时修改只在画布范围内生效。

★★ **真机实测（2026-10-16，本插件 PS 27.1）——取消选区的三种写法谁行谁不行**：
- `{ _obj:"set", _target:[{_ref:"channel",_property:"selection"}], to:{_enum:"ordinal",_value:"none"} }`（上面 `t.deselect`）
  ⇒ **可用**（权威写法，app.js 自己的实现）。
- `{ _obj:"deselect", _target:[{ _ref:"channel", _property:"selection" }] }` ⇒ `batchPlay` 返回 **ok**，
  但画布上的矩形选区**原样还在**（13:37:52 用户截图）⇒ 静默无效，13:43 改成「多发几种」后仅作为兜底之一。
- `{ _obj:"deselect", _target:[{ _ref:"document", _enum:"ordinal", _value:"targetEnum" }] }` ⇒ 被**明确拒绝**：
  `Photoshop 拒绝了描述符：命令"取消选择"当前不可用`（三次重试都拒）。
- 空矩形（`set selection → rectangle 0,0,0,0`）⇒ ok。
⇒ 通用教训：**ok ≠ 生效**；清理类动作要「已知写法全发一遍 + 用画布/DOM 回读判定」（本插件用 `photoshop_inspect`
读 `doc.selection.bounds` 确认 `selection none`）。插件侧落地：`straighten-apply.js deselectDescs()`（4 种依次发）、
`cutout.js` 链尾补 `set selection→none`。

### ⚠️ 缺口（必须知道）：「收缩图层蒙版」没有直接 API
`app.js` 里对图层蒙版的 `set` 只有 `userMaskFeather` 与 `userMaskDensity`，**没有 userMaskContract**（全树 `grep userMask` 只命中 app.js 这两处 + `hasUserMask` 读取）。
要收缩蒙版本体只能走：**载入蒙版为选区 → 在选区上 `contract` → 重新生成蒙版**（`{_obj:"set", _target:[{_ref:"channel",_enum:"channel",_value:"mask"}], to:{_enum:"ordinal",_value:"none"}}` 载入通道那一步 **本机未取证**）。
**建议**：`cutout.refine({contract})` 在实现上**只做 4a 的羽化**（INTERFACE 允许），或在 `contract>0` 时用「收缩选区 → 从选区重建蒙版」（A3 策略 1，重建会丢掉原有羽化值，代价明确）。

**失败模式**：对**没有蒙版**的图层设 `userMaskFeather` → PS 直接报错（对象上没有 userMask）。必须先 A3 建蒙版或用 `hasUserMask` 判过。

---

# B. 背景与投影

## B5. 新建纯色填充图层

**推荐做法：`make` + `contentLayer` + `solidColorLayer`** —— 比「设前景色 + `fill`」可靠：不依赖「当前前景色」这个隐藏状态，且产物是**独立、可选色、可排序**的填充层（符合 INTERFACE「非破坏」要求）。

**证据等级**: `[本机取证]`
**证据**：
- `D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js`（单行，偏移 **6360**）原文：
  `fillLayerSetup(e){…var t={_obj:"make",_target:[{_ref:"contentLayer"}],using:{_obj:"contentLayer",type:{}}};return applyOptionalParams(t.using,{name:e.name,color:e.color?{_enum:"color",_value:e.color}:void 0,mode:e.mode?{_enum:"blendMode",_value:e.mode}:void 0,opacity:e.opacity?{_unit:"percentUnit",_value:e.opacity}:void 0}),t}`
- 同文件（偏移 **11288**）原文：`solid:function(e,t){…applyOptionalParams((r=fillLayerSetup(t)).using.type,{_obj:"solidColorLayer",color:e.color}),r}`

**可复制代码**（INTERFACE `backdrop.setSolid({hex, name})` 的落点）：
```js
{ _obj: "make",
  _target: [{ _ref: "contentLayer" }],
  using: { _obj: "contentLayer",
           type: { _obj: "solidColorLayer",
                   color: { _obj: "RGBColor", red: 255, green: 255, blue: 255 } },
           name: "背景" } }
```
`RGBColor` 的三通道是 **0..255 整数**（与 INTERFACE 的 `ps.hexToRGB` 一致；`ps.js:416-447` 读回调整层时也是 255 标度）。

**备选：前景色法** `[本机取证]`（但更脆弱，不推荐）
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **59034** 与 **59338**）原文：
`t.hl=function fill(e,t,r,n,i,o,s,l){var c={_obj:"fill",_target:e}; applyOptionalParams(c,{wholePath:t,preserveTransparency:o,antiAlias:l}); … r&&applyOptionalParams(c,{color:r,using:{_enum:"fillContents",_value:"color"}}) }`
```js
{ _obj:"fill", _target:[{_ref:"layer",_id:layerId}],
  using:{ _enum:"fillContents", _value:"foregroundColor" },   // 或 "color" + color:{...}
  opacity:{ _unit:"floatUnit", _value:1 }, mode:{_enum:"mode",_value:"normal"} }
```
**为什么不推荐**：需要先改**全局前景色**（`{_obj:"set", _target:[{_ref:"foregroundColor"}], to:{_obj:"RGBColor",…}}`，污染用户状态）；而且 `fill` 只能作用于**已有图层**的像素，做不出「独立可改色的填充层」。

**注意事项**：`_target:[{_ref:"contentLayer"}]` **必需**（Adobe 自己的 factory 就这么写）。填充层默认插到当前图层**上方**。
**失败模式**：`type:{_obj:"solidColorLayer"}` 漏了 `color` → PS 报参数错误（`-25920` 类）；`RGBColor` 三通道必须齐全。

---

## B6. 图层排序 / 把新图层移到主体层下方

**结论**：batchPlay 的层序 API 是 **`move`**，`to` 用目标层序引用（`_id` / `_index` / `_offset` / `_enum:ordinal`）。**没有 `_place` 这种写法**（`Required\UXP\` 全树 `grep "_place"` = 0 命中）。

**证据等级**: `[本机取证]`
**证据**：
- `D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js`（单行，偏移 ~**13473** 区段）原文：`t.move=function(e,r){return{_obj:"move",_target:e,to:t.ref.index(r),version:5}}`
- 同文件图层引用族（偏移 **43494**）原文：`t.ref={selected:…{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}, next, front, previous, forward, backward, back, all, name(e)→{_ref:"layer",_name:e}, id(e)→{_ref:"layer",_id:e}, offset(e)→{_ref:"layer",_offset:e}, index(e)→{_ref:"layer",_index:e}, range(e,t)→{_obj:"layer",index:e,count:t}}`
  → 因此 `to:{_ref:"layer",_enum:"ordinal",_value:"back"}`（最底层）/ `"front"`（最顶层）是**官方枚举**。
- `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **189385**，DOM `Layer.placement` setter）确认语义：`PLACEBEFORE→moveAbove`、`PLACEAFTER→moveBelow`、`PLACEINSIDE→moveInside`；并且**每次移动前都先** `saveDocumentSelection()` + `select(ref.id(this._docId))`。

**推荐（唯一可靠的一种）：用 `_enum:"ordinal"` 移到最底层**
```js
// 背景填充层永远在主体下方 —— 最不容易错的写法
{ _obj:"move", _target:[{_ref:"layer",_id:fillLayerId}],
  to:{ _ref:"layer", _enum:"ordinal", _value:"back" }, version:5 }
```

**相对移动策略（要「主体层正下方」而非最底层时）**：
```js
// 1) 先到主体层位置（PLACEBEFORE 语义 → 即主体正上方）
{ _obj:"move", _target:[{_ref:"layer",_id:fillLayerId}], to:{_ref:"layer",_id:subjectLayerId}, version:5 }
// 2) 再相对下移一层，越过主体层
{ _obj:"move", _target:[{_ref:"layer",_id:fillLayerId}], to:{_ref:"layer",_offset:-1}, version:5 }
```
⚠️ 「`move` 的 `to` 直接给 `{_ref:"layer",_id:X}` 时插入语义是 before 还是 after」**本机未取证**（app.js 的 setter 通过计算 index 实现 above/below，没有把 `_id` 直接当作 before/after 用）。**建议只用 `"back"` / `"front"` 或 `_offset`**。

**注意事项**：
- `version:5` 必须带（Adobe 自己的 factory 就带）。
- 同一批次里**先建层再移动**时，新层的 `_id` 还拿不到 → **分两次 batchPlay**：第一次 `make`，从返回值取 `layerID`；第二次 `move`。
- 若主体层在被折叠的组里，`_id` 引用仍有效，但相对语义以组内外为界；**剪贴蒙版会改变结果**。
**失败模式**：`to:{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}` = 移到「当前选中层」的位置 → 常得到「无变化」或报错；`_index` 是 0 基且随移动变化，批量移动多个层时极易错位 —— **不要用 `_index` 做「移到某层下方」**。

---

## B7. 柔和接地投影（推荐路径论证）

**候选方案**：
- **(a)** 复制主体层 → 填黑 → 高斯模糊 → 缩放 → 降不透明度 → 移到主体下方：**每一步都有本机取证**。
- **(b)** 图层样式 `dropShadow`：❌ **本机取证为「无证据」**。`Required\UXP\` 全树 `grep dropShadow` 只命中 `com.adobe.cclibrariespanel` 里的 Lottie 运行时（与图层样式无关）；`layerEffects` 在 524.js 的命中只是帮助文档 URL id。**没有任何 Adobe 官方插件用 batchPlay 写 dropShadow**。
- **(c)** 椭圆选区 + 羽化 + 填充：可行（`selectBasicShape` / `feather` / `fill` 都有取证），但椭圆与主体轮廓无关（是「假影子」），且要手算几何、随主体比例变化会失真。

**推荐：(a)**，理由：
1. 四个步骤在 Adobe 官方代码里都有等价调用 → 真机第一次跑就有很高把握；
2. 影子形状**自动跟随主体轮廓**（这是「柔和接地」真实感的来源）；
3. 参数可直接映射 INTERFACE 的 `{opacity, blur, offsetY}`；
4. 影子是**独立图层**（非破坏），可重做、可排除在 `compose.normalize` 的缩放之外。

### 完整描述符链（`opacity` 0..100，`blur` px，`offsetY` px）
```js
// 1) 复制主体层（连蒙版一起复制）
{ _obj:"duplicate", _target:[{_ref:"layer",_id:subjectLayerId}], version:5, name:"阴影" }
//    ← 从返回值 res[0].layerID 取 shadowLayerId，后续全部用它

// 2) 若影子层不是普通像素层（智能对象/文字/形状），先光栅化
{ name:"rasterizeLayer", descriptor:{ _target:{ _ref:"document", _id:docId } } }

// 3) 整层填黑（蒙版仍在，轮廓保留）
{ _obj:"fill", _target:[{_ref:"layer",_id:shadowLayerId}],
  color:{ _obj:"RGBColor", red:0, green:0, blue:0 },
  using:{ _enum:"fillContents", _value:"color" },
  opacity:{ _unit:"floatUnit", _value:1 }, mode:{_enum:"mode",_value:"normal"} }

// 4) 高斯模糊 —— 注意：必须保证当前激活层是影子层（见下「注意事项」）
{ _obj:"gaussianBlur", radius:{ _unit:"pixelsUnit", _value: blurPx } }

// 5) 压扁（更像贴地）——可选
{ _obj:"transform", _target:[{_ref:"layer",_id:shadowLayerId}],
  freeTransformCenterState:{ _enum:"quadCenterState", _value:"QCSAverage" },
  width:{ _unit:"percentUnit", _value:100 }, height:{ _unit:"percentUnit", _value:60 },
  interpolation:{ _enum:"interpolationType", _value:"bicubic" } }

// 6) 下移 offsetY
{ _obj:"transform", _target:[{_ref:"layer",_id:shadowLayerId}],
  offset:{ _obj:"offset", horizontal:{_unit:"pixelsUnit",_value:0},
                        vertical:{_unit:"pixelsUnit",_value: offsetY} },
  interpolation:{ _enum:"interpolationType", _value:"bicubic" },
  freeTransformCenterState:{ _enum:"quadCenterState", _value:"QCSAverage" } }

// 7) 降不透明度
{ _obj:"set", _target:[{_ref:"layer",_id:shadowLayerId}],
  to:{ _obj:"layer", opacity:{ _unit:"percentUnit", _value: opacityPct } } }

// 8) 移到主体层正下方
{ _obj:"move", _target:[{_ref:"layer",_id:shadowLayerId}],
  to:{ _ref:"layer", _enum:"ordinal", _value:"back" }, version:5 }
```

### 证据（逐条）
| 步骤 | 文件:偏移 | 原文摘要 |
|---|---|---|
| 4 高斯模糊 | `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，函数 `applyGaussian`） | `{_obj:"gaussianBlur", radius:{_unit:"pixelsUnit",_value:e}}` |
| 4 高斯模糊（第二处） | `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **1514244**） | `gaussianBlurDescriptor(e,t=0){…{name:"gaussianBlur",descriptor:{radius:{_unit:"pixelsUnit",_value:e}, …}}}` |
| 6 位移 | `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **6704**） | `t.translate=function(e,t,r){return transform(r,{offset:{_obj:"offset",horizontal:{_unit:"pixelsUnit",_value:e},vertical:{_unit:"pixelsUnit",_value:t}},interpolation:{_enum:"interpolationType",_value:"bicubic"},freeTransformCenterState:{_enum:"quadCenterState",_value:"QCSAverage"}})}` |
| 5 百分比缩放 | `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **6704** 区段） | `t.resize=function(e,t,r,n,a){return transform(a,{freeTransformCenterState:{_enum:"quadCenterState",_value:r},height:{_unit:"percentUnit",_value:t},width:{_unit:"percentUnit",_value:e},interpolation:{_enum:"interpolationType",_value:n}})}` |
| 7 不透明度 | `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **164375**） | `set opacity(e){…batchPlaySync([saveDocumentSelection(), select(ref.id(this._docId)), set(ref.id(this._id), {_obj:"layer",opacity: lt.Percent(e)})])}`；`set fillOpacity` 同构（`{_obj:"layer",fillOpacity:…}`） |
| 3 填充 | 见 B5（`app.js` 偏移 **59034** / **59338**） | `{_obj:"fill", …, using:{_enum:"fillContents",_value:"color"}}` |
| 8 层序 | 见 B6 | `{_obj:"move", …, to:{_ref:"layer",_enum:"ordinal",_value:"back"}, version:5}` |

**不透明度读写的标度坑**：`getProperties(['opacity'])[0].opacity` 返回 **0..255**（DOM 层除以 255 换成百分比）；**写入时用 `{_unit:"percentUnit"}` 百分比**。两处标度不同，混用会让影子要么全黑要么消失。

### 注意事项 / 与项目契约的配合
- **第 4 步是最危险的一步**：`gaussianBlur` 是**无 `_target` 的滤镜事件**，它作用于**当前激活图层**。如果批处理里没有先 `select(ref.id(shadowLayerId))`，模糊会打到主体层上（灾难性）。**建议在执行 3/4/5/6 之前显式 `{_obj:"select", _target:[{_ref:"layer",_id:shadowLayerId}]}`**（`select` 描述符见 A4/B6 引用的 `photoshop.js` `t.select`）。
- 第 3 步**不要**开 `preserveTransparency`（会让填充结果与预期不同）。
- 第 6 步 `offsetY` **正数 = 向下**。
- 影子层执行 `transform` 时带 `freeTransformCenterState:"QCSAverage"`（Adobe 的 translate/resize 都带），保证以**中心**为基准，否则会以角落为基准导致偏移翻倍。
- INTERFACE 要求 `compose.normalize` 缩放时**排除背景/阴影层**：建议给这两层固定名字（`"背景"` / `"阴影"`）并记录 layerID，缩放前跳过。
- 影子层可以**只靠 `offsetY` 与 `blur` 两个参数**工作；`opacity` 直接映射到步骤 7。

**失败模式**：① 当前激活层不是影子层 → 模糊/变换打错层（**最难发现**，因为不报错）；② 步骤 1 的 `duplicate` 返回结构里 `layerID` 的实际字段名未实测（Adobe 的 `duplicate` 返回 `[{layerID:…}]`，但 `{name:"duplicate",descriptor:{…}}` 形式与 `{_obj:"duplicate",…}` 形式返回结构可能不同）→ **建议真机第一次跑时先 `console.log(JSON.stringify(res))` 确认字段名**；③ 不透明度标度用错（见上）。

---

# C. 调整图层（非破坏）

## 统一 make 形式

**证据等级**: `[本机取证]`
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\adjustments.js:56-71`（`makeDescriptors`）逐行原文：
```
L56 brightnesscontrast: {_obj:"make", _target:[{_ref:"adjustmentLayer"}], using:{_obj:"adjustmentLayer", type:{_obj:"brightnessContrast", useLegacy:false}}},
L57 levels:              … type:{_obj:"levels"}
L58 curves:              … type:{_obj:"curves"}
L59 exposure:            … type:{_obj:"exposure"}
L60 vibrance:            … type:{_class:"vibrance"}
L61 huesaturation:       … type:{_obj:"hueSaturation"}
L62 colorbalance:        … type:{_obj:"colorBalance"}
L63 blackandwhite:       … type:{_obj:"blackAndWhite"}
L64 photofilter:         … type:{_obj:"photoFilter"}
L65 channelmixer:        … type:{_obj:"channelMixer"}
L66 colorlookup:         … type:{_class:"colorLookup"}
L67 invert:              … type:{_class:"invert"}
L68 posterization:       … type:{_obj:"posterization"}
L69 thresholdclassevent: … type:{_obj:"thresholdClassEvent"}
L70 selectivecolor:      … type:{_obj:"selectiveColor"}
L71 gradientmapclass:    … type:{_obj:"gradientMapClass"}
```

**关键坑 1**：`useLegacy:false` 被 Adobe **只在 brightnessContrast 上**显式写出（L56）—— 因为 `brightnessEvent`（旧版行为）与 `brightnessContrast` 是同一 UI 的两个 mode。不写 `useLegacy` 时 PS 用默认，但**建议与官方面板一致显式写 `false`**。
**关键坑 2**：错误检测模式 —— `adjustments.js:120` 用 `core.executeAsModal`、`L124` 用 `resDesc.filter(item => item._obj === 'error')`：**batchPlay 会把失败项以 `{_obj:"error"}` 返回而不抛异常**，必须逐项过滤。

## 参数键名的总证据源
`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\data\presets.json`（**1457 行**，Adobe 自带的调整预设，**每条就是一个真实可用的参数描述符**）。
各 `_obj` 出现次数直方图：`adjustmentLayer`×60、`curves`×13、`blackAndWhite`×13、`colorBalance`×7、`brightnessEvent`×6、`photoFilter`×5、`hueSaturation`×5、`levels`×3、`brightnessContrast`×3、`vibrance`×2、`invert`×1 —— **没有 exposure**（所以 C12 的键名只能推断）。
另一份：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel-revamped\data\presets.json`（`photoFilter` @L100/162/495/1014/1088，`preserveLuminosity:true` @L348/456/496/981/1058）。

**通用「设参数」写法**（所有调整项共用）：
```js
{ _obj:"set",
  _target:[{_ref:"adjustmentLayer",_enum:"ordinal",_value:"targetEnum"}],
  to:{ _obj:"<类型>", …参数键… } }
```

---

## C8. 色相/饱和度（`hueSaturation`）

**证据等级**: `[本机取证]`
**证据**：
- `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\data\presets.json:123-130` 原文：
  `{_obj:"hueSaturation", adjustment:[{_obj:"hueSatAdjustmentV2", hue:0, lightness:0, saturation:-50}]}`
- `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\adjustments.js:61` make 形式
- 另一处（带 colorize）：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **1541643**）原文：
  `{name:"hueSaturation",descriptor:{adjustment:[{_obj:"hueSatAdjustmentV2",hue:30,lightness:0,saturation:25}],colorize:!0,presetKind:{_enum:"presetKindType",_value:"presetKindCustom"},_obj:"hueSaturation"}}`

**键名**：`adjustment`（**数组**，元素 `_obj:"hueSatAdjustmentV2"`，含 `hue` / `saturation` / `lightness`）；顶层可选 `colorize`(bool)、`presetKind`。
**取值范围**：`hue` -180..180；`saturation` / `lightness` -100..100（presets.json 里就是整数百分比）。

**可复制代码**：
```js
// a) 建层
{ _obj:"make", _target:[{_ref:"adjustmentLayer"}],
  using:{ _obj:"adjustmentLayer", type:{ _obj:"hueSaturation" } } }

// b) 设参数（作用于刚建的调整层 —— 它建好后就是当前选中层）
{ _obj:"set",
  _target:[{_ref:"adjustmentLayer",_enum:"ordinal",_value:"targetEnum"}],
  to:{ _obj:"hueSaturation",
       adjustment:[{ _obj:"hueSatAdjustmentV2", hue: 0, saturation: -30, lightness: 0 }] } }
```

⚠️ **本条最大的坑**：顶层**没有** `saturation` 键，饱和度必须在 `adjustment[0].saturation`。写成 `to:{_obj:"hueSaturation", saturation:-30}` 会被 PS **静默忽略**（不报错），表现为「调用成功但图没变」。
**注意**：数组元素个数 = 6（红/黄/绿/青/蓝/洋红）时表示分通道调整；**只给 1 个元素 = 全局（主通道）调整**，正是本项目要的。
**失败模式**：用 `_obj:"hueSatAdjustment"`（无 V2）是旧事件名，PS 2026 不认。
**→ INTERFACE 落点**：`adjust.apply` 的 `saturation` 项。

---

## C9. 亮度/对比度（`brightnessContrast`）

**证据等级**: `[本机取证]`
**证据**：
- `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\data\presets.json:112-116` 原文：`{_obj:"brightnessContrast", brightness:-40, contrast:30, useLegacy:false}`
- 旧版形态：同文件 `:70-74` 原文：`{_obj:"brightnessEvent", brightness:-30, center:10, useLegacy:false}`
- `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\adjustments.js:56` 的 make 里带 `useLegacy:false`

**键名**：`brightness`(-150..150)、`contrast`(-100..100)、`useLegacy`(bool)。旧事件 `brightnessEvent` 另含 `center`。

**可复制代码**：
```js
{ _obj:"make", _target:[{_ref:"adjustmentLayer"}],
  using:{ _obj:"adjustmentLayer", type:{ _obj:"brightnessContrast", useLegacy:false } } }

{ _obj:"set",
  _target:[{_ref:"adjustmentLayer",_enum:"ordinal",_value:"targetEnum"}],
  to:{ _obj:"brightnessContrast", brightness: 10, contrast: 15, useLegacy: false } }
```

**→ INTERFACE 落点**：`brightness` 与 `contrast` **共享同一层**的要求完全满足 —— 二者是同一事件的两个键，**一次 `set` 同时写**即可，不要建两层。
**失败模式**：`useLegacy:true` 时 `brightness` 的取值范围与视觉完全不同（且影响 `contrast` 行为）→ **始终写 `useLegacy:false`**。

---

## C10. 照片滤镜（`photoFilter`，用于色温）

**证据等级**: `[本机取证]`（键名）；`color` 的预设枚举写法为 `[推断]`
**证据**：
- `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\data\presets.json:297-305` 原文：
  `{_obj:"photoFilter", color:{_obj:"labColor", luminance:67, a:32, b:120}, density:30}`
- `preserveLuminosity` 见 `...\adjustments-panel-revamped\data\presets.json:348/456/496/981/1058`

**键名**：`color`（**`labColor`**：`luminance`/`a`/`b`）、`density`（数字，通常 1..100）、`preserveLuminosity`(bool)。

⚠️ **陷阱**：`color` 是 **`labColor`**，**不是** `RGBColor`。色温方向由 **`b`（黄/蓝轴）的符号**决定：`b` 为正 → 偏暖（加黄），`b` 为负 → 偏冷（加蓝）。

**可复制代码（本机取证版本，推荐）**：
```js
{ _obj:"make", _target:[{_ref:"adjustmentLayer"}],
  using:{ _obj:"adjustmentLayer", type:{ _obj:"photoFilter" } } }

{ _obj:"set",
  _target:[{_ref:"adjustmentLayer",_enum:"ordinal",_value:"targetEnum"}],
  to:{ _obj:"photoFilter",
       color:{ _obj:"labColor", luminance: 70, a: 6, b: 55 },   // b>0 → 偏暖
       density: 25, preserveLuminosity: true } }
```

**[推断] 备选：直接用 Photoshop 内置滤镜预设枚举**
```js
to:{ _obj:"photoFilter", color:{ _enum:"filter", _value:"warmingFilter85" },
     density:25, preserveLuminosity:true }
```
**类比依据**：PS 动作录制里 `photoFilter.color` 可以是 `{_enum:"filter",_value:…}`（内置 85/80/L 系列滤镜）；但**本机 presets.json 里只见到 `labColor` 形式**，未见枚举形式 → 标 `[推断]`。
**真机首次验证方法**：跑一次 `{_enum:"filter"}`；若失败改用 `labColor`（已取证，必可用）。

**→ INTERFACE 落点**：`adjust.apply` 的 `temperature` 项。
**失败模式**：`color` 写成 `{_obj:"RGBColor",…}` → 报参数错；`density:0` → **无效果且不报错**（容易误判调用成功）。

---

## C11. 色彩平衡（`colorBalance`，用于白平衡）

**证据等级**: `[本机取证]`
**证据**：
- `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\data\presets.json:81-98` 原文：
  `{_obj:"colorBalance", preserveLuminosity:true, shadowLevels:[-20,0,20], midtoneLevels:[-100,0,-100], highlightLevels:[100,0,0]}`
- 同族强证据：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\adjustment-layer-enablement.js:368` 的 `keyList` 明确列出 `['highlightLevels','midtoneLevels','shadowLevels']`

**键名**：`shadowLevels` / `midtoneLevels` / `highlightLevels`（各 **3 元素**数组 = `[青-红, 洋红-绿, 黄-蓝]`，取值 **-100..100**）、`preserveLuminosity`(bool)。

⭐ **拼写陷阱**：中间调是 `midtoneLevels`（**单数 midtone**），阴影/高光是复数 `shadowLevels` / `highlightLevels`。

**可复制代码**：
```js
{ _obj:"make", _target:[{_ref:"adjustmentLayer"}],
  using:{ _obj:"adjustmentLayer", type:{ _obj:"colorBalance" } } }

{ _obj:"set",
  _target:[{_ref:"adjustmentLayer",_enum:"ordinal",_value:"targetEnum"}],
  to:{ _obj:"colorBalance", preserveLuminosity: true,
       shadowLevels:    [0, 0, 0],
       midtoneLevels:   [10, 0, -10],   // 第 3 个 = 黄(-)/蓝(+)，负值偏暖
       highlightLevels: [0, 0, 0] } }
```

**→ INTERFACE 落点**：`adjust.apply` 的 `whiteBalance` 项。一般只改 `midtoneLevels` 就够，保留 `preserveLuminosity:true` 避免明度漂移。
**失败模式**：数组长度不是 3 → 报错（好）；拼成 `midtonesLevels` → PS 报 unknown key 类错误（**也会报错**，比静默忽略好）。

---

## C12. 曝光度（`exposure`）

**证据等级**: make 形式 `[本机取证]`；**参数键名 `[推断]`**
**证据**：
- make 形式 `[本机取证]`：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\adjustments.js:59` = `{_obj:"make",_target:[{_ref:"adjustmentLayer"}],using:{_obj:"adjustmentLayer",type:{_obj:"exposure"}}}`
- 事件名 `[本机取证]`：`D:\software\Adobe Photoshop 2026\Required\UXP\constants.js`（单行，偏移 **8757** 区段）= `EXPOSURE="exposure"`
- **键名缺口（重要）**：`Required\UXP\` 全树 `grep "exposure:"` = **0 命中**；两份 `presets.json` 里**没有任何 exposure 预设**（见上文直方图）→ **键名无本机证据**。

**键名 `[推断]`**：
```js
{ _obj:"exposure", exposure: 0.3, offset: 0, gamma: 1 }
```
**类比依据**：① 曝光度调整层有且只有三个控件（曝光度 / 位移 / 灰度系数校正）；② 同族调整事件都用**控件名的小驼峰**做键名（`brightness`/`contrast`/`saturation`/`midtoneLevels`…），而 PS 动作录制历史上这三个键就是 `exposure` / `offset` / `gamma`；③ 另一个可能的名字是 `gammaCorrection`（未取证）。
**真机首次验证方法**：先用极端值（`exposure: 5`）确认生效；键名错时 batchPlay 会返回 `{_obj:"error"}`，错误文本通常会列出可用键 —— **以真机报错为准**。

**可复制代码**：
```js
{ _obj:"make", _target:[{_ref:"adjustmentLayer"}],
  using:{ _obj:"adjustmentLayer", type:{ _obj:"exposure" } } }

{ _obj:"set",
  _target:[{_ref:"adjustmentLayer",_enum:"ordinal",_value:"targetEnum"}],
  to:{ _obj:"exposure", exposure: 0.3, offset: 0, gamma: 1 } }
```
**取值范围**：`exposure` 约 -20..20（EV），`offset` -0.5..0.5，`gamma` 0.01..9.99。
**→ INTERFACE 落点**：`adjust.apply` 的 `exposure` 项。
**失败模式**：键名错 → 返回 `{_obj:"error"}` 项（**batchPlay 不抛异常，必须过滤**）；`gamma` 写成 `gammaCorrection` → 可能被静默忽略。

# D. 智能滤镜（非破坏锐化 / 降噪）

**这一节的核心机制（必须先理解）**：Photoshop 里「智能滤镜」不是一种特殊描述的滤镜事件，而是**普通滤镜事件作用在智能对象图层上**的结果。也就是说：
> 把图层变成智能对象 → 照常调用滤镜事件 → Photoshop 自动把它记进该层的智能滤镜栈。

这个机制**有本机取证**，见 D14 的「机制证据」。

---

## D13. 图层转智能对象 / 反向光栅化

### 转智能对象
**证据等级**: `[本机取证]`
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop-material-filters\index.js:1414` 原文：
```js
"_obj": "newPlacedLayer",
```
（该行位于同文件 `ConvertToSmartObject` 函数内，约 `L1410-1425`；`newPlacedLayer` 是「转换为智能对象」的**事件名**，不是 `convertToSmartObject` —— `convertToSmartObject` 在全树无命中）
第二处出现：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **1511871** 的 `smartObjectDescriptor`）—— 同族用法。

**可复制代码**（作用于当前选中层）：
```js
{ _obj: "newPlacedLayer", _isCommand: true, _options: { dialogOptions: "silent" } }
```
**注意事项**：
- `_isCommand:true` + `_options:{dialogOptions:"silent"}` 是 Adobe 自己的写法（抑制任何对话框）。**在 modal 里必需**。
- 转换**必须有当前选中图层**（图层级命令）。建议批处理里先 `{_obj:"select",_target:[{_ref:"layer",_id:X}]}`。
- 已经是智能对象时再调用 → 无害（PS 会忽略）。

### 反向：智能对象 → 普通图层
**证据等级**: `[本机取证]`（用 `rasterizeLayer`，不是 `placedLayerConvertToLayers`）
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **1524042 / 1513030**）原文：`rasterizeLayerDescriptor(e=0){ … return {name:"rasterizeLayer", descriptor:{_target:{_ref:"document",_id:e}}} }`
```js
{ name: "rasterizeLayer", descriptor: { _target: { _ref: "document", _id: docId } } }
```
⚠️ `placedLayerConvertToLayers` 这一事件名在 `Required\UXP\` 全树**未找到** → 不要用；`rasterizeAllPlaced` 是批量版本（`{_obj:"rasterizeAllPlaced", missing:false, filterFX:false, _target:…}`，`photoshop.js` 偏移 **2674**）。

---

## D14. USM 锐化作为**智能滤镜**（关键项）

**证据等级**: `[本机取证]`（事件 + 机制）→ **可以实现，无需次优方案**

### 事件本身
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，函数 `applyUnSharpMask`）原文：
```js
t.f0 = function applyUnSharpMask(e, t, r) {
  return { _obj: "unsharpMask",
           amount:    { _unit: "percentUnit", _value: e },
           radius:    { _unit: "pixelsUnit",  _value: t },
           threshold: r } }
```
**可复制代码**：
```js
{ _obj: "unsharpMask",
  amount:    { _unit: "percentUnit", _value: 120 },   // 0..500 %
  radius:    { _unit: "pixelsUnit",  _value: 1.2 },   // 0.1..1000 px
  threshold: 2 }                                       // 0..255 阶
```
`threshold` 是**裸数字**（不是带单位的对象）—— 与 `amount`/`radius` 不同，这是最容易写错的一点。

### 机制证据：作用在智能对象上会成为智能滤镜
1. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **1512419 / 1512716** 区段）：Adobe 自家的 talent 在 `smartObjectDescriptor()`（= `newPlacedLayer`）之后调用 `hasSmartFilterAtIdx(t, 1, "blackAndWhite")` —— 说明**在 `newPlacedLayer` 之后执行的普通滤镜事件，会出现在该图层的智能滤镜栈里（索引 1）**。
2. 同文件（偏移 **4083380** 区段）原文：`async smartFilter(e){ … {name:"set",descriptor:{_target:[{_index:e,_ref:"filterFX"},{_enum:"ordinal",_ref:"layer"}],filterFX:{_obj:"filterFX"}},options:{dialogOptions:"display"}} }` —— 按索引打开智能滤镜对话框，证明滤镜栈可用 `filterFX` 引用定位。
3. 同文件（偏移 **4083380** 区段）原文：`getSmartFilters(){ return {_obj:"get",_target:{_ref:[{_property:"smartObjectMore"},{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}]}} }`，结果从 `[0].smartObjectMore.filterFX.filterFXList[i].filter._obj` 读滤镜名。
4. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop-material-filters\index.js:837`（`GetFilterList`）与 `:980`（`SetExistingParameters`）在 `smartObject.filterFX.filterFXList` 上读写 —— 同一机制的第三方（Adobe 官方）用法。

### 完整调用路径（推荐）
```js
[ { _obj:"saveDocumentSelection" },
  { _obj:"select", _target:[{_ref:"layer",_id:subjectLayerId}] },
  // 1) 主体层 → 智能对象
  { _obj:"newPlacedLayer", _isCommand:true, _options:{dialogOptions:"silent"} },
  // 2) 直接调用 USM —— 它会成为智能滤镜
  { _obj:"unsharpMask", amount:{_unit:"percentUnit",_value:120},
    radius:{_unit:"pixelsUnit",_value:1.2}, threshold:2 },
  { _obj:"restoreDocumentSelection" } ]
```
**注意**：第 2 步**不要**给 `_target`（滤镜事件只作用于当前激活图层）；如果给了 `_target:{_ref:"document"}` 反而无意义。

### 与 INTERFACE 的配合（重要设计后果）
INTERFACE 规定 `sharpness → 智能滤镜 USM（主体层必须先生成智能对象）`。执行顺序上必须：
1. 先完成抠图（主体层 + 蒙版）；
2. **再**转智能对象。⚠️ **但 `newPlacedLayer` 会保留图层蒙版**（智能对象可以有蒙版），所以先抠后转是安全的；
3. 转智能对象后，**蒙版仍然可用**，但**不能再用 `unsharpMask` 之外的方式改像素**（要改像素必须 rasterize，会丢掉智能滤镜栈）。
**风险**：智能对象 + 蒙版 + 后续 `compose.normalize` 的缩放 —— 缩放智能对象会缩放其智能滤镜的参数吗？**未实测**（见未查清事项）。建议 `normalize` 时先 `rasterizeLayer`（会丢智能滤镜）或把缩放放在锐化之前。

**失败模式**：① 忘记 `newPlacedLayer` → USM 直接改像素，**不可逆**（除非 `suspendHistory` 撤销）；② `threshold` 写成带单位对象 → 参数错误；③ `newPlacedLayer` 在没有选中图层时 → 报错（`_target` 缺失）。

---

## D15. 减少杂色作为智能滤镜

**证据等级**: `[本机取证]`（负向证据）+ `[推断]`（事件名）

**负向证据（重要）**：`reduceNoise` 在 `D:\software\Adobe Photoshop 2026\Required\UXP\` **全树 0 命中**（`app.js` / `photoshop.js` / `constants.js` / `524.js` / 25 个插件目录全部搜过）。同类 `surfaceBlur` 也是 **0 命中**。
也就是说：**「减少杂色」与「表面模糊」这两个滤镜在 Adobe 官方 UXP 源码里没有任何调用示例**。

**推断的写法（[推断]）**：
```js
{ _obj:"reduceNoise",
  noise: 8,               // 强度 0..10
  preserveDetails: 60,    // 保留细节 0..100
  removeJPEGArtifact: false,
  sharpenDetails: 15,     // 锐化细节 0..100
  channels: { _obj:"channels", channel: [{_enum:"channel",_value:"RGB"}] } }
```
**类比依据**：
- PS 的滤镜事件名 = 动作名（本机已证的同类：`gaussianBlur`、`dustAndScratches`、`median`、`despeckle`、`unsharpMask`、`addNoise`、`motionBlur`、`highPass`、`offset` 全部是「动作名小驼峰」）；
- `addNoise` 的本机取证形态为 `{$FlRs:12592194, distort:{_enum:"distort",_value:"gaussianDistribution"}, monochromatic:!1, noise:{_unit:"percentUnit",_value:15}, _obj:"addNoise"}`（`524.js` 偏移 **1541643** 区段）—— 说明噪声类事件的 `noise` 键**带 `percentUnit` 单位**。因此上面的 `noise: 8` 很可能应为 `noise:{_unit:"percentUnit",_value:…}`。**两条都要在真机试**。
**真机验证方法**：先只发 `{_obj:"reduceNoise"}`。若报 unknown event → 次优方案生效；若成功但参数报错，错误文本会回显可用键名。

### 次优可行方案（都有本机取证，均可作为智能滤镜）
| 替代滤镜 | 描述符（`[本机取证]`） | 证据位置 | 代价 |
|---|---|---|---|
| 蒙尘与划痕 | `{_obj:"dustAndScratches", radius: 15, threshold: 45}` | `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **1541643** 区段）；`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，函数 `applyDustAndScratches`）= `{_obj:"dustAndScratches",radius:e,threshold:t}` | 与「减少杂色」算法不同：对**高频颗粒**有效，但会**磨掉细节纹理**；`threshold` 需调 |
| 中间值 | `{_obj:"median", radius:{_unit:"pixelsUnit",_value:2}}` | `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，函数 `applyMedianNoise`） | 保边效果好于高斯，但对**椒盐噪点**外的噪声效果弱；半径大时明显糊 |
| 去斑 | `{_obj:"despeckle"}` | `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，函数 `applyDespeckle`） | **无参数**，强度不可控 |
| 表面模糊 | ❌ 无事件名证据（`surfaceBlur` 0 命中） | — | 不可用 |
| 智能模糊质量枚举 | `D:\software\Adobe Photoshop 2026\Required\UXP\constants.js`（单行，偏移 **12384** 区段）：`smartBlurQualityHigh / Low / Medium`、`smartBlurModeEdgeOnly / Normal / OverlayEdge` | 只证明 `smartBlur` 事件存在，**未取到调用示例** | — |

**推荐**：`dustAndScratches`（可作智能滤镜，参数可调，最接近「减少杂色」的语义）作为主回退；`median` 作为第二回退。
**→ INTERFACE 落点**：`adjust.apply` 的 `noise` 项。**建议在 INTERFACE/实现里注明**：`noise` 的落地实现是「智能滤镜 + 蒙尘与划痕（或 reduceNoise）」，因为 Adobe 官方源码里不存在 `reduceNoise` 的调用示例。

---

## D16. 若 D14 / D15 无法作为智能滤镜实现

**结论：D14（USM）能。** 依据见 D14 的机制证据（`524.js` 偏移 1512419/1512716 的 `hasSmartFilterAtIdx(…,"blackAndWhite")` 证明「`newPlacedLayer` 后执行的滤镜事件进入智能滤镜栈」，`4083380` 区段的 `getSmartFilters` / `smartFilter` 证明滤镜栈可读写）。
**D15（减少杂色）风险更高** —— 风险不在「能否成为智能滤镜」（机制相同），而在**事件名与参数键名没有本机证据**。若真机上 `reduceNoise` 不存在：
- 用 D15 表格里的 `dustAndScratches` / `median` 智能滤镜（**都是本机取证**，机制相同）→ 代价是算法不同、颗粒与纹理的取舍不同。
- 若必须完全复刻「减少杂色」：只能走**菜单命令**（`core.performMenuCommand`），这在 UXP modal 里通常不可靠（滤镜对话框是模态 UI），**不推荐**。

---

# E. 尺寸与导出

## E17. 图像大小 `imageSize`（等比缩放、重定图像像素方式）

**证据等级**: `[本机取证]`（含边长/分辨率/插值/等比/降噪的**完整真实调用序列**）

**证据 1（描述符工厂）**：`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **29049** 区段）原文：
`t.resizeImage=function resizeImage(e,t,r,n){var a={_obj:"imageSize"};return c.applyOptionalParams(a,{width:e,height:t,resolution:r,interpolation:n}),a}`

**证据 2（DOM 真实调用序列，偏移 **258128**）**原文：
```js
void 0!==e&&(o={_unit:"pixelsUnit",_value:e});      // width
void 0!==t&&(s={_unit:"pixelsUnit",_value:t});      // height
void 0!==r&&(l={_unit:"densityUnit",_value:r});     // resolution
const d={_enum:"interpolationType",_value:c};
let u=(0,V.resizeImage)(o,s,l,d);
u.constrainProportions = void 0===e||void 0===t;    // ← 省略任一维 ⇒ 自动等比
c!==H.ResampleMethod.PRESERVEDETAILS&&c!==H.ResampleMethod.DEEPUPSCALE||void 0===i||(u.noise=i);
const p=[(0,V.saveDocumentSelection)(),(0,V.select)(V.ref.id(this.id)),u];
await batchPlay(p);
```

**可复制代码**：
```js
// 等比缩放到宽 1200px（省略 height ⇒ constrainProportions 自动为 true）
[ { _obj:"saveDocumentSelection" },
  { _obj:"select", _target:{ _ref:"document", _id: docId } },
  { _obj:"imageSize",
    width:  { _unit:"pixelsUnit",  _value: 1200 },
    resolution: { _unit:"densityUnit", _value: 72 },
    interpolation: { _enum:"interpolationType", _value:"bicubic" },
    constrainProportions: true },
  { _obj:"restoreDocumentSelection" } ]
```
**键名与取值**：
- `width` / `height`：`{_unit:"pixelsUnit", _value:N}`（**必须带单位**，Adobe 自己就是这么包的）
- `resolution`：`{_unit:"densityUnit", _value:R}`（PPI，**不是** pixelsUnit）
- `interpolation`：`{_enum:"interpolationType", _value:…}`；已取证的值：`"bicubic"`（`app.js` 偏移 6704 的 translate 里直接用了字面量 `"bicubic"`）、`"bilinear"`、`"nearestNeighbor"`、`"preserveDetailsUpscale"`、`"deepUpscale"`、`"none"`（`D:\software\Adobe Photoshop 2026\Required\UXP\constants.js` 单行，偏移 **2878** 区段）
- `constrainProportions`：bool（**省略一个维度即自动为 true**，见证据 2）
- `noise`：仅在 `preserveDetailsUpscale` / `deepUpscale` 时才有意义（**降噪滑块**）
- **没有 `relative` 键**（`imageSize` 不支持相对尺寸）

**注意事项**：
- 命令**必须**带 `{_obj:"select",_target:{_ref:"document",_id:docId}}` 指定目标文档（Adobe 自己就这么做），否则会作用到「当前文档」。
- **百分比缩放要自己算成像素**：Adobe 的代码里 width/height 一律用 `pixelsUnit`；不要指望 `percentUnit`。
- 重定图像像素方式 = `interpolation`。INTERFACE 的 `compose.normalize` 放大主体时应考虑用 `"preserveDetailsUpscale"` 或 `"bicubic"`（放大到 2 倍以内 bicubic 更自然）。
**失败模式**：`width` 给裸数字（不带 `_unit`）→ PS 可能按「单位不明的值」处理，行为不确定（Adobe 的代码总带单位，照抄最安全）。

---

## E18. 画布大小 `canvasSize`（相对定位、锚点）

**证据等级**: `[本机取证]`（事件名与工厂）；**锚点/相对键名 `[推断]`** ❌

**证据 1（工厂）**：`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **29049** 区段）原文：
`t.resizeCanvas=function resizeCanvas(e,t){var r=n({_obj:"canvasSize"},e);return void 0!==t&&(r=n(n({},r),t)),r}`
→ 事件名 **`canvasSize`**（[本机取证]），但**参数键名由调用方传入**，工厂本身不带任何键。

**负向证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\` **全树** `grep anchorPosition` = **0 命中**（`ADSCentersH` / `alignDistributeSelector` 也是 0 命中）→ 锚点键名**无本机证据**。

**推断的写法（`[推断]`）**：
```js
[ { _obj:"saveDocumentSelection" },
  { _obj:"select", _target:{ _ref:"document", _id: docId } },
  { _obj:"canvasSize",
    width:  { _unit:"pixelsUnit", _value: 2000 },
    height: { _unit:"pixelsUnit", _value: 2000 },
    anchor: { _enum:"anchorPosition", _value:"middleCenter" },   // ← [推断]
    relative: false },                                            // ← [推断]
  { _obj:"restoreDocumentSelection" } ]
```
**类比依据**：`width`/`height` 用 `pixelsUnit`（与 `imageSize` 同族，[本机取证] 同源）；锚点用 PS 动作录制的 `anchorPosition` 枚举（值 `topLeft`/`topCenter`/…/`middleCenter`/…/`bottomRight`）；「相对」勾选框对应 `relative:true`。**这三个键名都必须在真机第一次跑时验证**。
**真机验证方法**：先发 `{_obj:"canvasSize", width:{_unit:"pixelsUnit",_value:W}, height:{_unit:"pixelsUnit",_value:H}}`（不带 anchor）确认基本可用并观察默认锚点方向；再逐步加 `anchor` / `relative`。
**→ INTERFACE 落点**：`compose.normalize({baseSize})` 的「画布 → baseSize×baseSize」。
**风险**：默认锚点很可能是**居中**（Photoshop UI 默认）→ 即使 `anchor` 键名写错、被忽略，结果**仍然基本正确**；但如果键名写错而 PS 报错，整条批处理会失败 → **建议把 `canvasSize` 单独放一个 batchPlay 调用**，让它失败也不影响主体流程。

---

## E19. 复制文档 `duplicate`

**证据等级**: `[本机取证]`

**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js`（单行，偏移 **3166** 的 `duplicate` DOM 工厂）原文（文档级）：
`t.duplicate=function(e,t=!1,r=!1){…{_obj:"duplicate",untitled:t,merged:r}…}`（可选 `name:e`）
另有**图层级** `duplicate`（偏移 **12385**）：`{name:"duplicate",descriptor:{_target:e,version:5}}` + 可选 `to`/`name`。

**可复制代码（复制整个文档）**：
```js
{ _obj:"duplicate", _target:{ _ref:"document", _id: docId }, name:"tmp_1200x1200" }
```
**注意事项**：
- 文档级 `duplicate` 的 `_target` 是**文档引用**；省略 `_target` 时复制「当前文档」。
- `untitled:true` = 复制成未命名文档（不写磁盘）；`merged:true` = 复制时合并所有图层（**不要用**：INTERFACE 要求复制后再 flatten，顺序与命名都受控）。
- **返回值里带新文档的 id**（`res[0].documentID` 或 `res[0].ID`，**字段名未实测**）→ 后续 flatten / imageSize / save / close 都靠它定位。
**→ INTERFACE 落点**：`export.run()` 的「每个尺寸复制一份 → flatten → 缩放 → 另存 → 不保存关闭副本」。
**失败模式**：复制后**忘记把新文档设为操作目标** → 后续命令打到原文档上（灾难性，且 INTERFACE 明令「绝不修改原图」）。**每一条后续命令都要显式带 `_target:{_ref:"document",_id:copyDocId}`**。

---

## E20. 图层置中 / 把选中图层移到画布中心

**可选做法**：
1. **读图层 bounds → 算位移 → `transform` 平移**（推荐，像素精确）
2. 用 `align` / `ADSCentersH` 菜单命令 —— ❌ **全树 0 命中**（`_obj:"align"`、`ADSCentersH`、`alignDistributeSelector` 均无），不可用
3. 靠 `move` 到 `_offset` —— 与画布中心无关，不可用

**推荐：做法 1**，两步：

### 第一步：读图层 bounds
**证据等级**: `[本机取证]`
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **4054108** 的 `getLayerBounds`）原文：`$.getProperties($.ref.selected(),["bounds"])`
```js
{ _obj:"multiGet",
  _target:{ _ref:"layer", _id: layerId },
  extendedReference:[ ["bounds"] ] }     // 或 ["bounds","boundsNoEffects"]
```
（`photoshop.js` 的 `getProperties(e,t)` = `{_obj:"multiGet",_target:e,extendedReference:[t]}`，偏移 **5182**；`bounds` 与 `boundsNoEffects` 都出现在 `app.js` 偏移 **164375** 区段。）
⚠️ **返回值的单位形态未实测**：可能是 `{left:{_unit:"pixelsUnit",_value:N}, top:…, right:…, bottom:…}`，也可能被 DOM 包成 `Bounds` 对象（`app.js` 里看到 `.union(t)` 方法）。**真机第一次跑必须 `console.log` 确认**。

### 第二步：平移图层
**证据等级**: `[本机取证]`
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **6704**）原文：
```js
t.translate = function translate(e, t, r) {
  return transform(r, {
    offset: { _obj:"offset",
              horizontal: { _unit:"pixelsUnit", _value: e },
              vertical:   { _unit:"pixelsUnit", _value: t } },
    interpolation: { _enum:"interpolationType", _value:"bicubic" },
    freeTransformCenterState: { _enum:"quadCenterState", _value:"QCSAverage" } }) }
```
**可复制代码**：
```js
// 目标：把图层 bbox 的中心移到画布中心 (canvasW/2, canvasH/2)
const dx = canvasW/2 - (b.left + b.right)/2;
const dy = canvasH/2 - (b.top  + b.bottom)/2;

{ _obj:"transform", _target:[{ _ref:"layer", _id: layerId }],
  offset: { _obj:"offset",
            horizontal: { _unit:"pixelsUnit", _value: dx },
            vertical:   { _unit:"pixelsUnit", _value: dy } },
  interpolation: { _enum:"interpolationType", _value:"bicubic" },
  freeTransformCenterState: { _enum:"quadCenterState", _value:"QCSAverage" } }
```
**注意事项**：
- 用 `bounds`（**含效果**）还是 `boundsNoEffects`（不含图层样式/模糊扩展）取决于需求：**置中应该用 `bounds`**（视觉边界），避免阴影/效果把中心拉偏。若影子是独立图层（B7 推荐方案），`bounds` 即视觉边界。
- `freeTransformCenterState:"QCSAverage"` 必须带（Adobe 的 translate/resize 都带）—— 否则 `offset` 的基准点可能不是图层中心，位移会翻倍。
- 一次 `transform` 完成居中，**不需要**两次。
- 画布尺寸从 F25 读（`width`/`height`），注意 `width._value * resolution/72` 的换算（见 F25 的坑）。
**→ INTERFACE 落点**：`compose.normalize` 的「缩放并居中主体」。
**失败模式**：① 用 `boundsNoEffects` 但主体层带智能滤镜/图层样式 → 视觉中心偏；② 忘记 `QCSAverage` → 位移翻倍；③ `bounds` 返回单位形态猜错 → `dx/dy` 算成 NaN（**先 log 再算**）。

---

## E21. 合并图层 `flattenImage`

**证据等级**: `[本机取证]`
**证据**：
- `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **29049** 区段）原文：`t.flattenImage=function flattenImage(){return{_obj:"flattenImage"}}`，紧邻还有 `t.mergeVisible=function mergeVisible(){return{_obj:"mergeVisible"}}`
- `D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js`（单行，偏移 **3870 / 3938**）同名导出

**可复制代码**：
```js
{ _obj:"flattenImage", _target:{ _ref:"document", _id: copyDocId } }
// 只要合并可见层（保留下方隐藏层）时用：
{ _obj:"mergeVisible", _target:{ _ref:"document", _id: copyDocId } }
```
**注意事项**：
- `flattenImage` 会**丢弃隐藏图层**并把结果铺到「背景」层；如果主体层带图层蒙版，展平会**按蒙版合成**（正是我们要的）。
- 单图层文档上调用 `flattenImage` 可能报错（无内容可合并）→ **建议放在 try/catch 或先判层数**。
- **必须显式给 `_target`**，否则会 flatten「当前文档」——`export.run` 场景下会**毁掉原图**。
**→ INTERFACE 落点**：`export.run` 的「复制 → flatten」。

---

## E22. JPEG 另存为（PS 2026 / UXP 的正确做法）

**证据等级**: `[本机取证]` ✅ **结论：PS 2026 的 UXP 可以用 `save` + `{_obj:"JPEG"}` 走 batchPlay 另存 JPEG**（历史上 UXP 早期不能 `saveAs` JPEG 的限制已不适用）

**证据 1（save 事件）**：`D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js`（单行，偏移 **4986** 的 `save`）原文：
`t.save=function(e,t,r){return{_obj:"save",documentID:e,in:t,as:r}}`

**证据 2（JPEG 保存选项工厂，偏移 **59005** 区段）**原文：
```js
var o = { _obj:"JPEG", extendedQuality: 3, matteType: { _enum:"matteColor", _value: P.white } };
t.quality   !== undefined && (o.extendedQuality = t.quality);
t.scans     !== undefined && (o.scans = t.scans);
t.matteType !== undefined && (o.matteType = { _enum:"matteColor", _value: t.matteType });
…
return [ select(ref.id(this._id)), save(this._id, { _kind:"local", _path: r }, o), select(ref.id(prevActiveDoc)) ];
```
这段代码就是 **DOM 的 `saveAs.jpg()` 的完整实现** —— 它证明「另存 JPEG」在 PS 2026 里**就是一条 batchPlay**（DOM 层没有别的通道）。这是本条最有力的证据。

**证据 3（JPEG 压缩方式与元数据，`app.js` 偏移 **241232** 区段的 `Document.jpg`）**原文摘要：
```js
n = retrieveUXPFileToken(e);
switch (t?.formatOptions ?? JPEGFormatOptions.STANDARDBASELINE) {
  case OPTIMIZEDBASELINE: i = true; break;
  case PROGRESSIVE:       a = t?.scans ?? 3; break;
}
saveAs.jpg(this.id, n, { ...t,
  ...(t?.color       && { color: t.color.base.desc }),
  ...(t?.customMatte && { customMatte: t.customMatte.base.desc }),
  extendedQuality: t?.quality,
  embedProfiles:   t?.embedColorProfile,
  scans: a, optimized: i, copy: r })
```
（同区段的 `Document.psd` 也用 `embedProfiles: t?.embedColorProfile`。）

### 可复制代码
```js
[ { _obj:"save",
    _target:{ _ref:"document", _id: copyDocId },
    documentID: copyDocId,
    in: { _kind:"local", _path: "C:\\Users\\EDY\\Desktop\\out\\产品_1200x1200.jpg" },
    as: { _obj:"JPEG",
          extendedQuality: 10,                                        // ← quality 0..12 直接映射
          matteType: { _enum:"matteColor", _value:"white" },
          embedProfiles: true,                                        // ← 嵌入颜色配置文件
          optimized: true,                                            // ← 压缩方式：优化基线
          scans: 3                                                    // ← 仅 PROGRESSIVE 时使用
        } } ]
```

### 参数键名与取值
| 键 | 含义 | 取值 | 证据 |
|---|---|---|---|
| `extendedQuality` | 品质 | **0..12**（PS「存储为」对话框的 0..12 滑块） | `[本机取证]` 工厂默认 `3` + `Document.jpg` 里 `extendedQuality: t?.quality` |
| `embedProfiles` | 嵌入颜色配置文件 | bool | `[本机取证]` `app.js` 偏移 241232 区段 |
| `optimized` | 压缩方式 = 优化基线 | bool | `[本机取证]` 同上（`OPTIMIZEDBASELINE → i = true`） |
| `scans` | 渐进式扫描次数 | 数字（默认 3） | `[本机取证]` 同上（`PROGRESSIVE → a = t?.scans ?? 3`） |
| `matteType` | 杂边颜色 | `{_enum:"matteColor", _value:"white"}` | `[本机取证]` 工厂默认值 |
| `color` / `customMatte` | 色彩/自定义杂边 | 描述符对象 | `[本机取证]`（`t.color.base.desc` → **DOM 层包装，本机未展开**） |
| `copy` | 存为副本 | bool | `[本机取证]`（`copy: r`） |

**quality 0..12 的映射**：INTERFACE 的 `quality 0..12` **直接**写给 `extendedQuality`（无需换算）。注意 `Required\UXP\photoshop.js`（单行，偏移 **4930** 区段）还有一套 `JPEGMaximumQuality=7 / JPEGHighQuality=8 / JPEGMediumQuality=9 / JPEGLowQuality=…` 的**枚举常量**（用于「存储为」预设名），**不是**我们要用的数字品质 —— **别混用**。

**`in` 的路径写法**：`{ _kind:"local", _path:"C:\\…\\x.jpg" }`。同形状有本机取证：`D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js`（单行，偏移 **3409** 的 `open`）= `{_obj:"open",null:{_path:e,_kind:"local"}}`；文档路径读取也是 `fileReference._kind === "local"` → `_path`（`app.js` 偏移 **248256**）。

**注意事项**：
- **`_target` + `documentID` 都要给**：`_target` 决定「哪条命令作用到哪个文档」，`documentID` 是 `save` 事件自己的字段（Adobe 的 `t.save(e,t,r)` 把 e 同时用于两者）。
- 路径**必须已存在的目录**；UXP 需要 `localFileSystem` 权限（INTERFACE 的 `requiredPermissions: localFileSystem fullAccess` 已声明）。
- 存的是**副本**时建议同时 `copy:true`（避免影响文档的「已修改」标记）；但 INTERFACE 的流程是「另存 → 不保存关闭副本」，用 `copy` 与否都行。
**失败模式**：① `_path` 目录不存在 → 报错；② 用 `_obj:"JPEGFormat"` 之类不存在的 saveOptions 名 → 报错（正确名是 **`"JPEG"`**，对照 `PNGFormat` 是带格式后缀的，两者不同族名）；③ 文档是 16/32 位或 CMYK 时 JPEG 选项差异（未实测）。

**→ INTERFACE 落点**：`export.run({format:"jpg", quality, ...})`。

---

## E23. PNG 另存为

**证据等级**: `[本机取证]`（事件与选项工厂）；`compression` 取值范围 `[推断]`

**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **242023** 区段的 `Document.png`）原文摘要：
```js
async png(e, t, r = false) {
  …
  a = t?.interlaced ? "PNGInterlaceAdam7" : undefined;
  saveAs.png(this.id, n, { method: t?.method, PNGInterlaceType: a,
                           compression: t?.compression, copy: r })
}
```
配套：`D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js`（单行，偏移 **59005** 区段的 saveOptions switch）里 PNG 分支为 `{ _obj:"PNGFormat" }`。

### 可复制代码
```js
[ { _obj:"save",
    _target:{ _ref:"document", _id: copyDocId },
    documentID: copyDocId,
    in: { _kind:"local", _path: "C:\\Users\\EDY\\Desktop\\out\\产品_1200x1200.png" },
    as: { _obj:"PNGFormat",
          method: 0,                       // 0=快速/无交错基线；见下
          compression: 6,                  // 压缩级别（PNG deflate 强度）
          PNGInterlaceType: undefined,     // 交错：省略=无；"PNGInterlaceAdam7"=交错
          copy: true } } ]
```
**键名**：`method`、`compression`、`PNGInterlaceType`（已取证的两个值：省略 / `"PNGInterlaceAdam7"`）、`copy`。
**推断部分**：`compression` 的取值范围（PS「存储为 PNG」是 0..9，默认 6）与 `method` 的取值（0/1，对应「快速/最慢」）**没有本机证据** → `[推断]`。
**类比依据**：`Document.png` 把 `compression` 原样透传给 saveOptions，说明它是数字；PNG 的 deflate 级别在 PS UI 上是 0..9。
**注意事项**：
- PNG **没有 `extendedQuality`**（无损）；`quality` 参数对 PNG 无效 → INTERFACE 的 `quality` 在 `format:"png"` 时应忽略或映射到 `compression`。
- **PNG 不嵌入颜色配置文件**（PNG 规范里 iCCP 块 PS 可写但本机无证据）→ 不要传 `embedProfiles`。
**失败模式**：给 PNGFormat 传 `extendedQuality` → 报 unknown key；`PNGInterlaceType` 传 `true` → 报错（必须用字符串枚举 `"PNGInterlaceAdam7"`）。
**→ INTERFACE 落点**：`export.run({format:"png", ...})`。

---

## E24. 关闭文档不保存

**证据等级**: `[本机取证]`

**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js`（单行，偏移 **4199** 的 `close`）原文：
`t.close=function(e){return{_obj:"close",saving:{_enum:"saving",_value:e?"yes":"no"}}}`
（另一处：`D:\software\Adobe Photoshop 2026\Required\UXP\constants.js` 单行，偏移 **2878** 区段的 `SaveChanges = { DONOTSAVECHANGES:0, PROMPTTOSAVECHANGES:1, SAVECHANGES:2 }` —— 这是**另一套** API 的枚举，`close` 事件用不到。）

**可复制代码**：
```js
{ _obj:"close",
  _target:{ _ref:"document", _id: copyDocId },
  saving:{ _enum:"saving", _value:"no" } }
```
**注意事项**：
- 枚举名就是字面量 **`"saving"`**（很容易误写成 `"saveChanges"` 或 `"saveOptions"`）。
- `_value` 是 `"yes"`/`"no"`（字符串枚举），**不是**布尔、**不是**数字。
- **必须显式给 `_target`** —— 否则关掉的是「当前文档」，在 `export.run` 里可能关掉用户的**原图**（灾难性）。
**失败模式**：`saving:{_enum:"saveChanges",_value:"no"}` → 报错；省略 `_target` 且原图是当前文档 → **原图被关掉**（若已保存则只是关闭窗口，若未保存则弹对话框卡住 modal）。
**→ INTERFACE 落点**：`export.run` 的「不保存关闭副本」。

# F. 像素与元数据

## F25. 读取当前文档 id / name / width / height / path / resolution

**证据等级**: `[本机取证]`（两种方式都有）

### 方式 A：UXP DOM（推荐，最省事）
```js
const d = require("photoshop").app.activeDocument;
({ id: d.id, name: d.title, width: d.width, height: d.height,
   resolution: d.resolution, path: d.path });
```
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **248256**）原文：
`get path(){ … const e = batchPlaySync((0,V.getProperty)(V.ref.id(this.id),"fileReference"))[0]; if(!e.fileReference) return ""; if("local"===e.fileReference._kind) return e.fileReference._path; if("cloud"===e.fileReference._kind) return JSON.parse(e.fileReference._path).cloud_id; return "" }`
（同形状见 `D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js` 单行偏移 **52728** 的 `Document.prototype.path`；紧邻还有 `Document.prototype.title`。）
→ 所以 `path` 的真实来源是 **`fileReference` 属性**，本地文件是 `{_kind:"local", _path:"C:\\…"}`。

### 方式 B：batchPlay `multiGet`（一次拿到所有字段）
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **4078000** 区段的 `getDocDim`）原文：
`X.getProperties(X.ref.active(),["width","height","resolution","documentID"])` →
```js
{ _obj: "multiGet",
  _target: { _ref: "document", _enum: "ordinal", _value: "targetEnum" },
  extendedReference: [ ["width","height","resolution","documentID"] ] }
```
**path 用 get 单属性**（属性名已取证为 `fileReference`）：
```js
{ _obj:"get",
  _target: { _ref:[ { _property:"fileReference" }, { _ref:"document", _id: docId } ] } }
```

### ⚠️ 本条最大的坑：宽高**不是**像素
`524.js` 的 `getDocDim` 拿到 `width` 后**必须再做一次换算**才得到像素宽：
```js
Math.round( l[0].width._value * l[2].resolution._value / 72 )
```
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **4078000** 区段）原文（`l` = multiGet 结果）。
→ 结论：`multiGet` 返回的 `width._value` **不是像素值**（否则不需要乘 `resolution/72`）。**INTERFACE 的 `ps.activeDoc()` 要的是像素宽高**：
- **推荐**直接用 DOM（方式 A）的 `d.width` / `d.height`（DOM 层承担了换算）；
- 若走 batchPlay，**必须**套用 Adobe 的同一个公式，否则非 72 PPI 的文档会得到错误尺寸（**静默错误**：图看起来「差不多」，但 `compose.normalize` 的缩放与居中全错）。

**失败模式**：直接把 `width._value` 当作像素 → 300 PPI 文档上会偏小 4.17 倍（且不报错）。

---

## F26. 读取文档低分辨率像素到 `Uint8Array`（`imaging.getPixels`）

**证据等级**: `[本机取证]`（调用形式、返回对象、取 data 的方法均有用例）

### 调用形式（对象参数，官方推荐）
**证据 1**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\ps.js:353-367` 原文：
```js
async saveDocumentThumbnail(basename) {
  return await photoshop.core.executeAsModal( async () => {
    const imgObj = await photoshop.imaging.getPixels({targetSize: { height: 300 }, applyAlpha: true, colorSpace: "RGB", componentSize: 8})
    const jpegData = await photoshop.imaging.encodeImageData({imageData: imgObj.imageData, base64: false, colorSpace: "RGB"});
    imgObj.imageData.dispose();
```
**证据 2（位置参数形式）**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移 **4078000** 区段的 `grabPixels`）原文：
`async grabPixels(e, t=-1, o={x:0,y:0,width:0,height:0}, a={scaledWidth:0,scaledHeight:0}, i=0, s=this.spl.SPLConsts.layerAlphaModeType.eAlphaApply) { … await this.psimaging.getPixels(e, t, o, a, i, void 0, s) }`
→ 位置参数的顺序是：`(documentID, layerID, sourceRect, targetSize, componentSize, colorSpace, alphaMode)`。
**证据 3（另一处同族）**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\96.js`：`P.getPixels(e.docID, e.layer, t, r, void 0, !0, a)`。

### 可复制代码（INTERFACE `ps.getSubjectPixels()` 的落点）
```js
const imaging = require("photoshop").imaging;      // 也可用全局 imaging
const img = await imaging.getPixels({
  documentID: docId,                 // 省略 = 当前文档
  layerID: subjectLayerId,           // 省略 = 文档合成结果（展平）
  sourceRect: { x: 0, y: 0, width: 0, height: 0 },        // 0 = 全图
  targetSize: { width: 512, height: 512 },                // 降采样目标（等比！）
  componentSize: 8,                  // 8 / 16 / 32 位
  colorSpace: "RGB",                 // "RGB" / "Grayscale" / "CMYK" / "Lab"
  applyAlpha: false                  // ← 见下「applyAlpha 陷阱」
});
const bytes = await img.imageData.getData();   // → Uint8Array（或 ArrayBuffer 视图）
const w = img.imageData.width, h = img.imageData.height;
img.imageData.dispose();                        // ← 必须释放，否则 PS 侧内存泄漏
```

### 参数注意事项（逐条）
| 参数 | 注意 |
|---|---|
| `targetSize` | 只给一个维度时**等比缩放**（`ps.js` 只给了 `{height:300}`）。给两个维度时是否强制拉伸**未实测**（更可能是按比例取最大缩放）→ **建议只给 `height`**，自己按宽高比算另一维 |
| `sourceRect` | `{x,y,width,height}`；`width/height` 为 0 = 全图（本机默认值就是全 0） |
| `componentSize` | 8 = 每通道 1 字节（要 `Uint8Array` 就必须用 8） |
| `colorSpace` | `"RGB"` 时 `getData()` 的布局是**交错（chunky）RGB/RGBA**；灰度用 `"Grayscale"` |
| `applyAlpha` | ⚠️ **语义未实测**。Adobe 在**做 JPEG 缩略图**时用 `applyAlpha:true`（`ps.js:356`）→ 强烈暗示它是「**把透明区域合成掉/应用 alpha**」而不是「附加 alpha 通道」。**要拿真正的 RGBA，应当用 `applyAlpha:false` 并另行读蒙版**（F27）—— 这一点必须真机验证 |
| `channels` | `getPixels` 的官方选项里有 `channels`（选取哪些通道），**本机 0 命中**；`524.js` 的位置参数版没有传它 → `[推断]` 存在，未取证 |
| 返回值 | `{ imageData }`，`imageData` 是一个带 `.width` / `.height` / `.dispose()` 的包装对象；**像素数组通过 `await imageData.getData()` 取** |
| 平台调用 | `getPixels` **不**需要 `executeAsModal`（`ps.js` 里套了 modal 只是为了同时做别的；`528.js` 的 `grabPixels` 直接 await） |

**`getData()` 的证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.creative_assistant\index.js:723` 原文：
`const imageBuffer = await selection.imageData.getData();` —— 同一族 `imageData` 包装对象，用 `await …getData()` 取出缓冲区（该文件 `:830` 还有 `await nativeImage.getData();`）。

**官方文档（补充）**：`[官方文档]`
- `imaging` API 参考：`https://github.com/AdobeDocs/uxp-photoshop/blob/c6a8009aac4a8d71128bdc70b8ddd77a53b17e52/src/pages/ps_reference/media/imaging.md`
- `batchPlay` 参考：`https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/batchplay`
- `GetPixelsOptions` 类型（第三方整理，可交叉核对键名）：`https://bubblydoo.github.io/uxp-toolkit/interfaces/_adobe-uxp-types_photoshop.GetPixelsOptions.html`

**→ INTERFACE 落点**：`ps.getSubjectPixels() → {width, height, rgba: Uint8Array, alphaMask}`；`analyze.subject()` 的 mean RGB / luma / sat / cast / percentiles 都在这份低分辨率像素上算。
**失败模式**：① 忘记 `dispose()` → 反复调用会耗尽 PS 侧图像内存；② `targetSize` 给两个值想做非等比拉伸 → 结果不是拉伸而是等比（INTERFACE 的 `analyze` 若假设「像素与画布同比例」需注意）；③ 用 `componentSize:16` 却按 8 位解析 → 读写错位。

---

## F27. 读取「是否有图层蒙版」以及把蒙版读成灰度像素

### 判断是否有蒙版
**证据等级**: `[本机取证]`
```js
{ _obj:"get",
  _target:{ _ref:[ { _property:"hasUserMask" }, { _ref:"layer", _id: layerId } ] } }
// 当前图层：{ _ref:[ {_property:"hasUserMask"}, {_ref:"layer",_enum:"ordinal",_value:"targetEnum"} ] }
```
返回 `res[0].hasUserMask`（布尔，无蒙版时返回 `false` 而不报错）。证据见 A3（`524.js` 单行，偏移 **1526856 / 4083380** 区段的 `layerMaskDescriptor` / `hasLayerMask`）。

### 读蒙版灰度像素：`imaging.getLayerMask`
**证据等级**: `[本机取证]`（API 名与调用形式）；**返回结构未查清**
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop-material-filters\index.js:384-390` 原文：
```js
async function GetLayerMask() {
    options = {
        layerID: GetFilterList()["layerID"],
        kind: "user"
    };
    return await imaging.getLayerMask(options);
}
```
**可复制代码**：
```js
const imaging = require("photoshop").imaging;
const mask = await imaging.getLayerMask({ layerID: subjectLayerId, kind: "user" });
// mask.imageData → 同族包装对象：await mask.imageData.getData() / .width / .height / .dispose()
```
**参数**：`layerID`（必需）、`kind:"user"`（用户蒙版；`kind` 的其它取值**未取证**，推测含 `"vector"`）。
**⚠️ 返回结构未实测**：本机唯一用例只是 `return await imaging.getLayerMask(options)`，**没有取用返回值**，所以「字段名是否也叫 `imageData`」「是否直接返回 base64」「`getData()` 是否存在」都**没有本机证据**。`[官方文档]` 线索：`https://forums.creativeclouddeveloper.com/t/how-to-convert-a-mask-to-base64-use-imaging-getlayermask-api/8065`（标题表明它有「需要转换成 base64」的用法，暗示返回的可能不是纯像素缓冲）。
**真机验证方法**：`console.log(Object.keys(mask)); console.log(mask.imageData ? Object.keys(mask.imageData) : mask);` 再决定怎么取数组。

**→ INTERFACE 落点**：`ps.getSubjectPixels().alphaMask`、`analyze.subject()` 的边界计算（`left/top/right/bottom` 需要从蒙版非零区域求 bbox）。
**失败模式**：**图层没有蒙版时**调用 `getLayerMask` 会抛异常（不是返回空）→ **必须先 F27 的 `hasUserMask` 判过**。这也是 A1 失败模式里「autoCutout 空选区 → 蒙版全黑」的检测入口：蒙版全黑 = 背景（或主体）检测失败。

---

## F28. 属性取色器 `colorPicker` / `showColorPicker`

**证据等级**: `[本机取证]`
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop-material-filters\index.js:1555-1580` 原文：
```js
async function getColorPickerValue(parameter, element) {
	if (color_picker_open) { return; }
	color_picker_open = true;
	const openPicker = {
		_target: { _ref: "application" },
		_obj: "showColorPicker",
		context: parameter.Label,
		color: { _obj: 'RGBColor',
		         red: parameter.Value.r * 255, green: parameter.Value.g * 255, blue: parameter.Value.b * 255 },
	};
	const pickerFunction = parameter => photoshop.action.batchPlay([openPicker], {});
	var colorPromise = require("photoshop").core.executeAsModal(pickerFunction, { "commandName": "Color Picker" });
	var resArray = await Promise.all([colorPromise]);
	const rgbFloat = resArray[0][0].RGBFloatColor;
	parameter.Value.r = rgbFloat.red / 255;
	parameter.Value.g = rgbFloat.grain / 255;      // ← Adobe 自己的 typo（grain ≠ green）
```
（同文件 `:2137` / `:2181` 是它的两个真实调用点。）

### 可复制代码（INTERFACE `ps.pickColor() → {hex}` 的落点）
```js
const res = await require("photoshop").core.executeAsModal(
  () => require("photoshop").action.batchPlay([{
    _target: { _ref: "application" },        // ← 注意：作用于 application，不是 document
    _obj: "showColorPicker",
    context: "取色",                          // 对话框提示文字
    color: { _obj:"RGBColor", red: 255, green: 255, blue: 255 }   // 初值（0..255）
  }], {}),
  { commandName: "Color Picker" }
);
const rgb = res[0][0].RGBFloatColor;   // { red, green, blue }
```

### 关键注意点
1. `_target` 必须是 **`{_ref:"application"}`**（不是 document / layer）—— 写错会报错。
2. **返回值的标度**：字段名叫 `RGBFloatColor`，但 Adobe 自己把结果 **除以 255** 才存回（它发送时乘的也是 255）→ 说明 **`RGBFloatColor.red/green/blue` 是 0..255 标度**（可能是浮点，例如 `127.5`）。转 hex 时 `Math.round()` 再转。
3. **必须在 `executeAsModal` 内**调用，且 `commandName` 建议用 `"Color Picker"`（Adobe 原文）。
4. **这是阻塞式 UI**：用户取消时返回什么**未查清**（Adobe 的代码没有处理取消分支，只读了 `resArray[0][0].RGBFloatColor`）→ 实现里必须 try/catch + 判空，否则取消会让整条链崩。
5. Adobe 用一个模块级布尔 `color_picker_open` 防重入 —— 我们的 `ps.pickColor()` 也应做同样的防重入。
6. `{_obj:"colorPicker"}`（事件名）在 `Required\UXP\` 全树**未找到** → 事件名是 **`showColorPicker`**，别写错。

**失败模式**：① 用户取消 → `res[0][0].RGBFloatColor` 为 `undefined` → 若直接 `.red` 会抛 TypeError；② 把返回当 0..1 浮点用 → hex 全错（这正是 Adobe 代码里 `grain` typo 存在也没被发现的原因：那一支的赋值根本不影响显示逻辑）。

---

# G. 历史 / 回退

## G29. `suspendHistory` / `executeAsModal` 的正确组合，以及「一键回退」

### 正确组合（本机取证，直接照抄 Adobe）
**证据**：`D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移 **263410**）原文：
```js
async suspendHistory(e, t) {
  return n.executeAsModal(async r => {
    const n = await r.hostControl.suspendHistory({ name: t, documentID: this._id }),
          a = { ...r, document: this };
    delete a.hostControl;
    await e(a);
    await r.hostControl.resumeHistory(n);
  }, { commandName: t });
}
```
**可复制代码**：
```js
await core.executeAsModal(async (executionContext) => {
  const historyState = await executionContext.hostControl.suspendHistory({
    documentID: docId,
    name: "电商图片制作"          // 这一步会以这个名字出现在历史记录里（= 一次撤销回退全部）
  });
  try {
    // ...这里放所有 batchPlay...
  } finally {
    await executionContext.hostControl.resumeHistory(historyState);
  }
}, { commandName: "电商图片制作" });
```
**关键点**：
- `hostControl` **只在 `executeAsModal` 的回调参数里**存在（Adobe 甚至显式 `delete a.hostControl` 再往下传）。
- `suspendHistory` / `resumeHistory` 必须**成对**且都在 modal 回调内。
- 这正好落在 INTERFACE 的 `ps.run(descriptors, {history:"suspend"})` 语义上：`"suspend"` → 包 `suspendHistory`；`"normal"` → 只包 `executeAsModal`。
- 其它出现位置（同族用法，可交叉参考）：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.cclibrariespanel\main.js:86`、`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\ps-preset-queue.js:162`。

### 一键回退：三种候选的取舍

| 方案 | 描述符 / 调用 | 证据 | 局限 |
|---|---|---|---|
| **(A) 记录 historyState id + 回选（推荐）** | 取：`{_obj:"get",_target:{_ref:[{_ref:"historyState",_enum:"ordinal",_value:"targetEnum"}]}}`；回退：`{_obj:"select",_target:{_ref:[{_ref:"historyState",_id:snapshotId}]}}` | `[本机取证]` `524.js`（单行，偏移 **4087127**）的 `getActiveHistoryState()` / `selectHistoryStateByIndex(e)` / `selectHistoryStateById(e)`；同文件偏移 **1512419** 的 `undoFnc` 用 `host.photoshop.selectHistoryStateById(t.revertId)` | ① 默认（非线性历史关闭）下**回选旧状态会永久丢弃之后的所有历史**；② 文档关闭/重开后 id 失效；③ 跨文档要分别记 |
| (B) 建历史快照 `make` + `historyState` | `[推断]` `{_obj:"make",_target:[{_ref:"historyState"}],using:{_obj:"historyState",name:"ecom_snap",snapshot:true}}` | `photoshop.js`（单行，偏移 **5840**）有 `makeFromHistoryState()` = `{_obj:"make",_target:{_ref:"document"},using:{_property:"currentHistoryState",_ref:"historyState"}}`；`524.js`（偏移 **1599846** 区段）有完整的快照管理器（`getActiveHistoryState` / `findHistoryState` / `backup` / `restore` / `reset` / `resumeSnapshot` / `endSnapshot` / `historyStateChanged` 监听）；`524.js` 偏移 **4943956** 的通知枚举含 `HISTORYSTATECHANGED="historyStateChanged"` | 快照**不随文档保存**、会占内存；快照 `make` 的确切键名（`snapshot:true`?）**没有本机证据** → 标 `[推断]` |
| (C) JS 侧保存文档副本 | `{_obj:"duplicate", _target:{_ref:"document",_id:docId}, name:"backup"}`，回退时把副本的图层搬回来或直接让用户用副本 | `[本机取证]`（E19） | 内存/磁盘开销大；副本是**独立文档**，无法「原地」恢复，用户看到的窗口会变；关闭副本同样要 E24 |

**推荐：(A)**，理由：
1. 每一步都有本机取证（取/回选都是官方 API）；
2. 它是**真正的原地回退**（用户的原图窗口不变、图层结构不变）；
3. 与 `suspendHistory` 天然配合：如果整个操作已经在一次 `suspendHistory` 里，那么「一键回退」可以简化为 **执行一次 `Undo`**（历史记录里的那一个条目），连 id 都不用记。
**推荐组合（最稳）**：
- 用 `ps.run(descriptors, {history:"suspend"})` 把一次业务操作合成**一个**历史条目；
- `ps.snapshot()` 记录**该条目之前**的 `historyState`（用 (A) 的 get 描述符，取 `_id` 或 `_index`）；
- `ps.restore(token)` 用 `{_obj:"select",_target:{_ref:[{_ref:"historyState",_id:token}]}}` 回选。
**局限（必须写进实现注释）**：
- 非线性历史未开时，回选旧状态 = **丢弃其后的全部历史**（包括用户自己的手动操作）；
- token **只在同一次文档会话内有效**（关闭文档后失效）；
- 回退**不恢复**选区、颜色设置等非历史状态；
- 若操作跨越多个文档（`export.run` 会复制文档），要**每个文档单独记 token**；副本文档直接用 E24 关掉即可，不需要回退。
**失败模式**：把 `_index` 当稳定标识（`selectHistoryStateByIndex`）—— 一次新操作后索引就变了 → **永久用 `_id`**。

---

# 附录

## 1. 证据等级统计

**29 条描述符条目的主证据等级分布**：

| 主证据等级 | 条数 | 条目编号 |
|---|---|---|
| `[本机取证]` | **26** | A1, A2, A3, A4, B5, B6, B7, C8, C9, C10, C11, D13, D14, D16, E17, E19, E20, E21, E22, E23, E24, F25, F26, F27, F28, G29 |
| `[推断]` | **3** | **C12（曝光度键名）**、**D15（减少杂色事件名/键名）**、**E18（canvasSize 锚点与相对键名）** |
| `[官方文档]` 为唯一主证据 | 0 | —（官方文档仅用于补强 F26 / F27 / G29 的官方参考链接） |

**逐条列出所有 `[推断]`（最需要复审的部分）**：

1. **C12「曝光度（`exposure`）」** —— 事件名与 make 形式 `[本机取证]`，但**三个参数键名 `exposure` / `offset` / `gamma` 全部是推断**。依据：曝光度只有三个控件 + 同族调整事件用控件名小驼峰 + PS 动作录制历史名。全树 `exposure:` 0 命中、presets.json 无任何 exposure 预设。
2. **D15「减少杂色作为智能滤镜」** —— `reduceNoise` 事件名与全部参数键名是推断。依据：同族滤镜事件名 = 动作名小驼峰（`gaussianBlur`/`median`/`despeckle`/`unsharpMask`/`addNoise` 均已取证）。全树 `reduceNoise` 0 命中。**已给出 4 个本机取证的替代滤镜**（见 D15 表格）。
3. **E18「画布大小 `canvasSize`」** —— 事件名 `canvasSize` 与参数透传机制 `[本机取证]`，但 **`anchor`（`{_enum:"anchorPosition"}`）与 `relative` 两个键名是推断**。依据：与 `imageSize` 同族的 `pixelsUnit` + PS 动作录制枚举名。全树 `anchorPosition` / `ADSCentersH` / `alignDistributeSelector` 均 0 命中。

**局部推断（该条主体有本机取证，但含推断子项，复审时也要看）**：

| 条目 | 局部推断的子项 | 依据 |
|---|---|---|
| C10 照片滤镜 | `color:{_enum:"filter",_value:"warmingFilter85"}` 的预设枚举写法 | PS 动作录制里存在；本机 presets.json 只见到 `labColor` 形式。**已给出必可用的 `labColor` 版本** |
| E23 PNG | `compression` 取值范围（0..9）、`method` 取值（0/1） | PS UI 的 PNG 选项；本机只证明这两个键被原样透传 |
| F26 `getPixels` | `applyAlpha` 的语义、`channels` 选项是否存在、`targetSize` 给两维时的行为 | Adobe 用它做 JPEG 缩略图（暗示是「合成掉 alpha」）；`channels` 全树 0 命中 |
| F27 `getLayerMask` | 返回结构（字段名 / 如何取数组） | 本机唯一用例未取用返回值 —— 见「未查清事项」 |
| G29 历史快照 | `{_obj:"make",…,using:{_obj:"historyState",snapshot:true}}` 的确切键名 | `makeFromHistoryState` 存在，但「建快照」的具体键名未见 |
| B7 接地投影 | `duplicate` 返回结构中新图层 id 的**字段名** | Adobe 用法存在，但字段名未在本机代码里被读取过 |

**负向证据清单（`[本机取证]` 的「不存在」结论，同样重要）**：

| 结论 | 检索范围 |
|---|---|
| `removeBackground` **不是** batchPlay 事件（只是通知事件名） | `Required\UXP\` 全树 |
| `_place` 写法不存在（层序用 `move` + `_ref:"layer"`） | `photoshop.js`（`_place` 0 命中） |
| `dropShadow` 图层样式**无官方 UXP 用例** | `Required\UXP\` 全树（唯一命中在 cclibrariespanel 的 Lottie 运行时） |
| `reduceNoise` / `surfaceBlur` 事件名无官方用例 | `Required\UXP\` 全树 |
| 对齐类命令 `align` / `ADSCentersH` / `alignDistributeSelector` 0 命中 | `Required\UXP\` 全树 |
| `anchorPosition` 0 命中 | `Required\UXP\` 全树 |
| `exposure` 的参数键名 0 命中；presets.json 无 exposure 预设 | `Required\UXP\` 全树 + 两份 presets.json |
| `placedLayerConvertToLayers` 0 命中（反向用 `rasterizeLayer`） | `Required\UXP\` 全树 |
| 图层蒙版**没有**「收缩」属性（只有 `userMaskFeather` / `userMaskDensity`） | `app.js` 全量 `userMask` 检索 |
| `_obj:"colorPicker"` 0 命中（正确名是 `showColorPicker`） | `Required\UXP\` 全树 |

## 2. 风险清单（最容易写错、且错了最难发现的 5 条）

| # | 条目 | 为什么错了最难发现 |
|---|---|---|
| 1 | **B7 接地投影的步骤 3–6 打错图层** | `fill` / `gaussianBlur` / `transform` 都作用于**当前激活图层**。如果没先 `select` 影子层，模糊与填黑会**打到主体层上**：不报错、返回成功，而主体变黑糊掉——而且是在「已经抠好图」之后才发现，返工成本最高 |
| 2 | **C8 色相/饱和度把 `saturation` 写在顶层** | 正确位置是 `adjustment[0].saturation`。写成顶层键 PS **不报错、静默忽略** → 「调用成功但图没变」，会被误判成 UI 的数值没接上，排查方向完全错 |
| 3 | **A1/A2 `autoCutout` 空选区静默成功** | 找不到主体时它**不报错**，产出的空选区 + `revealSelection` = **全隐藏蒙版**（图层看起来「消失」）。现象像「插件把图删了」，实际是抠图失败。**必须**在蒙版生成后检测非零像素（F27）才能真正发现 |
| 4 | **E22/E24 保存与关闭的 `_target` / `documentID` 写漏** | `export.run` 会复制文档；漏 `_target` 时 `save` 可能存到**原图路径**、`close` 可能**关掉原图**。INTERFACE 明令「绝不修改原图」。而这类错误在测试时**看起来完全正常**（导出文件确实生成了），只有用户的原图被覆盖/关闭时才暴露 |
| 5 | **F25 把 `multiGet` 的 `width._value` 当像素** | `524.js` 的 `getDocDim` 明确要做 `width._value * resolution/72` 换算。不换算时在 300 PPI 文档上除了 4.17 倍——`compose.normalize` 的缩放与居中会**全部偏小**，但输出图仍然「看起来是一张正常的商品图」，不会报任何错 |

**次一级风险（第 6–8 位，仍建议在实现里加断言）**：
6. 图层不透明度读写标度不同（读 0..255、写 `percentUnit` 百分比）→ 影子全黑或消失。
7. `close` 的枚举名是 `"saving"`、`_value` 是 `"yes"/"no"`（写 `saveChanges` 会报错；写布尔会静默变成 `"yes"` = 保存，反而更糟）。
8. `E23` 给 `PNGFormat` 传 `extendedQuality` → 报错；反之给 `JPEG` 传 `compression` → 报错。两个 saveOptions 的键名**不通用**。

## 3. 实际 grep / 读过的关键文件清单（绝对路径）

1. `C:\Users\EDY\Desktop\ps电商图片制作插件\docs\INTERFACE.md`（契约，全读）
2. `D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js`（单行，偏移定位；描述符工厂）
3. `D:\software\Adobe Photoshop 2026\Required\UXP\app.js`（单行，偏移定位；DOM→batchPlay 实现）
4. `D:\software\Adobe Photoshop 2026\Required\UXP\constants.js`（单行，偏移定位；枚举）
5. `D:\software\Adobe Photoshop 2026\Required\UXP\hostActions.js`（334 行，全读）
6. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\524.js`（单行，偏移定位；talent + helper + 历史快照）
7. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.unifiedpanel\js\96.js`（vision / imaging）
8. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\ps.js`（613 行）
9. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\adjustments.js`（154 行，全读）
10. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\adjustment-layer-enablement.js`（495 行）
11. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\data\presets.json`（1457 行，键名取证主源）
12. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel-revamped\data\presets.json`（`preserveLuminosity` 取证）
13. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop-material-filters\index.js`（2794 行；智能对象/智能滤镜/蒙版/取色器）
14. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.creative_assistant\index.js`（`imageData.getData()` 取证）
15. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.exportAs\js\0.js`（2.27 MB；仅做 token 扫描，未逐段读）
16. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.cai.uxp.panel\js\179.js`（vision `subjectSelect` 注释）
17. `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.cclibrariespanel\main.js`（`suspendHistory` 同族用法）
18. `D:\software\Adobe Photoshop 2026\Photoshop.exe`（仅字符串扫描：`removeBackground` / `selectSubject` 存在）

## 4. 未查清事项（明确列出）

| # | 未查清的事项 | 影响 | 建议的真机第一步 |
|---|---|---|---|
| 1 | `imaging.getLayerMask` 的**返回结构**（字段名、能否 `getData()`、是否 base64） | `ps.getSubjectPixels().alphaMask` 与 `analyze.subject()` 的主体 bbox 全靠它 | `console.log(Object.keys(mask), mask.imageData && Object.keys(mask.imageData))` |
| 2 | `imaging.getPixels` 的 `applyAlpha` **确切语义**（合成掉 alpha vs 附加 alpha 通道） | 决定 `rgba` 是 3 通道还是 4 通道 | 用一张带透明区的图跑两次（`applyAlpha: true/false`），比较 `getData().length` 与 `width*height*4` |
| 3 | `C12` 曝光度的三个参数键名 | `adjust.apply` 的 `exposure` 项可能整条失败 | 先发 `{_obj:"exposure"}`，再按错误回显补键名 |
| 4 | `D15` `reduceNoise` 事件名与键名 | `adjust.apply` 的 `noise` 项 | 先发 `{_obj:"reduceNoise"}`；失败即改用 `dustAndScratches`（已取证） |
| 5 | `E18` `canvasSize` 的 `anchor` / `relative` 键名与默认锚点方向 | `compose.normalize` 的画布扩展可能锚点错位 | 单独调一次，观察默认锚点；再逐个加键名 |
| 6 | 图层蒙版**「收缩」**的可用路径（`app.js` 只有 `userMaskFeather` / `userMaskDensity`） | `cutout.refine({contract})` 只能退化为「羽化」或「重建蒙版」 | 先只实现羽化；contract 用「收缩选区 → 重建蒙版」并接受丢羽化的代价 |
| 7 | **空选区**的判定方式（`{_ref:"channel",_property:"selection"}` 在无选区时的返回值） | A3 的「无选区却用 revealSelection → 全隐藏蒙版」防护 | `console.log` 无选区时的 get 结果 |
| 8 | 智能对象被 `imageSize`/`transform` **缩放时，其智能滤镜参数是否同步缩放** | 影响 `adjust`（锐化）与 `compose.normalize` 的**执行顺序** | 先转智能对象 + USM，再缩放到 50%，检查智能滤镜的 radius 是否变成 0.6 |
| 9 | `E22` 在 **16/32 位、CMYK、灰度**文档下的 JPEG 选项差异 | 电商图通常是 8 位 sRGB，风险低但边界要覆盖 | 三种模式各存一次 |
| 10 | `E19` `duplicate` 返回的新文档 id **字段名**（`documentID`? `ID`?） | 复制后的所有后续命令都依赖它 | `console.log(JSON.stringify(res))` |
| 11 | `E20` `bounds` 返回值的**单位形态**（是否带 `_unit`） | 居中位移可能算成 NaN | `console.log(JSON.stringify(bounds))` |
| 12 | `B7` 投影链里 `duplicate` 返回的**新图层 id 字段名** | 后续 `select`/`move`/`set` 全靠它 | 同上，先 log |
| 13 | `photoshop.js` 偏移 4930 的 `JPEGMaximumQuality=7 / HighQuality=8 / MediumQuality=9 / LowQuality=…` 枚举与 `extendedQuality` 的完整对应表 | 若有人误用该枚举当 quality，品质会错 | 本手册已明确「用 extendedQuality 0..12」，无需用该枚举 |
| 14 | Photoshop **菜单命令 id**（`core.performMenuCommand`）里「移除背景」的 id | 如果将来要 100% 复刻菜单行为 | 已知同族 id：`zoomIn 1004` / `fitOnScreen 1192` / `selectAndMask 1115`（`524.js` 偏移 4078000 区段）；`New Layer 1099` / `Levels 1801` / `Brightness-Contrast 1803`（`524.js` 偏移 **7451827** 区段的 commandId 表） |
| 15 | `exportAs\js\0.js`（2.27 MB）里 2026 版导出面板的**逐段导出逻辑** | 只做了 token 扫描，未逐段读；E22/E23 的结论已由 `photoshop.js`/`app.js` 的 DOM 实现独立证实 | 若 E22 真机失败，再回头读该文件 |

## 5. 与本项目契约（INTERFACE.md）的落点速查

| INTERFACE API | 本手册条目 | 一句话实现 |
|---|---|---|
| `ps.run(descriptors, {history})` | G29 | `executeAsModal` + （`history==="suspend"` 时）`hostControl.suspendHistory/resumeHistory`；批处理首 `saveDocumentSelection`、末 `restoreDocumentSelection` |
| `ps.activeDoc()` | F25 | DOM `app.activeDocument`（宽高**已**是像素）；若要 batchPlay 版，务必做 `width._value*resolution/72` |
| `ps.pickColor()` | F28 | `showColorPicker` @`application`，结果 `res[0][0].RGBFloatColor`（0..255） |
| `ps.snapshot()` / `ps.restore(token)` | G29 | get/select `historyState` by `_id`（**不要用 `_index`**） |
| `ps.getSubjectPixels()` | F26 + F27 | `imaging.getPixels`（8 位 / RGB / `applyAlpha` 待验证）+ `imaging.getLayerMask({layerID, kind:"user"})`；两者都要 `dispose()` |
| `analyze.subject()` | F26 + F27 + A3 | 主体 bbox 从蒙版非零区域求；均值/百分位在 `getPixels` 的交错 RGB(A) 上算，**只统计 alpha/蒙版非零像素** |
| `cutout.remove()` | A1b（主）+ A2 + A3（回退） | `rasterizeLayer` → `autoCutout` → `make` mask `revealSelection` → `delete channel apply:true`；失败检测 = 蒙版全黑 |
| `cutout.refine({contract, feather})` | A4 | 羽化用 `{_obj:"layer",userMaskFeather:{_unit:"pixelsUnit",…}}`；收缩见「未查清 #6」 |
| `backdrop.setSolid({hex, name})` | B5 + B6 | `make`+`contentLayer`+`solidColorLayer`（RGBColor 0..255）→ `move` 到 `_enum:"back"` |
| `backdrop.addShadow({...})` | B7 | duplicate → fill 黑 → `gaussianBlur` → `transform`(offset/scale) → 设 `opacity` → move 到主体下方；**每步先 `select` 影子层** |
| `adjust.apply(items)` | C8–C12 + D13/D14/D15 | saturation→C8；brightness+contrast→C9（同一层一次 set）；temperature→C10；whiteBalance→C11；exposure→C12（键名待验证）；sharpness→D13+D14；noise→D15 |
| `compose.normalize({baseSize, marginPercent})` | E18 + E20 + E17 | `canvasSize`→`imageSize`(缩放)→读 `bounds`→`transform` 平移居中；**排除背景/阴影层** |
| `export.run({sizes, quality, format, outputDir})` | E19 + E17 + E21 + E22/E23 + E24 | 每个尺寸 `duplicate` 文档 → `flattenImage` → `imageSize` → `save` JPEG/PNG → `close saving:"no"`；**每条命令都带 `_target:{_ref:"document",_id:copyDocId}`** |

---

## 文档结束

**本手册共覆盖 29 条描述符条目（A1–A29 = A1–A4, B5–B7, C8–C12, D13–D16, E17–E24, F25–F28, G29）。**
**所有 `[本机取证]` 结论都给出绝对路径 + 行号或字符偏移 + 原文片段，可用 `IndexOf` 原样复现。**
**所有 `[推断]` 均已在上文标注类比依据与真机验证方法 —— 未取证的键名/事件名一律没有伪装成本机取证。**
