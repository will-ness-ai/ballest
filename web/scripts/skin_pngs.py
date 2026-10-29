"""Copy the site's Skin pictures into assets/share/skins/ as PNGs, for the Stat Card (spec #323).

The site's pictures are the root skins/<asset>.webp; the Stat Card is drawn by Satori, which
reads no WebP, so it draws these copies instead, at their own 192px, scaled up to the card's
400px ball until larger shots are taken in the game. Run it after adding or changing a picture
under skins/; test/skins.test.ts fails until every Skin in lib/skins.ts has its copy.

Usage: python web/scripts/skin_pngs.py   (needs Pillow)
"""

from pathlib import Path

from PIL import Image

WEB = Path(__file__).resolve().parent.parent
SOURCE = WEB.parent / "skins"
TARGET = WEB / "assets" / "share" / "skins"


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for old in TARGET.glob("*.png"):
        old.unlink()
    for webp in sorted(SOURCE.glob("*.webp")):
        with Image.open(webp) as picture:
            picture.convert("RGBA").save(TARGET / f"{webp.stem}.png", optimize=True)
    print(f"wrote {len(list(TARGET.glob('*.png')))} pictures to {TARGET}")


if __name__ == "__main__":
    main()
