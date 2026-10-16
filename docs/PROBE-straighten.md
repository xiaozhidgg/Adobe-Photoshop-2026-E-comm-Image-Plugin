# 摆正 / 透视 —— 只读探针报告

> 本文件对应 `docs/PLAN-straighten.md` §9 的三项需跑项：① 事件名可用性 ② 参数键名 ③ 数值样本。三项本轮已全部跑完（§1-§4 = ExtendScript 取证，§5 = UXP 面板真机）。
> 全程只读：不修改用户文档、不写回仓库里的探针脚本产出的图片。§1-§4 的 ExtendScript 轮次前后 `documents.length` 均为 0；§5 的 UXP 轮次里有 1 个用户文档打开（只读它），探针自建的临时文档每轮都以 `DONOTSAVECHANGES` 关闭。

## 0 结论摘要

| 问题 | 结论 | 证据等级 |
|---|---|---|
| `executeAction` 的异常文本能否判「事件名是否可用」 | **不能**。真事件 `trim` 与负对照新铸字符串返回一字不差的错误 | 真机，A 段正/负对照 |
| 摆正（A 档）可用路径 | `transform` + `Angl`（已取证生效） | 真机，C 段回读 bounds |
| `upright` / `autoStraighten` | 本 build **不是已注册事件名** | 真机，A 段 + 连号新铸 |
| 透视（B 档）走 AM 滤镜（`lensCorrection` / `adaptiveWideAngle`） | 本 build **不可调用** | 真机，A/C 段 |
| `distort` 这个字符串 | 指向 **Distribute（分布）**，不是「扭曲」 | 真机，A 段错误原文「分布」 |
| Camera Raw 滤镜（C 档） | 不可调用 | 真机，A 段 + 既有事实 |
| 智能对象滤镜参数键名 | `smartObject.filterFX[0].filter.{amount,radius,…}` 形态已取证（用 USM 正对照） | 真机，C 段 dump |
| UXP 侧在真实商品图上跑只读分析 | **跑通**：θ / 四边残差 / 透视比五轮一致（θ=66.92°，`skip`） | 真机，UXP 面板 §5.1-5.2 |
| UXP 侧建临时文档 | `app.createDocument`（宿主 DOM API）**成功**；旧的 `make/using` 形态报「程序错误」 | 真机，§5.4 |
| `transform+Angl` 旋转 | 应用后回读 bounds 变化，数值与 5° 几何自洽（64×64：`L0T0R64B64`→`L-3T-3R67B67`） | 真机，UXP 面板 §5.3 |

## 1 方法与判据

环境：`app.version=27.1.0`，探针开始前与结束后均 `documents.length=0`、`activeDocument=none`（日志行 5、1511）；全程 `displayDialogs=NO`，未触发任何模态对话框。

### 1.1 ★ 为什么必须换判据

原判定规则（写在探针源码里，日志行 16 原文照录）：错误文本含「未知的 / not currently available / 当前不可用」⇒ 事件名不可用。

**该规则在本 build 失效**，因为它把真事件也判成不可用：

- 正对照 `trim`：真事件（`charIDToTypeID('trim')` → typeID `1953655149`，4 字符码反查为空串）在 0 文档与 1 文档两轮下都返回
  `命令"<未知的>"当前不可用。} num={-25920}`（日志行 17-18）。
- 负对照 `dshBogusEventNameA`：`stringIDToTypeID` 现铸的新串（typeID `4153`）返回**完全相同的文本**（日志行 19-20）。

⇒ 两者一字不差，异常文本没有判别力。**唯一可信的判据是「应用后回读」**：`bounds` 是否变化、`smartObject.filterFX` 是否多出一条。本报告所有「可用/不可用」的结论都以此为准，异常文本只当旁证。

同时必须记住：PS 会**静默忽略**被写错的参数键（no-throw 且无副作用），所以「没抛错」不等于「键被接受」。

## 2 事件名可用性（A 段，documents=1）

`stringIDToTypeID` 的返回值本身不能当判据（新铸字符串也能往返，见 §6 ④）。

