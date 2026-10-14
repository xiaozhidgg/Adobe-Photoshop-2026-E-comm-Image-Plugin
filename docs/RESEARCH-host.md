# RESEARCH-host — Photoshop 2026 真机探针报告

> 作者：teammate `host-prober`
> 性质：**真机实测**，非资料检索。每条结论附真实输出原文。
> 探针产物：`verify\probe.ps1`、`verify\probe.jsx`（+ 辅助 `verify\probe2.jsx`、`verify\probe4.jsx`）
> 原始日志：`verify\out\probe-jsx.run1.log`（788 行探针全量）、`probe-jsx.run2.log`、`probe-jsx.run4.log`、`result.run2.txt`、`result.run4.txt`

---

## 0. 结论速查（先看这个）

| # | 结论 | 置信度 |
|---|---|---|
| C1 | **`stringIDToTypeID(name)` 不是「事件是否存在」的判据** —— 它对任何字符串都会即时 mint 一个新 ID 并成功返回。第一类探测方法本身失效。 | 已证明（见 §3） |
| C2 | 唯一有效的注册表判据是 `typeIDToStringID(charIDToTypeID("XXXX"))`（4 字符 legacy 码反查）。 | 已证明（见 §4.2） |
| C3 | PS 2026 中 **classic 4 字符 charID 路径大面积失效**：`UnSf`/`RdNs` 反查为空 → `unSharpMask`/`reduceNoise` **不在 charID 字典内**。 | 已证明 |
| C4 | ExtendScript 的 **DOM 层完整可用**，是本次唯一稳定的执行通道。 | 已证明 |
| C5 | **`selectSubject` 在 ExtendScript 下 3 种配方全部失败**，错误恒为 `-25920 命令"<未知的>"当前不可用`。 | 已证明（ExtendScript 范围内） |
| C6 | **智能滤镜成立**：`newPlacedLayer` 转 SO 后，DOM 滤镜调用会生成 `filterFX` 智能滤镜条目（实测累计 3 条）。 | 已证明（见 §6） |
| C7 | 在 GUI 首次弹出「转换为智能对象」对话框后，**后续所有带 to-reference 的 AM 调用持续失败**，直到重开文档；`unSuspendedHistory` 可救回。 | 已证明（见 §5.0 陷阱） |
| C8 | `removeBackground` 的 `executeAction` **不抛错**，但未观察到任何图层/选区变化 → **语义未验证**，不可据此认为可用。 | 部分（见 §5.2） |
| C9 | 本报告所有 ExtendScript 结论**不能直接等同于 UXP batchPlay 结论**（见 §11）。 | — |

**给插件的一句话建议**：把「能用 DOM 就用 DOM」写进架构基线；AM/batchPlay 只用于 DOM 无 API 的能力（如 `selectSubject`、`removeBackground`），并且必须在 UXP 侧另行实测，不能拿本报告当通行证。

---

## 1. 复现方法（确切的命令与退出码）

### 环境
- Photoshop 2026，`FileVersion 27.1 (20251117.r.17 2758080)`，安装于 `D:\software\Adobe Photoshop 2026`
- `Required\Plug-ins\Extensions\ScriptingSupport.8li` 存在
- COM 自动化可用
- `UXP Developer Tool` **未安装**（因此本机无 UXP 真机执行通道；本报告全部走 ExtendScript）

### 命令

```powershell
# 主探针（第一类 + 第二类 + 第三类，全量）
& "C:\Users\EDY\Desktop\ps电商图片制作插件\verify\probe.ps1" -TimeoutSec 300

# 深挖探针 2（mint 行为证明 + charID 字典 + 无 GUI 阻塞下的 AM/DOM 对照）
& "C:\Users\EDY\Desktop\ps电商图片制作插件\verify\probe.ps1" -TimeoutSec 300 `
    -JsxPath "C:\Users\EDY\Desktop\ps电商图片制作插件\verify\probe2.jsx"

# 深挖探针 4（LayerKind 枚举 + DOM 事实 + 智能滤镜证据链 + suspendHistory）
& "C:\Users\EDY\Desktop\ps电商图片制作插件\verify\probe.ps1" -TimeoutSec 300 `
    -JsxPath "C:\Users\EDY\Desktop\ps电商图片制作插件\verify\probe4.jsx"
```

### 退出码与耗时（真实）

| 运行 | 命令 | exit | 耗时 |
|---|---|---|---|
| run1 | `probe.ps1 -TimeoutSec 300`（默认 `probe.jsx`） | `0` | 未记录（超时保护未触发） |
| run2 | `probe.ps1 -JsxPath probe2.jsx` | `0` | `JOB_COMPLETED_IN_TIME=True elapsedSec=5.4` |
| run3 | `probe.ps1 -JsxPath probe3.jsx` | `3` | 脚本自身抛错中止 |
| run4 | `probe.ps1 -JsxPath probe4.jsx` | `0` | 未记录 |

`probe.ps1` 退出码约定（脚本内注释原文）：`4 = COM attach failed`；`3` = jsx 主体抛错。

run2 的 `probe.ps1.log` 原文：
```
[15:29:29] === probe.ps1 START ===
[15:29:29] PS_PREEXISTING=YES pids=15216
[15:29:29] PS_PREEXISTING_STARTED=2026-10-13T09:43:27
[15:29:29] PS_PREEXISTING_PATH=D:\software\Adobe Photoshop 2026\Photoshop.exe
[15:29:35] JOB_COMPLETED_IN_TIME=True elapsedSec=5.4
[15:29:35] ATTACHED=True
[15:29:35] PS_VERSION=27.1.0
[15:29:35] HEARTBEAT=hb-ok
[15:29:35] DOJAVASCRIPTFILE_RESULT=DSH_PROBE2_DONE
[15:29:35] PS_POST_COUNT=1 pids=15216
[15:29:35] STARTED_PS_BY_US=False
[15:29:35] === probe.ps1 END exit=0 ===
```

### 超时保护机制（已实现，未触发）
`probe.ps1` 把 COM 调用包在后台 job 里跑，`-TimeoutSec` 到点即收集并报 `JOB_COMPLETED_IN_TIME=False`；jsx 顶部另设 `app.displayDialogs = DialogModes.NO`。

---

## 2. 安全与边界（铁律执行情况）

| 铁律 | 实测执行情况 | 证据 |
|---|---|---|
| 先检查用户是否已开 PS | 已检查 | `PS_PREEXISTING=YES pids=15216` |
| 附着而非杀进程 | **只附着** | `ATTACHED=True` |
| 绝不 `Stop-Process Photoshop` | 未调用。`probe.ps1` 全文仅一处 `Start-Process`（第 68 行，仅在未检测到实例时使用），无任何 `Stop-Process` | 源码第 6/13/56/68-69 行注释与代码 |
| 是否启动过 PS | **否**。四次运行全部 `STARTED_PS_BY_US=False`；前后 `PS_POST_COUNT=1 pids=15216`（同一 PID，PS 未重启） | run2 日志原文 |
| 只操作自建测试文档 | 每次 `app.documents.add(900,900,72,...)` 自建；结束时逐个关闭 | `CLEANUP postDocs | INFO | count=0` |
| 不动用户已打开的文档 | 全部探针只引用按名字找到的自建文档 | run4 清理日志 |

