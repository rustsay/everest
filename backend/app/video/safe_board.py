"""Keep only drawing primitives from generated HTML, build a trusted player shell."""
import html
import re
from bs4 import BeautifulSoup
from .engine import build_player_js

TAGS = {'svg', 'g', 'rect', 'text', 'tspan', 'line', 'path', 'polyline', 'polygon', 'circle', 'ellipse', 'defs', 'marker', 'lineargradient', 'stop'}
ATTRS = set('id class viewbox xmlns width height x y x1 x2 y1 y2 cx cy r rx ry dx dy d points fill stroke stroke-width stroke-dasharray opacity fill-opacity stroke-opacity font-size font-family font-weight text-anchor dominant-baseline transform marker-end marker-start refx refy markerwidth markerheight orient offset stop-color'.split())

def assemble(raw: str, steps: list[dict], title: str) -> str:
    soup = BeautifulSoup(raw, 'html.parser')
    svg = soup.find('svg', id='boardSvg')
    if svg is None:
        raise ValueError('В решении отсутствует доска')
    for tag in list(svg.find_all(True)):
        if tag.parent is not None and tag.name.lower() not in TAGS:
            tag.decompose()
    for tag in [svg, *svg.find_all(True)]:
        for attr in list(tag.attrs):
            value = ' '.join(tag[attr]) if isinstance(tag[attr], list) else str(tag[attr])
            if attr.lower() not in ATTRS or re.search(r'javascript:|data:|https?:|//', value, re.I) or ('url(' in value.lower() and not re.fullmatch(r'url\(#[\w-]+\)', value)):
                del tag[attr]
    svg['viewBox'] = svg.attrs.pop('viewbox', '0 0 1200 700')
    return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+html.escape(title)+'''</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f7f9f7;color:#173c31;font-family:Arial,sans-serif}.app{max-width:1200px;margin:auto;padding:16px}h1{font-size:24px}.board{background:white;border-radius:16px;overflow:hidden}svg{display:block;width:100%;height:auto}.fade{opacity:0;transition:opacity .4s}.fade.on{opacity:1}.path.on{stroke-dashoffset:0}.progress{height:6px;background:#dde8df;margin-top:12px}#bar{height:100%;background:#217756}.status{text-align:center;margin:10px}.controls{display:flex;gap:8px;justify-content:center}button{padding:10px;border:0;border-radius:8px;background:#dcece3;color:#173c31;cursor:pointer}
    </style></head><body><div class="app"><header><h1>'''+html.escape(title)+'''</h1></header><div class="board">'''+str(svg)+'''</div><div class="progress"><div id="bar"></div></div><div class="status" id="status"></div><div class="controls"><button onclick="__engine.goto(Math.max(0,__engine.get()-1))">Назад</button><button onclick="__engine.playFrom(0)">Сначала</button><button onclick="__engine.stop()">Пауза</button><button onclick="__engine.goto(Math.min(__engine.total-1,__engine.get()+1))">Дальше</button></div></div><script>'''+build_player_js(steps)+'</script></body></html>'
