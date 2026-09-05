#!/usr/bin/env python3
"""Apply the customer's report identity and embed its logo before PDF export."""

from __future__ import annotations

import argparse
import base64
import html
import json
import re
from pathlib import Path

DEFAULT_NAME = "元流涌现"
DEFAULT_LOGO = Path(__file__).resolve().parent.parent / "assets" / "neostream-logo.png"
NAME_PATTERN = r'(<(?P<tag>[a-z][a-z0-9]*)\b[^>]*\bdata-report-brand=[\"\']name[\"\'][^>]*>).*?(</(?P=tag)\s*>)'
LOGO_PATTERN = r'<img\b[^>]*\bdata-report-brand=[\"\']logo[\"\'][^>]*>'
BRAND_AREA_PATTERN = r'(<div\b(?=[^>]*\bclass\s*=\s*[\"\'](?:[^\"\']*\s)?brand(?:\s[^\"\']*)?[\"\'])[^>]*>)(.*?)(</div\s*>)'


def read_branding(path: Path | None = None) -> tuple[str, Path]:
    config = json.loads(path.read_text(encoding="utf-8")) if path else {}
    name = config.get("name", "").strip() or DEFAULT_NAME
    logo = Path(config["logoPath"]) if config.get("logoPath") else DEFAULT_LOGO
    if not logo.is_absolute() and path:
        logo = path.parent / logo
    return name, logo


def set_attribute(tag: str, name: str, value: str) -> str:
    attribute = f'{name}="{html.escape(value, quote=True)}"'
    pattern = rf'\s+{name}\s*=\s*(?:"[^"]*"|\x27[^\x27]*\x27)'
    if re.search(pattern, tag, flags=re.I):
        return re.sub(pattern, lambda _: " " + attribute, tag, flags=re.I)
    return re.sub(r'\s*/?>$', lambda _: " " + attribute + ">", tag)


def apply_branding(path: Path, branding_path: Path | None = None) -> None:
    name, logo = read_branding(branding_path)
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(logo.suffix.lower())
    if not mime:
        raise ValueError("Report logo must be PNG, JPG or WebP")
    data_url = f"data:{mime};base64,{base64.b64encode(logo.read_bytes()).decode('ascii')}"
    text = path.read_text(encoding="utf-8")
    # Reports adapted from the previous template may still have a name beside
    # the logo. Keep only the image in that area; signatures/footers keep names.
    def logo_only(match: re.Match) -> str:
        logo_tag = re.search(LOGO_PATTERN, match.group(2), flags=re.I)
        return match.group(1) + logo_tag.group() + match.group(3) if logo_tag else match.group()
    text = re.sub(BRAND_AREA_PATTERN, logo_only, text, flags=re.S | re.I)
    text, names = re.subn(NAME_PATTERN, lambda match: match.group(1) + html.escape(name) + match.group(3), text, flags=re.S | re.I)
    text, logos = re.subn(LOGO_PATTERN, lambda match: set_attribute(set_attribute(match.group(), "src", data_url), "alt", name + " Logo"), text, flags=re.I)
    if not names or not logos:
        raise ValueError("Report must retain data-report-brand name and logo markers from the template")
    for key in ("report-brand-name", "author"):
        pattern = rf'<meta\b[^>]*\bname=[\"\']{key}[\"\'][^>]*>'
        if re.search(pattern, text, flags=re.I):
            text = re.sub(pattern, lambda match: set_attribute(match.group(), "content", name), text, flags=re.I)
        else:
            text = re.sub(r'</head\s*>', lambda _: f'<meta name="{key}" content="{html.escape(name, quote=True)}">\n</head>', text, count=1, flags=re.I)
    path.write_text(text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path)
    parser.add_argument("--branding-json", type=Path, help="Per-turn branding.json supplied by the app; omit for 元流涌现")
    args = parser.parse_args()
    apply_branding(args.html, args.branding_json)
    print("Report brand applied; logo embedded for offline HTML/PDF.")


if __name__ == "__main__":
    main()
