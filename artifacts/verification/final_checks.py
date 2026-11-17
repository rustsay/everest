import asyncio, io, json, time
from pathlib import Path
import httpx
from sqlalchemy import select
from app.db.database import AsyncSessionLocal
from app.db.models import TaskResult
from app.models.schemas import AgentVerdict
from app.agents.judge import run_judge
from pypdf import PdfReader
from fpdf import FPDF

REPORT=json.loads(Path('/tmp/everest-qa-results.json').read_text()); CTX=REPORT['context']
def record(name,ok,detail=''):
    row={'name':name,'ok':bool(ok),'detail':str(detail)[:1000]}; REPORT['results'].append(row)
    print(json.dumps(row,ensure_ascii=False),flush=True)
    Path('/tmp/everest-qa-results.json').write_text(json.dumps(REPORT,ensure_ascii=False,indent=2))

async def main():
    def verdict(i,score):
        return AgentVerdict(agent_id=i,score=score,max_score=2,reasoning='Пункт а решен верно; в пункте б отбор корней не обоснован.',errors_found=['Не обоснован отбор корней'],correct_steps=['Общее решение найдено'],confidence=.7)
    for name,scores,level in [('full',[2,2,2],'full'),('majority',[1,1,0],'majority'),('disagreement',[0,1,2],'judge_decision')]:
        try:
            r=await asyncio.wait_for(run_judge(13,[verdict(i+1,x) for i,x in enumerate(scores)]),timeout=90)
            record('judge '+name,r.consensus_level==level and 0<=r.final_score<=2,r.model_dump())
        except Exception as e: record('judge '+name,False,type(e).__name__)
    async with httpx.AsyncClient(base_url='http://frontend/api',trust_env=False,timeout=120) as c:
        async def login(email):
            r=await c.post('/auth/login',json={'email':email,'password':'Everest-QA-42'}); return {'Authorization':'Bearer '+r.json()['token']}
        s=await login(CTX['emails'][0]); t=await login(CTX['emails'][1])
        # Validate the generated file, including its page content.
        r=await c.get(f"/sessions/{CTX['session_id']}/report.pdf",headers=s)
        pdf=PdfReader(io.BytesIO(r.content)); text='\n'.join(p.extract_text() or '' for p in pdf.pages)
        record('exported PDF has readable pages and score',len(pdf.pages)>0 and len(text)>200 and '13' in text,f'{len(pdf.pages)} pages; {len(text)} text characters')
        materials=(await c.get('/materials',headers=t)).json()['materials']
        slides=[m for m in materials if m['kind']=='slides']
        record('presentation has 8-10 slides',bool(slides) and 8<=len(slides[0].get('slides',[]))<=10,len(slides[0].get('slides',[])) if slides else 0)
        record('conspect preserves source formula',any('x=-b/a' in m.get('text','').replace(' ','') for m in materials if m['kind']=='conspect'))
        book=FPDF(); book.add_page(); book.set_font('Helvetica',size=12); book.multi_cell(0,8,'Linear equation ax+b=0 has the root x=-b/a, a is not zero. Example: 2x+3=7, x=2.')
        r=await c.post('/textbooks',headers=t,data={'title':'QA PDF '+CTX['run'],'authors':'QA','grade':'7'},files={'file':('qa.pdf',bytes(book.output()),'application/pdf')})
        record('PDF textbook text extraction',r.status_code==200 and r.json().get('chars',0)>50,r.text)
        if r.status_code==200:
            r=await c.delete('/textbooks/'+str(r.json()['id']),headers=t); record('delete textbook without materials',r.status_code==200,r.status_code)
        # Damaged images should be rejected instead of being scored by the LLM without input.
        ss=(await c.post('/sessions',headers=s)).json()['session_id']
        r=await c.post(f'/sessions/{ss}/tasks/13/upload',headers=s,files={'files':('broken.jpg',b'not an image','image/jpeg')})
        record('damaged JPEG rejected at upload',r.status_code in (400,422),r.status_code)
        for _ in range(35):
            task=(await c.get(f'/sessions/{ss}/results',headers=s)).json().get('tasks',{}).get('13',{})
            if task.get('status') in ('done','error'):
                record('damaged JPEG does not receive a grade',task['status']=='error',task.get('error') or task.get('judge_decision')); break
            await asyncio.sleep(2)
        r=await c.post('/auth/register',json={'email':'qa-'+CTX['run']+'-tutor@example.com','password':'Everest-QA-42','role':'tutor','name':'QA Tutor'})
        CTX['emails'].append('qa-'+CTX['run']+'-tutor@example.com')
        record('tutor registration',r.status_code==201,r.status_code)
        if r.status_code==201:
            h={'Authorization':'Bearer '+r.json()['token']}
            r=await c.get('/teacher/overview',headers=h); record('tutor cabinet API',r.status_code==200,r.status_code)
        record('final API checks finished',True)
asyncio.run(main())
