<#
.SYNOPSIS
    「电商图片制作」UXP 面板插件 —— 未打包（开发者模式）安装 / 卸载脚本。

.DESCRIPTION
    把 plugin\ 目录复制到 Photoshop 扫描的「用户回退插件目录」，并可选地打开
    Photoshop 的「启用开发人员模式」开关。

    落点依据（本机实测，见 docs/RESEARCH-install.md）：
      UXPLogs 每次启动都会记录
        upic::Loading plugins from user fallback plugins folder: <APPDATA>\Adobe\UXP\Plugins\External

    幂等、可重复执行：内容一致则跳过，内容不同则先备份再覆盖。

.PARAMETER SourceDir
    插件源目录，默认 <脚本所在目录>\plugin

.PARAMETER TargetRoot
    目标根目录，默认 %APPDATA%\Adobe\UXP\Plugins\External
    （脚本会在其中创建 <manifest.id>\ 子目录）

.PARAMETER PluginId
    插件 id，默认从 SourceDir\manifest.json 的 "id" 字段读取。
    卸载时若源目录已不存在，请用本参数显式指定。

.PARAMETER Uninstall
    卸载：把已安装的插件目录改名为 <id>.bak-<时间戳>

.PARAMETER SkipDeveloperMode
    跳过硬编码开发者模式开关（不修改 UIPrefs.psp）

.PARAMETER DryRun
    只报告将要做什么，不写入任何文件

.EXAMPLE
    pwsh -NoProfile -File .\install.ps1
    powershell -NoProfile -File .\install.ps1 -DryRun
    powershell -NoProfile -File .\install.ps1 -Uninstall -PluginId com.ecom.psimage

.NOTES
    兼容 Windows PowerShell 5.1 与 PowerShell 7.x。不使用 PS7 独有语法。
#>
[CmdletBinding()]
param(
    [string] $SourceDir,
    [string] $TargetRoot,
    [string] $PluginId,
    [switch] $Uninstall,
    [switch] $SkipDeveloperMode,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# 常量（均有本机实测证据，见 docs/RESEARCH-install.md）
# ---------------------------------------------------------------------------
$DefaultPluginId    = 'com.ecom.psimage'
$UserFallbackRoot   = Join-Path $env:APPDATA 'Adobe\UXP\Plugins\External'
$PsPrefsDir         = Join-Path $env:APPDATA 'Adobe\Adobe Photoshop 2026\Adobe Photoshop 2026 Settings'
$UiPrefsFile        = Join-Path $PsPrefsDir 'UIPrefs.psp'
# UIPrefs.psp 中该记录的字节布局：[长度:1][名字:25]["bool"][值:4 小端]
$DevModeNeedle      = 'enablePluginDeveloperModebool'

$script:OkCount   = 0
$script:SkipCount = 0
$script:FailCount = 0

# ---------------------------------------------------------------------------
# 输出与工具
# ---------------------------------------------------------------------------
function Write-Step {
    param(
        [ValidateSet('OK', 'SKIP', 'FAIL')][string] $Tag,
        [string] $Path,
        [string] $Note
    )
    Write-Host ('[{0}] {1} {2}' -f $Tag, $Path, $Note)
    switch ($Tag) {
        'OK'   { $script:OkCount++ }
        'SKIP' { $script:SkipCount++ }
        'FAIL' { $script:FailCount++ }
    }
}

function Get-Stamp {
    return (Get-Date).ToString('yyyyMMddHHmmss')
}

function Get-TreeFingerprint {
    param([string] $Root)
    if (-not (Test-Path -LiteralPath $Root)) { return $null }
    $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) { return '' }
    $lines = New-Object System.Collections.ArrayList
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($Root.Length).TrimStart([char]92, [char]47)
        $hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
        [void]$lines.Add($rel + '|' + $hash)
    }
    $sorted = $lines | Sort-Object
    return ($sorted -join "`n")
}

