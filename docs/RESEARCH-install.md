# RESEARCH-install：PS 2026 未打包 UXP 插件的真实落点（本机实测）

> 取证机器：`C:\Users\EDY` / Windows，Photoshop FileVersion `27.1 (20251117.r.17 2758080)`，安装目录 `D:\software\Adobe Photoshop 2026`
> 取证时间：本次会话；所有结论均可追溯到下面的命令、文件路径或日志原文。
> **本文件不照抄网络博客**；每条判定后面都给了「存在/不存在 + 证据路径/原文」。

---

## 0. 结论（TL;DR）

| 问题 | 结论 |
|---|---|
| 未打包插件装到哪 | `C:\Users\EDY\AppData\Roaming\Adobe\UXP\Plugins\External\<manifest.id>\` |
| 需要开发者模式吗 | **需要**。开关是 PS 首选项布尔值，本机**当前为关闭(0)**，已定位到可脚本化的字节 |
| `.ccx` 打包通道能用吗 | **不能**。本机无 Creative Cloud Desktop，也无 UPI 插件索引 |
| manifestVersion 用几 | **5**（PS 2026 自带插件里 mv=4/5/6 都存在，均被加载） |
| 装完要做什么 | 完全退出 PS → 由 `install.ps1` 写入 → 重启 PS → 窗口 → 增效工具 |

---

## 1. 候选落点排查表

命令：`Test-Path -LiteralPath <路径>` + 逐项列目录 + `reg query`（见各行的「证据来源」）。

| # | 路径 | 存在? | 判定 | 证据来源 |
|---|---|---|---|---|
| 1 | `C:\Program Files\Common Files\Adobe\UXP\extensions\` | **存在** | ❌ 不是未打包插件的落点。这是 **CCX/官方分包安装区**，内容只有 5 个官方目录且**目录名带版本后缀**（CCX 产物特征） | 列目录得 `com.adobe.ccx.start-{8.3.0,9.4.0,9.4.1,10.3.1}`、`com.adobe.substance-3d.viewer.ps`；8 份 UXPLogs 中**从未**出现该路径 |
| 2 | `%APPDATA%\Adobe\UXP\Plugins\External\` | **不存在** | ✅ **首选落点**（非管理员、幂等、可反复覆盖） | 8 份 `UXPLogs_*.log` 的 `upic::Loading plugins from user fallback plugins folder:` 行（§2 原文） |
| 3 | `%APPDATA%\Adobe\UXP\Plugins\` | **不存在** | ⚪ 父目录，本身不是落点；PS 只扫它的 `External` 子目录 | 日志只在第 2 行路径上带 `External` |
| 4 | `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\External\` | **不存在** | ❌ 不是代码落点。`PluginsStorage` 是 UXP 给插件分配的**持久化数据区**（localStorage / 沙箱文件），不是插件代码目录 | 同层只有 `Internal`/`Shared`；PS 启动扫描日志中该前缀出现 **0** 次（`Select-String -Pattern 'PluginsStorage'` 计数 = 0） |
| 5 | `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\Internal\` | **存在** | ❌ 同上。**`Internal` 不是「内部插件目录」**，它是 UXP 的插件存储根，空目录 | 列目录为空；日志 0 次命中 |
| 6 | `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\Shared\` | **存在** | ❌ 同上 | 同上 |
| 7 | `C:\Program Files\Common Files\Adobe\UXP\Plugins\External\` | **不存在** | ⚪ 系统级 fallback，PS 确实会扫，但需要管理员权限写入 | 8 份日志的 `system fallback plugins folder` 行 |
| 8 | `C:\Program Files\Common Files\Adobe\UXP\Plugins\EDY\External\` | **不存在** | ⚪ **hybrid** fallback（多用户共享），PS 也会扫；同样需要管理员权限 | 8 份日志的 `hybrid fallback plugins folder` 行。注意 `EDY` 段来自用户名 |
| 9 | `D:\software\Adobe Photoshop 2026\Required\UXP\` | **存在** | ❌ 官方**内置**插件区（随安装包发布，22 个 `com.adobe.*` 目录），不用于第三方插件 | 列目录；文件在受保护的安装目录内 |
| 10 | `C:\Program Files\Common Files\Adobe\UXP\PluginsInfo\v1\PS.json` | **不存在** | ⚪ UPI 插件索引；缺失 → **PS 走 fallback 目录扫描**（这正是第 2 条能生效的机制） | 日志第 51 行 `Failed to read plugin info file: ...` |
| 11 | `%APPDATA%\Adobe\UXP\PluginsInfo\v1\PS.json` | **不存在** | ⚪ 同上（用户级索引） | 日志第 52 行 |
| 12 | `%APPDATA%\Adobe\UXP\Plugins\`（作为唯一 UXP 子目录） | — | 说明：`%APPDATA%\Adobe\UXP\` 下**当前只有 `PluginsStorage` 一个子目录** | `Get-ChildItem $env:APPDATA\Adobe\UXP` |

**判定**：写入第 2 条即可。第 7/8 条是合法备选，但需要管理员权限，本脚本不采用。

---

## 2. `UXPLogs` 原文引用（最强证据）

日志目录：`C:\Users\EDY\AppData\Roaming\Adobe\Adobe Photoshop 2026\Logs\`
共 10 个 `.log`，其中 **8 个**含下面的启动扫描段（另外 2 个是 5 MB 轮转后的续写文件，见 §2.2）。

### 2.1 原文（`UXPLogs_2026-10-13_09-43-30_113031.log`，第 51–58 行）

```
[2026-10-13_09-43-30][9376][Info] upic::Failed to read plugin info file: C:\Program Files\Common Files\Adobe\UXP\PluginsInfo\v1\PS.json
[2026-10-13_09-43-30][9376][Info] upic::Failed to read plugin info file: C:\Users\EDY\AppData\Roaming\Adobe\UXP\PluginsInfo\v1\PS.json
[2026-10-13_09-43-30][9376][Info] upic::Loading plugins from system fallback plugins folder: C:\Program Files\Common Files\Adobe\UXP\Plugins\External
[2026-10-13_09-43-30][9376][Info] upic::Loading plugins from user fallback plugins folder: C:\Users\EDY\AppData\Roaming\Adobe\UXP\Plugins\External
[2026-10-13_09-43-30][9376][Info] upic::Loading plugins from hybrid fallback plugins folder: C:\Program Files\Common Files\Adobe\UXP\Plugins\EDY\External
[2026-10-13_09-43-30][9376][Info] upic::Number of plugins added from system's fallback: 0
[2026-10-13_09-43-30][9376][Info] upic::Number of plugins added from user's fallback: 0
[2026-10-13_09-43-30][9376][Info] upic::Number of plugins added from hybrid's fallback: 0
```

同一段（行号一致，均为 51–58）在下列文件中逐字重复出现：

| 日志文件 | 行号 |
|---|---|
| `UXPLogs_2026-09-23_11-37-02_600362.log` | 51–58 |
| `UXPLogs_2026-09-24_15-21-22_944569.log` | 51–58 |
| `UXPLogs_2026-09-28_09-07-25_545074.log` | 51–58 |
| `UXPLogs_2026-09-29_17-04-49_147648.log` | 51–58 |
| `UXPLogs_2026-10-08_17-24-39_175078.log` | 51–58 |
| `UXPLogs_2026-10-10_15-10-53_923011.log` | 51–58 |
| `UXPLogs_2026-10-12_09-07-17_198355.log` | 51–58 |
| `UXPLogs_2026-10-13_09-43-30_113031.log` | 51–58 |

计数命令与结果：

```powershell
Select-String -Path "$env:APPDATA\Adobe\Adobe Photoshop 2026\Logs\*.log" `
  -Pattern 'Loading plugins from user fallback plugins folder' -SimpleMatch |
  Select-Object -ExpandProperty Filename -Unique
# → totalLogs=10  logsWithUserFallbackLine=8
```

