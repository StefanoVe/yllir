import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb, cmyk, degrees, QRCode, PNG } from '../../vendor/print-libs.mjs';

test('the vendored bundle imports and creates a PDF, a QR matrix and a PNG', async () => {
  assert.equal(typeof QRCode.create, 'function');
  assert.ok(QRCode.create('x', { errorCorrectionLevel: 'M' }).modules.size > 0);
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  page.drawText('ok', { x: 10, y: 10, size: 10, font: await doc.embedFont(StandardFonts.Helvetica), color: rgb(0, 0, 0) });
  page.drawRectangle({ x: 1, y: 1, width: 5, height: 5, color: cmyk(0, 0, 0, 1) });
  page.drawText('r', { x: 20, y: 20, size: 8, rotate: degrees(0) });
  const bytes = await doc.save();
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString('latin1'), '%PDF-');
  assert.equal(doc.getPageCount(), 1);
  assert.equal(new PNG({ width: 2, height: 2 }).width, 2);
});