function Set-PluginDeveloperMode {
    param([bool] $Enabled)

    if (-not (Test-Path -LiteralPath $UiPrefsFile)) {
        Write-Step 'FAIL' $UiPrefsFile '未找到 PS 首选项文件，无法脚本化设置开发者模式（请手动勾选）'
        return
    }

    $bytes  = [System.IO.File]::ReadAllBytes($UiPrefsFile)
    $needle = [System.Text.Encoding]::ASCII.GetBytes($DevModeNeedle)

    $idx = -1
    for ($i = 0; $i -le ($bytes.Length - $needle.Length); $i++) {
        $hit = $true
        for ($k = 0; $k -lt $needle.Length; $k++) {
            if ($bytes[$i + $k] -ne $needle[$k]) { $hit = $false; break }
        }
        if ($hit) { $idx = $i; break }
    }

    if ($idx -lt 0) {
        Write-Step 'FAIL' $UiPrefsFile '未在 UIPrefs.psp 中找到 enablePluginDeveloperMode 记录（PS 版本可能不同，请手动勾选）'
        return
    }

    $valueOffset = $idx + $needle.Length
    $want = 0
    if ($Enabled) { $want = 1 }
    $current = [System.BitConverter]::ToInt32($bytes, $valueOffset)

    if ($current -eq $want) {
        Write-Step 'SKIP' $UiPrefsFile ('开发者模式已是目标值 {0}（offset {1}）' -f $want, $valueOffset)
        return
    }

    if ($DryRun) {
        Write-Step 'SKIP' $UiPrefsFile ('DryRun 未写入：将把开发者模式 {0} -> {1}（offset {2}）' -f $current, $want, $valueOffset)
        return
    }

    $bak = $UiPrefsFile + '.bak-' + (Get-Stamp)
    Copy-Item -LiteralPath $UiPrefsFile -Destination $bak -Force

    $bytes[$valueOffset]     = [byte]($want -band 0xFF)
    $bytes[$valueOffset + 1] = [byte]0
    $bytes[$valueOffset + 2] = [byte]0
    $bytes[$valueOffset + 3] = [byte]0
    [System.IO.File]::WriteAllBytes($UiPrefsFile, $bytes)

    Write-Step 'OK' $UiPrefsFile ('开发者模式 {0} -> {1}（原文件已备份为 {2}）' -f $current, $want, (Split-Path -Leaf $bak))
}

# ---------------------------------------------------------------------------
# 解析参数
# ---------------------------------------------------------------------------
$src = $SourceDir
if (-not $src) { $src = Join-Path $PSScriptRoot 'plugin' }
$src = [System.IO.Path]::GetFullPath($src)

$root = $UserFallbackRoot
if ($TargetRoot) { $root = $TargetRoot }
$root = [System.IO.Path]::GetFullPath($root)

$manifestPath = Join-Path $src 'manifest.json'

$id = $PluginId
if (-not $id) {
    if (Test-Path -LiteralPath $manifestPath) {
        $raw = Get-Content -LiteralPath $manifestPath -Raw
        $m = [regex]::Match($raw, '"id"\s*:\s*"([^"]+)"')
        if ($m.Success) { $id = $m.Groups[1].Value }
    }
}
if (-not $id) { $id = $DefaultPluginId }

$target = Join-Path $root $id

# ---------------------------------------------------------------------------
# 开场信息
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '====================================================================='
if ($Uninstall) { Write-Host ' 电商图片制作 · UXP 插件 卸载' } else { Write-Host ' 电商图片制作 · UXP 插件 安装' }
Write-Host '====================================================================='
Write-Host (" 模式        : {0}{1}" -f $(if ($Uninstall) { 'Uninstall' } else { 'Install' }), $(if ($DryRun) { ' (DryRun 只读演练)' } else { '' }))
Write-Host (" 源目录      : {0}" -f $src)
Write-Host (" 目标根目录  : {0}" -f $root)
Write-Host (" 插件 id     : {0}" -f $id)
Write-Host (" 目标目录    : {0}" -f $target)
Write-Host '---------------------------------------------------------------------'

