# 开发者文档 · 电商图片制作（Photoshop 2026 UXP 插件）
> **★ 行号会漂移（2026-10-13 版）**：本文所有 `文件:行号` 引用对应 **13 个文件 / 4766 行 / 180183 字节** 的那一版代码。代码一改行号就会漂移 —— **请把函数名当稳定标识，把行号只当线索**；要重新定位，跑 `powershell -ExecutionPolicy Bypass -File verify\anchors.ps1`。

面向要继续维护 / 排查这个插件的人（可能就是你，几周之后）。它记录**代码怎么组织**、**改哪里**、以及**这台机器上踩过的坑**——第三部分比前两部分值钱。

- 契约（跨模块冻结的签名与数据结构）在 `docs/INTERFACE.md`，本文不重复，只讲"为什么"和"怎么改"。
- 决策与验收记录在 `docs/PLAN.md`。
- 描述符取证细节在 `docs/RESEARCH-descriptors.md`（1419 行，本项目最重要的一份原始资料）。
- 不想看原理，只想跑起来：看 §7「本地开发循环」。

> **本文所有行号都是 UTF-8 解码后实测的**（`[System.IO.File]::ReadAllLines($fp,[Text.Encoding]::UTF8)`）。别用不带编码参数的 `Get-Content` 去核对——它会给你错的数字，理由见 §0 的陷阱提示。

---

## 0. 命令速查

```powershell
$root = 'C:\Users\EDY\Desktop\ps电商图片制作插件'

# 装机 / 重装（必须完全退出 Photoshop）
powershell -NoProfile -ExecutionPolicy Bypass -File "$root\install.ps1" -DryRun   # 只报告
powershell -NoProfile -ExecutionPolicy Bypass -File "$root\install.ps1"           # 正式
powershell -NoProfile -ExecutionPolicy Bypass -File "$root\install.ps1" -Uninstall

# 语法检查（改完 JS 先跑这个，成本极低）
Get-ChildItem "$root\plugin" -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName; "$($_.Name) => $LASTEXITCODE" }

# 三个模拟回归（不需要 PS，改引擎层后必跑）
D:\software\node.exe %TEMP%\ecom-hostsim.js      # 127 项
D:\software\node.exe %TEMP%\ecom-v3-probe2.js    # 27 项
D:\software\node.exe %TEMP%\ecom-v6-check.js     # 62 项

# 看 UXP 日志（最新一份）
$log = Get-ChildItem "$env:APPDATA\Adobe\Adobe Photoshop 2026\Logs\UXPLogs_*.log" | Sort-Object LastWriteTime | Select-Object -Last 1
$log.FullName
Select-String -LiteralPath $log.FullName -Pattern 'com\.ecom|Ecom\.|fallback|error' -Encoding UTF8

# 已装机副本位置
"$env:APPDATA\Adobe\UXP\Plugins\External\com.ecom.psimage"
```

> **★ 本机 PowerShell 陷阱**：读取带中文的文本文件**必须显式加 `-Encoding UTF8`**。本机默认编码不是 UTF-8，`Get-Content`/`Select-String` 会把 UTF-8 当 ANSI 解码 —— 中文变乱码，而且**行号会错**（GBK 解码会把某些字节和紧跟的换行吞成一个字符，于是少算行）。
> 我在写这份文档时就踩了：同一个 `ps.js`，不带编码参数数出 **684** 行，带编码参数是 **699** 行，真值是后者（写这份文档时 ps.js 是 699 行；当前已是 1016 行，行号随时间漂移）。行号算错会连带把文档里所有行引用写歪。

---

## 1. 架构一览

```
index.html                       ← 唯一的 HTML，只用 <script src> 顺序加载
├─ src/ps.js       1016 行   ← 唯一 require("photoshop") 的地方（真调用只有 ps.js:31；:2 是注释）
├─ src/store.js     406 行   ← state 默认值 / 校验 / localStorage 持久化 / 预设导入导出
├─ src/analyze.js   133 行   ← 读主体像素统计（纯计算，不写文档）
├─ src/cutout.js    246 行   ← 抠图 + 边缘净化 + 主体边界
├─ src/backdrop.js  366 行   ← 纯色背景层 + 接地投影层
├─ src/adjust.js    337 行   ← 8 项调色的自动估值与落地
├─ src/compose.js   218 行   ← 基准画布 / 留白规范化（构图居中）
├─ src/export.js    195 行   ← 多尺寸导出
├─ src/ui.js        925 行   ← 面板 DOM 搭建与渲染（唯一碰 DOM 的模块）
└─ index.js         510 行   ← 编排层：一键全流程、模块单跑、所有用户动作的回调
                       ─────
                       4766 行（全部文件合计，含 styles.css 362 行）
```

**所有模块挂在同一个全局命名空间 `window.Ecom.*` 下**，每个文件是一个 IIFE，末尾把自己的公开面赋值上去：

| 命名空间 | 导出（公开面赋值行） |
|---|---|
| `Ecom.ps` | `require, setLogSink, log, probe, modal, run, runRaw, activeDoc, hexToRGB, rgbToHex, pickColor, snapshot, restore, getSubjectPixels` + 另外 13 个：`logFilePath, setFileLogEnabled, readBatchPlay, firstErrorItem, describeErrorItem, activeLayer, layerBounds, hasUserMask, getUserMaskCoverage, findSubjectLayer, createFolder, fileSize, safeJson`（`ps.js:986`，导出对象共 27 个键） |
| `Ecom.store` | `defaults, load, save, newId, addSizePreset, removeSizePreset, setColor, removeColor, exportPresets, importPresets, STORAGE_KEY`（`store.js:405`，对象字面量起于 `:249`） |
| `Ecom.analyze` | `subject, clamp`（`analyze.js:129`） |
| `Ecom.cutout` | `remove, refine, subjectBounds, SELECTION`（`cutout.js:240`） |
| `Ecom.backdrop` | `setSolid, addShadow, BG_NAME, SHADOW_NAME`（`backdrop.js:360`） |
| `Ecom.adjust` | `computeAuto, apply, RANGES, ORDER`（`adjust.js:331`） |
| `Ecom.compose` | `normalize`（`compose.js:215`） |
| `Ecom.export` | `run`（`export.js:192`） |
| `Ecom.ui` | `mount, refresh, setBusy, setLog, setAnalysis, getPresetText, setPresetText`（`ui.js:924`） |

### 为什么不用 ESM / CommonJS

`<script src>` 有明确的加载顺序，失败是"某个全局变量 undefined"——一眼能看出；而 UXP 的本地模块解析（`require("./store.js")`）在不同宿主版本上行为有差异，一旦解析失败，报错信息通常指向别处。这个项目**没有热重载、没有 UXP Developer Tool**（见 §7），每一次试错都要退 PS、装机、起 PS，所以选择了"牺牲现代语法，换一次成功"。

代价：模块间没有编译期依赖检查。`index.js` 里因此有一个防御性包装：

```js
function require3(name, fn) { /* index.js:51 —— 缺模块时返回 {ok:false,error:"模块未加载：..."} 而不是崩掉 */ }
```

### 为什么一切 PS 操作收敛到 `ps.js`

`require("photoshop")` 只出现一次（`ps.js:31`，被缓存在 `ps.js:29 mods()`）。好处是 batchPlay 的三件脏活只写一遍：**错误信封化、历史状态挂起、选区保护**。没有第二条路径能让某个模块绕过它们。

---

## 2. 加载与运行链路

```
UXP 载入 index.html
  → 按顺序执行 10 个 <script>（每个是 IIFE，只登记 window.Ecom.*，不做事）
  → index.js 末尾（:505）：document.readyState === "loading" ? 监听 DOMContentLoaded : 立即 boot
  → boot()（index.js:482）
       state = Ecom.store.load()                            读 localStorage，非法则回落默认值
       api   = Ecom.ui.mount({ state, on: {…12 个回调…} })   ← index.js:484；内里 createInstance（ui.js:66）
       log("面板已就绪（状态版本 v…）")
```

`ui.mount` 在内部（`ui.js:901`）把 `setLog` 注册成 `ps` 的日志出口：

```js
window.Ecom.ps.setLogSink(function (level, text) { setLog({ time: nowTime(), level, text }); });
```

**这是单向的**：`ps.js` 只认一个 sink（`ps.js:56`，无 sink 时静默丢弃），`ui.js` 是它的消费者。所以引擎模块可以在没有 UI 的环境里跑测试（engine-builder 就是这么做的，见 §8）。

### 一键全流程

`FLOW`（`index.js:260`）就是顺序，7 步：

| 步 | key | 调用 | 依赖的 state |
|---|---|---|---|
| 1 | `cutout` | `Ecom.cutout.remove({contract, feather})`（`index.js:173`） | `edge.contract` `edge.feather` |
| 2 | `refine` | `Ecom.cutout.refine({feather})`（`:181`） | `edge.feather` |
| 3 | `backdrop` | `Ecom.backdrop.setSolid({hex, name})`（`:189`） | `selectedColorId` / `customHex` |
| 4 | `shadow` | `Ecom.backdrop.addShadow({opacity, blur, offsetY, color, subjectLayerId})`（`:199`） | `shadow.*` |
| 5 | `adjust` | 先 `Ecom.analyze.subject()`（`:212`）拿统计，再 `Ecom.adjust.apply({items, analysis})`（`:226`） | `adjust.items` |
| 6 | `compose` | `Ecom.compose.normalize({baseSize, marginPercent, excludeLayerNames:["背景","阴影"]})`（`:234-241`） | `baseSizeId` `marginPercent` |
| 7 | `export` | `Ecom.export.run({sizes, quality, format, outputDir})`（`:251`） | `sizes` `export.*` |

编排语义全在 `onRunAll`（`index.js:291-329`）：

1. 重入保护：`if (busy) return`（`:292`）。
2. 没有勾选任何尺寸 → 记 error 并返回，不继续（`:297-300`）。
3. 打历史快照，token 存内存（`:301-304`）。**快照失败不阻断**——只 warn 并让本次「回退」不可用（`:305-308`）。
4. 逐步执行；`state.moduleEnabled[step.key]` 为 false 的步骤**跳过并记日志**（`:311-314`）。
5. 任一步 `ok:false` → 记 error、**立刻 return，不执行后续步骤**（`:318-322`）。
6. `finally` 里一定复位 `busy` 与 UI 状态（`:325-328`）。

`onRunModule(key)`（`:331`）走同一个 `FLOW[i].run`，所以"单跑某模块"和"全流程里的那一步"**永远是同一段代码**，不存在两套实现漂移。

**关键顺序约束**：`adjust` 在 `compose` 之前（`docs/INTERFACE.md` §15 变更 #7）。因为调色会引入智能对象/智能滤镜，先缩放画布会牵动它们的参数。

---

## 3. 模块参考（只列容易踩的地方）

### `ps.js`

