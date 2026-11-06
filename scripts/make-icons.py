"""홈 화면 아이콘 생성: 초록 배경(앱 주 색상) + 흰 글자 "반반".

결과물은 public/icons/ 에 커밋돼 있으므로 평소엔 실행할 필요 없다. 디자인을 바꿀 때만 다시 만든다.

    python3 -m pip install pillow
    python3 scripts/make-icons.py <Pretendard-ExtraBold.otf 경로>

글꼴: Pretendard (SIL Open Font License) — https://github.com/orioncactus/pretendard
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

GREEN = (0x1F, 0x6F, 0x5C)  # src/styles/global.css --color-primary
WHITE = (255, 255, 255)
TEXT = "반반"
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def make(size: int, text_width_ratio: float, font_path: str) -> Image.Image:
    """정사각형 전체를 초록으로 채우고(모서리 둥글림은 OS가 한다) 글자를 가운데 놓는다.

    text_width_ratio: 글자 묶음 너비 / 아이콘 너비.
    maskable 아이콘은 안드로이드가 원·물방울 등으로 잘라내므로 안전 영역(가운데 지름 80% 원) 안에 들어가게 작게 잡는다.
    """
    scale = 4  # 크게 그린 뒤 줄여서 글자 가장자리를 매끄럽게
    big = size * scale
    img = Image.new("RGB", (big, big), GREEN)
    draw = ImageDraw.Draw(img)

    # 목표 너비에 맞는 글자 크기 찾기
    font_size = big
    while True:
        font = ImageFont.truetype(font_path, font_size)
        left, top, right, bottom = draw.textbbox((0, 0), TEXT, font=font)
        if right - left <= big * text_width_ratio:
            break
        font_size -= max(1, font_size // 50)

    w, h = right - left, bottom - top
    draw.text(((big - w) / 2 - left, (big - h) / 2 - top), TEXT, font=font, fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    font_path = sys.argv[1]
    OUT.mkdir(parents=True, exist_ok=True)
    targets = [
        # (파일, 크기, 글자 너비 비율)
        ("icon-192.png", 192, 0.66),
        ("icon-512.png", 512, 0.66),
        ("icon-maskable-192.png", 192, 0.52),  # 대각선까지 지름 80% 원 안에 들어가는 크기
        ("icon-maskable-512.png", 512, 0.52),
        ("apple-touch-icon.png", 180, 0.62),  # 아이폰은 투명 영역을 검게 칠하므로 배경을 꽉 채운다
    ]
    for name, size, ratio in targets:
        make(size, ratio, font_path).save(OUT / name, optimize=True)
        print(OUT / name)


if __name__ == "__main__":
    main()