**读法**：`Number of plugins added from user's fallback: 0` 说明 PS **每次都真的去扫了这个目录**，只是因为目录不存在/为空所以命中 0 个。放进去就会被计数。

### 2.2 另外 2 个日志为什么没有这段（不是反例）

`UXPLogs_2026-10-12_10-32-42_400457.log` 与 `UXPLogs_2026-10-10_17-19-49_788505.log` 里 `upic::` 只出现 1 次。原因由时间戳与文件大小证明为**5 MB 轮转续写**：

| 前一个日志 | 大小 | 结束时间 | 后一个日志 | 开始时间 |
|---|---|---|---|---|
| `UXPLogs_2026-10-12_09-07-17_198355.log` | 5 242 951 B | 2026-10-12 10:32:42 | `UXPLogs_2026-10-12_10-32-42_400457.log` | 2026-10-12 10:32:42 |
| `UXPLogs_2026-10-10_15-10-53_923011.log` | 5 242 901 B | 2026-10-10 17:19:49 | `UXPLogs_2026-10-10_17-19-49_788505.log` | 2026-10-10 17:19:49 |

续写文件的**首行就已经是运行中日志**（`[2026-10-12_10-32-42][26588][Warn] [console] [DP] UXP-IMS Error: ...`），没有启动横幅，因此不含扫描段。