| 函数 | 行 | 要点 |
|---|---|---|
| `enterModal(label, fn)` | 285 | **一切 modal 的规范入口**。内部维护 `modalDepth`；已在 modal 内时直接调用 `fn`，不嵌套 |
| `imagingCall(label, fn)` | 297 | **`imaging.*` 调用的唯一入口**。`modalDepth>0` 直接调，否则自动包一层 modal —— 真机不包必被拒（§6.3） |
| `run(descriptors, opts)` | 366 | `opts = {history:"suspend"\|"normal", preserveSelection:true, label}`。**首尾自动包 `saveDocumentSelection` / `restoreDocumentSelection`**（Adobe 自家 `app.js:26888` 惯例，不加会丢用户选区）。**忙类拒绝时等宿主空闲后整条链重跑**：`RUN_BUSY_RETRIES=8`（`:365`）、`RUN_BUSY_BUDGET_MS=300000`（`:359`）；重跑前再用 `busyGap` 补一段**递增退避**（真机 10:59:32：两次重跑挤在同一秒 = 没等，因为探针只 `get`、写命令仍被拒）。`busySafeToRetry`（`:347`）在「错误之前已有真实步骤落地」时拒绝重跑（否则调整层会叠两层） |
| `runOnce(descriptors, opts)` | 390 | `run` 的单次执行体（不含重跑）。要「绝不重跑」就用它 |
| `fileEntryForPath(path)` | 1566 | 原生路径 → UXP File entry：`resolveEntryByNativePath(父目录)` → `entry.createFile(名,{overwrite:true})`，失败再 `getEntry`。**写盘的唯一入口**（见 §6.5 的 `invalid file token used`） |
| `saveDocToFile(docId, path, format, quality)` | 1588 | **另存三级降级**：① DOM `doc.saveAs.jpg(entry,{quality},true)` / `saveAs.png(entry,{compression:6,method:"quick"},true)`（包在 `modal` 里）② batchPlay `in: await fs.createSessionToken(entry)` ③ 旧的路径字面量。每级都写 `另存生效形式 = …`（真机 11:27 确认 ① 可用） |
| `listDir(dir)` | 1650 | 列目录文件名（`entry.getEntries()`，上限 3000）。导出命名顺延靠它 |
| `subjectAlphaCoverage(layerId, budgetMs, nameHint)` | 1672 | **抠图结果的主判据**：`getSubjectPixels({applyAlpha:true, layerId})` → 统计 `rgba[i*4+3] > 8` 的占比（`channels<4` 直接报「像素不含 alpha 通道」）。返回 `{coverage, sampled, components}`；id 报 `Unknown layer` 时按名字自愈重试（`withLayerIdSelfHeal`） |
| `isUnknownLayer` / `layerIdByName` / `layerExistsById` / `selfHealLayerId` / `withLayerIdSelfHeal` | 792–860 / 1759 | **图层 id 自愈**四件套（用户 m03578）：`rasterizeLayer` 会换 id（真机 13:47:16 id=1 → 13:47:55 实际 id=2），所有按 id 的蒙版/像素读取都要带 `nameHint` |
| `runRaw(descriptors)` | 327 | 不挂历史、不包选区。只在你明确不需要撤销点时用 |
| `readBatchPlay(descriptors)` | 303 | 只读。部分宿主版本要求只读也进 modal，直接调失败会自动用 modal 重试一次 |
| `modal(label, fn)` | 315 | `enterModal` 的薄包装，留给旧调用点 |
| `probe(label, value)` | 219 | 同时写 `console.log`（UDT 用）和面板日志（`[Ecom.probe]` 前缀）。真机核对字段名就用它 |
| `snapshot()` / `restore(token)` | 543 / 564 | 取当前 `historyState` 的 id，回退 = `select` 到该 id。**id 键名是 `ID`（大写）**，历史条目里没有 `_id`/`historyStateID`（真机 17:37 日志）→ `extractHistoryIdShallow`（`:510`）按 `ID → historyStateID → _id → id` 认 |
| `pickColor()` | 473 | F28 坑：`_target` 必须是 `application`，结果在 `res[0][0].RGBFloatColor` |
| `pixelCandidates(wrap)` | 629 | F27 坑**已定案**：真机 `getPixels` 返回 `{imageData, sourceBounds, level}`，且 **`imageData` 是「可调用宿主对象」而不是类**（Adobe 自家插件 `creative_assistant/index.js:723` 直接 `await selection.imageData.getData()`、`adjustments-panel/js/ps.js:357` 直接 `imgObj.imageData.dispose()`，从不 `new`）。候选顺序：原样 → `new` → `call()` |
| `extractPixelBuffer(wrap)` | 734 | 认对象 / 函数 / 类构造器；`pickNumber`（`:244`）与 `isPixelBuffer`（`:619`）都要**接受 function 持有者**，否则 `width/height` 会被读成 null（旧 bug：`len=6 w=null h=null`）。拿到缓冲区后还要求「长度整除、通道数恰为 3 或 4」 |
| `waitHostIdle(layerId, budgetMs)` | 921 | **等宿主空闲的唯一入口**：探针 = 一次整层 get，成功即空闲；忙则按 `busyGap`（`:1011`）递增退避。`removeBackground` 之后 1~3 分钟里读被拒「获取」、写被拒「设置」，任何后续步骤前都要先过这里 |
| `hasUserMask(layerId, budgetMs, nameHint)` | 1021 | 整层 get 读 `userMaskEnabled` / `hasUserMask`（属性形式必被拒，§6.5）。被拒时按 `BUSY_BACKOFF_MS`（`:1005`）递增退避重试，**不再强制 modal**。报 `Unknown layer` 且有 `nameHint` 时按名字重解析 id 再试（§14.3 坑 1） |
| `getUserMaskCoverage(layerId, budgetMs, nameHint)` | 1045 | 占比量不出来时返回 `coverage:null` + `verdictUncertain:true`，**不把整条流程判死**；状态说「无蒙版」时用**蒙版像素翻案**（`stateContradicted:true`）。返回里带 `layerId` = 实际用到的 id（自愈后可能已变） |
| `searchQuad` / `domLayerBounds` / `layerBounds` | 1095 / 1124 / 1149 | 量主体外框。**DOM 优先取 `boundsNoEffects`**，回退 `bounds`（`bounds` 含投影/发光，§6.5）。`searchQuad` 第 4 参是**键名字符串**，不是布尔 |
| `findSubjectLayer` / `getSubjectPixels` | 1234 / 1279 | 主体定位与像素读取。`getSubjectPixels` 全程在 `imagingCall` 内 |

`run` 里的错误检测在 `ps.js:365`（用 `firstErrorItem`，`:257` 定义）；**batchPlay 失败不抛异常**，详见 §6.4。

### `store.js`

- `STORAGE_KEY = "ecom-plugin-state-v1"`（`store.js:6`）。
- `ADJUST_KEYS`（`store.js:8`）是调色项的**唯一真名表**，顺序 = 默认执行顺序：

  `["saturation","brightness","temperature","contrast","whiteBalance","exposure","sharpness","noise"]`

- `load()`（`store.js:254`）是**宽容**的：逐字段类型校验，非法值回落默认值，绝不因为旧版本残留的状态而崩。新增字段必须同时在 `defaults()`（`:58`）和 `known` 白名单（`:139`）里出现，否则刷新一次就丢。
- 旧状态里缺失的调色项会被补齐进 `order`（`:223-231`）。
- localStorage 不可用时降级为内存状态并 warn 一次（`:257-262`），不抛错。
- `addSizePreset`（`:309`）会重算 id；`removeSizePreset`（`:325`）若删掉的是 `baseSizeId`，会把它清成 `null`（`:336`）让 `index.js:70 baseSizeOf` 回落到"取最大的"。
- 预设导入导出：`exportPresets`（`:377`）/ `importPresets`（`:385`），都过 `validatePreset`（`:103`）+ `mergePreset`（`:180`）。

### `cutout.js`

主路径是**逐字照抄 Adobe 官方** `com.adobe.unifiedpanel\js\524.js` 偏移 1524042 的链（`cutout.js:3` 注释、`:30 buildCutoutChain`）：

```
:23 select(layer) → rasterizeLayer → autoCutout → [contract] → [feather]
  → :80 make(通道 mask, using revealSelection) → :65 deselect(取消选区)
  → 【仅当面板关掉「自动应用蒙版」】:80 set(userMaskEnabled:false) 把刚建好的蒙版停用
```

三条硬事实：
- **链只有这一种形状**（v7 起）。面板复选框「抠图后自动应用蒙版」**不改变这条链**，只决定末尾要不要把刚建好的蒙版**停用**。
- **`removeBackground` 不是可调用事件**（手册 A1：13 处命中全是通知事件名 / talent id / CDN URL）。功能等价，但实现路径不是那颗按钮。
- **PS 没有蒙版「收缩」属性**，只有 `userMaskFeather` / `userMaskDensity`。所以「边缘净化」的收缩作用在**选区**上，时机在建蒙版之前；`refine()`（`:251`）只做羽化。

`setMaskEnabled(ps, layerId, enabled)`（`:91`）是改蒙版启用状态的唯一入口：先试整层
`{_obj:"set",_target:[{_ref:"layer",_id}],to:{_obj:"layer",userMaskEnabled:false}}`，被拒再试「目标 = mask 通道」的回退形式（`setMaskEnabledChain`，`:80` 的第 3 参）。**只写布尔，绝不 `delete`**（§6.5）。

`remove()`（`:115`）的实际次序：抠图 → 收缩 → 羽化 → 建蒙版 →（可选）停用 → 读回占比复核。v7 **删掉了「只算选区」的分支**：抠图永远建蒙版。停用时额外写一条 warn —— 蒙版停用期间图层整层不透明，后续背景/投影/居中/调色统计会按**整张画布**算，而不是按抠出的主体算。

空蒙版检测：读出蒙版非零占比，太低就回退 `sampleAllLayers:true`（**回退链同样要带第 5 参**，漏过一次被 hostsim 抓住），两次都近空则报「PS 未找到主体」。这条来自手册 A1 的失败模式——`autoCutout` 找不到主体时**不报错**，只产出空选区。

**第 8 / 9 轮补充**：
- 抠图结果的**主判据**换成主体图层自身的像素 alpha：`ps.subjectAlphaCoverage(subject.id, 30000)`（`cutout.js:279`）在 `settleHost` 之后量「alpha>8 的占比」，日志写 `[抠图核对] 图层「X」像素 alpha 非零占比=…%`，>0.995 时 warn「整层仍不透明」；`data.alphaCoverage / alphaError` 一并返回。**真机 11:27 已能读到该像素签名**（`getLayerMask` 的 `imageData` + `getData()`）。
- 等待预算按用户 m03252「不用等那么久了，明明都生成完了，还是读不到」砍短：`settleHost` 抠图后 **30s**（`:174`，原 300s）、`MASK_REREAD_IDLE_MS` 回读兜底 **8s**（`:118`，原 90s）、`REFINE_BUSY_BUDGET_MS` **12s**（`:111`，原 20s）。等不到不再死等，交给 `ps.run` 的退避重跑去收尾。

**第 10 / 11 轮补充**：
- **抠图链跑完立刻重解析主体层 id**（`cutout.js remove()` 两跳之后）：`layerExistsById(subject.id)` 为 false 才用 `findSubjectLayer` 换 id 并写 warn「抠图后图层 id 变了（rasterizeLayer 会重建图层）：主体 id X（「背景」）→ id Y（「图层 0」）」。**旧 id 还在就绝不换** —— 换错会破坏「抠图/边缘净化/投影/构图同一图层」这条不变式（§12 第 3 组）。
- 所有蒙版读取带 `nameHint`（`subject.name`）：`readCoverage(id, ps, name)`、`getUserMaskCoverage(id, budget, name)`、`subjectAlphaCoverage(id, budget, name)`。根因与真机证据见 §14.3 坑 1。

### `adjust.js`

- `computeAuto(analysis, order)`（`:34`）是**纯函数**：输入主体统计，输出每项的自动值。没有副作用 → 可以脱离 PS 测试。
- `apply(opts)`（`:131`）按 `ORDER`（`:19`）逐项处理，单项失败不中断整体，结果里用 `applied / skipped / layers / effective / failureDetail` 分开报告（`:314`、`:322`）。
- `layerMake(typeObj, extraKeys)`（`:101`）/ `layerSet(toObj)`（`:110`）是构造调整图层描述符的两个原语。
- `execStep`（`:118`）曾被写错参数签名，导致所有调色被吞成失败——**改这里务必核对 `ps.run` 的返回信封**。
- `RANGES`（`:9`）是各键的值域，`clampByKey`（`:28`）负责夹紧。
- **第 9 轮（用户 m03252）**：饱和度与色温**共用一个**「颜色和自然饱和度」层、一次 `set` 同时写 `saturation` + `temperature`（`:262` 起，`needSat / needTemp` 决定带哪些键）。**照片滤镜回退链已删** —— 它落在最上层且**不受剪贴**，正是「整幅变暖」的直接原因。
- **回读只作诊断**：`readAdjustmentObject`（`:73`）用 `_ref adjustmentLayer + ordinal targetEnum` 的 `get`，返回可能是**类数组**（`Object.keys` 只给 `["0"]`）也可能直接是对象，两种形状都要认（`adj[0]` 兜一层）。读到 `temperature` 键说明键名对了；**读不到也不回退**。
- 亮度/对比度的「自动」：写完 `brightnessContrast(useLegacy:false)` 后依次试 `AUTO_EVENTS`（`:310`：`autoBrightnessContrast → autoBrightness → autoContrast → autoTone`），全被拒只 warn 并保留统计值（真机不可达，见 §6.5）。

### `compose.js`

`normalize(opts)`（`:65`）的实际次序**与 `INTERFACE.md` §10 的文字相反，这是有意的**（见 §15.1）：

```js
if (longSide > baseSize) { …resizeDoc（compose.js:42）等比缩到 baseSize }   // :84 先缩，避免被裁
…canvasSize(baseSize × baseSize)                                             // :100（带 anchor 失败则 :112 退回）
读主体 bounds → transform 等比缩放 → 重读 bounds → transform 位移
```