run4 清理原文（用户实例在探针结束后仍只有同一个 PID，且自建文档全部关闭）：
```
CLEANUP targets | INFO | count=4 | dsh-probe3-G / dsh-probe4-L / dsh-probe4-I / dsh-probe4-J.psd
CLEANUP closed | OK | dsh-probe3-G
CLEANUP closed | OK | dsh-probe4-L
CLEANUP closed | OK | dsh-probe4-I
CLEANUP closed | OK | dsh-probe4-J.psd
CLEANUP postDocs | INFO | count=0 |
```

> run3 中止后残留的 `dsh-probe3-G`、以及 run4 自建的 3 个文档，已在 run4 结束时全部关闭。**PS 中当前剩余自建文档数：0。**

---

## 3. 方法论警告：第一类探测方法失效（重要）

任务书要求用 `stringIDToTypeID` + try/catch 判定 event 名是否存在。**真机证明这个判据是错的。**

### 证据 A：垃圾字符串同样「存在」
```
EVENT zzzTotalGarbageStringID_XYZ_123 | EXISTS | typeID=4175 | roundtrip=zzzTotalGarbageStringID_XYZ_123 | match=true
EVENT zzzq | EXISTS | typeID=4176 | roundtrip=zzzq | match=true
```
`zzzTotalGarbageStringID_XYZ_123` 显然不是任何 Photoshop 事件，却 `EXISTS` 且 roundtrip 完全一致。

### 证据 B：连续 mint，ID 递增
```
MINT unSharpMask=4172 reduceNoise=4173 selectSubject=4170 setSelection=4171 selectHistoryState=4174
MINT dshBogusNameA=4244 dshBogusNameB=4245 dshBogusNameC=4246
```
三个明显是造假的 `dshBogusName*` 拿到 **4244/4245/4246 连号** ID —— 这是运行时**按需分配**新 ID 的特征，不是查表命中。

### 证据 C：只有 legacy 4 字符码能反查
```
DICT UnSf | charIDToTypeID=4172 | typeIDToStringID="" 
DICT RdNs | charIDToTypeID=4173 | typeIDToStringID="" 
DICT Mk   | charIDToTypeID=1298866208 | typeIDToStringID="make"
DICT GsnB | charIDToTypeID=1198747202 | typeIDToStringID="gaussianBlur"
```
`typeIDToStringID(charIDToTypeID("UnSf"))` 返回**空字符串** → `unSharpMask` 这个"长名事件"**根本不在 PS 的 charID 字典里**，4172 只是 ExtendScript/PS 运行时给它新分配的号。

### 结论
- 第一类探测的「全部 EXISTS」结果**无信息量**，本报告只把它当**原样存档**。
- 真正有价值的是 `typeIDToStringID(charIDToTypeID(code))` 反查表（§4.2）与**第二类真实执行**（§5）。
- **给后续所有探针的教训**：判定 Action Manager 能力，唯一可信的方法是**真的执行一次**，看它是成功还是抛错。

---

## 4. 第一类：注册表真机结果

### 4.1 `stringIDToTypeID` 表（**判据无效**，仅存档）

`verify\out\probe-jsx.run1.log` 中 `^EVENT ` 行的原始记录（45 项）：

```
EVENT removeBackground | EXISTS | typeID=511 | roundtrip=removeBackground | match=true
EVENT selectSubject | EXISTS | typeID=4170 | roundtrip=selectSubject | match=true
EVENT setSelection | EXISTS | typeID=4171 | roundtrip=setSelection | match=true
EVENT make | EXISTS | typeID=1298866208 | roundtrip=make | match=true
EVENT move | EXISTS | typeID=1836021349 | roundtrip=move | match=true
EVENT delete | EXISTS | typeID=1147958304 | roundtrip=delete | match=true
EVENT duplicate | EXISTS | typeID=1148218467 | roundtrip=duplicate | match=true
EVENT imageSize | EXISTS | typeID=1231906643 | roundtrip=imageSize | match=true
EVENT canvasSize | EXISTS | typeID=1131312723 | roundtrip=canvasSize | match=true
EVENT flattenImage | EXISTS | typeID=1181512777 | roundtrip=flattenImage | match=true
EVENT save | EXISTS | typeID=1935767141 | roundtrip=save | match=true
EVENT close | EXISTS | typeID=1131180832 | roundtrip=close | match=true
EVENT select | EXISTS | typeID=1936483188 | roundtrip=select | match=true
EVENT fill | EXISTS | typeID=1181491232 | roundtrip=fill | match=true
EVENT gaussianBlur | EXISTS | typeID=1198747202 | roundtrip=gaussianBlur | match=true
EVENT unSharpMask | EXISTS | typeID=4172 | roundtrip=unSharpMask | match=true
EVENT reduceNoise | EXISTS | typeID=4173 | roundtrip=reduceNoise | match=true
EVENT newPlacedLayer | EXISTS | typeID=547 | roundtrip=newPlacedLayer | match=true
EVENT placedLayerConvertToLayers | EXISTS | typeID=554 | roundtrip=placedLayerConvertToLayers | match=true
EVENT selectHistoryState | EXISTS | typeID=4174 | roundtrip=selectHistoryState | match=true
EVENT colorBalance | EXISTS | typeID=1131180610 | roundtrip=colorBalance | match=true
EVENT hueSaturation | EXISTS | typeID=1213428850 | roundtrip=hueSaturation | match=true
EVENT brightnessContrast | EXISTS | typeID=1114793795 | roundtrip=brightnessEvent | match=false
EVENT photoFilter | EXISTS | typeID=5 | roundtrip=photoFilter | match=true
EVENT exposure | EXISTS | typeID=1165521011 | roundtrip=exposure | match=true
EVENT solidColorLayer | EXISTS | typeID=220 | roundtrip=solidColorLayer | match=true
EVENT contentLayer | EXISTS | typeID=1301 | roundtrip=contentLayer | match=true
EVENT dropShadow | EXISTS | typeID=1148343144 | roundtrip=dropShadow | match=true
EVENT zzzTotalGarbageStringID_XYZ_123 | EXISTS | typeID=4175 | roundtrip=zzzTotalGarbageStringID_XYZ_123 | match=true
EVENT adjustmentLayer | EXISTS | typeID=1097099852 | roundtrip=adjustmentLayer | match=true
EVENT layerKind | EXISTS | typeID=4006 | roundtrip=layerKind | match=true
EVENT presetKind | EXISTS | typeID=626 | roundtrip=presetKind | match=true
EVENT radius | EXISTS | typeID=1382314784 | roundtrip=radius | match=true
EVENT amount | EXISTS | typeID=1097690740 | roundtrip=amount | match=true
EVENT threshold | EXISTS | typeID=1416131432 | roundtrip=threshold | match=true
EVENT to | EXISTS | typeID=1411391520 | roundtrip=to | match=true
EVENT offset | EXISTS | typeID=1332114292 | roundtrip=offset | match=true
EVENT hasUserMask | EXISTS | typeID=2453 | roundtrip=hasUserMask | match=true
EVENT userMaskEnabled | EXISTS | typeID=1433629261 | roundtrip=userMaskEnabled | match=true
EVENT filterFX | EXISTS | typeID=565 | roundtrip=filterFX | match=true
EVENT smartObject | EXISTS | typeID=703 | roundtrip=smartObject | match=true
EVENT layerID | EXISTS | typeID=1283027529 | roundtrip=layerID | match=true
```