| 候选 | typeID | 错误原文要点 | 结论 |
|---|---|---|---|
| `trim`（正对照） | `1953655149`（charIDToTypeID；反查空） | 命令"**<未知的>**"当前不可用 | 正对照失败 ⇒ §1.1 规则失效 |
| `dshBogusEventNameA`（负对照） | `4153` | 命令"**<未知的>**"当前不可用 | 与上者同文本 |
| `transform` | `1416785510`（`'Trnf'`，反查 `transform`） | 命令"**变换**"当前不可用 | 名字已注册；**C 段证明事件真生效** |
| `distort` | `1148417138`（`'Dstr'`，反查 `distort`） | 命令"**分布**"当前不可用 | 该 ID 实为 Distribute（分布），**不是「扭曲」** |
| `perspective` | `1349677936`（`'Prsp'`，反查 `perspective`） | 命令"**<未知的>**"当前不可用 | 已注册；生效未取证 |
| `upright` | `4154` | 命令"<未知的>"当前不可用 | 非已注册事件名 |
| `autoStraighten` | `4155` | 同 | 非已注册事件名 |
| `lensCorrection` | `4156` | 同 | 非已注册事件名 |
| `lensCorrectionFilter` | `4157` | 同 | 非已注册事件名 |
| `adaptiveWideAngle` | `4158` | 同 | 非已注册事件名 |
| `cameraRawFilter` | `4159` | 同 | 非已注册事件名 |
| `cameraRaw` | `32` | 命令"<未知的>"当前不可用 | 形态异常（非 4 字符码），语义未取证 |

四个负对照（`dshBogusEventNameA..D`）与上表 6 个未注册名按调用顺序连号新铸（`4153`–`4160`）⇒ 这批字符串就是普通字符串，没有对应的已注册 AM 类型。

B 段 4 字符码反查（仅参考，不作判据，理由见 `docs/DEVELOPER.md` §6.1）：`Mk`→make、`ImgS`→imageSize、`Exps`→exposure、`Trnf`→transform、`Dstr`→distort、`Prsp`→perspective、`Auto`→auto 全部 MATCH；`AdpW` / `Uprt` / `Lnsc` / `LnsC` / `CRaw` / `CamR` / `Trim` / `UnSf` 反查为空串；`dshBogusNameA..D` 也能往返 ⇒ **往返检测恒为真**。

A.param 段（`Trnf` + `quad` / `quadrilateral` / `freeTransform` / `distort` / `perspective` / `warp`；`lensCorrection` + `vertical` / `horizontalPerspective` / … ；`cameraRaw` + `upright` / …）全部 `-25920`，连真事件 `Trnf` 带键也报「变换」当前不可用 ⇒ **该形式无判别力**，已弃用。

## 3 参数键名的真实形态（C 段）

临时文档 `dsh-probe5-C`，层 `ProbeSubject`，初始 `bounds{L=50 T=50 R=250 B=150}`。

用**正对照**取键名：`newPlacedLayer` 转智能对象（OK，`kind=LayerKind.SMARTOBJECT`）→ 走 DOM `applyUnSharpMask(100, 2, 0)` → 回读 `smartObject.filterFX` 成功，键名 n=8 原样 dump：

```
name
blendOptions(.opacity, .mode)
enabled
hasoptions
foregroundColor(.red, .grain, .blue)
backgroundColor(.hue, .saturation, .brightness)
filter(.amount, .radius, .threshold)   ← USM 的真实参数键
filterID(typeID=4185)
```

每键都带 typeID（如 `amount` = `1097690740` = `'Amnt'`）。

镜透类滤镜（`lensCorrection` / `lensCorrectionFilter` / `cameraRaw` / `cameraRawFilter` / `adaptiveWideAngle`）在 C 段全部 `-25920`，且 `filterFX` 里始终**只剩 USM 那一条**（`name="USM 锐化…"`）⇒ 没有任何一个该类滤镜被真正应用过。

## 4 生效证据（Trnf + Angl）

生效判据＝应用后回读层 `bounds`：

| 事件 | 参数 | boundsBefore | boundsAfter | changed |
|---|---|---|---|---|
| `Trnf` | `Angl`（`#Ang`，5°） | `L50 T50 R250 B150` | **`L46 T41 R254 B159`** | **true** |
| `Trnf` | `quad` 列表 / `freeTransform` 对象 / `Ofst` / `mdSc` 多数 | `L50 T50 R250 B150` | `L50 T50 R250 B150` | false |

⇒ `transform` 事件在本 build 真能生效，`Angl` 是确认可用的键；其余键 no-throw 却无副作用，**不能证明被接受**。

## 5 UXP 面板探针的数值样本（真机，2026-10-16）

探针：`plugin/src/straighten-probe.js`，面板按钮「探针（只读）」。**只读**：读像素 + 在探针自建的临时文档上试一次旋转；用户文档全程未被写入、未被保存。

