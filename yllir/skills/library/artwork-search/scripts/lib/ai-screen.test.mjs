import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { screenCandidate } from './ai-screen.mjs';

const BYTES = Buffer.from('plain image bytes');

function cand(overrides = {}) {
  return {
    pageUrl: 'https://example.org/art/harbour-17',
    imageUrl: 'https://example.org/files/harbour-17.png',
    title: 'Harbour at dusk',
    author: 'Jane Painter',
    tags: ['landscape', 'watercolor'],
    pageText: 'Hand-painted in watercolor on paper.',
    publishedAt: '2019-03-01',
    declaredNoAi: true,
    ...overrides,
  };
}

function reasonsOf(candidate, options = { bytes: BYTES }) {
  return screenCandidate(candidate, options).reasons;
}

describe('screenCandidate: clean candidates', () => {
  it('passes a declared human-made candidate with plain bytes', () => {
    assert.deepEqual(screenCandidate(cand(), { bytes: BYTES }), { ok: true, reasons: [] });
  });

  it('passes an old undeclared candidate', () => {
    assert.deepEqual(reasonsOf(cand({ declaredNoAi: false, publishedAt: '2021-01-01' })), []);
  });
});

describe('screenCandidate: text markers', () => {
  const phrases = [
    ['Midjourney v6', 'midjourney'],
    ['Stable Diffusion XL', 'stable-diffusion'],
    ['SDXL base', 'sdxl'],
    ['DALL-E 3', 'dall-e'],
    ['dall e', 'dall-e'],
    ['Firefly render', 'firefly'],
    ['AI generated', 'ai-generated'],
    ['ai-generated', 'ai-generated'],
    ['ai art', 'ai-art'],
    ['made with AI', 'made-with-ai'],
    ['text-to-image', 'text-to-image'],
    ['txt2img', 'txt2img'],
    ['niji journey', 'niji'],
    ['civitai model', 'civitai'],
    ['NovelAI', 'novelai'],
    ['leonardo.ai', 'leonardo-ai'],
    ['prompt: a castle', 'prompt'],
    ['negative prompt: blurry', 'negative-prompt'],
    ['LoRA weights', 'lora'],
    ['ComfyUI workflow', 'comfyui'],
    ['NightCafe', 'nightcafe'],
    ['Playground AI', 'playground-ai'],
    ['Craiyon', 'craiyon'],
    ['flux', 'flux'],
    ['#aiart', 'aiart'],
    ['aigenerated', 'aigenerated'],
  ];

  for (const [phrase, name] of phrases) {
    it(`rejects the text marker "${phrase}"`, () => {
      const reasons = reasonsOf(cand({ pageText: `Piece: ${phrase}` }));
      assert.ok(reasons.includes(`marker:${name}`), `expected marker:${name}, got ${reasons}`);
    });
  }

  it('checks tags and the title as well', () => {
    assert.deepEqual(reasonsOf(cand({ tags: ['gemini'] })), ['marker:gemini']);
    assert.deepEqual(reasonsOf(cand({ title: 'Midjourney study' })), ['marker:midjourney']);
  });

  it('matches whole words only for short markers', () => {
    assert.deepEqual(reasonsOf(cand({ pageText: 'Fluxion studies and Lorazepam bottles' })), []);
    assert.deepEqual(reasonsOf(cand({ pageText: 'Flux capacitor' })), ['marker:flux']);
  });

  it('reports each marker once', () => {
    assert.deepEqual(reasonsOf(cand({ pageText: 'midjourney midjourney' })), ['marker:midjourney']);
  });
});

describe('screenCandidate: binary markers', () => {
  const markers = [
    'c2pa',
    'jumbf',
    'trainedalgorithmicmedia',
    'algorithmicmedia',
    'midjourney',
    'stable diffusion',
    'comfyui',
    'negative prompt',
    'sd-metadata',
    'invokeai',
  ];

  for (const marker of markers) {
    it(`rejects the metadata marker "${marker}"`, () => {
      const bytes = Buffer.from(`xx ${marker.toUpperCase()} yy`, 'latin1');
      const reasons = reasonsOf(cand(), { bytes });
      assert.ok(reasons.includes(`metadata:${marker.replace(/\s+/g, '-')}`), `got ${reasons}`);
    });
  }

  it('rejects steps followed by a sampler within 200 characters', () => {
    const bytes = Buffer.from('steps: 30, cfg: 7, sampler: euler', 'latin1');
    assert.deepEqual(reasonsOf(cand(), { bytes }), ['metadata:steps-sampler']);
  });

  it('accepts steps and sampler far apart', () => {
    const bytes = Buffer.from(`steps:${'x'.repeat(300)}sampler:`, 'latin1');
    assert.deepEqual(reasonsOf(cand(), { bytes }), []);
  });
});