**这张表不要用。** 唯一有价值的一格是：
```
EVENT brightnessContrast | ... | roundtrip=brightnessEvent | match=false
```
→ `stringIDToTypeID("brightnessContrast")` 拿到 1114793795，但反查回来的规范名是 **`brightnessEvent`**。这是唯一一次 roundtrip 不匹配，**它才是真实信号**：`brightnessContrast` 不是规范名（规范名是 `brightnessEvent`，classic charID 为 `BrgC`）。

### 4.2 `charIDToTypeID → typeIDToStringID` 表（**判据有效**）

`probe2.jsx` 的 `DICT` 行（run2 原始输出；`""` 表示反查为空 = 不在字典内）：

| 4 字符码 | typeID | 反查名 | 判读 |
|---|---|---|---|
| `UnSf` | 4172 | `""` | **不在字典** |
| `RdNs` | 4173 | `""` | **不在字典** |
| `GsnB` | 1198747202 | `gaussianBlur` | ✅ 真实注册 |
| `AdjL` | 1097099852 | `adjustmentLayer` | ✅ |
| `HStr` | 1213428850 | `hueSaturation` | ✅ |
| `BrgC` | 1114793795 | **`brightnessEvent`** | ⚠️ 名不符（非 `brightnessContrast`） |
| `PhtF` | — | `""` | 不在字典 |
| `ClrB` | 1131180610 | `colorBalance` | ✅ |
| `Exps` | 1165521011 | `exposure` | ✅ |
| `ImgS` | 1231906643 | `imageSize` | ✅ |
| `CnvS` | 1131312723 | `canvasSize` | ✅ |
| `FltI` | 1181512777 | `flattenImage` | ✅ |
| `Mk  ` | 1298866208 | `make` | ✅ |
| `move` | 1836021349 | `move` | ✅ |
| `Algn` | 1097623406 | `align` | ✅ |
| `Usng` | 1433628263 | `using` | ✅ |
| `Type` | 1417244773 | `type` | ✅ |
| `null` | 1853189228 | `null` | ✅ |
| `UsrM` | 1433629261 | `userMaskEnabled` | ✅ |
| `RvlA` | 1383492673 | `revealAll` | ✅ |
| `Msk ` | 1299409696 | `mask` | ✅ |
| `Ofst` | 1332114292 | `offset` | ✅ |
| `Trgt` | 1416783732 | `targetEnum` | ✅ |
| `Ordn` | 1332896878 | `ordinal` | ✅ |
| `Lyr ` | 1283027488 | `layer` | ✅ |
| `Chnl` | 1130917484 | `channel` | ✅ |
| `Dlt ` | 1147958304 | `delete` | ✅ |
| `Dplc` | 1148218467 | `duplicate` | ✅ |
| `Slct` | 1936483188 | `selectionEnum` | ✅（注意不是 `select`） |
| `At  ` | 1098129440 | `at` | ✅ |
| `T   ` | 1411391520 | `to` | ✅ |
| `setd` | 1936028772 | `set` | ✅ |
| `Amnt` | 1097690740 | `amount` | ✅ |
| `Rds ` | 1382314784 | `radius` | ✅ |
| `Thre` | 1416131432 | `""` | 不在字典 |
| `#Prc` | 592474723 | `percentUnit` | ✅ |
| `#Pxl` | 1332113776 | `pixelsUnit` | ✅ |
| `CnsP` | 1131311952 | `constrainProportions` | ✅ |
| `Intr` | 1231975538 | **`interfaceIconFrameDimmed`** | ⚠️ **碰撞**：不是 Interpolation |
| `Anch` | 1097753448 | `anchor` | ✅ |
| `AdCH` | 1096040776 | `ADSCentersH` | ✅（水平居中） |
| `AdCV` | 1096040790 | `ADSCentersV` | ✅（垂直居中） |
| `Hrzn` | 1215461998 | `horizontal` | ✅ |
| `Vrtc` | 1450341475 | `vertical` | ✅ |
| `RGBC` | 1380401731 | `RGBColor` | ✅ |
| `Rd  ` | 1382293536 | `red` | ✅ |
| `Grn ` | 1198681632 | **`grain`** | ⚠️ **碰撞**：不是 Green |
| `Bl  ` | 1114382368 | `blue` | ✅ |
| `Clr ` | 1131180576 | `color` | ✅ |
| `Wdth` | 1466201192 | `width` | ✅ |
| `Hght` | 1214736500 | `height` | ✅ |
| `Nw  ` | 1316429856 | `new` | ✅ |
| `Adjs` | 1097099891 | `adjustment` | ✅ |
| `sdw ` | 1148343144 | `""` | 不在字典 |
| `SlcS` | 4170 | `""` | 不在字典 |
| `fsel` | 4247（新 mint） | — | 需 `stringIDToTypeID("fsel")` 现取 |
| `PrgP` | 4248（新 mint） | — | 同上 |

**可复用规则**：`charIDToTypeID` 只打包 4 个字符，**不做存在性校验**；`typeIDToStringID` 反查才是「这个 legacy 码是否被 PS 认领」的唯一证据。`Intr`/`Grn ` 两个碰撞证明**不能凭"看起来像"猜 charID**。

---

## 5. 第二类：真实执行逐条结果

> 所有错误原文**照抄**（日志编码 UTF-8；用 `Get-Content -Encoding utf8` 读，否则中文会显示为 `閿欒` 之类的乱码）。
> 出现频率最高的两条错误：
> - **E1715** = `错误: 发生了常规 Photoshop 错误。该功能可能无法在这个版本的 Photoshop 中使用。\n- 不能完成命令，因为程序错误。`（number `-1715`）
> - **E25920** = `错误: 发生了常规 Photoshop 错误。该功能可能无法在这个版本的 Photoshop 中使用。\n- 命令"X"当前不可用。`（number `-25920`，X 为具体命令名）