### 5.1 运行记录（5 轮，同一张真实商品图）

| # | 时间 | 代码版本 | 像素形态 | θ | 蒙版模式 | verdict |
|---|---|---|---|---|---|---|
| 1 | 10:05:38 | 旧（单发建文档） | 1024×1024×3ch | 66.92° | bgThreshold | skip |
| 2 | 10:05:55 | 旧 | 1024×1024×4ch | 66.92° | bgThreshold | skip |
| 3 | 10:10:50 | 旧（热重载不成立，见 §5.4） | 1024×1024×4ch | 66.92° | bgThreshold | skip |
| 4 | 10:11:30→34 | 新（三路径阶梯） | 1024×1024×3ch | 66.92° | bgThreshold | skip |
| 5 | 10:11:47 | 新 | 1024×1024×4ch | 66.92° | bgThreshold | skip |

- 被测文档：**`朵宝乐清新雪山薄荷风味益生菌酵素靓白牙膏.jpg`#60，1254×1254 @72dpi**（面板活动文档）。计划里那张 `carton_lying_v5.psd`（2000×1400，3 通道无 alpha）本轮**没用到** —— 用户实际打开的是这张真实商品图。
- **5 轮 θ 完全一致（66.92°）**，且与 `channels` 是 3 还是 4 无关 ⇒ 分析确定性、对通道数差异不敏感。采样：`ps.getSubjectPixels({applyAlpha:false, maxDim:1024})`（★ 必须 `applyAlpha:false`）。
- `channels` 在同一图层上 3/4 抖动；4 通道那几轮 alpha **没有**被当成主体掩膜（仍回落 `bgThreshold`），与「背景层 alpha 全不透明 ⇒ 回落阈值法」的设计一致 —— 但 alpha 的实际统计没打印，列 §6 未取证。
- `mask.mode=bgThreshold`，`mask.bg=[196,196,196]`；该图层无用户蒙版：`hasUserMask=false`（判据键取自整层 `get`），`getLayerMask` 返回结构无法识别 ⇒ `alphaMask=null`。

### 5.2 数值样本（五轮同值）

- `thetaDeg = 66.92`（主轴角，图像矩 / PCA）
- `minRect = {cx:517.9515923566879, cy:505.85541401273883, w:803.3449687733801, h:500.5737154365851, thetaDeg:-87.95459151111278}`
- `centroid = {x:524.9575398147531, y:415.36550942893314}`；`coverage=0.072`、`areaPx=75035`
- `edges = {top:10.129010466204285, right:22.39823030685699, bottom:9.87377620551937, left:15.311681991576966}`（该边 RMS 残差占边长百分比）；`edgeRmsPct=22.398`
- `quad = {topW:775.232868240247, botW:689.2807845863688, leftH:471.4679204357387, rightH:505.6678751908213}`
- `perspective = {widthRatio:1.1246982152642733, heightRatio:0.9323667639709626, maxDeviation:0.12469821526427327}`
- `verdict = skip`；`notes`：`主轴角 66.92° 与最小外接矩形角 -87.95° 相差 25.12°（以矩形角为准）`、四边各一条 `整边 X% vs 近边带 0.40/0.33/0.33/0.10%（报告用整边）`、`跳过：|主轴角| 66.92° > skipThetaDeg 15`
- §9 要求的「建议动作」= `verdict` 三档，面板日志同时打紧凑判定行：`micro` →「可微调 <3°」、`confirm` →「建议人工确认」、`skip` →「跳过」。本轮日志原文：`紧凑判定：θ=66.92° · 边缘残差=22.398% · 透视偏差=0.1247 · mask=bgThreshold(0.0716) → skip`

**这张图上判 `skip` 是正确的，不是失败**：它不是「摆歪了的平面产品图」，而是轮廓本身弯曲的实拍图 —— 主轴角与最小外接矩形角相差 25.12°（差得远），四边整边残差 10~22% 而近边带只有 0.1~0.4%（弯曲集中在轮廓，不是整体倾斜）。这正好实测了 `docs/PLAN-straighten.md` §5 风险策略与 §6 验收里「异形 / 非平面必须跳过、零改动」那一条。

### 5.3 旋转路径的生效证据（应用后回读）

在探针自建的临时文档（`dsh-straighten-probe#65` / `#72`，64×64 @72dpi）上：

