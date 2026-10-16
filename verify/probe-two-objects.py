# 多物体倾斜探针：把一张图里的每个「醒目物体」分开，逐个量倾斜（tilt = θ 折叠到 (-45,45]）。
# 用途：验证 D 档（多物体）前置条件 —— 画面里各物体的 tilt 是否一致（一致⇒一个变换就够；不一致⇒需要逐物体）。
# 用法：python verify/probe-two-objects.py <图片路径> [最小面积像素数，默认 3000] [导出掩膜.raw]
#   给了第 3 个参数时，把「醒目像素」掩膜按 raw uint8（每像素 0/1）导出，并在同目录写 <路径>.json 存宽高。
#   用途：把这个真实掩膜喂给 plugin/src/straighten.js 的 analyzeMask（verify/straighten-multi-check.js），
#   在离线环境下验证 D 档（多物体）分支的真实数据行为。
# 判据与插件一致：θ = 0.5*atan2(2*mu11, mu20-mu02)（屏幕 y 向下，正=向右下倾）；tilt 折叠到 (-45,45]。

import math
import sys

import numpy as np
from PIL import Image


def theta_deg(mask):
    ys, xs = np.nonzero(mask)
    x = xs.astype(float)
    y = ys.astype(float)
    dx = x - x.mean()
    dy = y - y.mean()
    mu20 = (dx * dx).mean()
    mu02 = (dy * dy).mean()
    mu11 = (dx * dy).mean()
    deg = math.degrees(0.5 * math.atan2(2.0 * mu11, mu20 - mu02))
    while deg > 90:
        deg -= 180
    while deg <= -90:
        deg += 180
    return deg


def tilt_of(deg):
    while deg > 45:
        deg -= 90
    while deg <= -45:
        deg += 90
    return deg


def label_components(mask):
    """4 邻接连通域（BFS，按行扫描，返回 [(ys,xs)] 列表）。"""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    comps = []
    for y0 in range(h):
        row = mask[y0]
        for x0 in np.nonzero(row & ~seen[y0])[0]:
            stack = [(y0, int(x0))]
            seen[y0, x0] = True
            ys, xs = [], []
            while stack:
                y, x = stack.pop()
                ys.append(y)
                xs.append(x)
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            comps.append((np.array(ys), np.array(xs)))
    return comps


def main():
    path = sys.argv[1]
    min_area = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
    img = Image.open(path).convert("RGB")
    a = np.array(img).astype(int)
    h, w, _ = a.shape
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    sat = mx - mn                       # 彩色度：灰色背景/白色齿形 ≈ 0，蓝色包装高
    mask = sat > 30
    frac = mask.mean()
    print("图片 %dx%d  醒目像素 %.2f%%" % (w, h, 100 * frac))
    comps = [c for c in label_components(mask) if c[0].size >= min_area]
    comps.sort(key=lambda c: c[1].mean())
    print("连通域（面积 >= %d）：%d 个" % (min_area, len(comps)))
    print("%4s %9s %9s %6s %6s %9s %9s" % ("#", "面积px", "占比%", "宽", "高", "θ", "tilt"))
    tilts = []
    for i, (ys, xs) in enumerate(comps, 1):
        m = np.zeros((h, w), dtype=bool)
        m[ys, xs] = True
        th = theta_deg(m)
        t = tilt_of(th)
        tilts.append(t)
        print("%4d %9d %8.2f%% %6d %6d %8.2f° %8.2f°" % (
            i, ys.size, 100.0 * ys.size / (h * w), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1, th, t))
    if len(tilts) >= 2:
        spread = max(tilts) - min(tilts)
        print("各物体 tilt 极差 = %.2f°  ⇒ %s" % (
            spread, "同朝向（一个变换够）" if spread <= 1.0 else "朝向不一致（需要逐物体变换或交回人工）"))
    if len(sys.argv) > 3:
        out = sys.argv[3]
        with open(out, "wb") as f:
            f.write(mask.astype(np.uint8).tobytes())
        with open(out + ".json", "w", encoding="utf-8") as f:
            f.write('{"width": %d, "height": %d}' % (w, h))
        print("掩膜已导出：%s（%dx%d，raw uint8，1=前景；同目录 .json 存宽高）" % (out, w, h))


if __name__ == "__main__":
    main()