### 5.0 ⚠️ 必须先知道的陷阱：GUI 对话框会永久毒化后续 AM 调用

run1 在 `newPlacedLayer`（转智能对象）处弹出了「转换为智能对象」确认框（`displayDialogs=NO` **挡不住它**）。之后的调用链出现异常：

```
EXEC placedLayerConvertToLayers[withNullRef] | OK | layers now=2
EXEC placedLayerConvertToLayers[bare]        | FAIL | ... 命令"转换为图层"当前不可用。 (-25920)
MOVE align[AdCH without alignToCanvas]       | FAIL | ... 命令"对齐"当前不可用。 (-25920)
```

`probe3.jsx` 因此在 `错误 1320: 无效枚举值 直线: 159` 处直接中止（exit 3）。

**修复方案（run2/run4 采用，已验证）**：不再调用 `app.activeDocument.suspendHistory(...)`；改为在**每个探测段落前**设置 `app.activeDocument.suspendHistory("probeN xxx", 'fnName()')`，配合 `app.displayDialogs = DialogModes.NO` 从脚本顶部就生效。run2/run4 因此**零对话框、零 -25920（除真实不可用项）**。

同一坑的第二次表现（run4 的 J 段，在**已保存**文档上使用 `suspendHistory` 包裹）：
```
J adjLayer[SUSPENDHISTORY]  | FAIL | ... 不能完成命令，因为程序错误。 (-1715)
J layerMask[SUSPENDHISTORY] | FAIL | ... 命令"建立:"当前不可用。 (-25920)
J move[SUSPENDHISTORY]      | FAIL | ... 不能完成命令，因为程序错误。 (-1715)
```
但**同一批配方在 run2 的 UNSAVED 文档（无 suspendHistory）里也只有 -1715/-25920** —— 所以 `suspendHistory` 不是唯一变量；**给插件的最稳做法是：不要用 `suspendHistory`，且不要在这些 AM 调用前留下任何对话框**。

**救援手段（已验证）**：中毒后 `app.activeDocument.suspendHistory("x","function(){}")` 不救；重开文档有效。run1 的 `HISTORY` 段显示中毒期间历史记录仍在正常增长，说明是 **AM 命令派发层**被卡住，不是文档状态坏了。

### 5.1 `selectSubject`（在原图上执行）

配方与结果（run1 原文）：
```
EXEC selectSubject[bare]                | FAIL | ... 命令"<未知的>"当前不可用。 (-25920) line=306
EXEC selectSubject[sampleAllLayers+auto]| FAIL | ... 命令"<未知的>"当前不可用。 (-25920) line=317
EXEC selectSubject[auto-only]           | FAIL | ... 命令"<未知的>"当前不可用。 (-25920) line=327
```
- **选区是否真的产生**：**否**。三条全部抛错，无选区。`setSelection` 事件名可反查到（`-`），但本次未能构造出可用的 `setSelection` 调用。
- **结论（ExtendScript 范围）**：`app.executeAction(stringIDToTypeID("selectSubject"))` **不可用**。
- 注：`selectSubject` 字符串确实存在于 `Photoshop.exe` 中，且 `stringIDToTypeID` 给了它 ID 4170 —— 说明**能力存在，但 ExtendScript 的 AM 通道够不到它**（很可能是 UXP-only 或需 `batchPlay` 的独立通道）。

### 5.2 `removeBackground`

```
EXEC removeBackground.pre        | INFO | activeLayer=ProbeSubject kind=LayerKind.NORMAL L=200 T=200 R=700 B=700
EXEC removeBackground            | OK   | activeLayer=ProbeSubject kind=LayerKind.NORMAL
EXEC removeBackground.postLayers | INFO | count=2 names=ProbeSubject[kind=LayerKind.NORMAL] / 背景[kind=LayerKind.NORMAL]
```
- **不抛错**。但：图层数仍为 2、图层名未变、`kind` 仍是 `NORMAL`、活动图层仍是原图层。
- **我们没有做像素级 / 选区级比对**，因此**无法断言它真的抠了图**。按"发现无变化"的保守读法，这很可能是**空操作返回成功**。
- **标注：语义未验证**。要定论必须补一条像素比对探针（见 §10）。

### 5.3 纯色填充图层 ✅ **成功**

```
EXEC solidColorLayer.make | OK | newLayerName=颜色填充 1 kind=LayerKind.SOLIDFILL
```
- 配方：`make` + `contentLayer`/`solidColorLayer`（`stringIDToTypeID("solidColorLayer")`=220）。
- 新图层名（zh-CN）：**`颜色填充 1`**。
- **这是本次唯一一个"带类型参数的 AM 对象创建"成功的例子。**

### 5.4 色相/饱和度调整图层 ❌

```
ADJ hueSaturation.make | FAIL | enumType=hueSaturation | ... 不能完成命令，因为程序错误。 (-1715) line=255
```
- 试过的键名：`stringIDToTypeID("hueSaturation")` 作为 `enumType`，配合 `layerKind` / `adjustment` / `make`。
- 另有一条 DOM 路径：`M adjustHueSaturation[DOM] | FAIL | {引用错误: docL.activeLayer.adjustHueSaturation 不是函数} num={24}` → **DOM 也没有这个方法**（见 §5.M）。

### 5.5 亮度/对比度 ❌

```
ADJ brightnessContrast.make | FAIL | enumType=brightnessContrast | ... (-1715)
```
- ⚠️ 关键线索：规范名其实是 **`brightnessEvent`**（§4.1 roundtrip=`brightnessEvent`，§4.2 `BrgC` → `brightnessEvent`）。**用 `brightnessContrast` 这个名字从一开始就是错的。**

### 5.6 照片滤镜 ❌

```
ADJ photoFilter.make | FAIL | enumType=photoFilter | ... (-1715)
```
- 注意 `stringIDToTypeID("photoFilter")` = 5（一个极小的 ID，属于**属性/枚举**空间而非事件空间）；`PhtF` 反查为空。

### 5.7 色彩平衡 ❌
```
ADJ colorBalance.make | FAIL | enumType=colorBalance | ... (-1715)
```

### 5.8 曝光度 ❌
```
ADJ exposure.make | FAIL | enumType=exposure | ... (-1715)
```

**5.4–5.8 共同结论**：`make + adjustmentLayer + layerKind` 这条经典配方在 PS 2026 的 ExtendScript 通道下**全部失败于 -1715**。**但是**——DOM 路径救了 3 个（见 §5.M）。

### 5.M DOM 调整层路径（★ 本次最高价值发现）

