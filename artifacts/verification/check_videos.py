"""Run inside backend: full video generation plus ownership and media checks."""
import asyncio, json, time, io, subprocess
from pathlib import Path
import httpx
from app.video.safe_board import assemble

async def main():
    html=assemble('<svg id="boardSvg" viewBox="0 0 1200 700"><g id="step1" class="fade"><text onclick="alert(1)">x=2</text><script>alert(1)</script><foreignObject>bad</foreignObject><image href="file:///etc/passwd"/></g></svg>',[{'title':"Корень's",'text':"Ответ </script> ' ", 'show':['step1']}],'QA')
    assert 'alert(1)' not in html and 'foreignobject' not in html.lower() and 'file:///etc' not in html
    assert "var steps=[" in html and '<\\/script>' in html
    print('PASS generated drawing sanitized; narration safely encoded',flush=True)
    async with httpx.AsyncClient(base_url='http://frontend/api',trust_env=False,timeout=45) as c:
        assert (await c.get('/videos')).status_code==403
        email=f'qa-video-{int(time.time())}@example.com'
        r=await c.post('/auth/register',json={'email':email,'password':'Everest-QA-42','role':'student','name':'QA Video','grade':'7','exam':'none'})
        assert r.status_code==201,r.text
        c.headers['Authorization']='Bearer '+r.json()['token']
        await c.post('/diagnostics/skip')
        await c.put('/me/settings',json={'onb':'done'})
        assert (await c.post('/videos',json={'problem':'     '})).status_code==422
        r=await c.post('/videos',json={'problem':'Решите квадратное уравнение x² − 5x + 6 = 0. Объясните разложение на множители и проверьте оба корня.'})
        assert r.status_code==202,r.text
        vid=r.json()['id']
        Path('/tmp/video-check-context.json').write_text(json.dumps({'email':email,'vid':vid}))
        assert (await c.post('/videos',json={'problem':'Решите 2x+3=7.'})).status_code==409
        async with httpx.AsyncClient(base_url='http://frontend/api',trust_env=False) as other:
            r=await other.post('/auth/demo'); other.headers['Authorization']='Bearer '+r.json()['token']
            assert (await other.get('/videos/'+vid)).status_code==404
            assert (await other.post('/videos/'+vid+'/retry')).status_code==404
            assert (await other.get('/videos')).json()['videos']==[]
        print('PASS creation, duplicate queue limit, input validation and ownership',flush=True)
        before=''
        for _ in range(240):
            v=(await c.get('/videos/'+vid)).json()
            if v['stage']!=before:
                print('STAGE:',v['stage'],flush=True); before=v['stage']
            if v['status']=='error':
                raise AssertionError(v['error'])
            if v['status']=='ready': break
            await asyncio.sleep(4)
        else: raise AssertionError('generation timeout')
        assert v['duration']>10
        assert (await c.post('/videos/'+vid+'/retry')).status_code==409
        again=(await c.get('/videos/'+vid)).json(); assert v['video_url']==again['video_url']
        board=await c.get('http://frontend'+v['board_url']); assert board.status_code==200
        assert 'sandbox allow-scripts' in board.headers['content-security-policy']
        assert '<svg' in board.text
        for name in ('video_url','audio_url'):
            r=await c.get('http://frontend'+v[name]); assert r.status_code==200 and len(r.content)>10000,(name,r.status_code)
        r=await c.get('http://frontend'+v['video_url'],headers={'Range':'bytes=0-1023'}); assert r.status_code==206 and len(r.content)==1024
        assert (await c.get(f'/videos/{vid}/media/mp4?token=invalid')).status_code==401
        print('PASS ready MP4/MP3, board, stable URLs, range seeking and invalid token',flush=True)
        p=Path('/app/uploads/videos')/(vid+'.mp4')
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
        assert any(s['codec_name']=='h264' for s in probe['streams'])
        assert any(s['codec_type']=='audio' for s in probe['streams'])
        print('PASS video codecs and audio track:',probe['format']['duration'],flush=True)
        print('CONTEXT',json.dumps({'email':email,'vid':vid}),flush=True)
asyncio.run(main())
