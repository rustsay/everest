"""Run with: python -m unittest discover -s tests -v (inside the backend image)."""
import io
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException, UploadFile
from httpx import ASGITransport, AsyncClient
from PIL import Image
from pypdf import PdfReader, PdfWriter

from app.api import batch


def photo(fmt='JPEG', color='red'):
    out = io.BytesIO()
    Image.new('RGB', (80, 60), color).save(out, fmt)
    return out.getvalue()


def pdf():
    out = io.BytesIO()
    Image.new('RGB', (80, 60), 'red').save(
        out, 'PDF', save_all=True, append_images=[Image.new('RGB', (80, 60), 'blue')])
    return out.getvalue()


class ConversionTests(unittest.TestCase):
    def test_supported_images_become_browser_readable_jpegs(self):
        for fmt, filename in [('JPEG', 'scan.JPEG'), ('PNG', 'scan.png'),
                              ('WEBP', 'scan.webp'), ('HEIF', 'scan.HEIC'), ('HEIF', 'scan.heif')]:
            with self.subTest(filename=filename):
                pages = batch.file_pages(photo(fmt), filename, 30)
                self.assertEqual(len(pages), 1)
                with Image.open(io.BytesIO(pages[0][0])) as im:
                    self.assertEqual(im.format, 'JPEG')
                    self.assertEqual(im.size, (80, 60))
                    self.assertGreater(im.getpixel((40, 30))[0], 240)

    def test_pdf_pages_keep_order_and_source_name(self):
        pages = batch.file_pages(pdf(), 'work.PDF', 30)
        self.assertEqual([p[1] for p in pages], ['work.PDF · стр. 1', 'work.PDF · стр. 2'])
        for (data, _), channel in zip(pages, [0, 2]):
            with Image.open(io.BytesIO(data)) as im:
                self.assertLessEqual(max(im.size), 2200)
                self.assertGreater(im.getpixel((im.width // 2, im.height // 2))[channel], 240)

    def test_pdf_page_limit_checked_before_rendering(self):
        with patch.object(batch, 'convert_from_bytes') as render:
            with self.assertRaises(HTTPException) as ctx:
                batch.file_pages(pdf(), 'work.pdf', 1)
            self.assertEqual(ctx.exception.status_code, 400)
            render.assert_not_called()

    def test_invalid_files_return_actionable_errors(self):
        for data, filename in [(b'broken', 'work.pdf'), (b'broken', 'scan.heic'),
                               (photo(), 'work.txt')]:
            with self.subTest(filename=filename), self.assertRaises(HTTPException) as ctx:
                batch.file_pages(data, filename, 30)
            self.assertEqual(ctx.exception.status_code, 400)

    def test_password_protected_pdf_returns_readable_error(self):
        writer = PdfWriter()
        writer.append(PdfReader(io.BytesIO(pdf())))
        writer.encrypt('secret')
        out = io.BytesIO()
        writer.write(out)
        with self.assertRaises(HTTPException) as ctx:
            batch.file_pages(out.getvalue(), 'protected.pdf', 30)
        self.assertIn('паролем', ctx.exception.detail)


class UploadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.sid = uuid.uuid4()
        self.folder_patch = patch.object(batch, 'folder', AsyncMock(return_value=self.path))
        self.suggest_patch = patch.object(batch, 'suggest', AsyncMock(return_value=([13], '')))
        self.folder_patch.start()
        self.suggest = self.suggest_patch.start()

    async def asyncTearDown(self):
        self.suggest_patch.stop()
        self.folder_patch.stop()
        self.temp.cleanup()

    async def upload(self, files):
        return await batch.upload_photos(self.sid, [
            UploadFile(filename=name, file=io.BytesIO(data)) for name, data in files
        ], user=None, db=None)

    async def test_mixed_upload_persists_each_pdf_page_with_jpeg_previews(self):
        result = await self.upload([('photo.jpeg', photo()), ('work.pdf', pdf()),
                                    ('phone.heic', photo('HEIF'))])
        pages = result['pages']
        self.assertEqual(len(pages), 4)
        self.assertEqual(self.suggest.await_count, 4)
        self.assertEqual(batch.read_pages(self.path), pages)
        self.assertEqual([p['filename'] for p in pages],
                         ['photo.jpeg', 'work.pdf · стр. 1', 'work.pdf · стр. 2', 'phone.heic'])
        for page in pages:
            preview = await batch.image(self.sid, uuid.UUID(page['id']), user=None, db=None)
            self.assertEqual(preview.media_type, 'image/jpeg')
            with Image.open(preview.path) as im:
                self.assertEqual(im.format, 'JPEG')
            self.assertEqual(page['task_ids'], [13])
            self.assertFalse(page['submitted'])

    async def test_corrupt_file_does_not_partially_save_upload(self):
        with self.assertRaises(HTTPException):
            await self.upload([('valid.jpeg', photo()), ('broken.pdf', b'broken')])
        self.assertEqual(list(self.path.iterdir()), [])
        self.suggest.assert_not_awaited()

    async def test_multipart_upload_accepts_mixed_formats(self):
        app = FastAPI()
        app.include_router(batch.router, prefix='/api')
        app.dependency_overrides[batch.get_current_user] = lambda: None
        app.dependency_overrides[batch.get_db] = lambda: None
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post(f'/api/sessions/{self.sid}/photos', files=[
                ('files', ('work.pdf', pdf(), 'application/pdf')),
                ('files', ('phone.heic', photo('HEIF'), 'application/octet-stream')),
                ('files', ('scan.jpeg', photo(), 'image/jpeg')),
            ])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['pages']), 4)

    async def test_pdf_limit_includes_previously_uploaded_pages(self):
        existing = [{'id': str(uuid.uuid4()), 'filename': 'old.jpeg'} for _ in range(29)]
        for page in existing:
            (self.path / f"{page['id']}.jpg").write_bytes(photo())
        batch.write_pages(self.path, existing)
        with self.assertRaises(HTTPException) as ctx:
            await self.upload([('work.pdf', pdf())])
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(batch.read_pages(self.path), existing)
        self.suggest.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