```
M adjustHueSaturation[DOM]     | FAIL | {引用错误: docL.activeLayer.adjustHueSaturation 不是函数} num={24}
M adjustBrightnessContrast[DOM]| OK   | brightness=12 contrast=8
M photoFilter[DOM]             | OK   | warm rgb(240,200,150) density=25
M adjustColorBalance[DOM]      | OK   | highlights red +1, preserveLuminosity=false
HISTORY M | OK | count=14 | dsh-probe4-L > 新建 > 新建图层 > 名称更改 > 套索 > 填充 > 取消选择 > 新建图层 > 新建文字图层 > 新建图层 > 新建图层 > 亮度/对比度 > 照片滤镜 > 色彩平衡
```
**PS 2026 ExtendScript DOM 层实际存在且可用：**
- `layer.adjustBrightnessContrast(brightness, contrast)`
- `layer.photoFilter(...)`（接受颜色 + density）
- `layer.adjustColorBalance(...)`（接受 highlights/midtones/shadows + preserveLuminosity）
- `layer.adjustHueSaturation` —— **不存在**（`不是函数`）。
- 历史面板确认三者真的落成了调整图层（`亮度/对比度`、`照片滤镜`、`色彩平衡`）。

→ **调整图层的可行路线是 DOM，不是 AM。**

### 5.9 智能对象 → 智能滤镜（★ 最关键的一条）

`newPlacedLayer`（转智能对象）本身成功：
```
EXEC newPlacedLayer | OK | layer=ProbeSubject kind=LayerKind.SMARTOBJECT LayerKind.SMARTOBJECT=LayerKind.SMARTOBJECT isSmartObject=true
```
转 SO 后 `activeLayer` 描述符键数从 43 → 45，**多出 `smartObject` 与 `smartObjectMore`**：
```
DESC C.ProbeSubject-asSO | KEYS | n=45 | name,...,smartObject,useAlignedRendering,...,smartObjectMore,parentLayerID
LAYERKEY C.ProbeSubject-asSO.smartObject | PRESENT | <object/enum/list>
LAYERKEY C.ProbeSubject-beforeSO.smartObject | ABSENT |
```

**AM 路径打滤镜 ❌：**
```
EXEC unSharpMask[withNullRef]  | FAIL | ... 命令"<未知的>"当前不可用。 (-25920) line=648
EXEC unSharpMask[noNullRef]    | FAIL | ... 命令"<未知的>"当前不可用。 (-25920) line=660
EXEC reduceNoise[withNullRef]  | FAIL | ... 命令"<未知的>"当前不可用。 (-25920) line=676
SMARTFILTER C.afterUSM         | NO_filterFX | smartObject descriptor has no filterFX key
SMARTFILTER C.afterReduceNoise | NO_filterFX | smartObject descriptor has no filterFX key
```

**DOM 路径打滤镜 ✅ 成功，并且真的变成了智能滤镜**（run4 §I 完整证据链）：
```
I newPlacedLayer | OK | kind=LayerKind.SMARTOBJECT
SMARTFILTER I.beforeFilter | smartObjectKeys | n=5 | placed,documentID,compsList,linked,fileReference
SMARTFILTER I.beforeFilter | NO_filterFX | no filterFX key -> NOT a smart filter

I applyUnSharpMask[DOM] on SO | OK | amount=100 radius=2.0px threshold=0
SMARTFILTER I.afterUSM | smartObjectKeys | n=6 | placed,documentID,compsList,linked,fileReference,filterFX
SMARTFILTER I.afterUSM | filterFX_COUNT | 1
SMARTFILTER I.afterUSM.filterFX[0] | keys | n=8 | name,blendOptions,enabled,hasoptions,foregroundColor,backgroundColor,filter,filterID
SMARTFILTER I.afterUSM.filterFX[0].name    | OK | USM 锐化...
SMARTFILTER I.afterUSM.filterFX[0].enabled | OK | true
HISTORY I.afterUSM | OK | count=9 | dsh-probe4-I > 新建 > 新建图层 > 名称更改 > 套索 > 填充 > 取消选择 > 转换为智能对象 > USM 锐化

I applyGaussianBlur[DOM] on SO | OK | radius=4px
SMARTFILTER I.afterGaussian | filterFX_COUNT | 2
SMARTFILTER I.afterGaussian.filterFX[1].name | OK | 高斯模糊...
HISTORY I.afterGaussian | OK | count=10 | ... > 转换为智能对象 > USM 锐化 > 高斯模糊

I applyMedianNoise[DOM] on SO | OK | radius=2
SMARTFILTER I.afterMedian | filterFX_COUNT | 3
SMARTFILTER I.afterMedian.filterFX[2].name | OK | 中间值...
HISTORY I.afterMedian | OK | count=11 | ... > USM 锐化 > 高斯模糊 > 中间值
```

**结论明确性：成。** 判定依据不是"历史面板出现了滤镜名"，而是**结构性证据**：
1. `smartObject` 描述符**新增了 `filterFX` 键**（n=5 → n=6）；
2. `filterFX` 是数组，`filterFX_COUNT` 单调 1 → 2 → 3；
3. 每个 `filterFX[i]` 有 8 个键 `name, blendOptions, enabled, hasoptions, foregroundColor, backgroundColor, filter, filterID`，`enabled=true`；
4. 每个 `filterFX[i].name` 就是对应滤镜的本地化名（`USM 锐化...` / `高斯模糊...` / `中间值...`）；
5. 历史面板把滤镜记录为**智能对象下的子步骤**（`转换为智能对象 > USM 锐化 > 高斯模糊 > 中间值`），而非独立历史状态。

**可用的 DOM 滤镜方法（SO 上实测成功）**：`applyUnSharpMask(amount, radius, threshold)`、`applyGaussianBlur(radius)`、`applyMedianNoise(radius)`。
**AM 侧不可用**：`unSharpMask`、`reduceNoise`（charID `UnSf`/`RdNs` 反查为空，-25920）。
⚠️ `reduceNoise` 这个名字**在 DOM 侧也未验证**（DOM 侧实测的是 `applyMedianNoise`，不是降噪）。见 §10。

### 5.10 `imageSize` 缩放 ✅
```
EXEC imageSize[AM,900->800 constrain] | OK | now W=800 H=800
EXEC resizeImage[DOM,->800]           | OK | now W=800 H=800
```
两条路径都成功（`imgS`，含 `constrainProportions`）。

### 5.11 `canvasSize` 改尺寸带锚点 ✅
```
EXEC canvasSize[AM,->800 MidC]   | OK | now W=800 H=800
EXEC resizeCanvas[DOM,->800 MidC]| OK | now W=800 H=800
```
AM 配方用了 `canvasSize` + `anchor`；`MidC`（`middleCenter`）需要**现 mint**（见 §4.2 的 `middleCenter=4251`）。**这是带参数 AM 事件成功的第二个例子。**