- 应用前 `bounds = L0 T0 R64 B64`
- `transform`（变体 `withCenter`：`freeTransformCenterState = QCSAverage` + `offset` 0 + `angle` 5°）→ `applied=true`、**回读 `changed=true`**：`bounds = L-3 T-3 R67 B67`
- 数值自洽：64·(cos5°+sin5°) = 64×1.08335 = 69.33 ⇒ 左/上 = (64−69.33)/2 = −2.66 ≈ **−3**，右/下 = 66.66 ≈ **67** ✔ 与回读一致
- 临时文档已按 `DONOTSAVECHANGES` 关闭；探针后文档清单只剩用户文档 `#60`

**边界（不得越读）**：这次旋转**只作用在探针自建的 64×64 干净文档上**，没有也不可能作用在用户的商品图上（只读原则）。因此「`transform+Angl` 在带智能对象 / 蒙版的真实商品图上一定生效」**尚未取证**（§6 第 6 条）；变体 `bare` 第一变体成功即返回，也没跑到。

### 5.4 建临时文档：换形态才是根因（顺带取证）

原探针手写的 `{_obj:"make", _target:[{_ref:"document"}], using:{…}}`（ExtendScript 风格）真机报 `无法完成请求，因为程序错误。`（10:05:38 / 10:05:55 / 10:10:50 三轮都因此整体跳过探测）。改成三路径阶梯后**第一条即成功**：

| 路径 | 形态 | 结果 |
|---|---|---|
| 1 | `app.createDocument({mode:"RGBColorMode",width,height,resolution,fill,name})`，包在 `ps.modal()` 里（宿主 DOM API） | **成功**：返回 `Document#65` / `#72`，活动文档即临时文档 |
| 2 | `batchPlay` `{_obj:"make", new:{_obj:"document", …}}`（宿主同形） | 未跑到 |
| 3 | `batchPlay` `{_obj:"make", _target:[…], using:{…}}`（旧形态，对照） | 未跑到 |

根因证据（实测读出，非推测）：`Photoshop 安装目录\Required\UXP\photoshop.js` 里 `Photoshop.prototype.createDocument` 的实现就是 `batchPlay(makeDocument({mode,width,height,resolution,fill,…}))`，而 `makeDocument` 产出 **`{_obj:"make", new:{_obj:"document", mode:{_class:"RGBColorMode"}, width:{_unit:"distanceUnit",…}, height:…, resolution:{_unit:"densityUnit",…}, fill:{_enum:"fill",_value:…}, …}}`** —— **没有 `_target`，也没有 `using`**；同函数还会把 width/height 按 `72/resolution` 换算后当 `distanceUnit` 传（故 72dpi 下 1pt = 1px）。

⇒ 以后建文档：**优先 `app.createDocument`**；必须自己写描述符时用 `{_obj:"make", new:{…}}` 形态。

同轮顺带坐实的两条真机教训：

- **UXP 插件不会热重载**：改完 `%APPDATA%\Adobe\UXP\Plugins\External\com.ecom.psimage` 里的文件，PS 里跑的还是旧代码（10:10:50 那轮即是），**必须完全退出并重启 PS**。
- **`读取图层蒙版失败：Error: Unknown layer` 是已知非阻塞噪声**：ps.js 的蒙版读取会重试 5 次（400/800/1600/1200ms，上限 4000ms）后放弃，本轮因此白等约 4s（10:11:30→34）。该图层本就无蒙版，不影响结论；属既有 ps.js 行为，本轮不改。

### 5.5 候选事件名（UXP 侧空参扫描，日志行 3606-3619）

7 个候选**全部抛错**：`lensCorrection`、`adaptiveWideAngle`、`cameraRaw`、`cameraRawFilter`、`perspective`、`upright` 报 `命令"<未知的>"当前不可用。`；**`distort` 报 `命令"分布"当前不可用。`** —— 解析成了 Distribute（分布），与 §0 表、ExtendScript 侧结论一致。

对 §1.1 判据的**细化**（本轮新增经验）：异常文本并非全无信息 —— 字符串能映射到某个已注册命令时，PS 会打出**该命令的本地化显示名**（`distort` → 「分布」），映射不到才打 `"<未知的>"`。但它仍**不能**判「我要的那个几何事件可用」：真事件 `trim` 打的也是 `"<未知的>"`，而 `distort` → 「分布」指向的是另一个功能。⇒ 判据不变：**应用后回读是唯一可信判据**，文本只当旁证。

### 5.6 耗时

