import asyncio, io, json, time
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import httpx

async def main():
    async with httpx.AsyncClient(base_url='http://frontend/api',trust_env=False,timeout=180) as c:
        email=f'qa-batch-{int(time.time())}@example.com'
        r=await c.post('/auth/register',json={'email':email,'password':'Everest-QA-42','role':'student','name':'QA Photo batch','grade':'11','exam':'prof'})
        assert r.status_code==201,r.text
        c.headers['Authorization']='Bearer '+r.json()['token']
        sid=(await c.post('/sessions')).json()['session_id']
        Path('/tmp/batch-context.json').write_text(json.dumps({'email':email,'sid':sid}))
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',30)
        files=[]
        texts=['Задание 13\nа) Решите 2cos(x)=1.\nб) Корни на [0;2π].\ncos(x)=1/2. x=±π/3+2πn, n ∈ Z.\nНа отрезке: π/3 и 5π/3. Ответ: π/3;5π/3.', 'Задание 15\nРешите неравенство log₂(x-1) > 1.\nОДЗ: x>1. Основание 2>1.\nx-1>2; x>3. Ответ: (3;+∞).']
        for i,text in enumerate(texts):
            im=Image.new('RGB',(1200,650),'white'); ImageDraw.Draw(im).multiline_text((40,40),text,font=font,fill='black',spacing=22)
            buf=io.BytesIO();im.save(buf,'JPEG'); Path(f'/tmp/batch-{i}.jpg').write_bytes(buf.getvalue())
            files.append(('files',(f'page-{i}.jpg',buf.getvalue(),'image/jpeg')))
        bad=await c.post(f'/sessions/{sid}/photos',files={'files':('broken.jpg',b'broken','image/jpeg')})
        assert bad.status_code==400,bad.text
        print('PASS invalid image rejected',flush=True)
        r=await c.post(f'/sessions/{sid}/photos',files=files); assert r.status_code==200,r.text
        pages=r.json()['pages']; assert len(pages)==2
        print('Automatic suggestions:',[(p['filename'],p['task_ids']) for p in pages],flush=True)
        assert pages[0]['task_ids']==[13] and pages[1]['task_ids']==[15],pages
        preview=await c.get(f"/sessions/{sid}/photos/{pages[0]['id']}/image"); assert preview.status_code==200
        async with httpx.AsyncClient(base_url='http://frontend/api',trust_env=False) as anon:
            assert (await anon.get(f'/sessions/{sid}/photos')).status_code==403
            other=await anon.post('/auth/demo'); anon.headers['Authorization']='Bearer '+other.json()['token']
            assert (await anon.get(f'/sessions/{sid}/photos')).status_code==403
            assert (await anon.get(f"/sessions/{sid}/photos/{pages[0]['id']}/image")).status_code==403
            assert (await anon.post(f'/sessions/{sid}/photos/check')).status_code==403
        pages.reverse()
        choices={'pages':[{'id':p['id'],'task_ids':p['task_ids']} for p in pages]}
        assert (await c.put(f'/sessions/{sid}/photos',json=choices)).status_code==200
        assert (await c.get(f'/sessions/{sid}/photos')).json()['pages'][0]['id']==pages[0]['id']
        print('PASS manual ordering, persistence and ownership',flush=True)
        invalid={'pages':[{'id':pages[0]['id'],'task_ids':[99]}]}
        assert (await c.put(f'/sessions/{sid}/photos',json=invalid)).status_code==422
        unassigned={'pages':[{'id':p['id'],'task_ids':[]} for p in pages]}
        await c.put(f'/sessions/{sid}/photos',json=unassigned)
        assert (await c.post(f'/sessions/{sid}/photos/check')).status_code==400
        await c.put(f'/sessions/{sid}/photos',json=choices)
        r=await c.post(f'/sessions/{sid}/photos/check'); assert r.status_code==200,r.text
        assert sorted(r.json()['task_ids'])==[13,15]
        assert (await c.post(f'/sessions/{sid}/photos/check')).status_code==400
        deadline=time.monotonic()+220
        while time.monotonic()<deadline:
            tasks=(await c.get(f'/sessions/{sid}/results')).json()['tasks']
            if len(tasks)==2 and all(t['status'] in ('done','error') for t in tasks.values()):
                assert all(t['status']=='done' for t in tasks.values()),tasks
                print('PASS photo work checked:',{k:t['judge_decision']['final_score'] for k,t in tasks.items()},flush=True); break
            await asyncio.sleep(3)
        else: raise AssertionError('processing timeout')
        from app.ocr.pipeline import get_scan_jpegs
        assert len(get_scan_jpegs([(files[0][1][1],'page.jpg')]*5))==5
        print('PASS fifth page retained; batch checks complete',flush=True)
asyncio.run(main())
