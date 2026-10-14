# 冻结接口契约（INTERFACE）· v3

> **本文件是唯一的跨模块契约。** Wave 2 的两位实现者必须严格遵守；任何偏离视为缺陷。
> **v2 修订依据**：`docs/RESEARCH-descriptors.md`（本机取证 26 条 / 推断 3 条）与 `docs/RESEARCH-host.md`（真机探针）。
> v2 推翻了 v1 的三处错误假设，见 §15 变更记录。修改契约只能由调度者执行。

---

## 0. 加载模型（不用 ESM / 不用 CommonJS 本地模块图）

UXP 本地模块解析行为在版本间有差异，而我们无法热重载迭代。因此：

- **所有源码文件都是普通脚本**：不用 `import`，不用 `module.exports`，不用 `require("./xxx.js")`。
- 用 `plugin/index.html` 里的多个 `<script src>` 按固定顺序加载。
- 每个文件把能力挂到**唯一全局命名空间** `window.Ecom`。
- `require("photoshop")` **只在 `plugin/src/ps.js` 里出现一次**，其余模块一律走 `window.Ecom.ps`。
- 每个文件只声明 `window.Ecom = window.Ecom || {};` 然后挂子对象。

### `plugin/index.html` 中 script 顺序（**冻结，不得调整**）

```html
<script src="./src/ps.js"></script>
<script src="./src/store.js"></script>
<script src="./src/analyze.js"></script>
<script src="./src/cutout.js"></script>
<script src="./src/backdrop.js"></script>
<script src="./src/adjust.js"></script>
<script src="./src/compose.js"></script>
<script src="./src/export.js"></script>
<script src="./src/ui.js"></script>
<script src="./index.js"></script>
```

### 0.1 描述符知识不在本文件

本文件只冻结**接口**。每个接口背后的 batchPlay 描述符，一律以 `docs/RESEARCH-descriptors.md` 的对应条目为准（该文件每条都带绝对路径+偏移/行号+原文或明确的 `[推断]` 标记）。**实现者必须先读该手册再写代码。**

---

## 1. 统一返回信封

```js
{ ok: true,  data: { /* 见各函数说明 */ } }
{ ok: false, error: "人类可读的中文错误描述（含宿主原文错误）" }
```

- **禁止抛出异常穿越模块边界**，用 `try/catch` 转成信封。
- `error` 必须包含宿主原文，不要只写「失败了」。

## 1.1 ★ batchPlay 不抛异常（v2 新增，最容易漏的一条）

`batchPlay` 对**失败的描述符**不抛异常，而是把该位置换成 `{ _obj: "error", message, number, ... }` 返回。
证据：`D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\js\adjustments.js:120-124`。

**因此 `ps.run` 必须逐项检查返回值**：任一元素满足 `item && item._obj === "error"` → 整个调用返回 `ok:false`，`error` 取自该项的 `message` / `toString()` / `number`。
**所有业务模块不得假设「没抛异常 = 成功」。** 需要逐项容错的场景（如 `adjust.apply`），用 `ps.runRaw` 自己遍历。

## 2. 统一日志

```js
Ecom.ps.setLogSink(fn)   // fn(level:"info"|"warn"|"error", text:string)
Ecom.ps.log(level, text) // 无 sink 时静默丢弃，禁止报错
```
`sink` 由 `ui.js` 在 `mount()` 时注册。

---

## 3. 状态对象（`state`）— 形状冻结

由 `store.js` 拥有。**其他模块不得修改 state，只读取传入的参数。**

```js
{
  version: 1,

  colors: [ { id:"c-white", name:"纯白", hex:"#FFFFFF" }, ... ],
  selectedColorId: "c-white",
  customHex: "#F5F5F5",              // 非 null 时优先于 selectedColorId

  sizes: [
    { id:"s-800",  w:800,  h:800,  label:"800×800",   enabled:true,  builtin:true },
    { id:"s-1254", w:1254, h:1254, label:"1254×1254", enabled:false, builtin:true },
    { id:"s-1600", w:1600, h:1600, label:"1600×1600", enabled:false, builtin:true }
  ],                                  // 用户新增项 builtin:false
  baseSizeId: null,                   // null = 自动取 enabled 中最大的尺寸
  marginPercent: 5,                   // 主体最大边占画布的比例基准（见 §10）
  compose: { center: true },          // ★ v3 新增：是否把主体摆到画布正中央（见 §10）

  // 边缘净化：★ 两项的作用时机不同，实现者必须分清（v2 修订）
  edge: { contract: 1, feather: 0.5 },   // px
  //   contract → 只在 cutout.remove() 内生效：对 autoCutout 产生的【选区】做收缩，
  //              然后才转成蒙版（全链本机取证）。单独跑 refine 时无法应用。
  //   feather  → 既在 cutout.remove() 内作用于选区，也可由 cutout.refine() 作用于【已有蒙版】。

  shadow: { enabled:false, opacity:30, blur:40, offsetY:12, color:"#000000" },

  adjust: {
    order: ["saturation","brightness","temperature","contrast","whiteBalance","exposure","sharpness","noise"],
    items: {
      saturation:  { enabled:true,  auto:true, min:-100, max:100, value:0 },
      brightness:  { enabled:true,  auto:true, min:-100, max:100, value:0 },
      temperature: { enabled:true,  auto:true, min:-100, max:100, value:0 },
      contrast:    { enabled:true,  auto:true, min:-100, max:100, value:0 },
      whiteBalance:{ enabled:true,  auto:true, min:-100, max:100, value:0 },
      exposure:    { enabled:true,  auto:true, min:-5,   max:5,   value:0 },
      sharpness:   { enabled:false, auto:true, min:0,    max:300, value:80 },
      noise:       { enabled:false, auto:true, min:0,    max:100, value:30 }
    }
  },

  moduleEnabled: {
    cutout:true, refine:true, backdrop:true, shadow:false,
    adjust:true, compose:true, export:true
  },

  export: { format:"jpg", quality:12, outputDir:null }   // jpg quality 合法区间 0..12（真机实测）
}
```