### 2.3 未找到的内容（明确说明，不编造）

- 日志中 **没有** `PluginsStorage`、`developer`、`addPlugin`、`plugin folder` 等字样（计数均为 0）。
- 日志中 **没有**任何一次「外部插件被成功加载」的记录（因为历史上从未装过未打包插件）。
- 因此「PS 加载外部插件后日志长什么样」**未被取证**，无法给出成功样例。

---

## 3. 开发者模式开关

### 3.1 它确实是加载门槛（本机 UI 文案取证）

文件：`D:\software\Adobe Photoshop 2026\Locales\zh_CN\Support Files\tw10428_Photoshop_zh_CN.dat`

```
37639: "$$$/UXP/PluginManagerDelegate/NotDevMode=无法载入增效工具，因为开发人员模式已禁用。是否要启用开发人员模式？"
32519: "$$$/Prefs/Plugins/EnableDeveloperMode=启用开发人员模式"
```

- 第 37639 行是 **PS 自己的报错文案**：外部增效工具在没有开发者模式时**拒绝载入**（并询问是否启用）。
- 第 32519 行给出 UI 位置：**首选项 → 增效工具 → 启用开发人员模式**。

### 3.2 开关落在哪：`UIPrefs.psp`（不是注册表）

文件：`C:\Users\EDY\AppData\Roaming\Adobe\Adobe Photoshop 2026\Adobe Photoshop 2026 Settings\UIPrefs.psp`（5 974 字节）

- **注册表没有这个开关。** `reg query "HKCU\Software\Adobe" /f "Developer" /s` → `0 match(es)`；`HKLM\SOFTWARE\Adobe` 同；`HKLM\SOFTWARE\WOW6432Node\Adobe` 同。`/f "UXP" /k /s` 只命中两个 PS 插件子键：
  ```
  HKEY_CURRENT_USER\Software\Adobe\Photoshop\200.0\uxp_com.adobe.ccx.lrimporter
  HKEY_CURRENT_USER\Software\Adobe\Photoshop\200.0\uxp_com.adobe.ccx.start
  ```
  （这两个是**插件自己的**偏好容器，不是开发者模式开关。）

- 记录格式（由同文件内 100+ 条记录交叉验证得到）：`[长度:1 字节][名字:ASCII][类型名:ASCII]['bool'][值:4 字节 小端]`
  例：`0E 73 68 6F 77 4D 65 6E 75 43 6F 6C 6F 72 73 62 6F 6F 6C 01 00 00 00` = `len=0x0E(14)` + `"showMenuColors"` + `"bool"` + `1`。

- 目标记录实测坐标：

  | 项 | 值 |
  |---|---|
  | 记录前缀字节偏移 | 2695（值 = 0x19 = 25 = 名字长度） |
  | 名字起始偏移 | 2696 |
  | 字面量 `enablePluginDeveloperModebool` 起始偏移 | 2696（该字面量在文件中**唯一**，只 1 处命中） |
  | **值字节偏移** | **2725** |
  | **当前值** | `00 00 00 00` → **开发者模式 = 关闭** |
  | 文件总长 | 5974 |

### 3.3 可脚本化的设置方法

`install.ps1` 中的 `Set-PluginDeveloperMode` 函数：

1. `[System.IO.File]::ReadAllBytes(UIPrefs.psp)`
2. 字节级搜索 ASCII 字面量 `enablePluginDeveloperModebool`（不硬编码偏移 2725，抗版本漂移）
3. 值偏移 = 命中位置 + 字面量长度 = 2725
4. `[System.BitConverter]::ToInt32` 读当前值；若已是目标值 → `[SKIP]`（幂等）
5. 否则先 `Copy-Item` 备份为 `UIPrefs.psp.bak-<yyyyMMddHHmmss>`，再原地改 4 字节为 `01 00 00 00`，`WriteAllBytes` 写回

