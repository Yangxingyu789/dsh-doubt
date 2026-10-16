#!/usr/bin/env python3
"""生成 dsh-doubt 的项目图标。

设计：深色圆角方块 + 放大镜（取证）+ 镜内对勾（已验证结论）+ 两层同心环（分层）。
输出：assets/icon.png (512)、assets/icon-256.png、assets/icon.ico (多尺寸，供 Windows 用)。

用法： python assets/make-icon.py
依赖： Pillow（仓库不打包 Python 依赖，图标产物已随仓库提交，本脚本仅供复现）
"""

from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))

SIZE = 1024          # 设计画布
SS = 4               # 超采样倍数（抗锯齿）
OUT = SIZE * SS

BG_TOPLEFT = (30, 41, 59)      # #1E293B
BG_BOTTOMRIGHT = (14, 116, 144)  # #0E7490
ACCENT = (52, 211, 153)        # #34D399
WHITE = (255, 255, 255)


def gradient(size: int) -> Image.Image:
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    t = (x + y) / (2.0 * (size - 1))
    rgb = np.zeros((size, size, 3), dtype=np.float32)
    for c in range(3):
        rgb[..., c] = BG_TOPLEFT[c] + (BG_BOTTOMRIGHT[c] - BG_TOPLEFT[c]) * t
    # 左上角加一点柔光，避免整图过平
    glow = np.clip(1.0 - np.sqrt(x ** 2 + y ** 2) / (size * 0.9), 0.0, 1.0) ** 2
    rgb += (glow * 26.0)[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def main() -> None:
    s = SS
    base = gradient(OUT).convert("RGBA")

    # 圆角遮罩
    mask = Image.new("L", (OUT, OUT), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, OUT - 1, OUT - 1), radius=224 * s, fill=255
    )
    img = Image.new("RGBA", (OUT, OUT), (0, 0, 0, 0))
    img.paste(base, (0, 0), mask)

    # 图层环（分层取证）：两层同心细环
    for radius, width, alpha in ((345, 10, 70), (410, 8, 40)):
        ring = Image.new("RGBA", (OUT, OUT), (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse(
            (
                (470 - radius) * s,
                (470 - radius) * s,
                (470 + radius) * s,
                (470 + radius) * s,
            ),
            outline=WHITE + (alpha,),
            width=width * s,
        )
        img = Image.alpha_composite(img, ring)

    # 放大镜手柄
    handle = Image.new("RGBA", (OUT, OUT), (0, 0, 0, 0))
    ImageDraw.Draw(handle).line(
        ((470 + 134) * s, (470 + 134) * s, 790 * s, 790 * s),
        fill=WHITE + (255,),
        width=74 * s,
    )
    img = Image.alpha_composite(img, handle)
    # 手柄圆头
    cap = Image.new("RGBA", (OUT, OUT), (0, 0, 0, 0))
    ImageDraw.Draw(cap).ellipse(
        ((790 - 37) * s, (790 - 37) * s, (790 + 37) * s, (790 + 37) * s),
        fill=WHITE + (255,),
    )
    img = Image.alpha_composite(img, cap)

    # 放大镜镜圈
    lens = Image.new("RGBA", (OUT, OUT), (0, 0, 0, 0))
    ImageDraw.Draw(lens).ellipse(
        ((470 - 190) * s, (470 - 190) * s, (470 + 190) * s, (470 + 190) * s),
        outline=WHITE + (255,),
        width=56 * s,
    )
    img = Image.alpha_composite(img, lens)

    # 镜内对勾（结论已被实测证据确认）
    check = Image.new("RGBA", (OUT, OUT), (0, 0, 0, 0))
    ImageDraw.Draw(check).line(
        (
            (385 * s, 480 * s),
            (452 * s, 550 * s),
            (572 * s, 395 * s),
        ),
        fill=ACCENT + (255,),
        width=64 * s,
        joint="curve",
    )
    img = Image.alpha_composite(img, check)

    icon = img.resize((SIZE, SIZE), Image.LANCZOS)

    png512 = os.path.join(HERE, "icon.png")
    icon.resize((512, 512), Image.LANCZOS).save(png512)
    icon.resize((256, 256), Image.LANCZOS).save(os.path.join(HERE, "icon-256.png"))
    icon.save(
        os.path.join(HERE, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    for name in ("icon.png", "icon-256.png", "icon.ico"):
        p = os.path.join(HERE, name)
        print(f"{name}: {os.path.getsize(p)} bytes")


if __name__ == "__main__":
    main()
