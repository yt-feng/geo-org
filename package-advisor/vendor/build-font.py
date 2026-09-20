"""Rebuild the OFL font transport asset; requires fonttools 4.65.0.
Usage: python build-font.py /path/to/NotoSansSC-Regular.otf
This runs only during development; browsers use the prebuilt asset.
"""
import gzip
import io
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

font = TTFont(sys.argv[1])
order, source = font.getGlyphOrder(), font.getGlyphSet()
glyphs = {}
for name in order:
    pen = TTGlyphPen(source)
    source[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
    glyphs[name] = pen.glyph()
builder = FontBuilder(font['head'].unitsPerEm, isTTF=True)
builder.setupGlyphOrder(order)
builder.setupCharacterMap(font.getBestCmap())
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics(font['hmtx'].metrics)
builder.setupHorizontalHeader(ascent=font['hhea'].ascent, descent=font['hhea'].descent, lineGap=font['hhea'].lineGap)
builder.setupNameTable({
    'familyName': 'Eco GEO Noto SC', 'styleName': 'Regular',
    'uniqueFontIdentifier': 'EcoGEONotoSC-Regular-20260920',
    'fullName': 'Eco GEO Noto SC Regular', 'psName': 'EcoGEONotoSC-Regular',
    'version': 'Version 1.0 (derived from Noto Sans SC)',
    'copyright': font['name'].getDebugName(0) or 'Noto Fonts Authors',
    'licenseDescription': 'SIL Open Font License 1.1',
    'licenseInfoURL': 'https://openfontlicense.org/',
})
os2 = font['OS/2']
builder.setupOS2(sTypoAscender=os2.sTypoAscender, sTypoDescender=os2.sTypoDescender,
                sTypoLineGap=os2.sTypoLineGap, usWinAscent=os2.usWinAscent,
                usWinDescent=os2.usWinDescent, usWeightClass=400, fsType=0)
builder.setupPost()
output = io.BytesIO()
builder.save(output)
Path(__file__).with_name('EcoGEONotoSC-Regular.ttf.gz').write_bytes(gzip.compress(output.getvalue(), compresslevel=9, mtime=0))