**前置条件**：PS 必须完全退出（否则退出时可能用内存里的旧值覆写）。脚本在开头硬校验：检测到 `Photoshop` 进程即 `[FAIL]` 并 `exit 1`（`-DryRun` 除外，因为 DryRun 不写任何文件）。

---

## 4. manifest 契约（从 PS 2026 自带官方插件取证）

### 4.1 读过的官方 `manifest.json` 绝对路径清单

| 绝对路径 | manifestVersion | entrypoint 类型 |
|---|---|---|
| `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.ccx.start\manifest.json` | 5 | `homescreen`/`popover`… + `requiredPermissions.webview` |
| `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.pluginspanel\manifest.json` | 5 | **`panel`** |
| `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.adjustments-panel\manifest.json` | 5 | **`panel`** |
| `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.exportAs\manifest.json` | 5 | `command` |
| `D:\software\Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop-material-filters\manifest.json` | 4 | `panel` ×3 + **`requiredPermissions.localFileSystem: "fullAccess"`** |
| `C:\Program Files\Common Files\Adobe\UXP\extensions\com.adobe.substance-3d.viewer.ps\manifest.json` | **6** | （addon 形态）+ `localFileSystem: "fullAccess"` |

另用脚本批量解析了 `D:\software\Adobe Photoshop 2026\Required\UXP\` 下全部 22 个官方插件的 `id / manifestVersion / version / host / entrypoints / requiredPermissions`，结论：`manifestVersion` 取值为 **4、5、6** 三种，PS 2026 都能加载；`requiredPermissions` 顶层键实测出现 `localFileSystem`、`webview`、`launchProcess`、`network`、`clipboard`、`enableAddon`、`allowCodeGenerationFromStrings`。

### 4.2 字段实测结论

| 字段 | 实测结论 |
|---|---|
| `manifestVersion` | `5` 完全可用（`com.adobe.pluginspanel` / `adjustments-panel` / `exportAs` 都是 5，且都是 PS 核心面板）。PS 2026 也接受 4 和 6 |
| `id` | 反向域名点分字符串，如 `com.adobe.photoshop.adjustments-panel`。必须全局唯一 |
| `name` | 可含中文；官方也允许 `$$$/Key=Default` 的本地化引用形式（`material-filters` 用了） |
| `version` | 点分数字字符串，如 `"2.2.8"` / `"99.3.2.2"` |
| `main` | **相对文件名** `"index.html"`（官方 6 例全是 `index.html`，未见路径形式） |
| `host` | **对象或数组都接受**：`adjustments-panel` 用对象 `{ "app":"PS", "minVersion":"25.4.0", "data":{...} }`，`ccx.start` 用数组。`app` 取 `"PS"` |
| `host.data.apiVersion` | 官方普遍写 `2`（`adjustments-panel`、`exportAs`、`substance`）。**注意**：它不是 entrypoint 的属性，而是 `host` 下的 `data` |
| `entrypoints` / `entryPoints` | **两种拼写都在官方文件里出现**：`com.adobe.pluginspanel` 用 `entrypoints`，`com.adobe.ccx.start` 用 `entryPoints`。两者都被 PS 加载，故大小写不敏感。**本项目统一用 `entrypoints`**（与 `docs/INTERFACE.md` 一致） |
| `entrypoints[].type = "panel"` | 面板入口。官方 panel 例子均带 `id`、`label.default`，并常带 `minimumSize` / `maximumSize` / `preferredDockedSize` / `preferredFloatingSize`（`{width,height}`） |
| `requiredPermissions.localFileSystem` | 本机可取证到的唯一取值：**`"fullAccess"`**（`material-filters` mv4、`substance` mv6 各一处）。本项目导出功能需要它 |
| `icons` | 数组，元素形如 `{ "path":"icons/dark.png", "width":23, "height":23, "theme":["dark","darkest"], "scale":[1,2] }`。**日志实测警告**：`Plugin com.adobe.photoshop.creative-assistant : Expected the icon to have a 1X scaled file` —— 声明了图标但缺 1x 文件会报警（不阻断加载）。**若没有真实 PNG，建议整个 `icons` 字段省略** |

### 4.3 可直接使用的 manifest.json 骨架

与 `docs/INTERFACE.md` §14 的冻结要求一致（`manifestVersion: 5`、`host.minVersion: "24.0"`、`main: "index.html"`、`panel` 入口 `id: "ecomMainPanel"`、`localFileSystem: "fullAccess"`）。

```json
{
  "manifestVersion": 5,
  "id": "com.ecom.psimage",
  "name": "电商图片制作",
  "version": "1.0.0",
  "main": "index.html",
  "host": {
    "app": "PS",
    "minVersion": "24.0",
    "data": {
      "apiVersion": 2
    }
  },
  "entrypoints": [
    {
      "type": "panel",
      "id": "ecomMainPanel",
      "label": {
        "default": "电商图片制作"
      },
      "minimumSize": { "width": 320, "height": 400 },
      "maximumSize": { "width": 2000, "height": 2000 },
      "preferredDockedSize": { "width": 380, "height": 720 },
      "preferredFloatingSize": { "width": 380, "height": 720 }
    }
  ],
  "requiredPermissions": {
    "localFileSystem": "fullAccess"
  }
}
```

可选补充（**仅在对应能力确实需要时**才加；取值来源见 §4.1）：

```json
"requiredPermissions": {
  "localFileSystem": "fullAccess",
  "clipboard": "readAndWrite",
  "network": { "domains": ["https://*.adobe.com"] },
  "webview": { "allow": "yes", "domains": ["https://*.adobe.com"] }
}
```

> ⚠️ `network` / `clipboard` / `webview` 的**具体子结构**我未逐个读官方原文核对，只有顶层键名是实测的。本插件按 `INTERFACE.md` 只用 `localFileSystem`，不必引入这些。

`icons` 字段（**只有真的放了 PNG 才加**）：

```json
"icons": [
  { "path": "icons/dark.png",  "width": 23, "height": 23, "theme": ["dark", "darkest"],   "scale": [1, 2] },
  { "path": "icons/light.png", "width": 23, "height": 23, "theme": ["light", "lightest"], "scale": [1, 2] }
]
```

---

## 5. `.ccx` 打包安装通道：**不可用**

理由（逐条可追溯）：

1. **Creative Cloud Desktop 未安装**：`C:\Users\EDY\AppData\Roaming\Adobe\Creative Cloud` → `MISSING`。`.ccx` 的双击安装由 CC Desktop / UPI 接管。
2. **UPI 插件索引缺失**：`C:\Program Files\Common Files\Adobe\UXP\PluginsInfo\v1\PS.json` → `False`；`%APPDATA%\Adobe\UXP\PluginsInfo\v1\PS.json` → `False`。日志第 51/52 行明确记录读取失败（§2.1 原文）。
3. **`.ccx` 的落点是 `Common Files\Adobe\UXP\extensions\`**，本机该目录只有 5 个官方包，命名形态为 `<id>-<version>`（如 `com.adobe.ccx.start-10.3.1`），与 `.ccx` 安装产物形态一致 —— 这是 CCX 通道的目录，但**没有 CC Desktop 去驱动它**。
4. **补充**：即便将来装了 CC Desktop，`.ccx` 要求包经过 Adobe 签名；本项目的迭代节奏不适合走签名链路。

**结论**：本项目走「未打包目录 + fallback 扫描」通道（§1 第 2 条），`.ccx` 不在路线图内。

---

## 6. `install.ps1` 与验证证据

文件：`C:\Users\EDY\Desktop\ps电商图片制作插件\install.ps1`

参数：`-SourceDir`（默认 `<脚本目录>\plugin`）、`-TargetRoot`（默认 `%APPDATA%\Adobe\UXP\Plugins\External`）、`-PluginId`、`-Uninstall`、`-SkipDeveloperMode`、`-DryRun`。

幂等实现：对源目录和目标目录各做一次 **SHA-256 文件树指纹**（相对路径 + 哈希，排序后拼接）；一致则 `[SKIP]`，不一致则把旧目录改名为 `<id>.bak-<yyyyMMddHHmmss>` 再复制。

### 6.1 语法校验（命令 + 输出原文）

```powershell
$p = 'C:\Users\EDY\Desktop\ps电商图片制作插件\install.ps1'
$tokens = $null; $errs = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tokens, [ref]$errs)
"PSVersion: $($PSVersionTable.PSVersion)"
"TokenCount: $($tokens.Count)"
"ParseErrorCount: $($errs.Count)"
```

输出原文：

```
PSVersion=5.1.22621.5624
TokenCount=1458
ParseErrorCount=0
```

> 注意：本机 `pwsh` 实际解析为 **Windows PowerShell 5.1**，所以上面这次校验本身就同时证明了 **5.1 兼容**。
> 脚本另存为 **UTF-8 with BOM**（首 3 字节 `EF BB BF`），保证 PS 5.1 正确读取中文提示。

### 6.2 DryRun 真机演练（命令 + 输出原文）

用 `%TEMP%` 下的临时插件目录（**不触碰 `plugin\`，不触碰 Program Files**）：

```powershell
& 'C:\Users\EDY\Desktop\ps电商图片制作插件\install.ps1' -SourceDir $env:TEMP\ecom-plugin-dryrun-probe -DryRun
```

输出原文：

```
=====================================================================
 电商图片制作 · UXP 插件 安装
