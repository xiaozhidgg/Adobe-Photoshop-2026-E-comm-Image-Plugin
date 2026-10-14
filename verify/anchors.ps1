# verify\anchors.ps1 —— 行号锚点表（只读，不写任何文件）
#
# 用法：powershell -ExecutionPolicy Bypass -File verify\anchors.ps1
# 输出：相对路径:行号  锚点名        （纯文本，一行一个锚点，可直接被 Select-String 过滤）
# 口径：与 docs\DEVELOPER.md 一致 —— [System.IO.File]::ReadAllLines(...,UTF8) 解码后的真实行号
#
# 收录两类锚点：
#   1) 函数定义      function 名( / async function 名( / var|let|const 名 = function(
#                    / 对象字面量方法  名: function(        （store / ui / ps 的公开面用的都是这种）
#   2) 公开面赋值    window.Ecom.<模块> = ...      （Ecom.ps = { 之类）

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$plugin = Join-Path $root 'plugin'

$files = @()
$files += (Join-Path $plugin 'index.js')
foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $plugin 'src') -Filter '*.js' -File | Sort-Object Name)) {
  $files += $f.FullName
}

foreach ($file in $files) {
  $rel = $file.Substring($root.Length + 1).Replace('\', '/')
  $lines = [System.IO.File]::ReadAllLines($file, [System.Text.Encoding]::UTF8)
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    $name = $null

    if ($line -match '^\s*(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(') {
      $name = $matches[1]
    }
    elseif ($line -match '^\s*(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?function\b') {
      $name = $matches[1]
    }
    elseif ($line -match '^\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?:async\s+)?function\b') {
      $name = $matches[1]
    }
    elseif ($line -match '^\s*window\.Ecom(?:\.([A-Za-z_$][A-Za-z0-9_$]*))?\s*=') {
      if ($matches[1]) { $name = 'Ecom.' + $matches[1] } else { $name = 'window.Ecom' }
    }

    if ($name) {
      '{0}:{1}  {2}' -f $rel, ($i + 1), $name
    }
  }
}
