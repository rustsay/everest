"""Integration checks against the running deployment; uses only its own QA accounts."""
import asyncio
import io
import json
import time
from datetime import date, timedelta
from pathlib import Path
import httpx
import websockets
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select
from app.db.database import AsyncSessionLocal
from app.db.models import User, TaskResult
from app.learning import engine, service
from app.learning.content import NODES

RUN = str(int(time.time()))
RESULTS = []
CONTEXT = {'run': RUN}

def record(name, ok, detail=''):
    row = {'name': name, 'ok': bool(ok), 'detail': str(detail)[:1000]}
    RESULTS.append(row)
    print(json.dumps(row, ensure_ascii=False), flush=True)
    Path('/tmp/everest-qa-results.json').write_text(json.dumps({'context': CONTEXT, 'results': RESULTS}, ensure_ascii=False, indent=2))

async def req(c, name, method, path, expected=200, **kwargs):
    try:
        r = await c.request(method, '/api'+path, **kwargs)
        record(name, r.status_code in (expected if isinstance(expected, tuple) else (expected,)), f'HTTP {r.status_code}' + (': '+r.text[:500] if r.status_code >= 400 else ''))
        return r.json() if 'json' in r.headers.get('content-type','') else r.content
    except Exception as e:
        record(name, False, f'{type(e).__name__}: {str(e)[:250]}')
        return {}

def client(token=None):
    return httpx.AsyncClient(base_url='http://frontend', headers={'Authorization': 'Bearer '+token} if token else {}, timeout=240, trust_env=False)

async def register(c, role, grade=None, exam=None, suffix=''):
    email=f'qa-{RUN}-{role}{suffix}@example.com'
    data=await req(c, 'register '+role+suffix, 'POST','/auth/register',201,json={'email':email,'password':'Everest-QA-42','name':'QA '+role+suffix,'role':role,'grade':grade,'exam':exam})
    CONTEXT.setdefault('emails',[]).append(email)
    return data

async def diagnostics(c, grade, exam, mode='first'):
    d=await req(c, f'diagnostic {grade}/{exam}/{mode} start','POST','/diagnostics',json={'mode':mode})
    if 'id' not in d: return
    key=engine.exam_key(grade,exam)
    items=engine.diag_items(key,grade,d['variant'],date.today())
    record(f'diagnostic {grade}/{exam} hides answer keys',all('a' not in i for i in d['items']))
    for pos,it in enumerate(items):
        r=await c.put(f"/api/diagnostics/{d['id']}/answer",json={'item_id':it['id'],'answer':'full' if it['t']=='self' else str(it['a']),'position':pos+1})
        if r.status_code != 200:
            record('save diagnostic answers',False,r.status_code); return
    record(f'diagnostic {grade}/{exam}/{mode} answers saved',True,len(items))
    resume=await req(c,'diagnostic resume','POST','/diagnostics',json={'mode':mode})
    record('diagnostic resumes saved answers',resume.get('id')==d['id'] and len(resume.get('answers',{}))==len(items))
    result=await req(c,f'diagnostic {grade}/{exam}/{mode} finish','POST',f"/diagnostics/{d['id']}/finish")
    record(f'diagnostic {grade}/{exam}/{mode} result', isinstance(result.get('value'),(int,float)),json.dumps(result,ensure_ascii=False)[:500])
    again=await req(c,'diagnostic repeated finish','POST',f"/diagnostics/{d['id']}/finish")
    record('diagnostic finish is idempotent',again==result)