=====================================================================
 模式        : Install (DryRun 只读演练)
 源目录      : C:\Users\EDY\AppData\Local\Temp\ecom-plugin-dryrun-probe
 目标根目录  : C:\Users\EDY\AppData\Roaming\Adobe\UXP\Plugins\External
 插件 id     : com.ecom.psimage
 目标目录    : C:\Users\EDY\AppData\Roaming\Adobe\UXP\Plugins\External\com.ecom.psimage
---------------------------------------------------------------------
[SKIP] Photoshop.exe 检测到 1 个 Photoshop 进程；DryRun 不写文件，继续演练
[OK] C:\Users\EDY\AppData\Local\Temp\ecom-plugin-dryrun-probe\manifest.json 源目录校验通过
[SKIP] C:\Users\EDY\AppData\Roaming\Adobe\UXP\Plugins\External DryRun 未创建：将新建目标根目录
[SKIP] C:\Users\EDY\AppData\Roaming\Adobe\UXP\Plugins\External\com.ecom.psimage DryRun 未写入：将备份并复制插件文件
[SKIP] C:\Users\EDY\AppData\Roaming\Adobe\Adobe Photoshop 2026\Adobe Photoshop 2026 Settings\UIPrefs.psp DryRun 未写入：将把开发者模式 0 -> 1（offset 2725）
---------------------------------------------------------------------
汇总: 1 OK / 4 SKIP / 0 FAIL

