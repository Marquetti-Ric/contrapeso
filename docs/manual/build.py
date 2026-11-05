import json,html,sys
M=sys.argv[1]
B=json.load(open(M+'/boxes.json'))
LOGO='<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><g transform="rotate(-9 16 12)"><rect x="2" y="10.5" width="28" height="3" rx="1.5" fill="currentColor"/><rect x="3" y="3.5" width="7" height="7" rx="1.2" fill="#AE4E17"/><circle cx="26" cy="8.3" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/></g><path d="M16 13.5 L22.5 28.5 H9.5 Z" fill="currentColor"/></svg>'
def fig(name,cap,legend=None,cls=''):
    b=B[name]; pins=''
    for m in b['marks']:
        pins+=f'<span class="box" style="left:{m["x"]*100:.2f}%;top:{m["y"]*100:.2f}%;width:{m["w"]*100:.2f}%;height:{m["h"]*100:.2f}%"></span>'
        pins+=f'<span class="pin" style="left:{m["x"]*100:.2f}%;top:{m["y"]*100:.2f}%">{m["n"]}</span>'
    leg=''
    if legend:
        leg='<ol class="legend">'+''.join(f'<li><b>{i+1}</b><span>{t}</span></li>' for i,t in enumerate(legend))+'</ol>'
    return f'<figure class="shot {cls}"><div class="frame"><img src="img/{name}.png" alt="{html.escape(cap)}">{pins}</div><figcaption>{cap}</figcaption>{leg}</figure>'

body=open(M+'/content.html').read()
import re
body=re.sub(r'\{\{fig:(\w[\w-]*)\|([^|}]*)(?:\|([^}]*))?\}\}',lambda m:fig(m.group(1),m.group(2),[x.strip() for x in m.group(3).split(';;')] if m.group(3) else None),body)
body=body.replace('{{LOGO}}',LOGO)
tpl=open(M+'/tpl.html').read().replace('{{BODY}}',body).replace('{{FONTS}}',open(M+'/fonts.css').read())
open(M+'/manual.html','w').write(tpl)
print('ok')