async def photo(c, sid):
    image=Image.new('RGB',(1300,750),'white')
    draw=ImageDraw.Draw(image)
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',30)
    text='Задание 13\nа) Решите уравнение 2 cos(x) = 1.\nб) Найдите корни на отрезке [0; 2π].\nРешение:\nа) cos(x) = 1/2, x = ±π/3 + 2πn, n ∈ Z.\nб) На [0; 2π] получаем π/3 и 5π/3.\nОтвет: а) ±π/3 + 2πn; б) π/3; 5π/3.'
    draw.multiline_text((40,40),text,font=font,fill='black',spacing=22)
    data=io.BytesIO(); image.save(data,format='PNG'); CONTEXT['photo_fixture']='printed math solution, task 13 (not handwriting)'
    events=[]
    try:
        async with websockets.connect(f'ws://frontend/api/ws/{sid}') as ws:
            await req(c,'photo upload PNG','POST',f'/sessions/{sid}/tasks/13/upload',files={'files':('solution.png',data.getvalue(),'image/png')})
            deadline=time.monotonic()+240
            while time.monotonic()<deadline:
                try:
                    event=json.loads(await asyncio.wait_for(ws.recv(),timeout=10)); events.append(event)
                    if event.get('event') in ('task_complete','task_error'): break
                except asyncio.TimeoutError:
                    print('WAIT photo processing', flush=True)
            record('WebSocket processing updates',bool(events),[x.get('event') for x in events])
    except Exception as e:
        record('WebSocket processing updates',False,type(e).__name__+': '+str(e)[:200])
    result=await req(c,'photo results','GET',f'/sessions/{sid}/results')
    task=result.get('tasks',{}).get('13',{})
    record('photo OCR + agents + judge complete',task.get('status')=='done',task.get('error') or json.dumps(task.get('judge_decision'),ensure_ascii=False))
    record('OCR extracted math text',bool(task.get('ocr_text')),str(task.get('ocr_text',''))[:300])
    record('photo three agent verdicts',len(task.get('agent_verdicts') or [])==3)
    pdf=await req(c,'PDF report','GET',f'/sessions/{sid}/report.pdf')
    record('PDF report file signature',isinstance(pdf,bytes) and pdf.startswith(b'%PDF'))
    await req(c,'HTML report advertised by frontend','GET',f'/sessions/{sid}/report.html')
    if task.get('status')=='done':
        await req(c,'trajectory generation start','POST',f'/sessions/{sid}/trajectory')
        for _ in range(45):
            await asyncio.sleep(2)
            r=await c.get(f'/api/sessions/{sid}/trajectory')
            if r.status_code==200:
                record('trajectory generated',True,r.text[:300]); break
        else: record('trajectory generated',False,'not ready within 90 seconds')
    return task