`targetEdge = baseSize * (100 - 2*marginPercent) / 100`（`:138`）：**主体最大边**占画布的 `(100-2m)%`。

缩完画布后会复核尺寸（`:123`）：不等于 `baseSize²` 时 **warn** 并指出「锚点/相对语义为 [推断] 项」（`canvasFallback` 见 `:118`）——只警告不中止，所以产物尺寸可能略有偏差，看日志确认。

### `backdrop.js`

- `setSolid(opts)`（`:86`）建 `solidColorLayer` 填充层，再 `move` 到 `ordinal:back`（`:127`）。被它隐起来的图层记进 `hiddenIds`，由 `index.js` 负责恢复。
- `addShadow(opts)`（`:177`）把 `layerEffects.dropShadow` 加在**主体层自己**身上（真机验证生效，且**跟随图层蒙版轮廓**）。
- ⚠️ **投影会撑大 `bounds`**：所以「居中」必须量 `boundsNoEffects`，否则会按「主体+投影」的外框把主体推偏（§6.5）。量外框的统一入口是 `ps.layerBounds`，别在 `backdrop.js` / `compose.js` 里自己发 `get` 描述符。

### `export.js`

`run(opts)`（`:123`）对每个尺寸：`duplicate` → `flattenImage` → `imageSize(size.w, size.h)` → `ps.saveDocToFile` → `close(saving:"no")`。
**命名与落盘（用户 m02731 / m03252 口径）**：目录 = 「输出目录」设置，未设置就用**原图同目录**（`:132`，**不再拼 `\output` 子目录**）；文件名 `nextName()`（`:155`）→ `<原名>-ps-<n>.<ext>`（`:180`，**不带尺寸后缀**），n 从 1 起、撞上目录里已存在的名字就顺延（清单来自 `ps.listDir`，`:144`）；勾「覆盖原文件」时**第一个尺寸**直接写 `<原名>.<ext>`（真的覆盖原图，`:131`），其余尺寸仍按 `-ps-N` 顺延。
另存走 `ps.saveDocToFile`（`:85`，三级降级 + 每级落日志），旧的 `saveOptions` 已删；`exportOne`（`:47`）是单尺寸实现。
防御：发现副本 id 与原文档 id 相等时**主动中止**（否则会关掉用户的文档）。

### `ui.js`

- 唯一碰 DOM 的模块。`createInstance(opts)`（`:66`）用 `el(tag, cls, text)`（`:22`）手搓 DOM，无框架。
- `setLog`（`:135`）是日志区的唯一入口；`refreshAll`（`:784`）负责整面板重绘。
- `mount` 是单例：重复 mount 会替换 `current`。
- 所有用户动作通过 `opts.on.*` 回传 `index.js`（`index.js:482` 起注册的 12 个回调），UI 本身**不含业务逻辑**。

### `analyze.js`

`subject()`（`:101`）读主体像素并交给**纯函数** `collectStats(data)`（`:13`）算统计；`clamp`（`:7`）是本地数值工具。整个模块不写文档——只读。

---

## 4. 状态模型

`state` 的完整形状见 `docs/INTERFACE.md` §3。改状态时记住三条：

1. **单一真源是 `index.js` 里的 `state` 变量**，`ui` 只是渲染它。
2. `mergeState(patch)`（`index.js:275`）= 浅合并 + `store.save` + `api.refresh`。`setState(next)`（`:285`）是全量替换。
3. **浅合并**意味着 `adjust.items` 这类嵌套对象要整体传，不能只传一个子键。

---

## 5. 硬约定（改代码前必须知道）

| # | 约定 | 为什么 |
|---|---|---|
| 1 | **不抛异常穿越模块边界**，一律返回 `{ok:false, error:"…"}` | 面板要能逐步显示"哪一步失败、宿主原文是什么"。抛异常会丢掉上下文 |
| 2 | `error` **必须含宿主原文** | 排查全靠它。吞掉 `#-25920` 之类的码等于自断手脚 |
| 3 | 只有 `ps.js` 可以 `require("photoshop")` | 见 §1 |
| 4 | 不新增 `<script>` 标签打乱顺序；新文件要加在**依赖它的文件之前** | 加载即执行，顺序即依赖 |
| 5 | 引擎模块（`ps/store/analyze/cutout/backdrop/adjust/compose/export`）**不得依赖 `ui`** | 否则无法脱离面板做测试 |
| 6 | 需要新增调色项时，`store.js` 的 `ADJUST_KEYS`（`:8`）与 `adjust.js` 的 `ORDER`（`:19`）必须同时改 | 两处不一致 → 该项被静默忽略 |
| 7 | 新增 state 字段要同时改 `defaults()` 和 `known` 白名单 | 否则刷新即丢 |
| 8 | **`imaging.*`（`getPixels` / `getLayerMask` / `imageData.getData`）必须走 `ps.imagingCall`** | 不在 modal 作用域内必被拒：`The requested functionality is only allowed from inside a modal scope ... (#1000)`（真机 17:38:49） |
| 9 | **改蒙版启用状态只 `set`，永不 `delete` 通道** | 建完蒙版后"当前通道"就是那个蒙版，`delete channel targetEnum` 删掉的是蒙版本身（`docs/INTERFACE.md` §11 第 17 条，四组对照实验） |
| 10 | **不用 `app.runMenuItem`，不弹原生对话框** | 真机实测 `runMenuItem` 之后 PS 对 COM 持续 `RPC_E_SERVERCALL_RETRYLATER`（外部脚本和用户界面一起卡死），只能 AppActivate + ESC 救回来 |
| 11 | **诊断读取不得阻塞主流程** | 「读蒙版状态」曾被写成硬等 45s（候选 9×5s），真机 71 次重试全失败。诊断类调用一律带预算，超时按「未知」继续 |
| 12 | **忙类拒绝（`命令"X"当前不可用`）意味着命令根本没执行 → 可以先 `waitHostIdle` 再重跑整条链**；但链里错误之前已有真实步骤落地时**禁止重跑** | 真机 09:55 一键：抠图后的 2.5 分钟里读被拒「获取」、写被拒「设置」，边缘净化的 `set` 就死在这里。重跑安全的前提是「没落地」，见 `ps.busySafeToRetry`（`ps.js:347`） |
| 13 | **调色层一律剪贴到主体层**（`adjust.js` 的 `layerSet` 带 `clipping:true`，`adjust.js:102`） | 用户要求「调色只应用到选中的主体图上，而不是调全部图层」（m02477）。剪贴的 AM 键名 `clipping` 由 `Clpg` 惯例映射而来，**真机未复验**，失败只在日志里 |
| 14 | **一次流程只解析一次主体层**，各步复用同一个 id（`index.js resolveRunSubject()`） | 真机同一次一键里抠图日志写「背景」、接地投影却选了「图层 0」(id=3) → 蒙版落在一层、投影/构图落在另一层，用户看到的就是「没有应用蒙版」 |

---

## 6. Photoshop 描述符开发指南 ★

这一节是本项目的核心风险区：**写错的描述符不会在语法检查里报错，只会在真机上失败，而我们没有热重载**。

### 6.1 判断"某个事件到底存不存在"的正确方法

**❌ 不能用 `stringIDToTypeID`**：它对你给的任何垃圾串都会**即时创建**一个 ID 并成功返回。用 `zzzTotalGarbageStringID_XYZ_123` 试，它会回一个合法 typeID（实测 `4175`，自造的 `dshBogusNameA/B/C` 分别得到 `4244/4245/4246`）。基于它做的"存在性检测"全是假阳性。

**✅ 正确判据**：`charIDToTypeID` + `typeIDToStringID` **反查**——给它一个 4 字符 code，看它反查出的名字是不是你期望的：

```js
typeIDToStringID(charIDToTypeID("Mk"))   // → "make"
```

本机实测反查表（可用于交叉验证你自己的猜测）：

| code | 反查结果 | | code | 反查结果 |
|---|---|---|---|---|
| `Mk` | `make` | | `Exps` | `exposure` |
| `GsnB` | `gaussianBlur` | | `AdjL` | `adjustmentLayer` |
| `CnvS` | `canvasSize` | | `UsrM` | `userMaskEnabled` |
| `ImgS` | `imageSize` | | `RvlA` | `revealAll` |
| `FltI` | `flattenImage` | | `Msk` | `mask` |
| `Dplc` | `duplicate` | | `ClrB` | `colorBalance` |
| `HStr` | `hueSaturation` | | `BrgC` | `brightnessEvent` ← 真名不是 brightnessContrast |

**注意 4 字符 code 会碰撞**：`intr` 反查是 `interfaceIconFrameDimmed`（不是 interface），`Grn` 反查是 `grain`（不是 green）。反查为空（`UnSf` / `RdNs` / `Thre` / `PhtF` / `SlcS`）**不代表事件不存在**，只代表那个 code 不对。

### 6.2 Action Manager 会在很多地方失灵 → 能 DOM 就 DOM

真机探针结论：**调整类事件在 Action Manager 侧大面积失败**（`hueSaturation`、`brightnessContrast`、`photoFilter`、`colorBalance`、`exposure` 全部 `#-1715`），但同一批功能在 **DOM 侧可用**：

```
adjustBrightnessContrast(DOM)  OK
photoFilter(DOM)               OK
adjustColorBalance(DOM)        OK
applyUnSharpMask(DOM)          OK   ← 且会生成智能滤镜（filterFX）
applyGaussianBlur(DOM)         OK
applyMedianNoise(DOM)          OK
```

> **⚠ 证据边界**：这些是 **ExtendScript 侧**的实测结果（`verify\probe*.jsx`）。ExtendScript 里的 `-25920` / `-1715` **不构成"UXP 侧也不可用"的证据** —— 两个运行时的调用面不同。UXP 侧必须独立复测后才能下结论。
> 这条是本次交付里最容易被误用的一点：别拿探针报告当 UXP 的结论。

### 6.3 `executeAsModal`、`imaging.*` 与"忙碌期"

- 所有改文档的操作都必须在 `executeAsModal` 回调内 —— 统一入口是 `ps.enterModal`（`ps.js:282`），旧调用点走 `ps.modal`（`:312`）。
- **`imaging.*` 是一条独立的硬约束**：`imaging.getPixels` / `imaging.getLayerMask` / `imageData.getData()` 若不在 modal 作用域内会被直接拒绝（真机 17:38:49）：

  ```
  The requested functionality is only allowed from inside a modal scope.
  See https://www.adobe.com/go/ps_executeasmodal for details. (#1000)
  ```

  → 一律走 `ps.imagingCall(label, fn)`（`:294`）：不在 modal 内就自动包一层，已在 modal 内就直接调（不嵌套）。
  `docs/RESEARCH-descriptors.md` 的 F26 曾写「getPixels 不需要 executeAsModal」—— **已被真机推翻**。
- `suspendHistory` / `resumeHistory` 必须**成对**，且**都在 modal 回调内**；`resumeHistory` 放 `try/finally` 的 finally 位置，连失败都只 warn。漏掉它会让历史面板卡住。
- **modal 之内也有"忙碌期"**：`autoCutout` / `removeBackground` 是异步的（大图上要跑几分钟），之后 PS 会拒绝**所有**描述符 —— 读被拒 `命令"获取"当前不可用`、写被拒 `命令"设置"当前不可用`，被拒的不是某一颗事件。真机实测（09:55 一键，4080×1836 图）：抠图后 **2.5 分钟**里 13 次探测全被拒，紧接着的边缘净化 `set` 直接失败，一键就停在那里。
  - 等空闲用 `ps.waitHostIdle(layerId, budgetMs)`（`ps.js:921`）：探针 = 一次整层 get，成功即空闲。
  - 退避必须用 `ps.busyGap`（`:1011`）**按剩余预算裁剪**：表用尽时沿用最后一跳，预算耗尽返 0。旧写法直接取表项，12 条表合计只有 72s，于是 `budgetMs=120000` 的等待永远到不了上限就自己判失败（真机日志：`已等 72000ms / 上限 120000ms`）—— 这是「抠图完成了但检测不到蒙版」的最后一层原因。
  - 整条链要不要重跑见 §5 第 12 条（`ps.run` 自动做，`ps.runOnce` 不做）。
- **诊断读取要有预算**：读蒙版状态/占比这类"只为写日志"的调用一律带 `busyBudgetMs`，超时按「未知」继续，绝不把一键流程卡在诊断上。