describe('screenCandidate: declared human-made wording', () => {
  it('does not trigger "ai art" on "no AI art"', () => {
    assert.deepEqual(reasonsOf(cand({ title: 'No AI art', pageText: 'No AI was used.' })), []);
  });

  it('accepts the declaration phrases', () => {
    assert.deepEqual(
      reasonsOf(cand({ pageText: 'Human-made ink. Made without AI. No-AI guarantee.', tags: ['no-ai', 'noai'] })),
      [],
    );
  });
});

describe('screenCandidate: dating', () => {
  it('rejects an undeclared work dated on the cutoff', () => {
    assert.deepEqual(reasonsOf(cand({ declaredNoAi: false, publishedAt: '2022-08-01' })), ['recent-undeclared']);
  });

  it('rejects an undeclared work dated after the cutoff', () => {
    assert.deepEqual(reasonsOf(cand({ declaredNoAi: false, publishedAt: '2024-05-01' })), ['recent-undeclared']);
  });

  it('accepts an undeclared work dated the day before the cutoff', () => {
    assert.deepEqual(reasonsOf(cand({ declaredNoAi: false, publishedAt: '2022-07-31' })), []);
  });

  it('rejects an undeclared work with no date', () => {
    assert.deepEqual(reasonsOf(cand({ declaredNoAi: false, publishedAt: null })), ['undated']);
  });

  it('rejects an undeclared work with an invalid date', () => {
    assert.deepEqual(reasonsOf(cand({ declaredNoAi: false, publishedAt: 'last tuesday' })), ['undated']);
  });

  it('skips the date rule when the work is declared human-made', () => {
    assert.deepEqual(reasonsOf(cand({ declaredNoAi: true, publishedAt: '2025-01-01' })), []);
    assert.deepEqual(reasonsOf(cand({ declaredNoAi: true, publishedAt: null })), []);
  });

  it('honours a custom cutoff', () => {
    const candidate = cand({ declaredNoAi: false, publishedAt: '2023-01-01' });
    assert.deepEqual(reasonsOf(candidate, { bytes: BYTES, cutoff: '2024-01-01' }), []);
    assert.deepEqual(reasonsOf(candidate, { bytes: BYTES, cutoff: '2023-01-01' }), ['recent-undeclared']);
  });
});

describe('screenCandidate: bytes and page URL', () => {
  it('rejects a missing image buffer', () => {
    assert.deepEqual(reasonsOf(cand(), { bytes: null }), ['no-bytes']);
    assert.deepEqual(reasonsOf(cand(), {}), ['no-bytes']);
  });

  it('rejects an empty image buffer', () => {
    assert.deepEqual(reasonsOf(cand(), { bytes: Buffer.alloc(0) }), ['no-bytes']);
  });

  it('rejects a page URL that is not https', () => {
    assert.deepEqual(reasonsOf(cand({ pageUrl: 'http://example.org/art' })), ['bad-page-url']);
  });

  it('rejects a missing page URL', () => {
    const { pageUrl, ...rest } = cand();
    assert.deepEqual(reasonsOf(rest), ['bad-page-url']);
  });
});

describe('screenCandidate: bad input never throws', () => {
  const badInputs = [
    ['null candidate', null, { bytes: BYTES }],
    ['string candidate', 'harbour', { bytes: BYTES }],
    ['array candidate', [], { bytes: BYTES }],
    ['tags as a string', cand({ tags: 'landscape' }), { bytes: BYTES }],
    ['declaredNoAi as a string', cand({ declaredNoAi: 'yes' }), { bytes: BYTES }],
    ['bytes as a string', cand(), { bytes: 'plain' }],
    ['cutoff not a date', cand(), { bytes: BYTES, cutoff: 'soon' }],
    ['cutoff not a string', cand(), { bytes: BYTES, cutoff: 2022 }],
  ];

  for (const [label, input, options] of badInputs) {
    it(`reports bad-input for ${label}`, () => {
      let result;
      assert.doesNotThrow(() => {
        result = screenCandidate(input, options);
      });
      assert.equal(result.ok, false);
      assert.deepEqual(result.reasons, ['bad-input']);
    });
  }

  it('treats null options as the defaults', () => {
    assert.deepEqual(screenCandidate(cand(), null), { ok: false, reasons: ['no-bytes'] });
  });
});
