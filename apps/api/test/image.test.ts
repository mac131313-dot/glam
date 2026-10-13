import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageRatio, imageSize } from '../src/services/image.ts';
import { jpegHeader } from './fixtures.ts';

test('wymiary zdjęć z nagłówka: JPEG, PNG, WebP; nieczytelny plik → null', () => {
  assert.deepEqual(imageSize(jpegHeader(1600, 1200), 'image/jpeg'), { width: 1600, height: 1200 });
  assert.equal(imageRatio(jpegHeader(1200, 1600), 'image/jpeg'), 0.75, 'pion 3:4');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  assert.deepEqual(imageSize(png, 'image/png'), { width: 1, height: 1 });

  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBPVP8X', 8, 'ascii');
  webp.writeUIntLE(1920 - 1, 24, 3);
  webp.writeUIntLE(1080 - 1, 27, 3);
  assert.deepEqual(imageSize(webp, 'image/webp'), { width: 1920, height: 1080 });

  assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), null, 'ucięty JPEG');
});