---

## 4. `window.Ecom.ps` —— 宿主桥接层（`src/ps.js`）

```js
ps.require()                  // → { app, core, action, uxp, imaging }（内部缓存）
ps.setLogSink(fn) / ps.log(level, text)
ps.logFilePath()              // → Promise<{ok, error?, data?:{ path:string }}>
ps.setFileLogEnabled(bool)    // 落盘开关，默认 true（v3 新增）
// ★★ v3 新增：ps.log 的每一行除送面板外，还【追加写入调试日志文件】。
//   原因（调度者真机实测）：第三方（3P）插件的 console.log 【不会】进入 UXPLogs_*.log ——
//   UXPLogs 里只抓得到 Adobe 自家 1P 插件（CCX 等）的 console 输出。
//   实测 `com.ecom.psimage` 在全部 UXPLogs_*.log 中命中 0 次。
//   → 面板文字之外必须有持久通道，否则用户一关面板，错误原文就永久丢失，无法远程诊断。
//   DEVELOPER.md §7.3 原先写「console.log 会进 UXPLogs」是错的，已更正。

ps.run(descriptors, opts)     // → Promise<{ok, data:{results:any[]}, error?}>
                              // opts: { history:"suspend"|"normal"=「suspend」,
                              //         preserveSelection:boolean=「true」 }
                              // 内部：core.executeAsModal + action.batchPlay
                              //   history==="suspend" → hostControl.suspendHistory / resumeHistory（见手册 G29）
                              //   preserveSelection    → 描述符首尾自动加 saveDocumentSelection / restoreDocumentSelection
                              // 逐项检测 {_obj:"error"}（见 §1.1），命中即 ok:false

ps.runRaw(descriptors)        // → Promise<{ok:true, data:{results:any[]}}>  只做 modal 包装，不做错误项检测
                              // 供需要逐项容错的模块使用

ps.modal(label, fn)           // → Promise<{ok, data, error?}>  fn 在 executeAsModal 内执行并可 await

ps.activeDoc()                // → Promise<{ok, data:{id,name,width,height,path,resolution}}|{ok:false,error}>
                              // ★ 必须走 UXP DOM（app.activeDocument），DOM 的 width/height 已是像素。
                              //   若改用 batchPlay multiGet，width._value 不是像素，必须乘 resolution/72（手册 F25）。
                              // path 为原图绝对路径；未保存的文档 path 为 null

ps.hexToRGB(hex)              // → { red, green, blue } 0..255（同步纯函数）
ps.rgbToHex({red,green,blue}) // → "#RRGGBB"（同步纯函数）

ps.pickColor()                // → Promise<{ok, data:{hex}}>  showColorPicker @ application，结果取 RGBFloatColor

ps.snapshot()                 // → Promise<{ok, data:{token}}>  记录 historyState 的 _id（★ 不要用 _index）
ps.restore(token)             // → Promise<{ok}|{ok:false,error}>  回退到该历史状态

ps.getSubjectPixels(opts)     // opts: { maxDim:number=512 }
// → Promise<{ok, data:{ width, height, rgba:Uint8Array, alphaMask:Uint8Array|null }}|{ok:false,error}>
//   rgba     : 交错 RGB(A)，8 位。★ 只给 targetSize.height（实测只给一维才等比，手册 F26）
//   alphaMask: 有图层蒙版时用 imaging.getLayerMask({layerID, kind:"user"}) 读；无蒙版时为 null
//   ★ 两个 imageData 包装对象都必须 dispose()，否则 PS 侧内存泄漏
//   ★ applyAlpha 语义与 getLayerMask 返回结构均未经真机确认 → 首次运行须 console.log 核对（见 §15）
```

## 5. `window.Ecom.store` —— 状态与预设（`src/store.js`）

```js
store.defaults()                 // → state（全新默认值，深拷贝）
store.load()                     // → state（读取失败则返回 defaults 并记警告）
store.save(state)                // → void（尽力持久化，失败不抛）
store.newId(prefix)              // → string

store.addSizePreset(state, {w,h,label})   // → {ok, state, error?}
store.removeSizePreset(state, id)         // → {ok, state, error?}  内置项不可删
store.setColor(state, {name, hex})        // → {ok, state, error?}
store.removeColor(state, id)              // → {ok, state, error?}  内置项不可删

store.exportPresets(state)                // → {ok, data:{json:string}}
store.importPresets(state, jsonString)    // → {ok, state, error?}  非法 JSON 必须报错且不破坏原 state
```

**持久化**：UXP `localStorage`，键 `ecom-plugin-state-v1`。`store.js` 是唯一读写它的地方。

---

## 6. `window.Ecom.analyze` —— 主体统计（`src/analyze.js`）

