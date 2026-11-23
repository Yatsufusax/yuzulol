# Genera todos los iconos (Android + PC + logos de las pantallas) a partir de medallion-source.jpg.
# Uso: python3 make_icons.py   (desde esta carpeta; necesita Pillow)
import os
from PIL import Image, ImageDraw, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))      # lol-companion/
CX, CY, R = 512, 505, 394                                   # círculo del medallón dentro de la imagen original
BG = (6, 11, 22)

src = Image.open('medallion-source.jpg').convert('RGB')
# medallón recortado en círculo, con borde suave y fondo transparente
M = 4
big = Image.new('L', (2*R*M, 2*R*M), 0); ImageDraw.Draw(big).ellipse((0, 0, 2*R*M-1, 2*R*M-1), fill=255)
mask = big.resize((2*R, 2*R), Image.LANCZOS)
med = src.crop((CX-R, CY-R, CX+R, CY+R)).convert('RGBA'); med.putalpha(mask)

def canvas(size, frac, bg=None):
    """Medallón centrado ocupando `frac` del lado, sobre transparente o sobre un color."""
    im = Image.new('RGBA', (size, size), bg or (0, 0, 0, 0))
    d = int(size*frac); m = med.resize((d, d), Image.LANCZOS)
    im.alpha_composite(m, ((size-d)//2, (size-d)//2)); return im

S = 1024
fg = canvas(S, 0.64)                                         # primer plano adaptativo (zona segura)
square = canvas(S, 0.86, BG+(255,))                          # icono clásico cuadrado redondeado
sm = Image.new('L', (S, S), 0); ImageDraw.Draw(sm).rounded_rectangle((0, 0, S-1, S-1), int(S*.2), fill=255); square.putalpha(sm)
round_ = canvas(S, 0.98, BG+(255,))
rm = Image.new('L', (S, S), 0); ImageDraw.Draw(rm).ellipse((0, 0, S-1, S-1), fill=255); round_.putalpha(rm)

for n, k in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
    d = f'res/mipmap-{n}'; os.makedirs(d, exist_ok=True)
    square.resize((int(48*k),)*2, Image.LANCZOS).save(f'{d}/ic_launcher.png')
    round_.resize((int(48*k),)*2, Image.LANCZOS).save(f'{d}/ic_launcher_round.png')
    fg.resize((int(108*k),)*2, Image.LANCZOS).save(f'{d}/yuzu_fg.png')
os.makedirs('res/mipmap-anydpi-v26', exist_ok=True); os.makedirs('res/values', exist_ok=True)
xml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/yuzu_bg"/>\n    <foreground android:drawable="@mipmap/yuzu_fg"/>\n</adaptive-icon>\n'
for f in ('ic_launcher', 'ic_launcher_round'): open(f'res/mipmap-anydpi-v26/{f}.xml', 'w').write(xml)
open('res/values/yuzu_colors.xml', 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="yuzu_bg">#060B16</color>\n</resources>\n')

# PC (ventana, .exe) y logos de las pantallas
os.makedirs(f'{ROOT}/build', exist_ok=True); os.makedirs(f'{ROOT}/public/img', exist_ok=True)
canvas(512, 1.0).save(f'{ROOT}/build/icon.png')
med.resize((256, 256), Image.LANCZOS).save(f'{ROOT}/public/img/icon.png')
med.resize((256, 256), Image.LANCZOS).save(f'{ROOT}/android-app/www/icon.png')
canvas(512, 0.98).save('icon-preview.png')
print('ok')
