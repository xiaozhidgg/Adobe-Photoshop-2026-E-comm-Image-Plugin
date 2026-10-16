# 生成 A 档（自动摆正）真机验收用的标定图：已知倾角的「平面产品卡片」。
# 三种口味：① alpha 版（透明背景 + 不透明卡片）测 mode:"alpha" 分支；
#           ② 不透明版（浅灰底 + 深色卡片）测 mode:"bgThreshold" 分支；
#           ③ 竖版（同 ①②，但长轴竖直）—— 真机 2026-10-16 11:38:35 的缺陷就出在这类图上：
#              长轴竖直时主轴角 θ≈±90°，真正要纠的是 tilt = θ 折叠到 (-45,45]。
# 每个文件同时打印【独立实现的基准 θ 与 tilt】（numpy 二阶矩，与插件 JS 实现无关），
# 供真机日志里的 plugin 测量值对照 —— 这才叫可量化的验收，而不是"看着挺正"。
# 用法：python verify/make-calibration-images.py
# ★ 屏幕坐标系 y 向下：θ 为正 = 长轴【向右下】倾斜（与 straighten.js 的 thetaDeg 定义一致）；
#   tilt 为正 = 相对最近轴向【顺时针】歪（与 straighten.js 的 tiltDeg 定义一致）。

import math
import os

import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "calib")
BG = (245, 245, 245)
CARD = (208, 172, 116)
# (画布尺寸, 卡片尺寸)：横版 700×420 / 竖版 420×700
LANDSCAPE = ((1200, 900), (700, 420))
PORTRAIT = ((900, 1200), (420, 700))


def mask_theta_deg(mask):
    """独立实现的基准：mask 为 HxW 布尔数组（y 向下），返回长轴角 ∈ (-90,90]。"""
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
    """θ 折叠到 (-45,45]：相对最近轴向的倾斜（straighten.js 的 tiltDeg）。"""
    while deg > 45:
        deg -= 90
    while deg <= -45:
        deg += 90
    return deg


def rect_points(cx, cy, w, h, phi_deg):
    """把 w×h 矩形绕中心在屏幕上【顺时针】转 phi_deg（y 向下的坐标系）。"""
    a = math.radians(phi_deg)
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for u, v in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        pts.append((cx + u * ca - v * sa, cy + u * sa + v * ca))
    return pts


def build_alpha(phi_deg, geom):
    (w, h), (cw, ch) = geom
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon(rect_points(w / 2, h / 2, cw, ch, phi_deg), fill=CARD + (255,))
    return layer, np.array(layer)[:, :, 3] > 128


def build_circle_alpha():
    (w, h), (cw, ch) = LANDSCAPE
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    r = 260
    ImageDraw.Draw(layer).ellipse([w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r], fill=CARD + (255,))
    return layer, np.array(layer)[:, :, 3] > 128


def build_opaque(phi_deg, geom):
    (w, h), (cw, ch) = geom
    img = Image.new("RGB", (w, h), BG)
    ImageDraw.Draw(img).polygon(rect_points(w / 2, h / 2, cw, ch, phi_deg), fill=CARD)
    a = np.array(img).astype(int)
    diff = np.abs(a - np.array(BG)).max(axis=2)
    return img, diff > 40  # 与插件默认 tolerance 一致


CASES = [
    # ---- 横版（7 张原图）----
    ("a-0.5", build_alpha, 0.5, "alpha 版 θ=+0.5° → 期望 micro（应旋转）", LANDSCAPE),
    ("a-2.5", build_alpha, 2.5, "alpha 版 θ=+2.5° → 期望 micro（应旋转）", LANDSCAPE),
    ("a-n2.0", build_alpha, -2.0, "alpha 版 θ=-2.0° → 期望 micro（应旋转，验方向常量）", LANDSCAPE),
    ("a-8.0", build_alpha, 8.0, "alpha 版 θ=+8.0° → 期望 confirm（不许动画面）", LANDSCAPE),
    ("b-2.0", build_opaque, 2.0, "不透明版 θ=+2.0° → 期望 micro（应旋转，测 bgThreshold）", LANDSCAPE),
    ("b-0.1", build_opaque, 0.1, "不透明版 θ=+0.1° → 期望 already-level（不许动画面）", LANDSCAPE),
    # ---- ★ 竖版（真机 2026-10-16 11:38:35 缺陷后新增）：θ≈±90°，判定必须看 tilt ----
    ("c-1.5", build_alpha, 1.5, "竖版 alpha 歪 +1.5° → 期望 micro（旧版会 skip、永不摆正）", PORTRAIT),
    ("c-n2.5", build_alpha, -2.5, "竖版 alpha 歪 -2.5° → 期望 micro（验竖版方向：不得把图放倒）", PORTRAIT),
    ("d-1.0", build_opaque, 1.0, "竖版不透明歪 +1.0° → 期望 micro（竖版走 bgThreshold）", PORTRAIT),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    print("%-11s %-7s %7s %9s %9s %8s  %s" % ("文件", "口味", "意图θ", "基准θ", "基准tilt", "覆盖率", "判定预期"))
    print("-" * 108)

    for name, builder, phi, note, geom in CASES:
        img, mask = builder(phi, geom)
        path = os.path.join(OUT, name + ".png")
        img.save(path)
        base = mask_theta_deg(mask)
        print("%-11s %-7s %7.2f %9.3f %9.3f %7.2f%%  %s" % (
            name + ".png", "alpha" if builder is build_alpha else "opaque", phi, base, tilt_of(base),
            100.0 * mask.mean(), note))

    layer, mask = build_circle_alpha()
    path = os.path.join(OUT, "a-circle.png")
    layer.save(path)
    base = mask_theta_deg(mask)
    print("%-11s %-7s %7s %9.3f %9.3f %7.2f%%  %s" % (
        "a-circle.png", "alpha", "-", base, tilt_of(base), 100.0 * mask.mean(),
        "圆形（异形）→ 期望 skip 或 confirm，绝不许 micro/旋转"))

    print("-" * 108)
    print("输出目录：" + OUT)
    print("★ 基准 θ/tilt 由 numpy 二阶矩独立算出；真机跑完后拿日志里的 thetaDeg/tiltDeg 跟它比（容差 ±0.5° 以内算过）。")
    print("★ 竖版真机预期：日志应报 θ≈±90°、tilt≈±1.5/2.5/1.0 → micro → 旋转量 = -tilt（不是 -θ），回读 tilt≈0。")


if __name__ == "__main__":
    main()