```js
analyze.subject()   // → Promise<{ok, error?, data?:{
                    //     scope:"subject"|"full",
                    //     bounds:{left,top,right,bottom}, width, height,   // 文档坐标系像素
                    //     meanR, meanG, meanB,        // 0..255
                    //     meanLuma,                   // 0..1
                    //     meanSat,                    // 0..100 (HSV S)
                    //     castRG, castBG,             // meanR-meanG, meanB-meanG
                    //     lumaP5, lumaP95, dynamicRange,   // 0..1
                    //     sampleCount
                    //   }}>
```

- 实现：`ps.getSubjectPixels()` → 有 `alphaMask` 时只统计蒙版非零像素并 `scope:"subject"`，`bounds` 取蒙版非零区域 bbox；无蒙版时统计全图并 `scope:"full"`。
- **不得报错**：未抠图时走 `scope:"full"` 回退。

## 7. `window.Ecom.cutout` —— 抠图与边缘净化（`src/cutout.js`）

★ **v2 重要修订**：PS 的「移除背景」**没有** batchPlay 事件。等价链（Adobe 自家 talent 逐字取证）是
`rasterizeLayer → autoCutout → make channel mask revealSelection → deselect`。

★★ **v5 修正（真机受控实验，务必遵守）**：Adobe talent 原文末步是 `delete channel apply:true`，但该步会**删掉刚刚建好的图层蒙版**——
`make … at:{_ref:"channel",_enum:"channel",_value:"mask"}` 之后**当前通道就是那个蒙版**，`targetEnum` 于是删它本身（`apply` 与否都一样）。
末步必须是 `deselect`：`{ _obj:"deselect", _target:[{ _ref:"channel", _property:"selection" }] }`。

```js
cutout.remove(opts)  // opts: { contract:number, feather:number }  (px)
// → Promise<{ok, error?, data?:{
//     layerName, hasMask:boolean, usedFallback:boolean, maskCoverage:number   // 0..1 非零蒙版像素占比
//   }}>
//
// 主路径（全链本机取证）：rasterizeLayer → autoCutout{sampleAllLayers:false}
//                        → [contract(选区)] → [feather(选区)]      ← 边缘净化在这里做，不在蒙版上做
//                        → make channel mask revealSelection
//                        → deselect                               ← v5：绝不能用 delete，它会删掉刚建好的蒙版
// 校验：读蒙版非零像素占比 maskCoverage
//   若 maskCoverage < 0.001（空选区 → 全隐藏蒙版，图层看起来消失）→ 回退：
// 回退路径：同链但 autoCutout{sampleAllLayers:true}（对文档合成取样），usedFallback=true
//   仍失败 → ok:false，error 必须写明「PS 未找到主体，请手动使用 选择主体 / 移除背景」

cutout.refine(opts)  // opts: { feather:number }
// → Promise<{ok, error?, data?:{ applied:boolean, feather, hadMask:boolean }}>
// 只作用于【已有图层蒙版】：set layer userMaskFeather（本机取证，非破坏，可随时改回 0）
// ★ 无蒙版时 set userMaskFeather 会报错 → 必须先 hasUserMask 判定；无蒙版则返回 ok:false 并提示「请先抠图」
// ★ v5：hasUserMask 必须用**取整层对象**的形式判定 —— {_obj:"get", _target:[{_ref:"layer",_id}]} 后读返回值里的 hasUserMask；
//   AM 属性 get（_property:"hasUserMask" / _property:"userMaskEnabled"）在 PS 2026 上被拒：命令"获取"当前不可用。
// ★ 「收缩蒙版本体」在 PS 里没有 API（全树只有 userMaskFeather / userMaskDensity）→ 本接口不提供 contract

cutout.subjectBounds() // → Promise<{ok, error?, data?:{ left,top,right,bottom,width,height }}>
                       // 优先用 DOM activeLayer.bounds；像素级精度走 ps.getSubjectPixels().alphaMask 求非零 bbox
```

## 8. `window.Ecom.backdrop` —— 背景与投影（`src/backdrop.js`）

