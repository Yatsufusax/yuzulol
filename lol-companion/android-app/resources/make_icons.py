# Genera el icono de YuzuLOL (hexágono hextech dorado + yuzu) para Android. Uso: python3 make_icons.py
import math, os
from PIL import Image, ImageDraw, ImageFilter

S = 1024
NAVY, NAVY2, GOLD, GOLD_L, GOLD_D, TEAL = (6,12,26), (18,49,90), (200,170,110), (248,233,183), (140,111,47), (11,196,180)

def radial(size, c_in, c_out, cx=.5, cy=.4):
    im = Image.new('RGB', (size, size)); px = im.load()
    for y in range(size):
        for x in range(size):
            d = min(1, math.hypot(x/size-cx, y/size-cy)/0.85)
            px[x, y] = tuple(int(c_in[i]+(c_out[i]-c_in[i])*d) for i in range(3))
    return im

def hexpts(cx, cy, r, rot=90):
    return [(cx+r*math.cos(math.radians(rot+60*i)), cy+r*math.sin(math.radians(rot+60*i))) for i in range(6)]

def background():
    return radial(S//4, NAVY2, NAVY).resize((S, S), Image.BICUBIC).convert('RGBA')

def foreground():
    """Contenido dentro del 61% central (zona segura del icono adaptativo)."""
    im = Image.new('RGBA', (S, S), (0,0,0,0)); c = S/2
    R = S*0.305
    glow = Image.new('RGBA', (S, S), (0,0,0,0)); ImageDraw.Draw(glow).polygon(hexpts(c, c, R*1.06), fill=GOLD+(150,))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(S*0.03)))
    d = ImageDraw.Draw(im)
    # marco dorado con degradado (capas)
    for i in range(14):
        t = i/13; a, b = ((250,226,150),(200,160,80)) if t < .5 else ((200,160,80),(120,92,36)); u = (t*2) % 1.0 if t < .5 else (t-.5)*2; col = tuple(int(a[k]+(b[k]-a[k])*u) for k in range(3))
        d.polygon(hexpts(c, c, R*(1-0.012*i)), fill=col+(255,))
    inner = R*0.86
    mask = Image.new('L', (S, S), 0); ImageDraw.Draw(mask).polygon(hexpts(c, c, inner), fill=255)
    fill = radial(S//4, (24,70,120), (5,11,24), .5, .38).resize((S, S), Image.BICUBIC).convert('RGBA')
    im.paste(fill, (0,0), mask)
    d = ImageDraw.Draw(im)
    d.polygon(hexpts(c, c, inner*0.97), outline=TEAL+(200,), width=int(S*0.006))   # filo hextech
    # yuzu
    yr = R*0.56; yc = (c, c+R*0.07)
    big = Image.new('RGBA', (S, S), (0,0,0,0)); bd = ImageDraw.Draw(big)
    for i in range(40):
        t = i/39; r = yr*(1-t*0.92)
        col = (int(236+19*t), int(150+96*t), int(30+154*t*t))
        bd.ellipse((yc[0]-r+t*yr*0.22, yc[1]-r-t*yr*0.22, yc[0]+r+t*yr*0.22, yc[1]+r-t*yr*0.22), fill=col+(255,))
    ym = Image.new('L', (S, S), 0); ImageDraw.Draw(ym).ellipse((yc[0]-yr, yc[1]-yr, yc[0]+yr, yc[1]+yr), fill=255)
    big.putalpha(ym.filter(ImageFilter.GaussianBlur(1)))
    sh = Image.new('RGBA', (S, S), (0,0,0,0)); ImageDraw.Draw(sh).ellipse((yc[0]-yr, yc[1]-yr+S*0.02, yc[0]+yr, yc[1]+yr+S*0.02), fill=(0,0,0,110))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(S*0.012))); im.alpha_composite(big)
    ov = Image.new('RGBA', (S, S), (0,0,0,0)); d = ImageDraw.Draw(ov)
    for a in (0, 60, 120):   # gajos
        x, y = math.cos(math.radians(a))*yr*0.72, math.sin(math.radians(a))*yr*0.72
        d.line((yc[0]-x, yc[1]-y, yc[0]+x, yc[1]+y), fill=(255,255,255,70), width=int(S*0.005))
    d.ellipse((yc[0]-yr*.74, yc[1]-yr*.74, yc[0]+yr*.74, yc[1]+yr*.74), outline=(255,255,255,95), width=int(S*0.006))
    # hoja y brillo
    leaf = [(c+yr*.04, yc[1]-yr*.96), (c+yr*.42, yc[1]-yr*1.32), (c+yr*.92, yc[1]-yr*1.22), (c+yr*.78, yc[1]-yr*.82), (c+yr*.3, yc[1]-yr*.74)]
    im.alpha_composite(ov); d = ImageDraw.Draw(im); ov = Image.new('RGBA', (S, S), (0,0,0,0))
    d.polygon(leaf, fill=(95,179,90,255)); d.line((c+yr*.04, yc[1]-yr*.96, c+yr*.62, yc[1]-yr*1.05), fill=(52,125,58,255), width=int(S*0.008))
    hl = Image.new('RGBA', (S, S), (0,0,0,0)); ImageDraw.Draw(hl).ellipse((yc[0]-yr*.62, yc[1]-yr*.66, yc[0]-yr*.2, yc[1]-yr*.36), fill=(255,255,255,150))
    im.alpha_composite(hl.filter(ImageFilter.GaussianBlur(S*0.006)))
    return im

def rounded(im, r):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).rounded_rectangle((0,0,im.size[0]-1,im.size[1]-1), r, fill=255)
    out = im.copy(); out.putalpha(m); return out

fg, bg = foreground(), background()
legacy = bg.copy(); big_fg = fg.resize((int(S*1.4), int(S*1.4)), Image.LANCZOS); legacy.alpha_composite(big_fg, ((S-big_fg.size[0])//2, (S-big_fg.size[1])//2))
square = rounded(legacy, int(S*0.2))
circle = legacy.copy(); cm = Image.new('L', (S,S), 0); ImageDraw.Draw(cm).ellipse((0,0,S-1,S-1), fill=255); circle.putalpha(cm)

dens = {'mdpi':1, 'hdpi':1.5, 'xhdpi':2, 'xxhdpi':3, 'xxxhdpi':4}
for n, k in dens.items():
    d = f'res/mipmap-{n}'; os.makedirs(d, exist_ok=True)
    square.resize((int(48*k),)*2, Image.LANCZOS).save(f'{d}/ic_launcher.png')
    circle.resize((int(48*k),)*2, Image.LANCZOS).save(f'{d}/ic_launcher_round.png')
    fg.resize((int(108*k),)*2, Image.LANCZOS).save(f'{d}/yuzu_fg.png')
os.makedirs('res/mipmap-anydpi-v26', exist_ok=True); os.makedirs('res/values', exist_ok=True)
xml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/yuzu_bg"/>\n    <foreground android:drawable="@mipmap/yuzu_fg"/>\n</adaptive-icon>\n'
for f in ('ic_launcher', 'ic_launcher_round'): open(f'res/mipmap-anydpi-v26/{f}.xml', 'w').write(xml)
open('res/values/yuzu_colors.xml', 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="yuzu_bg">#0A1428</color>\n</resources>\n')
square.resize((512,512), Image.LANCZOS).save('icon-preview.png')
print('ok')
