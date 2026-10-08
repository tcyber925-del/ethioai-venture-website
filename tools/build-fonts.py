#!/usr/bin/env python3
"""
Rebuild the self-hosted Inter subsets in public/fonts (ENG-102).

The site declares `--font-sans: Inter, system-ui, ...` and DESIGN.md names
Inter as the primary expression of the identity, but no webfont shipped — every
visit rendered in the OS fallback face. These are the subsets the site now
loads (see src/styles/fonts.css).

Why a script rather than committed binaries alone: the decisions below (which
codepoints, which weight axis, which file format) are deliberate and must be
reproducible and reviewable. Committing the output without the recipe would
make a silent subsetting change indistinguishable from an intentional one.

Reproduce:

    python3 -m pip install --target /tmp/fonts-libs fonttools brotli
    curl -L -o /tmp/Inter-4.0.zip \
      https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip
    PYTHONPATH=/tmp/fonts-libs python3 tools/build-fonts.py /tmp/Inter-4.0.zip

Then copy `InterVariable.ttf` and `LICENSE.txt` out of the archive root. The
outputs are written to public/fonts/ and their sha256 sums are printed — compare
them against the committed files.

Licensing: Inter is SIL Open Font License 1.1, which requires the license text
to accompany the font binaries. `LICENSE.txt` is copied verbatim from the same
upstream archive into public/fonts/, so it is served alongside the fonts and
`check:dist` link-checks it like any other asset.

Design constraints this encodes:

  - Latin subset, as ENG-102 specifies, using Google Fonts' published ranges —
    EXCEPT U+2192 (→), which this repo needs: the homepage Geography section and
    /about render "Ethiopia → Africa → Global" as real content, and Google's
    subset omits it (verified absent from the upstream Google build, present in
    upstream Inter). Without it the arrow silently falls back to a system font
    mid-heading.

  - Latin Extended is subset too, though no page needs it today. It ships so
    that adding accented content later cannot silently render in a non-Inter
    face. It costs nothing at runtime: unicode-range means the browser never
    fetches it for current content.

  - The weight axis is PINNED to 400-700. tokens.css uses exactly three
    weights — 400 (body), 600 (h3, labels), 700 (h1, h2, display) — so one
    variable file serves all three (29 KB) instead of three static instances
    (~115 KB each). Pinning the axis means no unused interpolation ships.

  - font-display: swap is declared in CSS, not here; CSS owns presentation.

Neither decision changes any design token: --font-sans and every typography
token value are untouched.
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "public" / "fonts"

# Google Fonts' published Inter ranges, verbatim, plus U+2192. See module docstring.
LATIN = ",".join(
    [
        "U+0000-00FF",
        "U+0131",
        "U+0152-0153",
        "U+02BB-02BC",
        "U+02C6",
        "U+02D9-02DC",
        "U+0304",
        "U+0308",
        "U+0329",
        "U+2000-206F",
        "U+20AC",
        "U+2122",
        "U+2192",  # ← the one addition over Google's published range
        "U+2212",
        "U+2215",
        "U+FEFF",
        "U+FFFD",
    ]
)

LATIN_EXT = ",".join(
    [
        "U+0100-02BA",
        "U+02BD-02C5",
        "U+02C7-02CC",
        "U+02CE-02D7",
        "U+02DD-02FF",
        "U+0304",
        "U+0308",
        "U+0329",
        "U+1D00-1DBF",
        "U+1E00-1E9F",
        "U+1EF2-1EFF",
        "U+2020",
        "U+20A0-20AB",
        "U+20AD-20C0",
        "U+2113",
        "U+2C60-2C7F",
        "U+A720-A7FF",
    ]
)

# The weight axis is PINNED to 400-700 — the three weights tokens.css declares.
#
# The optical-size axis is deliberately left on its native 14-32 range rather
# than pinned. `font-optical-sizing` defaults to `auto`, so the browser then
# picks the right optical size per rendered text. Pinning it would be cheaper
# but wrong for this site: it renders 60px h1 and 48px h2 (global.css), and
# measured from upstream Inter, opsz 14 -> 32 changes the advance of a
# 15-character bold heading at 60px by 23px (~5%). Tuning display type for
# 14px body copy is precisely what the axis exists to prevent, and typography
# is the stated rationale for shipping Inter at all. Cost of the extra
# interpolation: ~15 KB on the latin face.
PINNED_AXES = {"wght": (400, 400, 700)}

# Axes that must NOT survive subsetting. wght is pinned, so it is the only one
# expected; opsz is intentionally absent from PINNED_AXES.
UNEXPECTED_AXES = {"opsz"}

# Asserted after subsetting, so a bad range can never ship silently.
REQUIRED_CODEPOINTS = {
    "latin": {0x0020, 0x0030, 0x0041, 0x0061, 0x00B7, 0x00A9, 0x2013, 0x2014,
              0x2026, 0x2192},
    "latin-ext": set(),
}


def extract(archive: Path, workdir: Path) -> tuple[Path, Path]:
    """Pull InterVariable.ttf and LICENSE.txt out of the upstream zip."""
    import zipfile

    with zipfile.ZipFile(archive) as zf:
        members = zf.namelist()
        font_member = next(n for n in members if n.endswith("InterVariable.ttf"))
        license_member = next(
            n
            for n in members
            if "LICENSE" in Path(n).name.upper() or "OFL" in Path(n).name.upper()
        )
        font_path = workdir / "InterVariable.ttf"
        license_path = workdir / "LICENSE.txt"
        with zf.open(font_member) as src, font_path.open("wb") as dst:
            shutil.copyfileobj(src, dst)
        with zf.open(license_member) as src, license_path.open("wb") as dst:
            shutil.copyfileobj(src, dst)
    return font_path, license_path


def assert_license(license_path: Path) -> None:
    """OFL 1.1 must accompany the binaries; assert it rather than assume."""
    text = license_path.read_text(encoding="utf-8", errors="replace")
    if "SIL OPEN FONT LICENSE" not in text.upper():
        raise SystemExit(
            f"{license_path} does not contain the OFL text — refusing to ship "
            "font binaries without their license."
        )


def pin_axes(source: Path, dest: Path) -> None:
    font = TTFont(source)
    instancer.instantiateVariableFont(
        font, PINNED_AXES, inplace=True, updateFontNames=False
    )
    font.save(dest)


def subset(source: Path, unicodes: str, dest: Path) -> None:
    result = subprocess.run(
        [
            "pyftsubset",
            str(source),
            f"--unicodes={unicodes}",
            "--flavor=woff2",
            "--layout-features=kern,liga,calt,ccmp,locl,mark,mkmk",
            "--no-hinting",
            "--desubroutinize",
            "--drop-tables+=DSIG",
            "--name-IDs=1,2,3,4,5,6",
            f"--output-file={dest}",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(f"pyftsubset failed:\n{result.stderr}")


def verify(path: Path, label: str) -> None:
    font = TTFont(path)
    cmap = font.getBestCmap()

    missing = {cp for cp in REQUIRED_CODEPOINTS[label] if cp not in cmap}
    if missing:
        raise SystemExit(
            f"{path.name}: required codepoints missing after subsetting: "
            + ", ".join(f"U+{cp:04X}" for cp in sorted(missing))
        )

    axes = {
        axis.axisTag: (axis.minValue, axis.maxValue)
        for axis in font["fvar"].axes
    }
    if axes.get("wght") != (400.0, 700.0):
        raise SystemExit(
            f"{path.name}: expected the wght axis pinned to 400-700, found {axes}"
        )
    # opsz is intentionally retained (see PINNED_AXES). Assert it is the
    # native range so a future pin cannot silently reintroduce the
    # display-tuned-for-body-copy bug.
    if axes.get("opsz") != (14.0, 32.0):
        raise SystemExit(
            f"{path.name}: expected the native opsz range 14-32 so optical "
            f"sizing tracks rendered size, found {axes}"
        )
    unexpected = set(axes) - {"wght", "opsz"}
    if unexpected:
        raise SystemExit(f"{path.name}: unexpected axes survived: {unexpected}")

    size = path.stat().st_size
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f"  {path.name}: {size:,} bytes  {digest}")
    print(f"    codepoints={len(cmap)} glyphs={font['maxp'].numGlyphs} axes={axes}")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    archive = Path(sys.argv[1]).expanduser().resolve()
    if not archive.is_file():
        print(f"error: {archive} is not a file", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        source, license_path = extract(archive, workdir)
        assert_license(license_path)

        pinned = workdir / "InterVariable-pinned.ttf"
        pin_axes(source, pinned)

        for label, unicodes in (("latin", LATIN), ("latin-ext", LATIN_EXT)):
            dest = OUT_DIR / f"inter-{label}.woff2"
            subset(pinned, unicodes, dest)
            verify(dest, label)

        shutil.copyfile(license_path, OUT_DIR / "LICENSE.txt")
        print(f"  LICENSE.txt: copied from the same upstream archive (OFL 1.1)")

    print(
        "\nDone. Compare the sha256 sums above against the committed files; a\n"
        "mismatch means the output is no longer reproducible from this script."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