```js
backdrop.setSolid(opts)   // opts: { hex:string }        ★ v3：不再接受 name
// → Promise<{ok, error?, data?:{ layerId, layerName, hiddenIds:number[] }}>
// make + contentLayer + solidColorLayer(RGBColor 0..255)，随后 move 到 _enum:"back"（手册 B5+B6）
// ★ 层序一律用 {_obj:"move", to:{_ref:"layer",_enum:"ordinal",_value:"back"}}。
//   `_place` 这个键在本机全树 0 命中，不要用。
//
// ★★ v3 新增（真机缺陷 #9）：「换背景」必须【替换】而不是叠加。
//   1. 新背景层名【一律】是 backdrop.BG_NAME（"背景"）。绝不接受调用方传颜色名 ——
//      v2 让 index.js 把颜色名当图层名传进来（真机日志里层名叫「自定义色」），
//      于是既找不到旧背景、也无法隐藏它，每换一次色就多一个图层。
//   2. 建新层【之前】，把文档里所有 name===BG_NAME 且 kind==="solidColor" 的已有层
//      逐个 {_obj:"set", to:{_obj:"layer", visible:false}} 隐藏（用户选定语义：隐藏旧的、显示新的）。
//      返回 hiddenIds 供 UI/日志显示。

backdrop.addShadow(opts)  // opts: { opacity:0..100, blur:px, offsetY:px, color:"#RRGGBB",
                          //         subjectLayerId:number }
// → Promise<{ok, error?, data?:{ layerId, layerName }}>
// 链路（手册 B7，逐步本机取证）：
//   duplicate 主体层 → rasterizeLayer → fill 黑 → select 影子层 → gaussianBlur
//   → transform(width 100% / height 60%) → transform(offsetY) → set opacity → move 到主体层正下方
//
// ★★ 第 2 步起每一步之前都必须显式 {_obj:"select", _target:[{_ref:"layer",_id:shadowLayerId}]}。
//    gaussianBlur / transform / fill 都作用于【当前激活图层】；漏了 select 会把模糊打到【主体层】上，
//    不报错、返回成功 —— 这是本任务最难发现的一类事故。
// ★ 不透明度【读 0..255 / 写 percentUnit 百分比】标度不同，混用会让影子全黑或消失。
// ★ duplicate 返回结构里新图层 id 的字段名【未实测】→ 实现必须先在真机 console.log(JSON.stringify(res))
//    确认字段名，不要硬编码猜测。
// ★ 影子层固定命名 "阴影"，背景层固定命名 "背景"。
// ★★ v3（真机缺陷 #10）：fill 描述符【只能】用 Adobe helper 的最小形态（手册 B7 / 行 276-279）：
//     { _obj:"fill", _target:[{_ref:"layer",_id}], using:{_enum:"fillContents",_value:"color"},
//       color:{_obj:"RGBColor",...}, preserveTransparency:true }
//   ★ 绝不加 opacity / mode —— v2 加了 opacity:{_unit:"floatUnit"} 与 mode:{_enum:"mode"}，
//     真机报「电商图片制作：命令"填充"当前不可用」，于是影子层只复制、后续全部没执行。
//     Adobe 的 fill helper 里【没有】这两个键；不透明度由后续 {_obj:"set", to:{opacity:percentUnit}} 负责。
//   ★ preserveTransparency:true 让填充只落在非透明像素上（保住抠图轮廓）。
//   ★ 回退：先 { _obj:"set", _target:[{_ref:"color",_property:"foregroundColor"}],
//      to:{_obj:"RGBColor",...} } 设前景色，再发 { _obj:"fill", using:{_enum:"fillContents",_value:"foregroundColor"} }。
// ★★ v3：与背景同理，建新影子层前把所有已有 name===SHADOW_NAME 的层隐藏。
// ★★ v3：该链【逐步】执行（每步一次 ps.run，label 写明步骤名），不要合成一条大链 ——
//     合成链一旦第 N 步失败，日志只说「'填充' 当前不可用」，无法定位是哪一步、哪个描述符。
```

## 9. `window.Ecom.adjust` —— 调色（`src/adjust.js`）

```js
adjust.computeAuto(analysis, order)
// 纯函数，无宿主调用。→ { saturation, brightness, temperature, contrast, whiteBalance, exposure, sharpness, noise }
// 全部 clamp 进 state.adjust.items[*] 的 min..max；analysis 为 null 时全部返回 0

adjust.apply(opts)
// opts: { items:{ <键名>:{enabled,auto,value,min,max} }, analysis }
// → Promise<{ok, error?, data?:{
//     applied:string[], skipped:string[],
//     layers:string[],                    // 新建的图层/滤镜名
//     effective:{ <键名>:number },
//     failureDetail:[{ key, error }]      // 逐项失败明细
//   }}>
```

### 落地方式（冻结 · 依据手册 C8–C12 / D13–D15）

| 键名 | 落地 | 描述符要点 |
|---|---|---|
| saturation | 「色相/饱和度」调整图层 | `make adjustmentLayer type.hueSaturation`，参数在 `adjustment[0]`（`hueSatAdjustmentV2`：hue/saturation/lightness） |
| brightness + contrast | 「亮度/对比度」调整图层（**同一层一次 set**） | `type.brightnessContrast` + **必须显式 `useLegacy:false`** |
| temperature | 「照片滤镜」调整图层 | `type.photoFilter` + 滤镜色 + density + `preserveLuminosity` |
| whiteBalance | 「色彩平衡」调整图层 | `type.colorBalance`，三个 levels 是 **3 元数组** |
| exposure | 「曝光度」调整图层 | `type.exposure`。★ 三个参数键名是 **[推断]**，实现必须容错并在真机首跑核对 |
| sharpness | 智能滤镜 USM | 先 `{_obj:"newPlacedLayer", _isCommand:true, _options:{dialogOptions:"silent"}}` 转智能对象，再发**裸** `unsharpMask`（**不带 `_target`**）。★ `threshold` 是**裸数字**不是带单位对象 |
| noise | 智能滤镜 | ★ `reduceNoise` 全树 0 命中（**[推断]**）→ **主实现用 `dustAndScratches`**（本机取证），失败再退 `median` |

**统一 make / set 形式**：
```js
// 建层
{ _obj:"make", _target:[{_ref:"adjustmentLayer"}],
  using:{ _obj:"adjustmentLayer", type:{ _obj:"hueSaturation" } } }
// 设参（作用于刚建好、当前选中的调整层）
{ _obj:"set",
  _target:[{_ref:"adjustmentLayer",_enum:"ordinal",_value:"targetEnum"}],
  to:{ _obj:"hueSaturation", adjustment:[{ _obj:"hueSatAdjustmentV2", hue:0, saturation:-20, lightness:0 }] } }
```