| 轮次 | 耗时 | 说明 |
|---|---|---|
| 10:11:30 → 10:11:34 | 4s | 其中约 4s 花在蒙版读取重试（§5.4 第二条） |
| 10:11:47 | 同一秒内 | ≤1s，蒙版读取未走重试路径 |

量级符合 §5「不进关键链路的只读预判」定位。

## 6 仍未取证（不得当结论使用）

1. 镜透 / 自适应广角 / `upright` / `autoStraighten` / `cameraRaw` / `cameraRawFilter` 的**参数键名全部未取证**。
2. `cameraRaw`（typeID `32`）的语义未知。
3. `Trnf` 的 `quad` / `freeTransform` / `distort` / `perspective` / `warp` 键：no-throw 但不改 bounds，不能证明键被接受（PS 静默忽略未知键）。确认可用的只有 `Angl`；`Ofst` / `mdSc` 的正确嵌套待查。
4. **不能**把「这个字符串不是已注册事件名」升级成「该功能在本版本不存在」——只能说 AM 路径没走通，菜单/对话框路径未验。
5. 执行侧唯一可信的可用性判据是「应用后回读 bounds / filterFX」。
6. `transform+Angl` 在**真实商品图**（含智能对象 / 图层蒙版 / 多图层）上的应用未取证：只在探针自建的 64×64 干净文档上回读成功（§5.3）。变体 `bare` 未跑到。
7. 4 通道轮次里 alpha 的实际统计（是否全不透明 / 覆盖率多少）没打印，因此 `bgThreshold` 回落的机制只有观察、没有取证（§5.1）。
8. §5.4 的建文档路径 2 / 3 未跑到 ⇒ `{_obj:"make", new:{…}}` 与旧形态各自能否建出文档，仍未取证（当前只证明了路径 1 可用）。

## 7 对后续档位的裁决

- **A 档（摆正）**：可走 `transform` + `Angl`（64×64 干净文档上已应用并回读生效，§5.3）；★★ 2026-10-16 晚已在**真实图片上端到端取证**（7 张标定图 + 不透明图路径，命中率与误差见 `docs/PLAN-straighten.md` §10.3，本轮新事实见本文 §9）；`upright` / `autoStraighten` 在本 build 不是已注册事件名，**不能**作为实现路径。
- **B 档（透视）**：计划中的 AM 滤镜路径（`lensCorrection` / `adaptiveWideAngle`）在本 build 不可调用；`distort` 指向 Distribute，不是「扭曲」。B 档需要另找路径（菜单动作 / 逐角点 `transform` 组合），或先补一轮针对性的可用性探针。
- **C 档（Camera Raw）**：不可调用。
- `docs/DEVELOPER.md` §3 第 2 条的三条未采纳改进、以及真机验收欠账 3 项，仍悬置。

## 8 证据清单

**命令**（`-JsxPath` 必须绝对路径，相对路径会让 `DoJavaScriptFile` 抛错）：

```
$p='<插件仓库根目录>\verify\probe.ps1'
$j='<插件仓库根目录>\verify\probe5.jsx'
powershell -ExecutionPolicy Bypass -File $p -JsxPath $j -TimeoutSec 300   # → === probe.ps1 END exit=0 ===
powershell -ExecutionPolicy Bypass -File verify\probe.ps1 -JsxPath verify\probe5.jsx -TimeoutSec 300
                                                                          # → === probe.ps1 END exit=3 ===（相对路径失败版）
```

**产物**：`verify/out/probe5-extendscript.log`（241117 B，1514 行，sha256 `0FF63F66E2F90C53…`）、`verify/probe5.jsx`（31831 B）。进程中间文件只在 `%TEMP%\dsh-ps-probe\result.txt`（仓库外）。

**旧日志备份 / 还原**（跑前 `Copy-Item` 出 `.bak`，跑后原样拷回，哈希+字节数双等）：

| 文件 | 字节 | sha256(前16) |
|---|---|---|
| `verify/out/probe-jsx.log` | 16802 | `DB99F3B9CCCEEBD0`（与 `probe4-jsx.log.bak` 一致） |
| `verify/out/probe.ps1.log` | 1174 | `C1F5DB63FDC462F2`（与 `probe4-ps1.log.bak` 一致） |

诚实补充：跑前 `probe-jsx.log` 的内容等于 `probe-jsx.run2.log`，**不是** probe4 的 run4 输出（run4 = `probe-jsx.run4.log`，6881 B）——`.bak` 这个名字是按任务书取的。