### 6.4 batchPlay 失败**不抛异常**

失败项以 `{_obj:"error"}` 混在返回数组里。`ps.run` 用 `firstErrorItem`（`ps.js:257`）逐项扫描，`describeErrorItem`（`ps.js:266`）负责把宿主原文捞出来。
**任何直接调 `batchPlay` 而不检查 `_obj === "error"` 的代码都是错的** —— 它会一路"成功"到最后一无所获。（`adjust.js` 就出过一次这个 bug：真值判断把失败当成功。）

### 6.5 经典陷阱表

| 现象 | 原因 | 处理 |
|---|---|---|
| `#-1715` 发生了常规 Photoshop 错误 / 不能完成命令，因为程序错误 | 事件在当前上下文不可用（无目标对象、GUI 状态中毒…） | 换 DOM 路径；或确认是否在 modal 内 |
| `#-25920` 发生了常规 Photoshop 错误 / 命令"X"当前不可用 | 同上，且常伴"GUI 中毒" | 见下一条 |
| `newPlacedLayer` 弹出「转换为智能对象」**原生对话框**，且之后该文档持续 `-25920/-1715`，`suspendHistory` 也救不回来 | `displayDialogs = NO` **挡不住原生对话框**；对话框挂起后文档进入中毒状态 | 真中毒了只能**关掉该文档重新打开**；批量流程里要避免半途留下挂起对话框 |
| `saveAs` JPEG 报 `#1239 指定值大于最大允许值` | quality 合法区间是 **0..12**（实测 12 通过、13 失败） | clamp 到 0..12 |
| `saveAs(asCopy=true)` 之后立刻读 `doc.path` 抛 `#8103 尚未存储该文档` | 副本尚未落盘 | 保存后等 `save` 结果，别提前读 `path` |
| 只读 `batchPlay` 报"必须模态" | 部分宿主版本要求只读也进 modal | 用 `ps.readBatchPlay`（`ps.js:300`），它会自动重试 |
| 批处理把用户选区搞丢 | 没包 `saveDocumentSelection` | 用 `ps.run`（默认 `preserveSelection:true`） |
| `multiGet` 拿到的 `width._value` 不是像素 | 它是文档分辨率单位下的值 | 乘 `resolution / 72` |
| `autoCutout` 返回成功但图层看起来没了 | 找不到主体 → 空选区 → "全隐藏"蒙版 | 检测蒙版非零占比（`cutout.js`） |
| 属性 get（`_property:"userMaskEnabled"` / `"hasUserMask"` / `"historyState.name"`）报 `命令"获取"当前不可用` | PS 2026 上**属性形式的 get 大面积失效**，整对象 get 仍可用（真机 S1 整对象 OK / S2 属性 FAIL） | 取**整层对象**（`{_obj:"get",_target:[{_ref:"layer",_id}]}`）后在返回结构里找键；`snapshot()` 同理 |
| `imaging.getPixels` 返回的 `imageData` **是函数不是对象** | 真机返回 `{imageData: <function>, sourceBounds:{left,top,right,bottom}, level}`。它**不是类构造器**，而是 UXP 的「可调用宿主对象」：`getData` 挂在它自己身上 | **原样就用它**（Adobe 自家插件正是 `await x.imageData.getData()`）。`ps.pixelVariants`（`ps.js:651`）依次试 原样 → `new` → `call()`；真机日志靠 `探测 getPixels.buffer` 里的 `how` 字段自证走了哪条 |
| `getLayerMask` 返回 `{imageData, sourceBounds}`，没有顶层 `width/height` | 真机 17:59 探针 | 同上。`imageData` 也可能是函数 |
| 蒙版"建完又没了" | `make(…mask…)` 之后**当前通道就是那个蒙版**，链尾的 `delete channel targetEnum` 删掉的正是蒙版本身 | 链尾改 `deselect`；要停用蒙版用 `set userMaskEnabled:false`（INTERFACE §11 第 17 条） |
| 量主体外框时投影把主体推偏 | **`bounds` 包含图层样式**：真机实测 600×600 的层加 `dropShadow(distance18/size25/opacity75)` 后 `bounds` 从 `0,0,600,600` 变成 `-5,0,605,623` | 一律优先 `boundsNoEffects`（`ps.layerBounds`），回退 `bounds` 时落 warn |
| `app.runMenuItem(...)` 之后 PS 对外部脚本持续 `RPC_E_SERVERCALL_RETRYLATER` | `runMenuItem` 走 GUI 菜单通道，把 PS 卡在忙状态（用户界面也点不动） | **不要用 `runMenuItem`**。已卡住时：`WScript.Shell` → `AppActivate(<PS PID>)` → `SendKeys("{ESC}")` |
| 外部脚本/探针留下一堆打开的测试文档 | 脚本中断时不会有清理 | `app.documents[i].close(SaveOptions.DONOTSAVECHANGES)` 逐个关。**杀掉 pwsh 作业并不能停掉已经在 PS 里跑的 jsx** |
| `getPixels` 取到 `len=6` 却 `w=null,h=null` → 判「无法确定像素宽高与通道数」 | `ps.pickNumber` 旧写法只认 `typeof === "object"`，把**函数持有者自带的 `width/height` 全读成 null**（`isPixelBuffer` 同病） | `pickNumber` / `isPixelBuffer` 放宽到也接受 `function`（`ps.js:244` / `ps.js:578`） |
| 面板说「已应用蒙版」，用户却说「没有应用蒙版」：抠图的蒙版落在「背景」，紧接着接地投影却选了「图层 0」 | 每个步骤各自 `findSubjectLayer()` 解析一次主体层 —— 真机 09:32:43 日志里抠图作用于 id=4「背景」、投影作用于 id=3「图层 0」 | 编排层**一次流程只解析一次**：`index.js` 的 `resolveRunSubject()`，把 `subjectLayerId/Name/Kind` 传给 `cutout.remove` / `cutout.refine`（`cutout.js` 的 `resolveSubject()`）；回归用 spy 断言锁定后不再调用 `findSubjectLayer` |
| 另存报 `Error: invalid file token used` | UXP 的 batchPlay `save` 要的是**文件令牌**或 DOM File entry；`in:{_kind:"local",_path}` 这类路径字面量不是令牌（ExtendScript 的 `putPath(In)` 能用，UXP 不行） | 走 `ps.saveDocToFile`（`ps.js:1588`）：① DOM `doc.saveAs.jpg(entry,…)`（`entry` 来自 `fileEntryForPath`，`:1566`）② `in: await fs.createSessionToken(entry)` ③ 旧路径字面量。每级写 `另存生效形式 = …`（真机 11:27 确认 ① 可用） |
| 忙期里 `get` 已经能用，紧接着的 `set` 仍报 `命令"设置"当前不可用 #-25920` | 宿主的**读通道比写通道先恢复**；`waitHostIdle` 的探针是整层 `get`，「探针说空闲」≠「能写」 | 重跑前补递增退避（`ps.run`，`:366`）并把重试提到 8 次；真机 10:59:32 两次重跑挤在同一秒就是漏了这步 |
| 调整层 `get` 回读的 `adjustment` 是类数组（`Object.keys` → `["0"]`） | batchPlay 把 `get` 的返回值包成了带数字键的对象 | 回读助手两种形状都认（`adjust.js:73`）；**只作诊断**，别因形状不同把已生效的写入判失败 |
| `stringIDToTypeID("某事件名")` 成功返回 → 以为事件存在 | 它**会即时 mint 一个新 ID**（不存在也成功） | 有效判据：① DOM 侧真调一次（例：`layer.autoContrast()` 能用、历史状态名「自动对比度」）② `charIDToTypeID` + `typeIDToStringID` 反查。真机结论：调整层的「自动」按钮**没有可达事件名**，`autoBrightnessContrast/autoBrightness/autoContrast/autoTone` 全被拒 |
| 抠图后「蒙版」读不到 / 面板长期「待确认」 | PS 27.1 的「移除背景」是**擦像素**路径（副本实验：跑完 4 个图层 mask 全 `none`，只有 bounds 变了）；且它**异步锁死**期间连别的文档的 AM 命令都可能被拒 | 主判据改成**主体像素 alpha 占比**（`ps.subjectAlphaCoverage`，`:1672`）；蒙版状态只作尽力回读，读不到不影响抠图结论 |
| 调色后整幅图变暖 / 剪贴像是没生效 | 「照片滤镜」层落在**最上层且不带 clipping**，于是作用于整幅画面 | 色温已并进「颜色和自然饱和度」层（与饱和度同层、同一次 `set`），该层照样参与统一剪贴（`clipStepFor`，`adjust.js:125`） |
| `removeBackground` 之后立刻回读蒙版全被拒（`命令"获取"当前不可用`）→ 面板只能显示「待确认」 | `removeBackground` 是**延迟命令**，PS 随后会忙十几秒（真机 09:32:16 读不到、09:32:43 就读到了） | 回读预算给足（`BUSY_BACKOFF_MS`）；一键流程**收尾再核对一次**（`index.js` 的 `verifyMaskAtEnd()`），把「待确认」升级成确定结论 |
| `[输出目录] openPath 被拒（Extension "" is not accepted for the path …）` | UXP 的 `shell.openPath` 只放行 manifest 声明过的扩展名，**目录的扩展名是空串 `""`**；而且键名是 `requiredPermissions.launchProcess`（写成 `launch.process` 一律无效）+ 必须在 `extensions` 里显式列 `""`。**改 manifest 必须完全退出 PS 再重开**才会重新读 | 三个文件同时改：`manifest.json` 用 `launchProcess{extensions:[…,""]}`；`index.js onOpenOutputDir` 按官方语义处理返回值（**成功 resolve 空串、失败 resolve 错误文本**，不是只有 reject）；真机 13:32 的被拒原文见 §12 |
| 真机 12:48:26 日志「剪贴到主体：成功 1/1 个调整层（层 id=4）」，面板却只有最上面那张调整层带剪贴箭头 | 亮度/对比度那一支**自己建层、没走 `record()`**，于是漏掉「把刚建好的层 id 记进 `clipIds`」 | 凡是 `layerMake(...)` 之后都要 `activeLayerIdDom(ps)` 收进剪贴名单（`adjust.js` vibrance/BC 两支各记一次） |
| 真机 12:40:45 抠图第一跳（`removeBackground`）完成，第二跳（建蒙版）8 次重试全被拒：`命令"选择"当前不可用` | `removeBackground` 之后 PS 仍锁死描述符通道 ≥30s（12:41:45 探测还在报「命令"获取"当前不可用」），默认 8 次重试只够 30s | `ps.run` 支持 `busyRetries`/`busyBudgetMs` 覆盖；抠图**第二跳**给 40 次 / 10 分钟（第一跳 8 次） |
| 抠图「读不到蒙版」/ 边缘净化卡死十几分钟（真机 13:06:48→13:08:48） | **`removeBackground` 排第一跳时，跑完会把 PS 的描述符通道锁死 ≥16 分钟**：后续第 37..40 次重试仍是「命令"选择"当前不可用」，第二跳「建蒙版」永远跑不到 | 抠图主路必须是**选区链**（`select→rasterizeLayer→autoCutout→contract→feather→make mask`，几秒内删背景并建好蒙版）；`removeBackground` 只在选区链被拒时兜底（`cutout.js remove()`，用户 m03510） |
| 同一图层 13 秒内「有蒙版」→「没有蒙版」 | **整层 get 会瞬时报无蒙版**：13:31:32 边缘净化读到「原有蒙版=是」，13:31:45 阴影这步读到 `hasMask=false` → 弹出「投影会呈矩形」假警告 | 一切「有没有蒙版」的判断都要用**蒙版像素翻案**：`ps.getUserMaskCoverage`（状态说无 → 再读一次蒙版像素，成功则 `hasMask:true` + `stateContradicted:true`）；`backdrop.js` 已按此兜底 |
| 面板「未测出 / 待确认」 | 像素 alpha 走 `getPixels({applyAlpha:true})` 真机可能返回 **3 通道**（`channels=3`），量不出 alpha | 逐级降级：alpha → **蒙版像素占比**（`getUserMaskCoverage`，真机 11:37 读到非零占比 9.14%）→ 才写「未测出」；面板文案带来源（`alphaSource==="mask"` → 「按蒙版像素」） |

### 6.6 加新描述符的安全流程