### 5.12 duplicate / flatten / save / close ✅
```
EXPORT duplicate                       | OK | name=dsh-probe-export layers=2
EXPORT flatten[DOM]                    | OK | layers=1
EXPORT flattenImage[AM]                | OK | layers=1
EXPORT saveAs[JPEG quality=10]         | OK | path=...\probe-export.jpg exists=true bytes=51940
EXPORT saveAs[JPEG quality=12]         | OK | path=...\probe-export.jpg exists=true bytes=91295
EXPORT saveAs[JPEG quality=0]          | OK | path=...\probe-export.jpg exists=true bytes=25738
EXPORT saveAs[JPEG quality=13(out-of-range-control)] | FAIL | {错误: 指定值大于最大允许值} number={1239} line=717
```
- `duplicate`（AM）✅、`flattenImage`（AM）✅、DOM `flatten()` ✅
- **JPEG `quality` 参数被真实接受**：0→25738B、10→51940B、12→91295B（单调递增，字节数随 quality 变化 → 参数确实生效）
- **合法范围 0–12**；13 → `错误: 指定值大于最大允许值`（number `1239`）
- `close`：run1 的 export 段无独立 close 行；**close 由 run2/run4 的 CLEANUP 段验证**：
```
CLEANUP closed | OK | dsh-probe3-G
CLEANUP closed | OK | dsh-probe4-L
CLEANUP closed | OK | dsh-probe4-I
CLEANUP closed | OK | dsh-probe4-J.psd
CLEANUP postDocs | INFO | count=0 |
```
- ⚠️ 另有一条**已知陷阱**（run2）：`saveAs(..., asCopy=true)` 后**工作文档仍视为未保存**，随后任何 `doc.path` 访问抛 `错误: 尚未存储该文档。(8103)`。要让 `doc.path` 可读，必须 `asCopy=false`；run4 已验证：
```
SAVE asCopy=false | OK | fileExists=true doc.path=~/AppData/Local/Temp/dsh-ps-probe doc.saved=true
```

### 5.13 `gaussianBlur` ✅（唯一的"零参数引用"AM 滤镜成功例）
```
EXEC gaussianBlur[noNullRef] | OK | radius=6px on ProbeSubject
```
说明：AM 滤镜**并非全灭**——只要事件不引用任何对象/目标，就能跑通。一旦带 `null` target 引用，-25920。

### 5.14 图层置中 / 移动 ❌
```
MOVE align[AdCH without alignToCanvas] | FAIL | ... 命令"对齐"当前不可用。 (-25920) line=602
J move[SUSPENDHISTORY]                 | FAIL | ... (-1715)
```
- 试过 `align` + `AdCH`（水平居中）不带 `alignToCanvas`；在 GUI 中毒状态下无法定论 `align` 本身是否可用。**标注：未定论**。
- **DOM 平移可用**（run2）：
```
EXEC  translate[DOM] | OK | L=200 T=200 R=700 B=700 -> L=230 T=220 R=730 B=720
```

### 5.15 图层蒙版：**所有路线全灭** ❌
```
MASK make.revealAll        | FAIL | ... 命令"建立:"当前不可用。 (-25920) line=447
MASK maskField.hasUserMask | FAIL | ... <没有其它信息可用> (-1715) line=473
MASK maskField.userMaskEnabled/vectorMaskEmpty/userMaskDensity/userMaskFeather/... | FAIL | (-1715) 同上
J layerMask[SUSPENDHISTORY]| FAIL | ... 命令"建立:"当前不可用。 (-25920)
MASK docJ.afterMask        | INFO | hasUserMask=false userMaskEnabled=<absent>
MASK docL.ProbeSubject.fresh | INFO | hasUserMask=false userMaskEnabled=<absent>
```
- **无法通过 AM 创建蒙版**（`make` + `mask` + `revealAll` / `userMaskEnabled` 均被 -25920 拒）。
- 蒙版字段的**读取**也失败（-1715 `<没有其它信息可用>`），但**「没有蒙版时」布尔字段可通过描述符正常读取**（`hasUserMask=false`）。
- `doc.channels` 正常（**5.16**）：
```
MASK doc.channels | OK | count=3 | 红[kind=ChannelType.COMPONENT] / 绿[kind=ChannelType.COMPONENT] / 蓝[kind=ChannelType.COMPONENT]
```
- DOM 侧：`layer.mask` **未验证**（未探测）。见 §10。

---

## 6. 智能滤镜 —— 结论明确性声明

**问题：到底成不成？**

**答：成 —— 但只走 DOM，不走 AM。**

| 路径 | 结果 | 证据 |
|---|---|---|
| AM `newPlacedLayer` 转 SO | ✅ 成 | `isSmartObject=true`，描述符新增 `smartObject`/`smartObjectMore` |
| AM `unSharpMask`（`UnSf`）打 SO | ❌ 败 | `-25920 命令"<未知的>"当前不可用`；`NO_filterFX` |
| AM `reduceNoise`（`RdNs`）打 SO | ❌ 败 | `-25920`；`NO_filterFX` |
| **DOM `applyUnSharpMask` 打 SO** | ✅ **成** | `filterFX_COUNT=1`，`name=USM 锐化...`，`enabled=true` |
| **DOM `applyGaussianBlur` 打 SO** | ✅ **成** | `filterFX_COUNT=2`，`name=高斯模糊...` |
| **DOM `applyMedianNoise` 打 SO** | ✅ **成** | `filterFX_COUNT=3`，`name=中间值...` |

判定不依赖肉眼或历史面板，而是 **`smartObject` 描述符里 `filterFX` 键的结构化存在性与计数**。这条证据链在 `verify\out\probe-jsx.run4.log` 的 `MARKER I.smartfilter` 段内可逐行复查。

---

## 7. 第三类：DOM 事实（实测）

```
DOC id          | =740
DOC name        | =dsh-probe4-L
DOC width       | =900
DOC height      | =900
DOC resolution  | =72
DOC saved       | =false
DOC path        | THREW (expected for unsaved) | toString={错误: 尚未存储该文档。} num={8103}
DOC fullName    | THREW                       | toString={错误: 尚未存储该文档。} num={8103}
DOC mode        | =DocumentMode.RGB | bitsPerChannel=BitsPerChannelType.EIGHT
DOC backgroundLayer | =背景
DOC activeLayer | =ProbeSubject | kind=LayerKind.NORMAL
DOC artLayers.count | =2
DOC suspendHistory  | typeof=function
DOC historyStates.count | =7
```

**要点：**
- 未保存文档的 `path` **不是** `undefined`/空串 —— **访问即抛异常** `错误: 尚未存储该文档。(8103)`。插件代码必须 `try/catch`，不能写 `if (doc.path === undefined)`。
- `name` 是**显示名**（`dsh-probe4-L`），`fullName` 同样抛错。
- `resolution=72`、`mode=DocumentMode.RGB`、`bitsPerChannel=BitsPerChannelType.EIGHT`（自建 900×900 文档的默认值）。
- `backgroundLayer.name = 背景`（zh-CN 本地化）。
- `suspendHistory` 是函数（存在），但**使用它会引发 §5.0 的失败**，不建议用。