async def main():
    anon=client()
    await req(anon,'private endpoint requires authentication','GET','/me',403)
    s=await register(anon,'student','11','prof')
    t=await register(anon,'teacher')
    o=await register(anon,'teacher',suffix='-other')
    c,tc,oc=client(s['token']),client(t['token']),client(o['token'])
    await req(anon,'login correct password','POST','/auth/login',json={'email':CONTEXT['emails'][0],'password':'Everest-QA-42'})
    await req(anon,'login rejects wrong password','POST','/auth/login',401,json={'email':CONTEXT['emails'][0],'password':'wrong'})
    await req(anon,'duplicate registration rejected','POST','/auth/register',409,json={'email':CONTEXT['emails'][0],'password':'Everest-QA-42'})
    me=await req(c,'student profile','GET','/me'); CONTEXT['student_id']=me['id']
    await req(c,'profile edit','PUT','/me/profile',json={'name':'QA Student updated'})
    settings={'plan':{'date':(date.today()+timedelta(days=180)).isoformat(),'days':3,'min':45},'care':{'breaks':True,'sleep':True},'sound':False,'voice':False}
    await req(c,'settings save','PUT','/me/settings',json=settings)
    saved=await req(c,'settings reload','GET','/me')
    record('settings persistence',saved['settings']['plan']['days']==3 and saved['settings']['sound'] is False)
    await req(c,'student cannot access teacher section','GET','/teacher/overview',403)
    await req(c,'required diagnostic cannot be skipped','POST','/diagnostics/skip',400)
    await diagnostics(c,'11','prof')
    await diagnostics(c,'11','prof','mock')
    for grade,exam in [('11','base'),('9','oge'),('10','prof'),('7','none')]:
        await req(c,f'profile {grade}/{exam}','PUT','/me/profile',json={'grade':grade,'exam':exam})
        await diagnostics(c,grade,exam,'mock')
        if grade=='7': await req(c,'optional diagnostic skip','POST','/diagnostics/skip')
    await req(c,'restore profile','PUT','/me/profile',json={'grade':'11','exam':'prof'})
    dash=await req(c,'dashboard after diagnostics','GET','/dashboard')
    record('forecast has diagnostic history',len(dash.get('history',[]))>=2)
    plan=await req(c,'personalized plan','GET','/plan')
    record('plan has study blocks',any(day.get('blocks') for day in plan.get('week',[])))
    blocks=[b for day in plan.get('week',[]) for b in day.get('blocks',[])]
    if blocks:
        await req(c,'mark plan block done','POST','/plan/done',json={'key':blocks[0]['key']})
        await req(c,'unmark plan block','POST','/plan/done',json={'key':blocks[0]['key']})
    await req(c,'daily hint','POST','/daily/hint')
    await req(c,'daily wrong answer','POST','/daily/answer',json={'answer':'deliberately-wrong'})
    async with AsyncSessionLocal() as db:
        state=await service.get_state(db,me['id']); model=engine.build_model(state.data,'prof'); daily=engine.daily_pick(model,date.today())
    solved=await req(c,'daily correct answer','POST','/daily/answer',json={'answer':daily['a'][0]})
    record('daily correct answer recognized',solved.get('ok') is True)
    for event,id_ in [('video','13'),('hunt',None),('chest',None),('break',None)]:
        await req(c,'event '+event,'POST','/events',json={'event':event,'id':id_})
    await req(c,'topic quiz','POST',f"/nodes/{NODES[0]['id']}/quiz",json={'ok':2,'total':3})
    await req(c,'notifications','GET','/notifications')
    await req(c,'mark notifications read','POST','/notifications/read',json={})
    cg=await req(tc,'teacher create class','POST','/teacher/classes',json={'name':'QA '+RUN})
    await req(c,'student joins class','POST','/classes/join',json={'code':cg['code']})
    a=await req(tc,'teacher assigns homework','POST','/teacher/assignments',json={'class_id':cg['id'],'topic':'QA уравнения','count':3,'due':(date.today()+timedelta(days=3)).isoformat(),'task_id':13})
    await req(c,'student submits homework','POST',f"/assignments/{a['id']}/done")
    await req(tc,'teacher overview','GET','/teacher/overview')
    await req(tc,'teacher student details','GET',f"/teacher/students/{me['id']}")
    await req(oc,'other teacher cannot see student','GET',f"/teacher/students/{me['id']}",(403,404))
    for kind,cc in [('student',c),('teacher',tc)]:
        reply=await req(cc,'AI chat '+kind,'POST','/chat/'+kind,json={'text':'Помоги объяснить, как решить уравнение 2x+3=7.'})
        record('AI chat '+kind+' has reply',bool(reply.get('reply')))
        hist=await req(cc,'chat history '+kind,'GET','/chat/'+kind)
        record('chat history saved '+kind,len(hist.get('messages',[]))>=2)
    await req(c,'AI knowledge map analysis','POST','/map/analysis')
    booktext='§ 1. Линейные уравнения. Линейное уравнение имеет вид ax+b=0, где a и b — числа, a ≠ 0. Его корень x=-b/a. Пример 1: 2x+3=7; 2x=4; x=2. Задача 1: решите 3x+6=0. Задача 2: решите 5x-10=0.'
    book=await req(tc,'textbook TXT upload','POST','/textbooks',data={'title':'QA '+RUN,'authors':'QA','grade':'7'},files={'file':('qa.txt',booktext.encode(),'text/plain')})
    record('textbook text extracted',book.get('chars',0)>100)
    await req(tc,'textbook library','GET','/textbooks')
    for kind in ['conspect','slides']:
        material=await req(tc,'generate '+kind,'POST','/materials/generate',json={'kind':kind,'topic':'Линейные уравнения','textbook_id':book['id'],'section':'§ 1','who':'7 класс','minutes':'20'})
        record(kind+' has content',bool(material.get('text') if kind=='conspect' else material.get('slides')))
    await req(tc,'saved generated materials','GET','/materials')
    await req(tc,'delete textbook after material generation','DELETE',f"/textbooks/{book['id']}")
    sid=(await req(c,'create photo session','POST','/sessions'))['session_id']; CONTEXT['session_id']=sid
    await req(c,'session history','GET','/sessions')
    await req(oc,'another user cannot read results','GET',f'/sessions/{sid}/results',403)
    await req(oc,'another user cannot read task status','GET',f'/sessions/{sid}/tasks/13/status',(403,404))
    try:
        async with websockets.connect(f'ws://frontend/api/ws/{sid}'):
            record('WebSocket rejects unauthenticated connection',False,'connection accepted without authentication')
    except Exception: record('WebSocket rejects unauthenticated connection',True)
    await req(c,'invalid upload type rejected','POST',f'/sessions/{sid}/tasks/13/upload',400,files={'files':('bad.exe',b'bad','application/octet-stream')})
    task=await photo(c,sid)
    if task.get('status')=='done':
        async with AsyncSessionLocal() as db:
            row=(await db.execute(select(TaskResult).where(TaskResult.session_id==sid,TaskResult.task_id==13))).scalar_one()
            result_id=row.id
        await req(oc,'other teacher cannot change unrelated score','POST',f'/teacher/reviews/{result_id}',(403,404),json={'score':1})
        await req(tc,'teacher reviews own student score','POST',f'/teacher/reviews/{result_id}',json={'score':2})
        await req(tc,'teacher can update previous review','POST',f'/teacher/reviews/{result_id}',json={'score':1})
    await req(tc,'delete homework','DELETE',f"/teacher/assignments/{a['id']}")
    for kind,cc in [('student',c),('teacher',tc)]:
        await req(cc,'clear test chat '+kind,'DELETE','/chat/'+kind)
    record('suite finished',True,f'{len(RESULTS)} checks')
    for cc in [anon,c,tc,oc]: await cc.aclose()

asyncio.run(main())