1. 在 `docs/RESEARCH-descriptors.md` 里搜 —— 先确认它有没有被本机取证过。手册条目带**证据等级**（`[本机取证]` / `[推断]` / `[官方文档]`），只有前两者可用。
2. 用 §6.1 的反查法确认事件名，别信"我记得叫这个"。
3. 在 `ps.js` 里加/改函数，保持 `{ok, error, data}` 信封。
4. 需要核对返回结构的地方用 `ps.probe(label, value)` 埋点（会同时进 UXP 日志和面板日志）。
5. **写自适应而不是硬编码**：字段名不确定就都试一遍（参考 `extractPixelBuffer`，`ps.js:638`）。猜错时降级而不是崩。
6. 改完跑 `node --check`，然后走 §7 的装机流程**在真机上确认**。描述符的正确性**没有静态检查能替代真机运行**。

---

## 7. 本地开发循环

### 7.1 代码在哪、生效的是哪份

| | 路径 |
|---|---|
| **源**（改这里） | `C:\Users\EDY\Desktop\ps电商图片制作插件\plugin\` |
| **生效副本**（PS 读这里） | `%APPDATA%\Adobe\UXP\Plugins\External\com.ecom.psimage\` |

`install.ps1` 用 SHA-256 对比文件树，内容一致就 `[SKIP]`，**幂等**。所以日常循环是：

```powershell
# 1. 完全退出 Photoshop（脚本会检查进程，还在跑就直接 [FAIL]）
# 2. 改 plugin\ 下的源文件
# 3. 重装 + 起来
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

改完装完，在 PS 里打开面板：**窗口 → 增效工具（Plugins）→ 电商图片制作**。
面板已经在开的话，**关掉面板再重新打开**才会重新执行 JS —— 没有热重载。

> 直接改生效副本能跳过装机，但下次 `install.ps1` 会覆盖它（内容不同就先备份改名）。**以源为准**，别养成改副本的习惯。

### 7.2 这台机器上没有 UXP Developer Tool

后果，以及替代做法：

| UDT 能做的 | 这里的替代 |
|---|---|
| 热重载插件 | 关面板再开 / 重装 + 重启 PS |
| DevTools 控制台 | ★ **3P 插件的 `console.log` 不进 UXPLogs**（实测：全部 UXPLogs 里 `com.ecom.psimage` 0 命中，里面只有 Adobe 自家 1P 插件的 console）→ 改用 `ps.log()` 落盘，见 §7.3 通道 B |
| 断点调试 | 用 `ps.probe()` 在关键分支打点，从日志倒推 |
| 加载未打包插件 | 不需要 —— 我们**只能**走未打包目录（本机没有 CC Desktop，`.ccx` 双击无程序接管） |

### 7.3 看日志

**两条通道，用途完全不同，不要混：**

**通道 A · 插件是否被加载** —— 只有这里能看：
```
%APPDATA%\Adobe\Adobe Photoshop 2026\Logs\UXPLogs_*.log
```

按修改时间取最新一份。加载成功的标志：

```
upic::Loading plugins from user fallback plugins folder: C:\Users\EDY\AppData\Roaming\Adobe\UXP\Plugins\External
upic::Number of plugins added from user's fallback: 1
```

三条要会分辨：

| 日志里看到 | 含义 | 处理 |
|---|---|---|
| `Failed to read plugin info file: …\PluginsInfo\v1\PS.json` | **正常**，本机没有 CC Desktop 的插件索引 | 不理 |
| `Expected the icon to have a 1X scaled file` | 声明了 `icons` 但缺 1x 图（**不阻断**） | 本项目的 manifest 不声明 `icons`，就是为了避开它 |
| 完全没有插件 id / `NotDevMode`（「无法载入增效工具，因为开发人员模式已禁用」） | 开发模式没开或没重启 PS | 编辑 → 首选项 → 增效工具 → 勾选「启用开发人员模式」→ 重启 PS |

---

**通道 B · 插件运行期日志** —— ★ 真机实测：**3P 插件的 `console.log` 不写进 UXPLogs**。

取证方法（对全部日志文件搜插件 id）：
```powershell
$logs = Get-ChildItem "$env:APPDATA\Adobe\Adobe Photoshop 2026\Logs\UXPLogs_*.log"
(Select-String -LiteralPath $logs.FullName -Pattern 'com\.ecom\.psimage' -Encoding UTF8).Count
```

实测结果 **0** —— UXPLogs 里只抓得到 Adobe 自家 1P 插件（CCX Start 等）的 console 输出。

→ 所以运行期的错误原文只能靠 **`ps.log()` 落盘**（契约 §4 的 `ps.logFilePath()`）。
面板日志区标题会显示日志文件的**实际路径**；取不到时显示「日志落盘不可用」。

**运行期排错一律看这个文件，不要去翻 UXPLogs。**

**★ 关键**：UXP 面板的 HTML/JS 是**首次打开面板时**才执行的。所以"日志干净"只证明**注册成功**，不证明**运行正常**。如果面板打开后没有任何 `[Ecom.probe]` 输出，说明 JS 没跑起来 —— 先去日志里找解析错误。

### 7.4 改完的自检清单

1. `node --check` 全部 JS。
2. grep 确认没有新增第二处 `require("photoshop")` 真调用：
   `Select-String -Path plugin\**\*.js -Pattern 'require\("photoshop"\)' -Encoding UTF8`
   预期命中 2 处：**`ps.js:31`（真调用）和 `ps.js:2`（注释里提到）**。多于 2 处就是有人破了约定。
3. grep 确认没有 ESM / CJS 本地 import（`^import ` / `^export ` / `require("./`）。
4. grep 确认引擎模块没有引用 `Ecom.ui`（`src\ui.js` 自己除外）。
5. 装机 → 起 PS → 打开面板 → 看 `[Ecom.probe]`。
6. grep 确认没有新增 `runMenuItem` 或「`delete` + `channel targetEnum`」的用法：
   `Select-String -Path plugin\**\*.js -Pattern 'runMenuItem|delete.{0,120}channel' -Encoding UTF8`
   预期命中 0 处。

---

## 8. 测试资产

| 资产 | 内容 |
|---|---|
| `verify\probe.ps1` | 通过 COM（`Photoshop.Application` → `Photoshop.exe /Automation`）拉起 PS 并跑 `.jsx`，带超时保护 |
| `verify\probe.jsx` (788 行) | 主体探针：反查表、DOM/AM 可用性、saveAs 边界、蒙版、智能滤镜 |
| `verify\probe2.jsx` / `probe4.jsx` | 追加探针（智能滤镜与中毒态复现） |
| `verify\out\*.log` | 探针原始输出（**排查描述符问题的第一手资料**） |
| `%TEMP%\ecom-hostsim.js` (55526 B) | 宿主交互模拟：自建假 `photoshop` 模块 + `vm` 加载引擎层，验证信封、参数传递、错误分支：**124 项 / 失败 0** |
| `%TEMP%\ecom-v3-probe2.js` (16938 B) | 契约探针：抠图链形状、蒙版启用/停用步骤、`bounds` 来源、失败后不再发描述符：**27 项 / 失败 0** |
| `%TEMP%\ecom-v6-check.js` (16781 B) | v6/v7 定向检查：modal 作用域（不在 modal 内就抛 `#1000`）、`historyState` 的 `ID` 键名、`imageData` 的函数/类形态、抠图链两条分支：**62 项 / 失败 0** |

后三个在临时目录，可能被系统清理。它们都不依赖真实 PS —— 用一个假 `photoshop` 模块喂给引擎层，验证信封、参数传递、错误分支。**改引擎层后值得重跑**，因为它能在 1 秒内发现签名漂移。