### 图层蒙版事实（题目第 16 项）
- 自建文档的新图层：`hasUserMask=false`、`userMaskEnabled` **键不存在**（`<absent>`）—— 所以读布尔字段前必须判键存在性。
- **无法创建蒙版**：所有 AM 路线 -25920/-1715（§5.15）。
- 有蒙版时的字段读取**从未成功过**（无任何一次成功创建出蒙版），因此**蒙版名 (`layer.mask.name`) 完全未验证**。

### AM 描述符键清单（真实，可作 batchPlay 键名参考）
新建普通图层 `activeLayer` 描述符，`n=45`：
```
name,color,visible,mode,opacity,layerID,itemIndex,count,preserveTransparency,userMaskEnabled,
userMaskLinked,layerFXVisible,globalAngle,background,layerSection,layerLocking,group,
targetChannels,visibleChannels,channelRestrictions,fillOpacity,hasUserMask,hasVectorMask,
proportionalScaling,layerKind,hasFilterMask,userMaskDensity,userMaskFeather,vectorMaskDensity,
vectorMaskFeather,filterMaskDensity,filterMaskFeather,bounds,boundsNoEffects,boundsNoMask,
useAlignedRendering,generatorSettings,keyOriginType,fillEnabled,animationProtection,
isSyntheticFill,artboardEnabled,vectorMaskEmpty,textWarningLevel,parentLayerID
```
转 SO 后 `n=45`（含 `smartObject` + `smartObjectMore`，少了 `color`/`preserveTransparency` 等）。`smartObject` 描述符本身的键：`placed,documentID,compsList,linked,fileReference`（+有滤镜时 `filterFX`）。

`boundsNoMask` 子描述符键：`top,left,bottom,right,width,height`（n=6）。

---

## 8. `LayerKind` 枚举实测（PS 2026 ExtendScript）

`typeof LayerKind.X` 逐项实测（run4 §G2）：
```
NORMAL:object | TEXT:object | SOLIDFILL:object | EXPOSURE:object | LEVELS:object | CURVES:object
GRADIENTFILL:object | PATTERNFILL:object | INVERSION:object | POSTERIZE:object | THRESHOLD:object
VIBRANCE:object | SMARTOBJECT:object | LAYER3D:object | VIDEO:object
HUE_SATURATION:<ERR num={1320}> | BRIGHTNESS_CONTRAST:<ERR 1320> | PHOTO_FILTER:<ERR 1320>
COLOR_BALANCE:<ERR 1320> | CHANNEL_MIXER:<ERR 1320> | SELECTIVE_COLOR:<ERR 1320>
GROUP:<ERR 1320> | SMARTFILTER:<ERR 1320>
```
抛错原文：`错误: 无效枚举值`（number `1320`）。

**关键**：`LayerKind.HUE_SATURATION` 等**访问即抛错** —— 这直接导致 `probe3.jsx` 在 try/catch **内部**用 `sq(LayerKind[...])` 拼日志时二次抛错并中止整个脚本（exit 3）。**插件代码中绝不能用裸 `LayerKind.XXX` 取值，必须整体包在 try/catch 里，且 catch 里不得再次触碰它。**

另：`KIND2` DOM 路径设置 `layer.kind`：
```
KIND2 TEXT          | OK   | name=  kind=LayerKind.TEXT
KIND2 SOLIDFILL     | FAIL | {错误: 您只能将图层的类型更改为文本或正常。} num={8193}
KIND2 HUE_SATURATION| FAIL | {错误: 无效枚举值} num={1320}
```

---

## 9. 完整错误原文索引（供 grep / 对照）

| 错误原文（照抄） | number | 出现位置 |
|---|---|---|
| `错误: 发生了常规 Photoshop 错误。该功能可能无法在这个版本的 Photoshop 中使用。\n- 不能完成命令，因为程序错误。` | `-1715` | 所有 `make + adjustmentLayer`；蒙版字段读取 |
| `错误: 发生了常规 Photoshop 错误。该功能可能无法在这个版本的 Photoshop 中使用。\n- 命令"<未知的>"当前不可用。` | `-25920` | `selectSubject`、`unSharpMask`、`reduceNoise` |
| `错误: 发生了常规 Photoshop 错误。该功能可能无法在这个版本的 Photoshop 中使用。\n- 命令"移动"当前不可用。` | `-25920` | 中毒后的 `move` |
| `错误: 发生了常规 Photoshop 错误。该功能可能无法在这个版本的 Photoshop 中使用。\n- 命令"对齐"当前不可用。` | `-25920` | `align` |
| `错误: 发生了常规 Photoshop 错误。该功能可能无法在这个版本的 Photoshop 中使用。\n- 命令"建立:"当前不可用。` | `-25920` | 所有蒙版创建 |
| `错误: 发生了常规 Photoshop 错误。该功能可能无法在这个版本的 Photoshop 中使用。\n- 命令"转换为图层"当前不可用。` | `-25920` | `placedLayerConvertToLayers`（bare） |
| `错误: 发生了常规 Photoshop 错误。该功能可能无法在这个版本的 Photoshop 中使用。\n- <没有其它信息可用>` | `-1715` | 蒙版字段读 |
| `错误: 尚未存储该文档。` | `8103` | 未保存文档访问 `.path`/`.fullName` |
| `错误: 您只能将图层的类型更改为文本或正常。` | `8193` | 设置 `layer.kind` 为 SOLIDFILL |
| `错误: 无效枚举值` | `1320` | 访问 `LayerKind.HUE_SATURATION` 等 |
| `错误: 指定值大于最大允许值` | `1239` | JPEG `quality=13` |
| `引用错误: docL.activeLayer.adjustHueSaturation 不是函数` | `24` | DOM 无此方法 |
| `类型错误: undefined 不是对象` | `21` | 对非 SO 图层读 `.smartObject` |

---

## 10. 未能验证清单（**不要猜，这里就是空白区**）