**强制要求**：
1. 绝不使用直接改像素的等价滤镜。所有调色项默认落成调整图层 / 智能滤镜。
2. **逐项容错**：单项失败不得中止其余项；用 `ps.runRaw` 逐条执行，把失败项以 `{key, error}` 记入 `failureDetail`，并保留 `applied` / `skipped` 的准确划分。
3. `sharpness` 必须在**抠图与 compose 缩放之后**才执行（缩放智能对象会牵动智能滤镜参数，未经实测 —— 见 §13 顺序）。

## 10. `window.Ecom.compose` —— 构图规范化（`src/compose.js`）

```js
compose.normalize(opts)
// opts: { baseSize:number, marginPercent:number, excludeLayerNames:string[],
//         center:boolean }        ★ v3 新增，默认 true
// → Promise<{ok, error?, data?:{ baseSize, subjectPx, scale, movedTo:{x,y}, center, centered }}
//
// 职责：把画布改为 baseSize×baseSize；把主体层等比缩放并【居中】，
//       使主体最大边占画布的 (100 - 2*marginPercent)% 。
// 实现（手册 E18 + E20 + E17；顺序见 §15 变更 #8）：
//   [仅当长边 > baseSize] imageSize(等比缩小) → canvasSize(anchor middleCenter，失败退回只给宽高)
//   → 读主体层 bounds → transform(等比缩放) → 重读 bounds → 在 JS 侧算出位移 → transform(offset)
// ★ UXP 侧【没有对齐类命令】（align/ADSCentersH 全树 0 命中）→ 居中必须在 JS 侧算位移。
// ★ 背景层与阴影层【不参与缩放】：跳过名称在 excludeLayerNames 中的层，以及固定名 "背景"/"阴影"。
// ★ transform 带 freeTransformCenterState:{_enum:"quadCenterState",_value:"QCSAverage"}，否则以角落为基准、偏移翻倍。
//
// ★★ v3 新增（真机缺陷 #12，两条独立成因，都要修）：
//   (a) 每次 transform 之前【必须】显式 select 主体层
//       （{_obj:"select", _target:[{_ref:"layer",_id:subjectId}]}）。
//       `_target` 不足以让 transform 作用到指定图层 —— 它吃的是【当前激活图层】。
//       v2 只给 _target 没 select，居中被静默丢掉。
//       注意 backdrop.js 自己写着这条规则（backdrop.js:3），compose 却违反了。
//   (b) 居中改成【闭环】：读 bounds → 算 dx,dy → transform(offset) → 重读 bounds；
//       仍偏离中心超过 2px 就再校正一次，最多 2 轮。
//       理由：canvasSize 的 anchor/relative 键名是 [推断] 项，锚点若失效会把画布内容推到左上；
//       而旧实现只校验画布【尺寸】不校验主体【位置】，于是静默通过、主体偏在角上。
//       闭环位移不依赖锚点语义是否正确。
//   (c) center===false → 跳过居中，但仍做等比缩放与画布尺寸调整。
//
// ★★ v3 修订排除规则：excludeLayerNames 里【不再】放 "背景"。
//   PS 中文版把单层图片的像素层默认命名为「背景」，按名字排除会误伤用户真正的画面层。
//   背景层是 kind==="solidColor" 的填充层，已被 findSubjectLayer 的 SUBJECT_KINDS 过滤掉，无需按名排除。
//   仍按名排除的只有 "阴影"（插件自建，kind 是 pixel，无法用 kind 与用户图层区分）。
```

## 11. `window.Ecom.export` —— 导出（`src/export.js`）

```js
export.run(opts)  // opts:{ sizes:[{w,h,label}], quality:0..12, format:"jpg"|"png", outputDir:string|null }
// → Promise<{ok, error?, data?:{
//     outputDir:string,
//     files:[{path,bytes,w,h}],
//     failures:[{size,error}]
//   }}>
//
// 命名（冻结）：<原文件名不含扩展名>_<W>x<H>.<ext>
// 目录（冻结）：outputDir 为 null → <原图目录>\output\ ；原图未保存 → ok:false 提示先保存
// 实现（冻结）：逐个尺寸 duplicate 文档 → flattenImage → imageSize → save 另存 → close(saving:"no")
//   ★ 保存必须走 batchPlay 的 saveAs：JPEG 质量写给 extendedQuality（0..12，真机实测合法区间 0..12，
//     13 直接报「指定值大于最大允许值」），嵌入颜色配置用 embedProfiles（手册 E22）。
//   ★ 每条命令都必须带 _target:{_ref:"document",_id:copyDocId}。
//     漏掉 _target 可能把结果存到【原图路径】或【关掉原图】—— 契约明令绝不修改/关闭用户原文档。
//   ★ close 的枚举名是 "saving"，取值 "yes"/"no"。
//   ★ 一个尺寸失败不得中止其余尺寸，记入 failures。
//   ★ 原文档必须保持打开且未被修改（若原文档本身是未保存的新文档，本次 run 直接 ok:false）。
```

## 12. `window.Ecom.ui` —— 面板 UI（`src/ui.js`）