**UXP 面板探针（2026-10-16，5 轮）**：日志 `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\External\com.ecom.psimage\PluginData\ecom-debug.log`（跑后 3679 行；本轮新增行 3449-3679 = 10:05:38 / 10:05:55 / 10:10:50 / 10:11:30 / 10:11:47 五个块）。探针源码保留在仓库：`plugin/src/straighten-probe.js`；装机副本 `%APPDATA%\Adobe\UXP\Plugins\External\com.ecom.psimage\src\straighten-probe.js` 与源 sha256 一致。每轮结束都自检：临时文档以 `DONOTSAVECHANGES` 关闭、文档清单只剩用户文档 `#60`、用户文档未被写入。

**未触碰**：`verify/probe.jsx`、`verify/probe.ps1`、`verify/probe4.jsx`（mtime 仍 2026/10/14 15:09:15）；未 `git add` / `commit`。

---

## 9 A 档落地后补充的真机事实（2026-10-16，与本文 §5 同源的真机日志）

本节只记**在真机上逐行核对过**的新事实；A 档的实现与精度表在 `docs/PLAN-straighten.md` §10。日志：`%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\External\com.ecom.psimage\PluginData\ecom-debug.log`。

### 9.1 「背景层 → 普通层」的三条硬事实（此前未知，且与探针结论方向相反）

| 事实 | 真机证据 |
|---|---|
| ① 转换会**换图层 id**（1 → 2）并改名「图层 0」 | `11:35:00 转换命令发出后旧 id=1 已不存在 → 按文档最底层改用 id=2「图层 0」`；`图层 id 1 → 2）后继续`；`解锁后主体换了图层：id 1（「背景」）→ id 2（「图层 0」）` |
| ② PS **同时回一个错误项**（命令其实已生效） | 同轮 `Photoshop 拒绝了描述符：命令"设置"当前不可用。` 出现后，图层确实已是「图层 0」 |
| ③ 改名才算转换；`set` 传回原名不转换 | 转换名改用「图层 0」后一次成功（对比 11:24:45 那轮：拿旧 id 重试 21 轮、61s 全被拒） |

⇒ 探针期「写命令被拒」的**首要**解释不是「宿主忙/写通道未就绪」，而是**目标 id 已失效**；把「被拒」一律当忙等，会白等到超时（真机 61s、34s 两次）。

### 9.2 掩膜坐标系随路径不同（量 θ 时必须知道自己在量什么）

| 路径 | 掩膜参照 | 真机覆盖率样本 |
|---|---|---|
| `mode:"alpha"`（图层有非 255 alpha） | **图层自身的 bounds** | `a-8.0.png` 0.7615（卡片 / 旋转后外接框）；`a-circle.png` 0.7851 ＝ π/4 |
| `mode:"bgThreshold"`（不透明整层） | **整张画布** | `b-2.0.png` 0.2734（卡片 / 1200×900） |

⇒ 两种模式的 coverage **不可直接互相比较**（对 θ / 最小外接矩形无影响，因为两者掩膜里都有完整主体）；但**同一轮的首测与回读必须用同一模式**，否则旋转后四角变透明会让掩膜从「主体」跳到「整张画布」，量到的 θ 恰好是画布被转过去的角度（真机假信号：`θ 2.04° → −2.04°`）。

### 9.3 变换的真实形态（补 §5.3）

- 可用：`select`(目标图层) → `transform`，`freeTransformCenterState = {quadCenterState:"QCSAverage"}` + `angle`（实测角度误差 ≤ 0.05°，见 §10.3）；`transform` 只作用于**当前激活图层**，只给 `_target` 会被静默丢掉。
- 不可用：裸 `{ transform: { angle } }`（no-throw 但 bounds 不变，静默 no-op）；`quad` / `quadrilateral` / `freeTransform` / `perspective` / `warp` 参数形态在本 build 全部 THREW「命令"变换"当前不可用」（§2/§4，仍属 §6「未取证」）。
- 本 build 仍**不可调用**：`lensCorrection` / `adaptiveWideAngle` / Camera Raw（Upright 等）；`distort` 名字指向「分布」（Distribute）。⇒ §6 与 §7 对 B 档的裁决不变。

### 9.4 与 §6「仍未取证」的关系

§9 只关闭了「真实图片上的 `transform`+`Angl` 是否生效」与「被拒的真因是不是忙」两条；**B 档相关的未取证项（`lensCorrection`/`cameraRaw`/`quad` 的键名与可用性）一条都没有变化**，仍按 §6 处理。