下一步（人工操作）：
  1. 启动 Adobe Photoshop 2026。
  ...
EXITCODE=0
```

独立交叉验证：脚本自报的 `offset 2725` 与 §3.2 手工解析得到的值字节偏移 **完全一致**。
演练还证明：`Photoshop` 进程**当前确实在运行**（1 个），而正式（非 DryRun）执行会被 `[FAIL]` 拦下 —— 这是预期行为。

卸载路径 DryRun 输出原文：

```
[SKIP] Photoshop.exe 检测到 1 个 Photoshop 进程；DryRun 不写文件，继续演练
[SKIP] C:\Users\EDY\AppData\Roaming\Adobe\UXP\Plugins\External\com.ecom.psimage 未安装，无需卸载
[SKIP] C:\Users\EDY\AppData\Roaming\Adobe\Adobe Photoshop 2026\Adobe Photoshop 2026 Settings\UIPrefs.psp 卸载不改动开发者模式开关（如需关闭请在 PS 首选项中取消勾选）
---------------------------------------------------------------------
汇总: 0 OK / 3 SKIP / 0 FAIL
EXITCODE=0
```

### 6.3 未做的事（避免误解）

- **没有真实写入** `%APPDATA%\Adobe\UXP\Plugins\External`（只 DryRun）。
- **没有真实改写** `UIPrefs.psp`（只 DryRun；真实改写需要 PS 完全退出，本机 PS 正在运行）。
- **没有触碰** `D:\software\Adobe Photoshop 2026\` 与 `C:\Program Files\...` 下的任何文件。

### 6.4 交付时的仓库状态（给 lead 的交接事实）

本次取证结束时，项目根 `C:\Users\EDY\Desktop\ps电商图片制作插件\` 下只有：

```
d----- docs
d----- verify
-a---- install.ps1      (268 行)
-a---- 安装说明.md        (70 行)
```

**`plugin\` 目录尚不存在**（那是别人的模块）。因此：

- `install.ps1` 默认 `-SourceDir = <脚本目录>\plugin`，在 `plugin\manifest.json` 出现之前，正式执行会在第 218–226 行的源目录校验处 `[FAIL]` 退出：
  - `install.ps1:220` → `Write-Step 'FAIL' $src '源目录不存在'`
  - `install.ps1:223` → `Write-Step 'FAIL' $manifestPath '源目录中缺少 manifest.json，不是合法的 UXP 插件目录'`
- 这是**预期行为**，不是脚本缺陷。`-DryRun` 也走同一校验（§6.2 的演练之所以通过，是因为传了临时目录）。
- `install.ps1:23` 的 `-PluginId` 默认从 `SourceDir\manifest.json` 的 `"id"` 读取，所以 manifest 落地后无需再传参数。

---

## 7. 未能确认的事项（明确列出）

1. **「开发者模式关闭 ⇒ External 目录里的插件一定被拒载」没有被本机实测证明。** 直接证据只有 PS 自己的中文报错文案（§3.1 第 37639 行）。本机从未在 `Plugins\External` 放过插件，也没法在 PS 运行中做加载试验。→ 因此 `install.ps1` **默认就设置开发者模式**（可用 `-SkipDeveloperMode` 关掉）。
2. **`UIPrefs.psp` 二进制改写的持久性未做往返验证。** PS 退出时可能用内存中的旧值覆写文件。脚本要求 PS 完全退出后执行，理论上安全，但没有实测「改写 → 启动 PS → 退出 PS → 再读」这一轮。
3. **`requiredPermissions.localFileSystem` 的完整合法取值集合未取证。** 本机官方样例只有 `"fullAccess"` 一种。Adobe 文档里另有 `"request"`/`"plugin"` 之说，但我**没有在本机找到实例**，故不写进骨架。
4. **`Plugins\External` 下的子目录名是否必须等于 `manifest.id` 未取证。** 日志只按插件计数，没给出目录命名规则。`install.ps1` 采用 `<manifest.id>`（与 `Common Files\...\extensions\` 的 `com.adobe.ccx.start-10.3.1` 惯例一致，去掉版本后缀）。
5. **面板在 PS 里的确切菜单路径是推断，未实测。** §6.2 的「窗口 → 增效工具」来自 PS 通用认知，不是本机证据。
6. **hybrid fallback 路径里的 `EDY` 段来自用户名**，是否为所有机器通用未验证。
7. **是否需要额外写 `PluginsInfo\v1\PS.json` 索引未验证。** 当前事实是：该文件不存在时 PS 仍然扫描 fallback 目录（§2.1 第 51–58 行），所以本项目不写它。
8. **`docs/INTERFACE.md` 里 `host.minVersion: "24.0"` 的有效性未实测。** 官方样例最低见过 `"22.0.0"`、`"25.4.0"`、`"26.8"`、`"26.9.0"`；`"24.0"` 落在合理区间但未被本机样例直接覆盖。

---

## 8. 复现用命令清单

```powershell
# 1) 候选落点是否存在
Test-Path -LiteralPath 'C:\Program Files\Common Files\Adobe\UXP\extensions'
Test-Path -LiteralPath "$env:APPDATA\Adobe\UXP\Plugins\External"
Test-Path -LiteralPath "$env:APPDATA\Adobe\UXP\PluginsStorage\PHSP\27\Internal"

# 2) PS 实际扫描的插件目录（权威）
Select-String -Path "$env:APPDATA\Adobe\Adobe Photoshop 2026\Logs\*.log" `
  -Pattern 'plugins folder|PluginsInfo' | ForEach-Object { "$($_.Filename):$($_.LineNumber): $($_.Line.Trim())" }

# 3) 开发者模式开关（本机 = 0）
$p = "$env:APPDATA\Adobe\Adobe Photoshop 2026\Adobe Photoshop 2026 Settings\UIPrefs.psp"
$b = [System.IO.File]::ReadAllBytes($p)
$n = [System.Text.Encoding]::ASCII.GetBytes('enablePluginDeveloperModebool')
# 搜索结果 + 读值：[System.BitConverter]::ToInt32($b, $idx + $n.Length)

# 4) 加载门槛文案
Select-String -LiteralPath 'D:\software\Adobe Photoshop 2026\Locales\zh_CN\Support Files\tw10428_Photoshop_zh_CN.dat' `
  -Pattern 'EnableDeveloperMode','NotDevMode' -SimpleMatch
```