```js
ui.mount(opts)     // opts:{ state, on:{<事件名>:fn} }
                   // → { refresh(state), setBusy(bool,label), setLog(entry), setAnalysis(data|null) }
ui.refresh(state) / ui.setBusy(bool,label) / ui.setLog({time,level,text}) / ui.setAnalysis(data|null)

// on 事件名（冻结）：
//   onRunAll()                 一键全流程
//   onRunModule(moduleKey)     moduleKey ∈ "cutout"|"refine"|"backdrop"|"shadow"|"adjust"|"compose"|"export"
//   onRestore()                一键回退
//   onStateChange(patch)       任何 UI 值变更，patch 为浅层补丁对象，由 index.js 合并
//   onPickColor()
//   onAddSize({w,h,label}) / onRemoveSize(id)
//   onAddColor({name,hex}) / onRemoveColor(id)
//   onImportPresets() / onExportPresets()
//   onOpenOutputDir()
```

UI 必须新增的控件（v3）：
- 「居中主体」勾选框，绑定 `state.compose.center`，**默认勾选**；提交方式
  `onStateChange({ compose: { center: bool } })`
  （★ 必须提交完整的 compose 对象：onStateChange 是浅层合并，只传 `{center}` 会抹掉 compose 的其他键）。
- 日志区标题显示 `Ecom.ps.logFilePath()` 返回的路径（取不到就显示「落盘不可用」），
  供用户把日志文件发回。

UI 必须体现的提示（v2 新增）：
- 「边缘净化 - 收缩」只在**一键抠图**时生效；单独点「边缘净化」按钮只做羽化。UI 上要写明。
- 「降噪」的算法是「蒙尘与划痕」（非 PS 的「减少杂色」），UI 上要写明以免用户预期错位。

## 13. `plugin/index.js` —— 编排（`ui-builder` 拥有）

```js
// 职责：加载 state → Ecom.ui.mount({state, on}) → 实现所有 on 回调
// 一键全流程顺序（冻结）：
//   1. cutout   → Ecom.cutout.remove(state.edge)            // 边缘净化在此生效
//   2. refine   → Ecom.cutout.refine({feather: state.edge.feather})
//   3. backdrop → Ecom.backdrop.setSolid({hex})   // v3：不再传 name（层名由实现固定为 "背景"）
//   4. shadow   → Ecom.backdrop.addShadow(state.shadow + subjectLayerId)
//   5. adjust   → Ecom.analyze.subject() → Ecom.adjust.apply(...)
//   6. compose  → Ecom.compose.normalize({baseSize, marginPercent, excludeLayerNames:["阴影"],
//                                          center: state.compose.center})              // v3
//   7. export   → Ecom.export.run(...)
// 快照时机（冻结）：第 1 步之前调用 Ecom.ps.snapshot()
// v3：启动后调用 Ecom.ps.logFilePath()，把路径交给 UI 显示（见 §12）
// 任一步 ok:false → 记 error 日志并【停止】后续步骤（不静默继续）
// baseSize 计算（冻结）：state.baseSizeId 命中则用之；否则取 state.sizes 中 enabled:true 的最大 w（无则 1600）
//
// ★ 顺序理由（v2）：sharpness 会把主体层转成智能对象，而缩放智能对象的智能滤镜参数行为未实测
//   → 把 adjust(含锐化) 放在 compose 之前，让锐化参数不被缩放牵动。
//   代价：锐化先于缩放，缩小时锐化效果会被稀释 —— 这是可接受的已知取舍。
```

## 14. `plugin/manifest.json` 要求

