"""Copy the site's Skin pictures into the bot as PNGs, for Chosen Skins (spec #276).

The site's pictures are the root skins/<asset>.webp; the bot draws with resvg, which reads no
WebP, and its Fly image is built from discord-bot/ alone, so it carries its own copies in
assets/skins/<asset>.png, 128px: twice the largest marble an image draws, and the size Discord
shows an emoji at. Run it after adding or changing a picture under skins/; test/skins.test.ts
fails until the copies match the site's list.

Usage: python scripts/skin_pngs.py   (needs Pillow)
"""

from pathlib import Path

from PIL import Image

SIZE = 128
BOT = Path(__file__).resolve().parent.parent
SOURCE = BOT.parent / "skins"
TARGET = BOT / "assets" / "skins"


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for old in TARGET.glob("*.png"):
        old.unlink()
    for webp in sorted(SOURCE.glob("*.webp")):
        with Image.open(webp) as picture:
            small = picture.convert("RGBA").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
            small.save(TARGET / f"{webp.stem}.png", optimize=True)
    print(f"wrote {len(list(TARGET.glob('*.png')))} pictures to {TARGET}")


if __name__ == "__main__":
    main()