| # | 未验证项 | 原因 |
|---|---|---|
| U1 | **UXP `batchPlay` 侧的一切** | UXP Developer Tool 未安装 → 本机无 UXP 真机通道。本报告全部是 ExtendScript。 |
| U2 | `selectSubject` / `removeBackground` 在 UXP 下是否可用 | 同上。ExtendScript 下失败**不代表** UXP 下失败。 |
| U3 | `removeBackground` 的**真实语义** | 未做像素级比对；只观察到"不抛错 + 图层结构无变化"。**必须先补像素比对探针。** |
| U4 | 图层蒙版能否以**任何**方式创建 | AM 全灭；DOM `layer.mask` 路径**未探测**。 |
| U5 | 蒙版相关字段（`layer.mask.name` 等）的真实形态 | 从未成功创建出蒙版，样本数为 0。 |
| U6 | `align`（对齐）命令本身是否可用 | 探测时处于 GUI 中毒状态，结果被污染。 |
| U7 | `reduceNoise` 的 DOM 等价方法 | DOM 侧实测的是 `applyMedianNoise`，**不是**降噪。名字未验证。 |
| U8 | 色相/饱和度的**可达路径** | AM -1715；DOM `adjustHueSaturation` **不是函数**。目前**没有任何一条已验证的路径**。 |
| U9 | 图层样式 `dropShadow` 的实际可用性 | 只验证到 `stringIDToTypeID` 有值（判据已失效）；DOM/USP 路径未探测。 |
| U10 | 剪贴蒙版 / 图层组 / 文字图层的 AM 配方 | 未纳入本次探测范围。 |
| U11 | `probe.jsx` 中 `setSelection` 的可用构造 | 事件名可反查到但未构造出可用调用；选区相关 API 的空缺。 |
| U12 | 所有带参数 AM 事件在**干净文档（未中毒）**下的完整矩阵 | run1 后半段被 GUI 中毒污染；run2 只补了 DOM 侧对照，未逐一重跑故障项。 |
| U13 | `Q`：`probe2.jsx` 中 `DICT` 表里我未列出 ID 的条目（如 `Anch`/`AdCH` 等）的 typeID 精确值 | 部分 typeID 在压缩归档中未保留；需要在 `probe-jsx.run2.log` 中重新提取。 |
| U14 | 用户实际的生产素材工作流 | 本次全部使用脚本自建的 900×900 白底 + 椭圆测试文档，**未接触任何真实产品图**。 |

---

## 11. 可迁移性判定：哪些结论只对 ExtendScript 成立

任务书要求明确标注。逐条如下：

### ✅ 可安全迁移到 UXP `batchPlay` 的（是"字符串/枚举/键名"事实，与通道无关）
- **charID → 规范名反查表**（§4.2）：`GsnB`→`gaussianBlur`、`CnvS`→`canvasSize`、`FltI`→`flattenImage`、`ImgS`→`imageSize` 等；以及 `brightnessContrast` 的规范名其实是 **`brightnessEvent`**、`select` 的枚举名其实是 **`selectionEnum`**。**这些是 Photoshop 内部的命名事实，UXP 侧字符串必须一致。**
- **描述符键名清单**（§7）：`layerID`、`hasUserMask`、`filterFX`、`smartObject`、`boundsNoMask`、`targetEnum`、`ordinal`、`using`、`at`、`to`、`layerKind`、`adjustment`、`presetKind` 等。
- **`LayerKind` 枚举在 ExtendScript 侧残缺**（`HUE_SATURATION` 抛 1320）—— 这提示 **UXP 侧不要假设 `layerKind` 枚举齐全**，但 UXP 的具体表现**未验证**（U1）。
- **JPEG `quality` 合法区间 0–12**（13 → `1239`）—— 这是**编码器参数约束**，与调用通道无关，UXP `save` 的 `quality` 极可能同界（**但未在 UXP 侧验证**）。
- **GUI 对话框风险**：UXP `batchPlay` 同样会触发 PS 原生对话框（如「转换为智能对象」）。**这个坑是 PS 应用层的，不是 ExtendScript 的**，UXP 侧务必同样防护。
- **未保存文档的 `path` 不可读**（`8103`）—— 文档模型事实，与通道无关。

### ⚠️ **不可**直接迁移（必须在 UXP 侧重新实测）
- **`selectSubject` / `removeBackground` 在 ExtendScript 下失败（-25920）** —— 这**只能**说明 ExtendScript 的 `app.executeAction` 通道够不到它们。UXP `batchPlay` 是**另一条通向同一 Action Manager 的通道**，很可能可以。**结论：UXP 侧必须自己测，本报告不构成"不可用"的证据。**
- **`-1715` / `-25920` 这两个错误码**：`executeAction` 的参数封装方式是 ExtendScript 特有的（`ActionDescriptor` 对象）；UXP 用 JSON 对象，序列化路径不同 → **同样配方在 UXP 下的成败可能完全不同**。**尤其 `make + adjustmentLayer + layerKind` 那 5 个调整层，绝不能因为 ExtendScript 失败就判定 UXP 也失败。**
- **`suspendHistory` 中毒现象**：这是 ExtendScript DOM 方法，UXP 没有等价物（UXP 用 `batchPlay` 的 `historyState`）。**中毒机制不可迁移，但"不要在批处理中弹对话框"的教训可迁移。**
- **`stringIDToTypeID` 的 mint 行为**：ExtendScript API。UXP 侧无此函数（UXP 直接写字符串 + `_obj`/`_target`）。**§3 的方法论警告在 UXP 侧天然不存在。**
- **所有 DOM 方法名**（`adjustBrightnessContrast`、`applyUnSharpMask`、`photoFilter`、`adjustColorBalance`、`resizeImage`、`translate` 等）：UXP **没有**这套 DOM。它们的价值在于**证明 PS 2026 内部有这些能力**，UXP 侧需要用对应的 Action Manager 事件实现，**事件名与配方需另行探测**。

### ❌ 明确不可用（ExtendScript 范围内，且高度怀疑跨通道也不可用）
- 通过 `stringIDToTypeID` 判定事件是否存在（方法本身错，§3）。
- `charIDToTypeID("UnSf")` / `("RdNs")` 这类**长名事件的 4 字符猜测**（反查为空）。

---

## 12. 给插件架构的直接建议（基于本报告）

1. **ExtendScript 侧**：调整图层、滤镜、缩放、平移、导出，**一律走 DOM**。DOM 方法名已实测：`adjustBrightnessContrast` / `photoFilter` / `adjustColorBalance` / `applyUnSharpMask` / `applyGaussianBlur` / `applyMedianNoise` / `resizeImage` / `resizeCanvas` / `translate` / `flatten` / `saveAs`。
2. **不要用 `suspendHistory`**；改用 `app.displayDialogs = DialogModes.NO`（脚本顶部第一句）+ 每个探测段落独立 try/catch。
3. `selectSubject` / `removeBackground` / 调整层 AM 配方 / 蒙版 —— **这四项是 UXP 侧必须独立开辟的战场**，本报告只能告诉你要测什么，不能告诉你答案。
4. 所有 `LayerKind.XXX` / `doc.path` 访问**必须**包 try/catch，且 catch 块内不得再次触碰同一对象。
5. 定下一条**只属于 ExtendScript 的通道边界**：能 DOM 就 DOM；AM 只用于 DOM 没有的（目前实测：`gaussianBlur`、`imageSize`、`canvasSize`、`flattenImage`、`duplicate`、`solidColorLayer`/`contentLayer` 创建、`newPlacedLayer`）。

---

*本报告所有数值、错误码、错误原文均来自 `verify\out\` 下的真实日志文件；§10 明确列出未能验证的 14 项，未做任何推测性填充。*