- `manifestVersion: 5`
- `id: "com.ecom.psimage"`（**必须与安装目标文件夹名一致**）
- `host: [{ "app":"PS", "minVersion":"24.0" }]`（`autoCutout` 需要 PS 24.0+）
- `main: "index.html"`
- 一个 `type:"panel"` 的 entrypoint，`id:"ecomMainPanel"`
- `requiredPermissions.localFileSystem: "fullAccess"`
- **不要声明 `icons`**（缺 1x 文件会告警，无实际收益）
- 落点：`%APPDATA%\Adobe\UXP\Plugins\External\com.ecom.psimage\`
- 取证：`docs/RESEARCH-install.md`

---

## 15. v1 → v2 变更记录

| # | v1 的错误假设 | v2 修订 | 依据 |
|---|---|---|---|
| 1 | `removeBackground` 是 batchPlay 事件，主路径用它 | **不存在该事件**（13 处命中全是通知事件名/talent id/CDN URL）。主路径改为 `autoCutout` 等价链 | 手册 A1 / A1b |
| 2 | `cutout.refine({contract})` 收缩图层蒙版 | **PS 没有蒙版「收缩」属性**（只有 `userMaskFeather`/`userMaskDensity`）。收缩改为在**选区**上做（`contract`），时机提前到建蒙版之前；`refine` 只做羽化 | 手册 A4 |
| 3 | 未考虑 batchPlay 的错误返回形态 | 新增 §1.1：失败项以 `{_obj:"error"}` 返回**而不抛异常**，`ps.run` 必须逐项检测 | `adjustments.js:120-124` |
| 4 | `noise` →「减少杂色」智能滤镜 | `reduceNoise` 全树 **0 命中**。主实现改用本机取证的 `dustAndScratches` | 手册 D15 |
| 5 | `exposure` 参数键名当作已知 | 标记为 **[推断]**，实现必须容错 + 真机核对 | 手册 C12 |
| 6 | 未明确 `activeDoc` 的宽高来源 | 冻结走 DOM（`multiGet` 的 `width._value` 不是像素，须乘 `resolution/72`） | 手册 F25 |
| 7 | 未讨论智能对象与缩放的先后 | 冻结顺序：`adjust` 在 `compose` 之前，避免缩放牵动智能滤镜参数 | 手册 D14 风险项 |

---

## 15.1 v2 → v2.1：实现驱动的契约修正（`compose.normalize` 内部次序）

| # | v2 的文字 | v2.1 的实现（已落盘） | 理由 |
|---|---|---|---|
| 8 | `canvasSize → imageSize(等比) → bounds → transform` | `[长边>baseSize 时] imageSize(等比缩到 baseSize) → canvasSize(baseSize²) → bounds → transform(等比缩放) → 重读 bounds → transform(offset)` | v2 文字顺序会**先把画布设成 baseSize² 再缩放**：若原图长边大于 baseSize，`canvasSize` 会**裁掉主体**（`relative:false` 即绝对尺寸）。放到最前缩小则永不裁切，且居中位移只算一次。最终几何与契约文字**等价**（画布 baseSize²、主体最大边 = `(100-2*margin)%`、居中），故只修正文字，不改行为。 |

**`marginPercent` 语义（冻结不变）**：主体**最大边**占画布的 `(100 - 2*marginPercent)%`。

### 必须在真机首跑时 `console.log` 核对的 4 项（**未查清，不得硬编码猜测**）

1. `duplicate` 返回结构中新图层 id / 新文档 id 的**字段名**（B7 / E19）
2. `imaging.getLayerMask` 的**返回结构**（是否有 `imageData`、能否 `getData()`）—— 手册 F27
3. `imaging.getPixels` 的 `applyAlpha` **语义**（合成掉 alpha 还是附加 alpha 通道）—— 手册 F26
4. `exposure` 的三个参数键名、`canvasSize` 的 `anchor`/`relative` 键名（手册 C12 / E18）

---

## 15.2 v2.1 → v3：真机首跑缺陷驱动的契约修订

用户在真机上跑通了插件，报出 4 个缺陷 + 我方发现 1 个连带缺陷。逐条定位到**契约/实现缺陷**（不是 PS 不支持），据此修订：

| # | 真机现象 | 根因（代码级） | v3 修订 | 依据 |
|---|---|---|---|---|
| 9 | 换背景色只叠加不替换，旧背景层还留着 | `index.js:169` 把**颜色名**当图层名传给 `setSolid`（真机日志里层名叫「自定义色」）；且 `setSolid` 从不隐藏旧层 | `setSolid` 固定命名 `BG_NAME`，建新层前隐藏所有同名 `solidColor` 层 | 用户真机日志 `[背景] ok · 图层「自定义色」 id=15` |
| 10 | 投影只复制了图层，后续什么都没做 | `fill` 描述符多了 `opacity:{_unit:"floatUnit"}` 与 `mode:{_enum:"mode"}`；Adobe 的 fill helper **无**这两键 | 收敛到最小形态 + `preserveTransparency:true`；该链改为**逐步**执行以便定位 | 用户真机日志 `命令"填充"当前不可用`；手册 B7 行 276-279 |
| 11 | 调色「自动」全是 0，图没变 | `analyze.subject()` 失败 → `index.js:196` 只记 warn、`analysis=null` → `computeAuto(null,·)` 按契约全部返回 0 → 调整层数值 0 = 无可见变化且不报错 | 契约不变（该回退是 §9 明文约定）；新增**日志落盘**（§4）以取得失败原文；失败时 UI 必须显式提示「自动值不可用」，不得静默显示 0 | 用户答复「全是 0 / 数值没变」 |
| 12 | 尺寸调整后主体不在正中央 | `compose.js:113/127` 的 `transform` **没有先 select 目标层**（transform 吃当前激活图层）；且锚点语义是 [推断] 项、旧实现只量尺寸不量位置 | transform 前显式 `select`；居中改**闭环**（最多 2 轮）；新增 `center` 开关（默认开） | `backdrop.js:3` 自述规则；用户答复「默认开启 + 勾选框」 |
| 13 | （连带）第三方插件 `console.log` **不进** UXPLogs | `UXPLogs_*.log` 全量中 `com.ecom.psimage` 命中 **0** 次 | 新增 `ps.logFilePath()`，面板日志落盘 | 调度者实测；DEVELOPER.md §7.3 原文有误，已更正 |

## 15.3 v3 → v4：投影改为图层样式 + 编排层日志落盘

用户在真机上继续复测，报「投影生成后是一个矩形」。我在真机上做受控实验后定案：

| # | 真机现象 | 根因（代码级） | v4 修订 | 依据 |
|---|---|---|---|---|
| 14 | 编排层的失败原文全部丢失 | `index.js:24 log()` 只写面板 / `console.log`，从不落盘；而 3P 插件的 `console.log` **不进** UXPLogs | `log()` 整体委托 `Ecom.ps.log`（面板 1 行 + 文件 1 行），ps 缺失时降级 `setLog` | 用户日志 19 行全部来自引擎模块，无一行来自 `index.js` |
| 15 | 统计失败时静默套用全 0 自动值 | `stepAdjust` 把 `analysis=null` 直接交给 `adjust.apply` → `computeAuto(null,·)` 全 0 → 图没变却不报错 | `analysis===null` 且存在 `enabled && auto` 项 → 返回 `ok:false`，**不调用** `adjust.apply` | 用户答复「全是 0 / 数值没变」 |
| 16 | 投影是一个矩形 | ① `fill` **只要带 `_target` 就被 PS 拒绝**（8 组变体矩阵），无 `_target` 的 `foregroundColor` 形态只能**填满整层**（丢掉透明）；② `move to {_ref:"layer",_offset:-1}` 被拒 → 影子层序错、盖在主体上。两点叠加必然产出黑色矩形 | 投影整体改为**图层样式**：对主体层一次 `set → layerEffects.dropShadow`（`opacity`→percentUnit、`blur`→`size`、`offsetY`→`distance`、`localLightingAngle:90`、`choke:0`）；新增 `removeShadow`（`disableLayerStyle`）；无图层蒙版时必须 warn | 真机 8 组 fill 变体矩阵 + `%TEMP%\ecom-fx.png` / `ecom-fx2-masked.png` 目视；dropShadow 在**带蒙版**的层上严格贴合蒙版轮廓 |

## 15.4 v4 → v5：抠图链末步与蒙版判定（真机受控实验）

用户在真机上跑「一键处理」，报「只是扣完图就停了」。我在**用户文档的副本**上跑原样链条，用四组对照实验定位：

| # | 真机现象 | 根因（代码级） | v5 修订 | 依据 |
|---|---|---|---|---|
| 17 | 抠图后 `hasUserMask=false`、白底矩形仍在、一键流程在抠图后立刻停 | 链尾 `{_obj:"delete",_target:[{_ref:"channel",_enum:"ordinal",_value:"targetEnum"}],apply:true}` —— `make … at:{_ref:"channel",_enum:"channel",_value:"mask"}` 之后**当前通道就是刚建好的图层蒙版**，于是这一步删掉的就是蒙版本身（`apply` 与否都一样） | 链尾改用 `{_obj:"deselect",_target:[{_ref:"channel",_property:"selection"}]}`；并全文件自查所有 `delete channel targetEnum` | 四组对照：`[无末步] hasUserMask=true` / `[deselect] true` / `[delete 不带 apply] false` / `[delete apply:true] false` |
| 18 | 蒙版状态判定恒失败 | `ps.hasUserMask` 用的 AM **属性 get**（`_property:"hasUserMask"` / `"userMaskEnabled"`）在 PS 2026 上被拒：`命令"获取"当前不可用` | 改为**取整层对象**：`{_obj:"get",_target:[{_ref:"layer",_id}]}` 后读返回值里的 `hasUserMask` | 真机 H1/H2/H3 三种属性形式全 FAIL；整层 get 返回 43 个键且 `hasKey(hasUserMask)=true`，其值随蒙版真实变化 |
| 19 | 「有蒙版了还在检测」（抠图成功后长时间转圈） | 抠图完成后我立刻去读蒙版状态：真机 17:58:31→17:59:17 的 45s 内被拒 **71 次**（每次都被强制包进 modal），而**上限一到、紧接着的一次直接 batchPlay 就成功了** | ① 重试不再强制 modal；② 600ms 硬捶改递增退避；③ **不再为这条诊断信息等待**：抠图链 2s、边缘净化 6s 上限，超时按「未知」继续 | 真机日志 71 条 `命令"获取"当前不可用` + 上限之后第一次即成功（同一秒「边缘净化」的整层 get 也成功） |
| 20 | 一键仍卡在抠图；调色报「主体统计失败」 | 真机 `imaging.getPixels` 返回 `{imageData: <function>, sourceBounds, level}` —— **`imageData` 是方法不是对象**（要调一次才给出 ImageData）；旧代码只把 object 当像素候选 | `extractPixelBuffer` 三种形态全认（对象／函数：先 `new`、再 `call()` 绑父对象／类构造器）；尺寸判定改成「候选尺寸 × 通道数必须恰好 3 或 4 且长度整除」的验证式（返回自省 → 按 targetSize+文档尺寸推算 → sourceBounds） | 真机日志 `探测 getPixels.keys = imageData,sourceBounds` → `已试[self{无getData} / sourceBounds{无getData}]` → 调色整条判失败 |

### v7 面板开关「抠图后自动应用蒙版」的语义（按用户口径）

用户原话：「不勾选就是只执行抠图，扣完图不是会新建一个蒙版吗，如果勾选了选项就自动应用这个蒙版」。

- 抠图链**只有一种形状**：`select → rasterize → autoCutout / removeBackground → (contract) → (feather) → make(revealSelection) → deselect`。面板开关不改变这条链。
- **勾选**（默认）：链跑完即结束 —— 蒙版已建且**启用**，主体外透明。
- **不勾选**：链照跑（蒙版照样建），链尾追加一次 `{_obj:"set",_target:[{_ref:"layer",_id}],to:{_obj:"layer",userMaskEnabled:false}}` —— 把刚建好的蒙版**停用**（非破坏性：蒙版仍在，Shift+点击缩略图可随时启用）。整层 set 被拒时自动改用「目标 = mask 通道」的回退形式。
- ❗这里**只用 set 一个布尔，绝不 delete** —— 第 17 行那条 `delete` 教训。
- 停用期间图层整层不透明，`cutout.remove` 会额外写一条 warn，提醒后续步骤（背景／投影／居中／调色统计）会按整张画布算，而不是按抠出的主体算。
- 证据状态：`UsrM` ↔ `userMaskEnabled` 的字符/字符串 ID 对应已在 `docs/DEVELOPER.md:270` 与 `docs/RESEARCH-host.md:223`（`UsrM | 1433629261 | userMaskEnabled | ✅`）取证；无蒙版时该键**不存在**（`docs/RESEARCH-host.md:562`）。但 **set 方向尚未在真机上验证通过**，两种形式都留了回退，等真机日志给结论。