探针脚本用的是 ExtendScript，**只能证明 ExtendScript 侧的行为**（见 §6.2 的证据边界）。要在 UXP 侧取证，唯一的办法是往 `plugin\` 里加探针代码 + `ps.probe()`，然后看 §7.3 的日志。

---

## 9. 还没查清的事（3 项埋点 + 3 个语义问题）

这 3 个字段名在写代码时没能从任何一手资料里确认，实现全部写成**自适应 + 日志**。真机首跑时日志里会出现对应的 `[Ecom.probe]` 行，用来回填正确答案：

| # | 待确认 | 埋点位置 |
|---|---|---|
| 1 | `duplicate` / `make` 返回结构中新图层 id、新文档 id 的**字段名** | `ps.js` / `cutout.js` |
| 2 | `exposure` 的**三个参数键名** | `adjust.js` |
| 3 | `canvasSize` 的 `anchor` / `relative` **键名** | `compose.js`（回退写法在 `normalize` 内） |

**已定案**（原第 2 项）：`imaging.getLayerMask` 返回 `{imageData, sourceBounds}`，且 `imageData` 与 `getPixels` 一样**可能是函数**；`extractPixelBuffer` 已按对象/函数/类三种形态自适应。

仍无确证的语义：

- `imaging.getPixels` 的 `applyAlpha` 是"合成掉 alpha"还是"附加 alpha 通道"（手册 F26）。**当前实现不依赖它** —— 只按「长度整除 + 通道数 3 或 4」验证。
- **`set userMaskEnabled` 这个写入方向尚未在真机上跑通**（ID 对应已取证：`UsrM | 1433629261 | userMaskEnabled | ✅`）。代码留了两套形式（整层 `set` → mask 通道 `set`），真机日志会给结论。
- `canvasSize` 的 `relative:false` 在 PS 2026 上的确切语义（手册标为 `[推断]`）。

---

## 10. 常见改动怎么做（配方）

**加一个调色项**（例如"色阶"）
1. `store.js:8` `ADJUST_KEYS` 加键名。
2. `store.js:58 defaults()` 的 `adjust.items` 加 `{enabled, auto, min, max, value}` 默认值。
3. `adjust.js` 的 `ORDER`（`:19`）、`RANGES`（`:9`）、`computeAuto()`（`:34`）分支、`apply()`（`:131`）落地分支（调整图层用 `layerMake`，滤镜用智能对象）。
4. `ui.js` 的渲染循环会自动带出（它遍历 `ADJUST_KEYS`），若要特殊控件再改。

**加一个内置尺寸**
`store.js:58 defaults()` 的 `sizes` 数组加 `{id, w, h, label, enabled, builtin:true}`。**注意**：基准画布是正方形，加非正方形尺寸会导致主体拉伸（`docs/PLAN.md` §13 第 2 条）。

**加一个导出格式**
`export.js:33 saveOptions(format, quality, ps)` 加分支 + `exportOne`（`:47`）里的后缀映射。JPEG quality 记得 clamp 到 0..12。

**改留白 / 构图规则**
`compose.js:65 normalize`，其中 `:138` 是留白公式。改完**必须更新 `docs/INTERFACE.md`** 里对 `compose` 的描述 —— 这个文件的文字与实现已经漂移过一次（§15.1）。

**改面板布局/控件**
`ui.js:66 createInstance`，配 `styles.css`。业务逻辑不要写进 `ui.js`，通过 `opts.on.*` 回传 `index.js`。

---

## 11. 文件清单

行数 = UTF-8 解码后的真实行数；字节 = 文件长度。

行数 = UTF-8 解码后的真实行数；字节 = 文件长度。

| 文件 | 行 | 字节 |
|---|---|---|
| `manifest.json` | 30 | 692 |
| `index.html` | 22 | 635 |
| `index.js` | 563 | 20294 |
| `styles.css` | 362 | 4945 |
| `src\ps.js` | 1406 | 65444 |
| `src\store.js` | 413 | 17253 |
| `src\ui.js` | 940 | 36405 |
| `src\adjust.js` | 337 | 13530 |
| `src\cutout.js` | 366 | 19820 |
| `src\backdrop.js` | 280 | 12164 |
| `src\export.js` | 195 | 8062 |
| `src\compose.js` | 219 | 10272 |
| `src\analyze.js` | 142 | 4819 |
| **合计** | **5275** | **214335** |

`manifest.json` 要点：`manifestVersion:5`、`id:"com.ecom.psimage"`、`main:"index.html"`、`host:{app:"PS", minVersion:"24.0", data:{apiVersion:2}}`、一个 `type:"panel"` 的 entrypoint、`requiredPermissions.localFileSystem:"fullAccess"`、**不声明 `icons`**（见 §7.3）。

---

## 12. v6 / v7 真机回归索引

这一轮（v6 → v7）改的都是「不开 PS 就看不出来」的东西，落点分散，索引如下。每条的现象 / 根因 / 证据在 `docs/INTERFACE.md` §11 的表格里（第 17–20 条）。

| 现象 | 代码落点 |
|---|---|
| 一键卡在抠图后（读蒙版状态被拒 71 次） | `ps.js` `hasUserMask` 的 `BUSY_BACKOFF_MS`；所有诊断调用带 `busyBudgetMs` |
| 调色报「主体统计失败」 | `ps.js` `imagingCall` + `pixelCandidates` / `extractPixelBuffer` + `getSubjectPixels` 的尺寸验证 |
| 回退功能（历史快照）从来不可用 | `ps.js` `extractHistoryIdShallow`（认大写 `ID`） |
| 投影被算成矩形 / 主体被推偏 | `ps.js` `layerBounds` / `domLayerBounds`（**`boundsNoEffects` 优先**）、`cutout.js:291 subjectBounds` |
| 抠图面板「抠图后自动应用蒙版」 | `ui.js` 复选框 → `store.js` `cutout.autoMask` → `index.js cutoutAutoMask()` → `cutout.js setMaskEnabled` |
| 蒙版明明有，面板却显示「覆盖=0%」 | `index.js summarize()`：`maskCoverage===null` 显示「未知」，不再被 `Number(null)||0` 变成 0% |
| 抠图链丢了「回退到所有图层」 | `cutout.js`：回退链必须带第 5 参 `sampleAllLayers:true`（漏过一次，被 hostsim 抓住） |
| 抠图后「读不到蒙版」/ 边缘净化卡死 | 链序错：`removeBackground` 排第一跳会锁死描述符通道十几分钟；且整层 get 会谎报无蒙版 | `cutout.js remove()` 主路换回**选区链**、`removeBackground` 降为兜底；`ps.getUserMaskCoverage` 用蒙版像素翻案（用户 m03510 真机日志） |
| 面板「已应用=待确认」，用户说「还是没有应用蒙版」 | ① 主体层不一致：各步各自 `findSubjectLayer()`（真机 09:32:43：抠图 id=4「背景」/ 投影 id=3「图层 0」）→ `index.js resolveRunSubject()` + `cutout.js resolveSubject()` 全流程锁一个 id；② `removeBackground` 延迟执行期间回读必被拒 → `index.js verifyMaskAtEnd()` 收尾再核对一次 |
| 调色 / 覆盖率双双「取不到像素」（`Class constructor PhotoshopImageData cannot be invoked without 'new'`） | `ps.js pixelVariants`：函数候选依次试 原样 → `new` → `call()`（真机上它是可调用宿主对象，直接 `.getData()` 才对）；配套 `pickNumber` / `isPixelBuffer` 接受 `function`，否则尺寸读成 null |
| 面板「覆盖=未知」永远量不出来 | 同上一行 —— 覆盖率走 `imaging.getLayerMask` → `extractPixelBuffer`，同一个根因。修好后若占比 > 0.98，`cutout.js` 会 warn「整张画布都保留」 |
| 抠图完成后仍然「检测不到蒙版」/ 一键停在抠图或边缘净化 | 等待预算被退避表卡死：`ps.busyGap`（`:1011`）按剩余预算裁剪退避（旧写法 12 条表合计只有 72s，`budgetMs=120000` 永远到不了上限）；等空闲一律走 `ps.waitHostIdle`（`:921`）；`cutout.js settleHost`（`:164`）抠图后等 300s；`ps.run`（`:361`）忙类拒绝后等空闲再整链重跑，`busySafeToRetry` 保证**不重跑已落地的步骤** |
| 另存报 `Error: invalid file token used`（导出全失败） | `ps.js saveDocToFile`（`:1588`）+ `fileEntryForPath`（`:1566`）：DOM `saveAs` 优先、其次会话令牌、最后路径字面量 |
| 导出命名/目录不合口径（`_1254x1254` + `output\` 子目录） | `export.js run()`：`dir`（`:132`）、`listDir`（`:144`）、`nextName`（`:155`）；`overwrite` 时首个尺寸写回原名（用户 m02731 / m03252） |
| 用户说「还是检测不到蒙版」 | 主判据换成像素 alpha：`ps.subjectAlphaCoverage`（`:1672`）+ `cutout.js:279`；`index.js summarize()` 显示「已抠图（主体像素占比 X%）」，蒙版状态降级为尽力回读 |
| 调色后整幅变暖 /「颜色和自然饱和度」建了两个 | `adjust.js`：饱和度+色温合到**一个** `vibrance` 层（`:262`），照片滤镜链删除 |
| 等太久（明明算完了还读不到） | `cutout.js` 30s / 12s / 8s（`:174` / `:111` / `:118`）+ `ps.run` 的退避重试（`:366`） |
| 调色把整张画布都调了（用户要求只调主体） | `adjust.js` 的 `layerSet` 带 `clipping:true`（`:102`）把调整层剪贴到主体层；`index.js stepAdjust` 传锁定主体 id 与 `subjectName`（剪贴键名 `clipping` 由 `Clpg` 惯例映射，真机未复验） |
| 蒙版读数报 `Error: Unknown layer`，面板永远「未测出」 | 抠图链的 `rasterizeLayer` 换掉了图层 id，旧 id 被按着读（真机 13:47:16 id=1 → 13:47:55 实际 id=2，全日志 454 次） | `ps.js` 的 `nameHint` 自愈（`selfHealLayerId` / `layerIdByName` / `withLayerIdSelfHeal`）+ `cutout.js` 抠图后按 `layerExistsById` 重解析主体 id |
| 「打开输出目录」点不动（`Extension "" is not accepted` / `URI scheme "file" is not accepted`） | `manifest.json` 权限键名错了（写成了 `launch.process`） | 官方键是 `requiredPermissions.launchProcess`：`{extensions:[".jpg",…,""], schemes:["https"]}`（见 §14.3 坑 5） |

**回归命令**（动过这轮涉及的代码后必跑；三个都在 `%TEMP%`，不依赖真实 PS）：

- `D:\software\node.exe %TEMP%\ecom-hostsim.js` → 127 项 / 失败 0
- `D:\software\node.exe %TEMP%\ecom-v3-probe2.js` → 27 项 / 失败 0
- `D:\software\node.exe %TEMP%\ecom-v6-check.js` → 62 项 / 失败 0（其中「量覆盖率前等宿主空闲」的预算断言已随 m03252 改成 30s）

真机侧唯一的一手证据是 `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\External\com.ecom.psimage\PluginData\ecom-debug.log`（见 §7.3）。**改完必须让用户复测一次并把这份日志拿回来**，否则上面的结论都只是推断。

## 13. 第 8 / 9 轮编辑中的坑与注意事项（用户 m03252 复核后）

这一轮用户直接把真机 PS 连上了（`photoshop_run_jsx` / `photoshop_inspect` / `photoshop_apply` / `photoshop_reference` 四件套），所以下面每条都有真机证据，不再是推断。

### 13.1 编辑中踩到并已修的 9 个坑

1. **写盘不能用路径字面量** —— `in:{_kind:"local",_path}` → `Error: invalid file token used`。必须 DOM File entry（`fileEntryForPath`）或 `createSessionToken`。ExtendScript 的 `putPath(In)` 能用，UXP 不行——**两边的 AM 形式不要互相照抄**。
2. **别用 `stringIDToTypeID` 判存在** —— 它不存在也会 mint 一个 ID 并成功返回。判定要 ① DOM 侧真调一次 ② `charIDToTypeID` + `typeIDToStringID` 反查。
3. **读通道比写通道先恢复** —— 忙期探针（整层 `get`）通过 ≠ 能写。重跑前必须补退避，否则两次重试挤在同一秒等于没等。
4. **调整层回读可能是类数组**（`Object.keys` → `["0"]`）—— 只当诊断，别据此回退；两种形状都认。
5. **`m` 不在模块作用域** —— `ps.js` 里 `var m = mods()` 是**每个函数各自的局部**。新写的助手函数漏了这一行，一点就 `m is not defined`（被 hostsim 抓住）。**加新函数的第一件事是补 `var m = mods();`**。
6. **`photoFilter` 不受剪贴** —— 它会落在最上层把整幅调暖；色温必须并进「颜色和自然饱和度」层。
7. **等太久不等于安全** —— 用户口径：「明明都生成完了，还是读不到」→ 预算砍到 30s / 12s / 8s，等不到就交给退避重试收尾。
8. **「成功 N/N」不等于状态对** —— 剪贴只用 `runRaw` 的 ok 计数（每条都「成功」），真机却只有最上层那张被剪贴：`set {to:{clipping:true}}` 在本机静默失效。现用 `groupEvent + group:true`，建完层再逐层回读 `group`（`readLayerClipping`）。
9. **调整层建层处漏记 id** —— 亮度/对比度那一支绕过 `record()` 自己建层，`clipIds` 里只剩「颜色和自然饱和度」的 id（真机日志 1/1）。

### 13.2 动手前的 4 条规矩

1. 改 JS 先 `node --check`；改引擎层必跑三个模拟（hostsim 132 / v6-check 62 / probe2 27，全 0 失败）。
2. 改完必须重装到 UXP 目录并核对 `SAME / DIFF / MISSING`。
3. **编排层的 `log()` 不写 `ecom-debug.log`**（`index.js` 的 `log()` 只打面板 + `console.log`）—— 排查编排层问题要开面板，或用 `ps.log`。
4. `removeBackground` 受理后 1~3 分钟内**不要发任何 AM 描述符**（连 `get` 都可能被拒）。

### 13.3 「自己复刻一个去背景」的三个方案（用户 m03252 提出，待选）

| 方案 | 做法 | 代价 / 风险 |
|---|---|---|
| A 现状（已可用） | 继续用 PS 的「选择主体 / 移除背景」，但**只信像素 alpha 判据**（本轮已做：`subjectAlphaCoverage`） | 仍受 PS 忙期锁死影响；优点是不装任何东西 |
| B 本地开源模型（推荐备选） | 插件把图导出成临时 PNG → 调本地 CLI（`rembg` 的 U2Net/ISNet 或 `BiRefNet`）→ 把 alpha 作为图层蒙版导回 | 要装 Python 依赖 + 首次下载几百 MB 模型；纯 CPU 一张 1254² 约 1~3 秒；**完全不受 PS 忙期影响** |
| C UXP 侧纯 JS 阈值抠图 | `imaging.getPixels` 读全图，按亮度/色距阈值生成蒙版并用像素数据写回蒙版通道 | 零依赖、无锁死；但只适合纯色/浅色背景的产品图，渐变背景不靠谱 |

建议顺序：先按本轮改动复测（A 已经能读到像素签名与 alpha 占比）；若仍不满意，我按 B 做一个本地 CLI 通道给你选。


---

## 14. 开发注意事项（踩坑总表）· 附「Adobe 官方怎么读图层蒙版」

> 用户 m03578：「更新开发者文档，并将开发中的问题写入注意事项，看 Adobe 的官方文档如何读取蒙版，记录到开发者文档中」。
> 本节把 §6.5 / §13.1 的坑合并成一张**动手前必读**的表，并补上官方口径（每条都有真机证据或官方出处）。

### 14.1 Adobe 官方文档：读图层蒙版（Imaging API）

官方入口：`imaging.getLayerMask(options)` / `imaging.putLayerMask(options)`（UXP for Photoshop · Imaging API 参考里与 `getPixels` / `getSelection` 同页）。官方签名与参数：

| 参数 | 类型 | 官方说明 |
|---|---|---|
| `documentID` | `number` | 目标文档 id；**不传 = 当前活动文档**（官方明确写了可省略） |
| `layerID` | `number` | 目标图层 id —— 读蒙版必传（官方只对 `documentID` 标了「可省略」） |
| `sourceBounds` | `{left,top,right,bottom}` | 可选，只取蒙版的一块；不传 = 整张蒙版 |
| `kind` | `"user"` \| `"vector"` | 读哪种蒙版；像素图层蒙版用 `"user"` |
| `componentSize` | `8` \| `16` \| `32` | 位深；8 位最省内存（蒙版是灰度单通道） |
| 返回 | `Promise<PhotoshopImageData>` | 拿到 `imageData` 后**必须** `await imageData.getData()` 取字节，并在**同一个 `executeAsModal` 里** `dispose()`；官方示例把 `getLayerMask` 与 `getData()` 都写在一个 `core.executeAsModal(async () => …)` 内 |

官方**没有**提供的两件事（必须自己想办法）：

1. **「这个图层到底有没有蒙版」没有官方 API** —— 无蒙版时 `getLayerMask` 直接抛异常（本机实测 `Error: Unknown layer` / 通用失败），所以它不能用来判「有没有」。可行的判据只有一个：**读图层描述符里 `userMaskEnabled` 键是否存在**（`batchPlay` 整层 `get`）——键缺失 = 没有蒙版；存在且为 false = 蒙版被停用。
2. **蒙版对象 / 蒙版 id** —— UXP 的 DOM `ArtLayer` 上**没有** `layerMask` 属性（本机在 `executeAsModal` 内反射枚举确认：`Object.keys` / 原型链都只有 `id / name / kind / visible / opacity / blendMode / bounds / layers / …`，无任何 mask 字段），所以「拿蒙版对象」这条路在 UXP 里不存在；写回蒙版只能用 `putLayerMask`（同样要 `layerID`，整层覆盖）。

### 14.2 官方文档没写、但本机一定会踩的三条

- `getLayerMask` 与 `imageData.getData()` **必须都在 `executeAsModal` 内**；只包住前者、把 `getData()` 留在外面同样被拒（§6.3）。
- **忙期里「读」比「写」先恢复**：同一秒内整层 `get` 已成功，`set userMaskFeather` 仍报「命令"设置"当前不可用」。所以「探针说空闲」不足以决定重跑，重跑前必须补递增退避。
- **图层 id 会在抠图链里变**（`rasterizeLayer` 会重建图层），见 14.3 坑 1 —— 这是本轮「蒙版读取还是有问题」的根因。

### 14.3 踩坑总表（动手前必读）

| # | 坑 | 现象 / 根因 | 正确做法 |
|---|---|---|---|
| 1 | **`rasterizeLayer` 会把图层换成新 id** | 真机 13:47:16 锁定「背景」id=1 → 13:47:55 读到的蒙版像素其实属于 **id=2**；随后所有按 id=1 的读取全报 `Error: Unknown layer`（全日志 454 次），面板只能显示「未测出 / 待确认」 | 蒙版/像素读取一律带**图层名字**（`nameHint`）：`hasUserMask(id,budget,name)` / `getUserMaskCoverage(id,budget,name)` / `subjectAlphaCoverage(id,budget,name)`；报 Unknown layer 时按名字重解析一次（`selfHealLayerId`）。抠图链跑完再显式重挑主体层（`layerExistsById` 旧 id 真没了才换） |
| 2 | 整层 `get` 会**谎报无蒙版** | 11:36:25「整层 get 报无蒙版」与 11:37:35「蒙版像素签名 7.5MB 真实蒙版」同时成立 | `getUserMaskCoverage` 在状态说「无」时再做一次**像素探测**（预算封顶 4s），读得到就以像素为准（`stateContradicted:true`） |
| 3 | `stringIDToTypeID` 会 **mint** | 不存在的 id 也成功返回 → 不能用它判「事件是否存在」 | ① DOM 侧真调一次 ② `charIDToTypeID` + `typeIDToStringID` 反查 |
| 4 | 写盘不能用路径字面量 | `in:{_kind:"local",_path}` → `Error: invalid file token used` | DOM `saveAs`（首选）/ `createSessionToken` / 路径字面量 三级降级（`saveDocToFile`） |
| 5 | `manifest.json` 的权限键名 | 写成 `launch.process` 时 `openPath` 报 `Extension "" is not accepted for the path …`、`openExternal` 报 `URI scheme "file" is not accepted` | 官方键是 **`requiredPermissions.launchProcess`**：`{ extensions:[".jpg",…,""] , schemes:["https"] }`（**扩展名要带点；`""` = 允许文件夹**） |
| 6 | `removeBackground` 受理后锁死描述符通道 | 1~3 分钟内 `get`/`set` 全被拒（4080×1836 图 >150s；第 37~40 次重试仍是「命令"选择"当前不可用」） | 抠图主路用**选区链**（空闲时几秒建好蒙版），`removeBackground` 只做兜底；其后一切 AM 调用前先过 `waitHostIdle` |
| 7 | 调整层剪贴 `set {to:{clipping:true}}` **静默失效** | 每条都「成功」，真机只有最上层被剪贴 | 用 `groupEvent + group:true`，建完层再逐层回读 `group` 确认（`readLayerClipping`） |
| 8 | `photoFilter` 不受剪贴 | 会落在最上层把整幅调暖 | 色温并进「颜色和自然饱和度」（`vibrance`）层的 `temperature` 键 |
| 9 | 调整层回读可能是类数组 | `Object.keys` → `["0"]` | 只当诊断；两种形状都认 |
| 10 | `m` 不在模块作用域 | 新助手漏了 `var m = mods();` → `m is not defined` | 加新函数第一件事就是补这行（已被 hostsim 抓住过） |
| 11 | 建调整层处漏记 id | 亮度/对比度那一支绕过 `record()`，`clipIds` 里只剩另一支 → 日志「1/1」 | 每个建层点都要把 id 记进 `clipIds` |
| 12 | 等太久 ≠ 安全 | 用户口径「明明都生成完了，还是读不到」 | 预算砍到 30s / 12s / 8s，等不到交给 `ps.run` 的退避重跑收尾 |

### 14.4 动手前的 6 条规矩

1. 改 JS 先 `node --check`；改引擎层必跑三个模拟（hostsim **127** / v6-check **62** / probe2 **27**，全 0 失败）。
2. 改完必须重装到 UXP 目录并核对 `SAME / DIFF / MISSING`（PS 在跑时 `install.ps1` 会拒绝 → 直接按哈希同步并核对）。
3. **编排层的 `log()` 不写 `ecom-debug.log`** → 排查编排层要开面板或用 `ps.log`。
4. 读蒙版 / 取像素**一律带图层名字**；改任何「按 id 读图层」的代码前先想一遍：这条链里会不会 `rasterizeLayer`？
5. `removeBackground` 之后的 1~3 分钟窗口内不要发 AM 描述符。
6. **「成功 N/N」不等于状态对** —— 剪贴 / 蒙版 / 停用这类语义状态，都要回读一次并写进日志。
## 15. 第 12 轮真机事故与 Adobe 官方标注（用户 m03657 复核后）

### 15.1 Adobe 官方对 imaging.getPixels 的标注（原文，别记反）

来源：<https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/> → `getPixels` → `options.applyAlpha`。

> **applyAlpha** | Boolean - Optional. If true, then RGBA pixels will be converted to RGB by **matting on white**.
> The returned `imageData` property **will not contain an alpha channel**. Note that any areas devoid of pixel data
> will still be trimmed, see `sourceBounds` above.

结论（本插件踩过）：`applyAlpha:true` 是【按白底合成、主动丢掉 alpha】，**不是**「保留 alpha」。
想拿真 alpha 通道必须**不传**这个选项（默认 `false` → 返回 RGBA 4 通道）。第 10 轮我们传 `true` 去「量主体像素 alpha」，
真机固定只回 `channels=3`（日志「像素不含 alpha 通道（channels=3；applyAlpha 未生效时 PS 返回 3 通道）」），
根因就是这条标注。`ps.js` 的 `subjectAlphaCoverage` 已改为不传该选项，`getSubjectPixels` 收到 `true` 会写一条 warn 提示口径。

同页另两条相关标注：

- `getLayerMask(options)`：`layerID | Number - Required.`（**必填**，没有「取当前图层」的省略形式；且它读的是图层蒙版像素，与 `getPixels` 的像素 alpha 是两件事）。
- `getPixels(options)`：`targetSize` 只给一维时按比例缩放；不给则按 `sourceBounds` 原尺寸返回。

### 15.2 判「抠掉了多少」用蒙版像素，不用像素 alpha

本插件主路抠图是「按选区 `make` 图层蒙版」（`cutout.buildCutoutChain`）——**图层像素本身仍然不透明**，
只有蒙版说明剪掉了哪里。所以：

1. 先读 `ps.getUserMaskCoverage()` 的 `coverage`（真机 4080x1836 文档读到 9.37%，与蒙版像素签名「非零=678572/7490880」一致）；
2. 只有读不到蒙版（或 `removeBackground` 那种直接擦像素的兜底路）才退回 `subjectAlphaCoverage` 的像素 alpha。

面板文案会按来源标注：「已抠图（主体像素占比 9.4%，按蒙版像素）」。

### 15.3 事故：编排层抱着抠图前的旧图层 id（真机 13:55:57 → 13:56:55）

日志原文（`ecom-debug.log`）：

```
[13:56:01] 抠图后图层 id 变了（rasterizeLayer 会重建图层）：主体 id 1（「背景」）→ id 2（「图层 0」）→ 后续读数一律用新 id
[13:56:01] 抠图完成：图层「图层 0」蒙版非零占比=0.0937，蒙版已应用=是（已回读确认）（method=mask）
[13:56:01] [抠图] ok · 图层「图层 0」已抠图（主体像素占比 9.4%，按蒙版像素）；蒙版=已应用；method=mask
[13:56:13] 读取蒙版状态等待已达上限 12000ms（共试 7 次）→ 按未知继续，不阻塞流程
[13:56:25] Photoshop 拒绝了描述符：电商图片制作: 命令“设置”当前不可用。     ← 羽化 set，连试 8 次
[13:56:55] [边缘净化] fail · Photoshop 拒绝了描述符：电商图片制作: 命令“设置”当前不可用。
[13:56:55] 已停止后续步骤（边缘净化 失败）。可用「回退」恢复到执行前状态。
```

同一段日志里 `读取图层蒙版失败：Error: Unknown layer` 出现 454 次。两个根因：

1. **编排层没采纳新 id**：`index.js` 的 `runSubject` 在抠图前锁定 `id=1`（「背景」）；`cutout.remove()` 内部已换成 `id=2`（「图层 0」）
   并把新 id 写回日志，但编排层不知道 → 紧接着的边缘净化拿 `id=1` + 名字「背景」（PS 里已改名）去读蒙版，
   名字自愈也找不到，只能报 `Unknown layer`。
   **修法**：`stepCutout` 在 `cutout.remove()` 之后，用返回的 `data.layerId / data.layerName` 改写 `runSubject`，
   日志写「抠图后主体换了图层：编排层锁定 id N（「…」）→ id M（「…」）→ 后续步骤改用新图层」。
2. **羽化那条 `set` 的忙期预算不够**：抠图链跑完 PS 仍会忙 40s 以上，默认 `RUN_BUSY_RETRIES=8`（约 25s）用尽就放弃，
   整条一键流程随即停下。羽化只是一条 `set`，重试代价仅是等待 → 改成 `busyRetries: 40, busyBudgetMs: 180000`（约 3 分钟）。

### 15.4 由此得出的通用规矩

1. **凡是「按图层 id 操作」的步骤，都要假定 id 会变**：`rasterizeLayer`、`removeBackground`、图层被替换/重建都会换 id；
   读操作一律带图层**名字**做自愈（`ps.js` 的 `isUnknownLayer` / `layerIdByName` / `selfHealLayerId`，只自愈一次）。
2. **编排层必须采纳上游回报的新 id**：同一次一键里「各步骤必须操作同一个图层」这条不变式，靠的是编排层持有正确的 id，
   不是靠每步各自猜（09:32 那次两个步骤选到不同图层的教训同理）。
3. **判读结果要选「真值来源」**：抠图结果的真值在**蒙版像素**；像素 alpha 只在「直接擦像素」的抠法下才有意义。
4. **忙期预算按步骤性质给**：判定类读数可以短（12s 内判不出来就放行，别卡面板），**写命令**要长（羽化/建蒙版 3 分钟量级），
   否则一次大图抠图后的长忙期就会把整条流程打断。

## 16. 图层蒙版：存在性判定、烘焙（应用）与两个踩坑

### 16.1 「应用蒙版」= 烘焙进像素（用户 m03873 定案）
用户说的「图层蒙版没应用」= PS 的 图层 > 图层蒙版 > 应用（Apply Layer Mask）：蒙版缩览图消失、蒙版效果烘焙进图层像素，之后不能再编辑。
插件实现（第 16 轮）：
- `plugin/src/ps.js` `applyUserMask(layerId, nameHint, budgetMs)`：**两种写法按序试**，每种都回读验证后才算成功 ——
  ① `delete`（`_target = channel / channel / mask`）+ `apply:true` = 官方 apply 语义（真机上唯一生效的一种）；
  ② `{_obj:"applyLayerMask"}`（旧写法，真机 PS 27.1 回 `命令"<未知的>"当前不可用`）。
  每种试完都**重新取整层 get** 确认蒙版消失；两种都没生效则 `ok:false`，error 里带 PS 原文（不谎报烘焙成功）；
  成功时日志写 `应用蒙版生效形式 = delete+apply`。
- `plugin/src/cutout.js` `applyMask({subjectLayerId, subjectLayerName})`：给编排层调用；图层没有蒙版时返回 `{applied:false, reason:"no-mask"}`，不盲目发命令。
- `plugin/index.js`：`moduleEnabled.applyMask`（默认 **true**）把「应用蒙版」独立成一步，插在 `FLOW` 的抠图之后；UI 在「抠图」区加第二个勾选框，措辞写明「缩览图消失、之后不能再编辑」。

### 16.2 官方与 harness 取证
- harness 词表里 layer 组有 `apply_mask`，其实现见 `C:\Users\EDY\.dsh\plugin-src\dsh-plugin-photoshop\lib\ops-jsx.js:624`：
  `executeAction(stringIDToTypeID('applyLayerMask'), desc, DialogModes.NO)`（target = layer id）。
- **但这句在真机 PS 27.1 上不成立**（第 17 轮实测，14:33 日志）：走 `stringIDToTypeID('applyLayerMask')` 被 PS 回
  `命令"<未知的>"当前不可用`。`stringIDToTypeID` 只是**凭空造一个新 ID**，名字不存在它也不报错。
  真机真正生效的是 `delete` + `apply:true`（对 `channel/channel/mask`）。
  **⇒「harness 这么写」不是可用性证明**（harness 走 ExtendScript，与 UXP batchPlay 的解析不同）。
- `当前不可用` 有两种，**必须区分**：`命令"应用图层蒙版"当前不可用` = 真忙 → `busyRetries/busyBudgetMs` 退避；
  `命令"<未知的>"当前不可用` = 名字错 → 重试多少次都一样，应当直接换候选写法。

### 16.3 两个真踩过的坑（第 16 轮）
1. **ExtendScript 的 DOM 句柄会失效**：早先取到的 `L.mask` 在 `make 蒙版` 之后仍报 `undefined/none`，而**重新取一次** `doc.artLayers.getByName(name).mask` 就是 object。⇒ 早期「这份文档根本没有蒙版」的结论是**被失效句柄骗了**；判定/复核一律重新取对象，或改走 AM 描述符。
2. **`userMaskEnabled` 的 hasKey 才是真判据**：本机实测——无蒙版的新图层 `hasKey(userMaskEnabled)=false`；`make Chnl/Msk RvlS` 之后 =true 且 `getBoolean` 为 true。而**按通道引用读蒙版**（`putEnumerated(Chnl,Chnl,'Msk ')`）在任何图层上都报「程序错误」，不能用来判定有没有蒙版。

## 17. 注意事项（第 17 轮真机教训 · 加新步骤前必读）

> 浓缩版「为什么会卡 / 为什么会误判」。第 17 轮真机事故：新加的「应用图层蒙版（烘焙）」在 PS 里重试 12 次后
> 把**整条一键流程掐死**（日志末 `已停止后续步骤（应用蒙版 失败）`），而根因只是**事件名写错了**。

### 17.1 三条最贵的教训

1. **`stringIDToTypeID` 不是存在性判据**：它给任意字符串凭空造一个 ID 并成功返回。事件名写错时**当场不报错**，
   要等 PS 真执行才回 `命令"<未知的>"当前不可用`。判"这个事件到底存不存在"只能用 `charIDToTypeID` + `typeIDToStringID` 反查（见 §6.1）。
2. **命令成功 ≠ 生效**：`batchPlay` 不抛异常（§6.4），所以"没报错"从来不是证据。凡是**应用/烘焙/擦除/合并**类命令，
   必须在命令后**回读实际状态**才算成功 —— 烘焙的判据是「重新取整层后读不到蒙版」。
   第 17 轮正是靠这条判据（"命令通过但整层 get 仍读到蒙版"）才定位到事件名写错。
3. **可选步骤不许掐死一键流程**：`stepApplyMask` 失败时若 `return {ok:false}`，`FLOW` 就中止 ——
   用户要的"一键"变成"卡在半路"。**规矩**：一键里除抠图主路外的新步骤，失败一律**只警告、继续跑**，
   面板写清"已跳过 + 可手动怎么补"（现状见 `plugin/index.js:462-467`）。

### 17.2 写新描述符的安全流程（补充 §6.6）

1. **候选表**：同一语义准备 2~3 种写法（AM 事件式 / DOM 式），按"最可能生效"的顺序排。
2. **逐个试 + 每个都回读验证真值**；成功的那一种写进日志（如 `应用蒙版生效形式 = delete+apply`），下次排查一眼可见。
3. 全部失败时 error 里**带 PS 原文**（不是"失败"两个字）—— 没原文就无法区分是忙、缺权限，还是名字错。
4. 忙与名字错分开处理：`当前不可用`（真忙）值得退避重试；`<未知的>`（名字错）重试无意义，直接换写法。
5. 退避次数按**面板体验**给：一次重试约一分钟，写命令用 8 次量级（12 次那次让用户看着像卡死）。

### 17.3 排查入口（按这个顺序看）

1. `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\External\com.ecom.psimage\PluginData\ecom-debug.log` 的**尾部最后阶段**；
2. 搜 `已停止后续步骤（` —— 这一行直接指出哪个步骤失败中止了 FLOW；
3. 搜 `当前不可用` / `<未知的>` / `fail` 三类原文，区分"忙"与"写错"；**且先排除"图层被锁"**——锁住的图层做变换/编辑时 PS 回的也是 `命令"…"当前不可用`（§18），别当成宿主忙去退避重试；
4. 面板日志只在面板打开时可见（`index.js` 的 `log()` 同时进面板与 console），**排查以文件日志为准**。

### 17.4 改完必做（与 §7.4 自检清单配套）

- `node --check` 全部 js；`ecom-hostsim.js` / `ecom-v6-check.js` / `ecom-v3-probe2.js` 三个模拟回归全绿；
- 装机后逐文件 **sha1 比对 = 0 处不一致**（第 17 轮：`index.js`、`src/ps.js`；第 18 轮：`src/ps.js`、`src/compose.js`；第 19 轮：`index.js`、`src/ps.js`、`src/ui.js`，其余 SAME）；
- **完全退出 Photoshop 再重开**（面板不热重载），否则你测的还是旧代码；
- 真机复测时先跑"只留必要模块"的一键，确认新步骤的日志行真的出现（如 `应用蒙版生效形式 = …`）。

## 18. 第 18 轮真机事故：图层**被锁** ≠ 宿主忙（用户 m04284）

用户原话（verbatim）：**「调尺寸的有个问题，如果图层是锁住的状态会导致插件卡住，你可以看看日志」**。

### 18.1 取证（`ecom-debug.log`，422426 B / 2648 行 / mtime 14:41:05）

- 14:38:5x 打出「构图：画布 1254x1254，主体 …」之后，主体**缩放/居中**连续被 PS 拒，错误原文每次都是
  `命令"变换"当前不可用`，两次之间约 3–4 秒退避 → 8 次 ≈ **34 秒**，用户感知就是"插件卡住"；
- 随后一行 `已停止后续步骤（构图 失败）` —— 整条一键断在这里；
- 同一时刻能正常读到图层状态，且主体层 = `图层「背景」id=1 bounds 0,0,1254,1254`（kind=solidfill/normal）——
  **PS 默认锁定的「背景」层**（锁定位置 + 锁定透明像素）；
- 结论：锁住位置的图层，PS 对**变换类**事件回的就是「命令不可用」；而引擎的 `isBusy()` 把它当"宿主忙"
  → 退避重试 8 次。**锁是永久性原因，重试永远无效。**

### 18.2 修复（第 18 轮）

- `plugin/src/ps.js` 新增：
  - `domFindLayerById(layerId)`：DOM 递归找图层对象（不依赖描述符通道，忙期也能用）；
  - `layerLockInfo(layerId, nameHint)`：读 `allLocked` / `positionLocked` / `transparencyLocked` / `pixelsLocked` /
    `isBackgroundLayer`，合成 `locked` + 人话 `why`（如「背景层（PS 默认锁定）」）；
  - `ensureUnlocked(layerId, nameHint)`：**解锁后必须回读确认**——① DOM 写 `allLocked/positionLocked/… = false`
    （包在 `modal()` 里）→ 回读；② 不行再发描述符 `set layerLocking = none` → 再回读；③ 仍锁定 → `ok:false` +
    人话指引（「请在图层面板点掉锁图标（背景层可双击解锁/改名）后重跑本步」）。读不到锁定状态时**放行**，不挡主流程。
- `plugin/src/compose.js`：缩放/居中**动手前**先 `ensureUnlocked`，解锁则写日志
  「构图：主体层「背景」原本被锁定（背景层（PS 默认锁定））→ 已自动解锁后继续」；解不开就直接失败（不空转）。
- `plugin/src/ps.js` 的 `run()` 退避循环里加**一次性锁探测**：被拒且错误像「当前不可用/not available/unknown」时，
  先 `ensureUnlocked` —— 能解就**立即重跑本步**（不消耗重试次数），解不开就**立刻返回**
  （错误文本追加「排查结论=图层被锁：…」，`data.lockedCause = true`），不再空转 34 秒；
  另对 `modal state` 类错误追加人话提示（PS 里有未结束的对话框/变换会话 → 按 Esc 结束再重跑）。

### 18.3 第 19 条通用规矩

**"命令当前不可用"有三个截然不同的原因**：①真实的宿主忙（`isBusy` 判据，值当退避重试）；②事件名/描述符写错
（PS 回 `命令"<未知的>"当前不可用`，见 §17.1）；③**前置状态不满足——最常见的就是图层被锁**。
动手做变换/编辑之前先查锁；遇到"命令不可用"先排除③，再当成①。

## 19. 导出目录选择器（用户 m04355「导出加一个选择目录的选项」）

### 19.1 官方依据（Adobe UXP 官方文档，逐条核对过）

- UXP 指南「Filesystem Operations」→ **Ask the user to choose a location**：
  选目录＝`localFileSystem.getFolder({ initialDomain })`，返回 **`Folder | null`**（用户取消 → `null`），
  本机路径取 **`folder.nativePath`**；`initialDomain` 取自 `require('uxp').storage.domains.*`
  （本项目用 `domains.userDesktop`）。同段官方例子还给了 `getFileForOpening` / `getFileForSaving`。
- 同页 **Remember a selection with tokens**：`createPersistentToken(entry)` → 存 token →
  下次 `getEntryForPersistentToken(token)`。**本项目不需要 token**：manifest 是
  `requiredPermissions.localFileSystem: "fullAccess"`，写文件本来就走 `getEntryWithUrl("file:///绝对路径")`
  （见 `plugin/src/ps.js` 的 `createFolder` / `fileSize`），所以 store 里记**路径字符串**（`export.outputDir`）就够。
- API 参考（FileSystemProvider）条目：`getFolder(options)` / `getNativePath(entry)` / `createPersistentToken(entry)` /
  `getEntryForPersistentToken(token)`。注意 `getFolder` 的 `options` 只支持 `initialDomain`（**不能**指定起始路径）。

### 19.2 实现

- `plugin/src/ps.js`：新增 `pickFolder(initialDomainName)`（宿主模块只在这里 `require`，遵守 INTERFACE §0），
  返回 `{ok:true,data:{path,name}}` / `{ok:true,data:{cancelled:true}}` / `{ok:false,error}`；已导出。
- `plugin/index.js`：新增 `onPickOutputDir()` —— 调 `ps.pickFolder("userDesktop")`，拿到路径后
  `onStateChange({export:{…, outputDir:path}})`（落盘 + 刷新），并写日志「输出目录已选择：…」；已进 `boot()` 的 handler map。
- `plugin/src/ui.js`：「导出」区新增一行 —— 输出目录**文本框**（可手打/粘贴，`change` 即存）＋「选择…」＋「清除」，
  `refreshAll()` 回填；留空＝沿用旧行为「导出到原图同一目录，文件名 原名-ps-N」。
  一键的「一键完成后自动导出」与「只执行导出」共用 `state.export.outputDir`，所以设置一次两处都生效。

### 19.3 注意

- 改 `manifest.json` 的任何权限都必须**完全退出 PS 再重开**才生效（本功能没改 manifest：`fullAccess` 早已声明）。
- `folder.nativePath` 在 `fullAccess` 下才有本机路径；若为空，`pickFolder` 会直接报错而不是把空路径写进 store（避免导出落到意外位置）。
