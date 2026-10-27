import { chromium } from '../../desktop-stream-bench/node_modules/playwright/index.mjs';

// Local synthetic capability probe; does not measure the native encoder or transport.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('http://localhost/webcodecs-probe', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Single IDR probe</title>',
  }));
  await page.goto('http://localhost/webcodecs-probe');
  const result = await page.evaluate(async () => {
    const result = {
      status: 'not_run', userAgent: navigator.userAgent, secureContext: isSecureContext,
      deadlineMs: 2000, decoderFlushCalled: false, decoderInputs: 0,
      provenance: 'One synthetic browser-encoded H264 frame; no native server or network stream.',
    };
    const describe = error => `${error.name}: ${error.message}`;
    if (!globalThis.VideoEncoder || !globalThis.VideoDecoder) {
      return { ...result, reason: 'WebCodecs encoder or decoder unavailable' };
    }
    const encoderConfig = {
      codec: 'avc1.42001e', width: 128, height: 128, bitrate: 1_000_000,
      framerate: 30, latencyMode: 'realtime', avc: { format: 'annexb' },
    };
    const decoderConfig = {
      codec: encoderConfig.codec, codedWidth: 128, codedHeight: 128,
      optimizeForLatency: true,
    };
    const support = async (type, config) => {
      try { return await type.isConfigSupported(config); }
      catch (error) { return { supported: false, config, error: describe(error) }; }
    };
    result.encoderSupport = await support(VideoEncoder, encoderConfig);
    result.decoderSupport = await Promise.all(
      ['no-preference', 'prefer-hardware', 'prefer-software'].map(hardwareAcceleration =>
        support(VideoDecoder, { ...decoderConfig, hardwareAcceleration })),
    );
    if (!result.encoderSupport.supported || !result.decoderSupport[0].supported) {
      return { ...result, reason: 'Required encoder or decoder config unsupported' };
    }
    const chunks = [];
    let encoder;
    let decoder;
    try {
      encoder = new VideoEncoder({
        output(chunk, metadata) {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          chunks.push({ chunk, bytes });
          result.encoderMetadata = metadata.decoderConfig ? {
            ...metadata.decoderConfig,
            description: metadata.decoderConfig.description
              ? Array.from(new Uint8Array(metadata.decoderConfig.description)) : undefined,
          } : null;
        },
        error(error) { result.encoderError = describe(error); },
      });
      encoder.configure(encoderConfig);
      const source = new OffscreenCanvas(128, 128);
      const context = source.getContext('2d');
      context.fillStyle = 'rgb(32,192,64)';
      context.fillRect(0, 0, 128, 128);
      const frame = new VideoFrame(source, { timestamp: 0, duration: 33333 });
      const encodeStart = performance.now();
      try { encoder.encode(frame, { keyFrame: true }); } finally { frame.close(); }
      await encoder.flush();
      result.encodeWithFlushMs = performance.now() - encodeStart;
      encoder.close();
      result.encoderOutputCount = chunks.length;
      if (chunks.length !== 1 || chunks[0].chunk.type !== 'key') {
        return { ...result, status: 'inconclusive', reason: 'Expected exactly one key chunk' };
      }
      const { chunk, bytes } = chunks[0];
      const nalTypes = [];
      for (let i = 0; i < bytes.length - 3; i++) {
        if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
          nalTypes.push(bytes[i + 3] & 31);
        }
      }
      result.chunk = { type: chunk.type, timestamp: chunk.timestamp,
        duration: chunk.duration, byteLength: bytes.length, annexBNalTypes: nalTypes };
      if (![5, 7, 8].every(type => nalTypes.includes(type))) {
        return { ...result, status: 'inconclusive', reason: 'IDR, SPS and PPS not all present in Annex B chunk' };
      }
      let timer;
      let decodeStart;
      const output = new Promise(resolve => {
        decoder = new VideoDecoder({
          output(decoded) {
            const outputMs = performance.now() - decodeStart;
            try {
              const canvas = new OffscreenCanvas(128, 128);
              const ctx = canvas.getContext('2d');
              ctx.drawImage(decoded, 0, 0);
              const pixel = Array.from(ctx.getImageData(64, 64, 1, 1).data);
              // Independent source color; tolerate lossy H264/color conversion.
              const pixelPass = [32, 192, 64].every((value, i) => Math.abs(pixel[i] - value) <= 20);
              resolve({ status: pixelPass ? 'pass' : 'fail', outputMs, pixel, expectedPixel: [32, 192, 64], pixelTolerance: 20,
                timestamp: decoded.timestamp, pixelPass });
            } catch (error) { resolve({ status: 'fail', error: describe(error), outputMs }); }
            finally { decoded.close(); }
          },
          error(error) { resolve({ status: 'fail', decoderError: describe(error) }); },
        });
        decoder.configure({ ...decoderConfig, hardwareAcceleration: 'no-preference' });
        result.actualDecoderConfig = { ...decoderConfig, hardwareAcceleration: 'no-preference' };
        decodeStart = performance.now();
        result.decoderInputs++;
        decoder.decode(new EncodedVideoChunk({ type: chunk.type, timestamp: chunk.timestamp,
          duration: chunk.duration, data: bytes }));
        timer = setTimeout(() => resolve({ status: 'fail', reason: 'No output before deadline with one input and no decoder flush' }), result.deadlineMs);
      });
      const decodedResult = await output;
      clearTimeout(timer);
      return { ...result, ...decodedResult };
    } catch (error) {
      return { ...result, status: 'error', error: describe(error) };
    } finally {
      if (encoder && encoder.state !== 'closed') encoder.close();
      if (decoder && decoder.state !== 'closed') decoder.close();
    }
  });
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), browserVersion: browser.version(), ...result }, null, 2));
  process.exitCode = ['fail', 'error'].includes(result.status) ? 1 : 0;
} finally {
  await browser.close();
}