# ---------------------------------------------------------------------------
# 前置检查：Photoshop 必须已退出
# ---------------------------------------------------------------------------
$psProcs = @(Get-Process -Name 'Photoshop' -ErrorAction SilentlyContinue)
if ($psProcs.Count -gt 0 -and -not $DryRun) {
    Write-Step 'FAIL' 'Photoshop.exe' ('检测到 {0} 个 Photoshop 进程正在运行，请完全退出后再执行本脚本' -f $psProcs.Count)
    Write-Host ''
    Write-Host '汇总: 0 OK / 0 SKIP / 1 FAIL'
    exit 1
}
elseif ($psProcs.Count -gt 0) {
    Write-Step 'SKIP' 'Photoshop.exe' ('检测到 {0} 个 Photoshop 进程；DryRun 不写文件，继续演练' -f $psProcs.Count)
}
else {
    Write-Step 'OK' 'Photoshop.exe' '未在运行，可以安全写文件'
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
if (-not $Uninstall) {

    # 1. 源目录校验
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Step 'FAIL' $src '源目录不存在'
    }
    elseif (-not (Test-Path -LiteralPath $manifestPath)) {
        Write-Step 'FAIL' $manifestPath '源目录中缺少 manifest.json，不是合法的 UXP 插件目录'
    }
    else {
        Write-Step 'OK' $manifestPath '源目录校验通过'

        # 2. 目标根目录
        if (Test-Path -LiteralPath $root) {
            Write-Step 'SKIP' $root '目标根目录已存在'
        }
        elseif ($DryRun) {
            Write-Step 'SKIP' $root 'DryRun 未创建：将新建目标根目录'
        }
        else {
            New-Item -ItemType Directory -Path $root -Force | Out-Null
            Write-Step 'OK' $root '已新建目标根目录'
        }

        # 3. 幂等判定 + 备份 + 复制
        $srcFp = Get-TreeFingerprint -Root $src
        $dstFp = Get-TreeFingerprint -Root $target

        if ($null -ne $dstFp -and $srcFp -eq $dstFp) {
            Write-Step 'SKIP' $target '已是最新（内容哈希一致），无需复制'
        }
        elseif ($DryRun) {
            Write-Step 'SKIP' $target 'DryRun 未写入：将备份并复制插件文件'
        }
        else {
            if ($null -ne $dstFp) {
                $bak = $target + '.bak-' + (Get-Stamp)
                Move-Item -LiteralPath $target -Destination $bak -Force
                Write-Step 'OK' $bak '已备份原有插件目录'
            }
            Copy-Item -LiteralPath $src -Destination $target -Recurse -Force
            $n = @(Get-ChildItem -LiteralPath $target -Recurse -File -Force).Count
            Write-Step 'OK' $target ('已安装 {0} 个文件' -f $n)
        }
    }

    # 4. 开发者模式
    if ($SkipDeveloperMode) {
        Write-Step 'SKIP' $UiPrefsFile '按 -SkipDeveloperMode 要求跳过'
    }
    else {
        Set-PluginDeveloperMode -Enabled $true
    }
}
else {
    # 卸载
    if ($null -eq (Get-TreeFingerprint -Root $target)) {
        Write-Step 'SKIP' $target '未安装，无需卸载'
    }
    elseif ($DryRun) {
        Write-Step 'SKIP' $target 'DryRun 未写入：将把该目录改名为 <id>.bak-<时间戳>'
    }
    else {
        $bak = $target + '.bak-' + (Get-Stamp)
        Move-Item -LiteralPath $target -Destination $bak -Force
        Write-Step 'OK' $bak ('已卸载（原目录改名为 {0}）' -f (Split-Path -Leaf $bak))
    }
    Write-Step 'SKIP' $UiPrefsFile '卸载不改动开发者模式开关（如需关闭请在 PS 首选项中取消勾选）'
}

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
Write-Host '---------------------------------------------------------------------'
Write-Host ('汇总: {0} OK / {1} SKIP / {2} FAIL' -f $script:OkCount, $script:SkipCount, $script:FailCount)
Write-Host ''

if ($script:FailCount -eq 0 -and -not $Uninstall) {
    Write-Host '下一步（人工操作）：'
    Write-Host '  1. 启动 Adobe Photoshop 2026。'
    Write-Host '  2. 首次使用前确认开发者模式已开启：'
    Write-Host '       编辑 -> 首选项 -> 增效工具 -> 勾选「启用开发人员模式」，然后重启 Photoshop。'
    Write-Host '     （本脚本已尝试直接写入该开关；若 PS 在设置后仍提示未开启，请按上面手动勾选一次。）'
    Write-Host '  3. 打开面板：窗口 -> 增效工具（Plugins）-> 「电商图片制作」。'
    Write-Host '     若列表中没有：窗口 -> 工作区 -> 复位基本功能，再重新打开「增效工具」面板。'
    Write-Host '  4. 插件加载失败时查看日志（UTF-8 文本，直接搜索插件 id）：'
    Write-Host ('       {0}' -f (Join-Path $env:APPDATA 'Adobe\Adobe Photoshop 2026\Logs'))
    Write-Host '  5. 卸载：重新运行本脚本并加 -Uninstall。'
    Write-Host ''
}
elseif ($script:FailCount -gt 0) {
    Write-Host '存在 FAIL 项，请按上面的提示逐条处理后重试。'
    Write-Host ''
}

if ($script:FailCount -gt 0) { exit 1 }
exit 0
