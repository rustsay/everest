import asyncio, io, json, time
from pathlib import Path
from datetime import date
import httpx
from sqlalchemy import select
from app.db.database import AsyncSessionLocal
from app.db.models import User, TaskResult, LearnerState
from app.learning.content import NODES
from PIL import Image, ImageDraw, ImageFont

REPORT=json.loads(Path('/tmp/everest-qa-results.json').read_text())
CTX=REPORT['context']; ROWS=REPORT['results']
def record(name,ok,detail=''):
    row={'name':name,'ok':bool(ok),'detail':str(detail)[:1000]}; ROWS.append(row)
    print(json.dumps(row,ensure_ascii=False),flush=True)
    Path('/tmp/everest-qa-results.json').write_text(json.dumps(REPORT,ensure_ascii=False,indent=2))
async def main():
    async with httpx.AsyncClient(base_url='http://frontend/api',trust_env=False,timeout=180) as c:
        async def login(email):
            r=await c.post('/auth/login',json={'email':email,'password':'Everest-QA-42'}); return {'Authorization':'Bearer '+r.json()['token']}
        s=await login(CTX['emails'][0]); t=await login(CTX['emails'][1]); o=await login(CTX['emails'][2])
        # Verify the legitimate review path separately from the unauthorized-review check.
        sid=(await c.post('/sessions',headers=s)).json()['session_id']
        async with AsyncSessionLocal() as db:
            original=(await db.execute(select(TaskResult).where(TaskResult.session_id==CTX['session_id'],TaskResult.task_id==13))).scalar_one()
            fixture=TaskResult(session_id=sid,task_id=13,status='done',ocr_text=original.ocr_text,ocr_confidence=original.ocr_confidence,agent_verdicts=original.agent_verdicts,judge_decision={**original.judge_decision,'final_score':2,'consensus_level':'full'})
            db.add(fixture); await db.commit(); await db.refresh(fixture); rid=fixture.id
        r=await c.post(f'/teacher/reviews/{rid}',headers=t,json={'score':0})
        record('first legitimate teacher review (copied QA result fixture)',r.status_code==200,r.status_code)
        r=await c.post(f'/teacher/reviews/{rid}',headers=t,json={'score':1})
        record('repeat legitimate teacher review',r.status_code==200,r.status_code)
        r=await c.get('/dashboard',headers=s)
        obs=next(x.get('obs') for x in r.json()['model']['tasks'] if x['id']=='T13')
        record('teacher score updates learning observation',obs==0,'teacher final score 0/2; observation='+str(obs))
        r=await c.get(f"/sessions/{CTX['session_id']}/tasks/13/status",headers=o)
        record('another user cannot read existing task status',r.status_code in (403,404),f'{r.status_code}: {r.text}')
        for grade,exam in [('5','none'),('6','none'),('8','none')]:
            email=f"qa-{CTX['run']}-grade{grade}@example.com"
            r=await c.post('/auth/register',json={'email':email,'password':'Everest-QA-42','name':'QA fresh','role':'student','grade':grade,'exam':exam})
            CTX['emails'].append(email); record('register grade '+grade,r.status_code==201,r.status_code)
            h={'Authorization':'Bearer '+r.json()['token']}
            me=(await c.get('/me',headers=h)).json()
            async with AsyncSessionLocal() as db:
                st=await db.get(LearnerState,me['id'])
                record('fresh grade '+grade+' has no inherited activity',len(st.data.get('active_days',[]))<=1,st.data.get('active_days'))
            d=(await c.post('/diagnostics',headers=h,json={'mode':'first'})).json()
            record('grade '+grade+' diagnostic questions available',len(d.get('items',[]))>0,len(d.get('items',[])))
            r=await c.post(f"/diagnostics/{d['id']}/finish",headers=h)
            record('grade '+grade+' empty diagnostic finishes',r.status_code==200,r.status_code)
        # Profile and progress validation: invalid requests should be rejected, never crash later.
        r=await c.put('/me/profile',headers=s,json={'exam':'invalid'})
        record('invalid exam in profile rejected',r.status_code==422,r.status_code)
        r=await c.post('/nodes/'+NODES[0]['id']+'/quiz',headers=s,json={'ok':10,'total':1})
        record('quiz rejects more correct answers than total',r.status_code==422,r.status_code)
        r=await c.post('/plan/done',headers=s,json={'key':'fake:0'})
        record('nonexistent plan block rejected',r.status_code in (400,404,422),r.status_code)
        # JPEG and two-page PDF use the same correct mathematical solution as the PNG check.
        im=Image.new('RGB',(1300,750),'white'); dr=ImageDraw.Draw(im)
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',30)
        text='Задание 13\nа) Решите уравнение 2 cos(x) = 1.\nб) Найдите корни на отрезке [0; 2π].\nРешение: cos(x)=1/2; x=±π/3+2πn, n ∈ Z.\nНа [0; 2π]: x=π/3 и x=5π/3.\nОтвет: а) ±π/3+2πn; б) π/3 и 5π/3.'
        dr.multiline_text((40,40),text,font=font,fill='black',spacing=22)
        fixtures=[]
        buf=io.BytesIO(); im.save(buf,format='JPEG'); fixtures.append(('JPG', [('files',('qa.jpg',buf.getvalue(),'image/jpeg'))]))
        buf=io.BytesIO(); im.save(buf,format='PDF',save_all=True,append_images=[im]); fixtures.append(('two-page PDF',[('files',('qa.pdf',buf.getvalue(),'application/pdf'))]))
        buf=io.BytesIO(); im.save(buf,format='JPEG'); fixtures.append(('two JPG files',[('files',('one.jpg',buf.getvalue(),'image/jpeg')),('files',('two.jpg',buf.getvalue(),'image/jpeg'))]))
        jobs=[]
        for name,files in fixtures:
            ss=(await c.post('/sessions',headers=s)).json()['session_id']
            r=await c.post(f'/sessions/{ss}/tasks/13/upload',headers=s,files=files)
            record(name+' upload',r.status_code==200,r.status_code); jobs.append((name,ss))
        deadline=time.monotonic()+240
        while jobs and time.monotonic()<deadline:
            for name,ss in jobs[:]:
                rr=(await c.get(f'/sessions/{ss}/results',headers=s)).json(); task=rr.get('tasks',{}).get('13',{})
                if task.get('status') in ('done','error'):
                    record(name+' processing completes',task['status']=='done',task.get('error') or task.get('judge_decision')); jobs.remove((name,ss))
            if jobs: await asyncio.sleep(3)
        for name,ss in jobs: record(name+' processing completes',False,'timeout')
        # Image support in chat.
        import base64
        image=base64.b64encode(fixtures[0][1][0][1][1]).decode()
        r=await c.post('/chat/student',headers=s,json={'text':'Какое уравнение написано на картинке?','image':image})
        record('AI chat accepts photo',r.status_code==200 and bool(r.json().get('reply')),r.status_code)
        record('follow-up suite finished',True)
asyncio.run(main())
