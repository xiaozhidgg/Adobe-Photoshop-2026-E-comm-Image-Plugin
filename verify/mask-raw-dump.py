# 从一张 PNG 的 alpha 通道导出 raw uint8 掩膜 + 宽高 json
# 用途：把「Photoshop 自身的抠图结果」交给 Node 侧用 plugin/src/straighten.js 的 analyzeMask 复算，
#       与插件日志里的数字做同数学、不同掩膜来源的交叉验证。
# 用法：python verify/mask-raw-dump.py <png> [out_prefix]
import json
import os
import sys

import numpy as np
from PIL import Image

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(src)[0]
alpha = np.array(Image.open(src).convert("RGBA"))[:, :, 3]
alpha.tofile(out + ".raw")
with open(out + ".json", "w", encoding="utf-8") as fh:
    json.dump({"width": int(alpha.shape[1]), "height": int(alpha.shape[0])}, fh)
print("mask %dx%d fg=%.4f -> %s.raw" % (alpha.shape[1], alpha.shape[0], float((alpha >= 128).mean()), out))
