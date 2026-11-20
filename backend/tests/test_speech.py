import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from app.api import speech
from app.auth.deps import get_current_user


class SpeechTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        speech._cache.clear()
        speech._cache_bytes = 0
        self.app = FastAPI()
        self.app.include_router(speech.router)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()

    def login(self, uid=1):
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=uid)

    async def test_requires_login(self):
        self.assertEqual((await self.client.post('/speech', json={'text': 'Привет'})).status_code, 403)

    async def test_input_and_private_audio_cache(self):
        self.login()
        for text in ('', '   ', 'x' * 6001):
            self.assertEqual((await self.client.post('/speech', json={'text': text})).status_code, 422)
        with patch.object(speech, 'synthesize', AsyncMock(return_value=b'a' * 2048)) as generate:
            first = await self.client.post('/speech', json={'text': 'Привет'})
            second = await self.client.post('/speech', json={'text': 'Привет'})
            self.assertEqual(first.content, second.content)
            self.assertEqual(first.headers['content-type'], 'audio/mpeg')
            self.assertEqual(first.headers['cache-control'], 'private, no-store')
            self.assertEqual(generate.await_count, 1)
            self.login(2)
            await self.client.post('/speech', json={'text': 'Привет'})
            self.assertEqual(generate.await_count, 2)

    async def test_cache_eviction_and_provider_error(self):
        self.login()
        with patch.object(speech, '_MAX_CACHE_BYTES', 2500), patch.object(speech, 'synthesize', AsyncMock(return_value=b'a' * 2048)):
            for text in ('Первый', 'Второй'):
                self.assertEqual((await self.client.post('/speech', json={'text': text})).status_code, 200)
            self.assertEqual(len(speech._cache), 1)
            self.assertEqual(speech._cache_bytes, 2048)
        with patch.object(speech, 'synthesize', AsyncMock(side_effect=TimeoutError)):
            response = await self.client.post('/speech', json={'text': 'Ошибка'})
            self.assertEqual(response.status_code, 503)
            self.assertIn('временно недоступна', response.json()['detail'])
        self.assertEqual(len(speech._cache), 1)

    async def test_female_voice_pace_and_no_empty_audio(self):
        class Communicate:
            async def stream(self):
                yield {'type': 'WordBoundary', 'text': 'Привет'}
                yield {'type': 'audio', 'data': b'a' * 2048}
        with patch.object(speech.edge_tts, 'Communicate', return_value=Communicate()) as provider:
            self.assertEqual(len(await speech.synthesize('Привет')), 2048)
            provider.assert_called_once_with('Привет', 'ru-RU-SvetlanaNeural', rate='-6%', connect_timeout=5, receive_timeout=10)
        class Empty:
            async def stream(self):
                yield {'type': 'audio', 'data': b''}
        with patch.object(speech.edge_tts, 'Communicate', return_value=Empty()):
            with self.assertRaises(RuntimeError):
                await speech.synthesize('Привет')

    async def test_transient_empty_stream_retries(self):
        with patch.object(speech, '_render', AsyncMock(side_effect=[speech.edge_tts.exceptions.NoAudioReceived('empty'), b'a' * 2048])) as render:
            self.assertEqual(len(await speech.synthesize('Повтор')), 2048)
            self.assertEqual(render.await_count, 2)

    async def test_simultaneous_replay_shares_generation(self):
        self.login()
        async def render(text):
            await asyncio.sleep(0.02)
            return b'a' * 2048
        with patch.object(speech, 'synthesize', AsyncMock(side_effect=render)) as generate:
            results = await asyncio.gather(*[
                self.client.post('/speech', json={'text': 'Одновременный запрос'}) for _ in range(3)
            ])
            self.assertTrue(all(result.status_code == 200 for result in results))
            self.assertEqual(generate.await_count, 1)
            self.assertEqual(speech._cache_bytes, 2048)


if __name__ == '__main__':
    unittest.main()
