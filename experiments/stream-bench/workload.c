/**
 * Deterministic X11 workload generator for stream-bench. Every frame is drawn with one
 * XShmPutImage so a capture never sees half a frame, and every changed rectangle carries a
 * 16-bit barcode (2-bit phase, 14-bit index) so decoded frames can be matched to `--dump`
 * reference images.
 */
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/XShm.h>
#include <sys/shm.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define W 1280
#define H 720
#define PAGE_H 4096
#define BAR_BLOCK 12
#define BAR_BITS 16

enum { PHASE_NONE = 0, PHASE_TYPING = 1, PHASE_SCROLL = 2, PHASE_MOTION = 3, PHASE_FINAL = 4 };

typedef struct { int x, y, w, h; } Rect;
static const Rect typing_rect = {320, 300, 640, 48};
static const Rect scroll_rect = {240, 60, 960, 620};
static const Rect full_rect = {0, 0, W, H};

static uint32_t *page;
static uint8_t sin_a[512], sin_b[512], sin_c[1024], texture[256 * 256];
static uint32_t palette[768];

/** SplitMix64 step used for every pseudo-random choice. */
static uint64_t mix(uint64_t x) {
  x += 0x9e3779b97f4a7c15ull;
  x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ull;
  x = (x ^ (x >> 27)) * 0x94d049bb133111ebull;
  return x ^ (x >> 31);
}

/** Draws one 5x7 pseudo-glyph scaled by `scale`; glyph bits come from the character code. */
static void glyph(uint32_t *fb, int stride, int x, int y, unsigned c, uint32_t fg, int scale, int clip_w, int clip_h) {
  if (c == ' ') return;
  const uint64_t bits = mix(c * 7919u + 13u);
  for (int gy = 0; gy < 7; ++gy)
    for (int gx = 0; gx < 5; ++gx) {
      if (!((bits >> (gy * 5 + gx)) & 1)) continue;
      for (int sy = 0; sy < scale; ++sy)
        for (int sx = 0; sx < scale; ++sx) {
          const int px = x + gx * scale + sx, py = y + gy * scale + sy;
          if (px >= 0 && py >= 0 && px < clip_w && py < clip_h) fb[py * stride + px] = fg;
        }
    }
}

/** Character `n` of a deterministic word stream identified by `seed`. */
static unsigned text_char(uint64_t seed, unsigned n) {
  const uint64_t r = mix(seed * 1000003u + n / 6);
  if (n % 6 == 5 || (r & 7) == 0) return ' ';
  return 'a' + (unsigned)(mix(seed + n) % 26);
}

static uint32_t text_color(uint64_t seed, unsigned word) {
  static const uint32_t colors[] = {0x202020, 0x202020, 0x202020, 0x202020, 0xc0392b, 0x1e8449, 0x2e5cb8, 0x8e44ad};
  return colors[mix(seed * 31 + word) % 8];
}

static void text_line(uint32_t *fb, int stride, int x, int y, uint64_t seed, unsigned len, int scale, int clip_w, int clip_h) {
  for (unsigned n = 0; n < len; ++n)
    glyph(fb, stride, x + (int)n * 6 * scale, y, text_char(seed, n), text_color(seed, n / 6), scale, clip_w, clip_h);
}

static void fill(uint32_t *fb, int stride, int x, int y, int w, int h, uint32_t color) {
  for (int row = y; row < y + h; ++row)
    for (int col = x; col < x + w; ++col) fb[row * stride + col] = color;
}

static void barcode(uint32_t *fb, int stride, int phase, unsigned index) {
  const unsigned value = ((unsigned)phase << 14) | (index & 0x3fff);
  for (int bit = 0; bit < BAR_BITS; ++bit)
    fill(fb, stride, bit * BAR_BLOCK, 0, BAR_BLOCK, BAR_BLOCK, ((value >> (15 - bit)) & 1) ? 0x000000 : 0xffffff);
}

/** Full-screen desktop-like image: title bar, colored sidebar and lines of mixed-color text. */
static void desktop(uint32_t *fb, uint64_t seed) {
  fill(fb, W, 0, 0, W, H, 0xf4f4f4);
  fill(fb, W, 0, 0, W, 28, 0x2b2b2b);
  for (int i = 0; i < 6; ++i) text_line(fb, W, 12 + i * 160, 8, seed * 7 + i, 18, 1, W, H);
  fill(fb, W, 0, 28, 200, H - 28, 0x3c78d8);
  for (int row = 0; row < 40; ++row)
    for (unsigned n = 0; n < 24; ++n)
      glyph(fb, W, 12 + (int)n * 7, 44 + row * 16, text_char(seed * 11 + row, n), 0xffffff, 1, 200, H);
  fill(fb, W, 210, 38, W - 220, H - 48, 0xffffff);
  for (int row = 0; row < 48; ++row) {
    const unsigned len = 60 + (unsigned)(mix(seed * 17 + row) % 110);
    text_line(fb, W, 222, 46 + row * 14, seed * 101 + row, len, 1, W - 12, H - 10);
  }
}

static void init_tables(void) {
  page = malloc(sizeof(uint32_t) * (size_t)scroll_rect.w * PAGE_H);
  fill(page, scroll_rect.w, 0, 0, scroll_rect.w, PAGE_H, 0xffffff);
  for (int row = 0; row < PAGE_H / 16; ++row) {
    if (row % 12 == 0) {
      fill(page, scroll_rect.w, 8, row * 16 + 2, scroll_rect.w - 16, 12, 0xe8eef8);
      text_line(page, scroll_rect.w, 12, row * 16 + 4, 5000 + row, 60, 1, scroll_rect.w, PAGE_H);
      continue;
    }
    const unsigned len = 40 + (unsigned)(mix(row * 3 + 1) % 110);
    text_line(page, scroll_rect.w, 16, row * 16 + 4, 9000 + row, len, 1, scroll_rect.w - 8, PAGE_H);
  }
  for (int i = 0; i < 512; ++i) {
    sin_a[i] = (uint8_t)(127.5 + 127.5 * sin(i * 2 * M_PI / 512));
    sin_b[i] = (uint8_t)(127.5 + 127.5 * sin(i * 4 * M_PI / 512 + 1.3));
  }
  for (int i = 0; i < 1024; ++i) sin_c[i] = (uint8_t)(127.5 + 127.5 * sin(i * 6 * M_PI / 1024 + 0.7));
  for (int i = 0; i < 256 * 256; ++i) texture[i] = (uint8_t)(mix((uint64_t)i) & 63);
  for (int i = 0; i < 768; ++i) {
    const double t = i * 2 * M_PI / 768;
    const unsigned r = (unsigned)(128 + 100 * sin(t)), g = (unsigned)(128 + 100 * sin(t + 2.1)), b = (unsigned)(128 + 100 * sin(t + 4.2));
    palette[i] = (r << 16) | (g << 8) | b;
  }
}

/** Renders the changed rectangle of `phase` frame `index` into `out` (stride = rect width). */
static Rect render(int phase, unsigned index, uint32_t *out) {
  if (phase == PHASE_TYPING) {
    const Rect r = typing_rect;
    fill(out, r.w, 0, 0, r.w, r.h, 0xffffff);
    const unsigned typed = index % 50, line = index / 50;
    text_line(out, r.w, 8, 20, 300 + line, typed, 2, r.w, r.h);
    fill(out, r.w, 8 + (int)typed * 12, 18, 2, 18, 0x000000);
    barcode(out, r.w, phase, index);
    return r;
  }
  if (phase == PHASE_SCROLL) {
    const Rect r = scroll_rect;
    const unsigned offset = (index * 4) % (PAGE_H - r.h);
    memcpy(out, page + (size_t)offset * r.w, sizeof(uint32_t) * (size_t)r.w * r.h);
    barcode(out, r.w, phase, index);
    return r;
  }
  if (phase == PHASE_MOTION) {
    const unsigned t = index;
    for (int y = 0; y < H; ++y) {
      uint32_t *row = out + y * W;
      const unsigned by = sin_b[(y + t * 2) & 511];
      const uint8_t *tex = texture + ((y + t) & 255) * 256;
      for (int x = 0; x < W; ++x) {
        const unsigned v = sin_a[(x + t * 3) & 511] + by + sin_c[(x + y + t * 5) & 1023] + tex[(x + t * 2) & 255];
        row[x] = palette[v % 768];
      }
    }
    const int px = 80 + (int)((t * 5) % 700), py = 120 + (int)(150 + 120 * sin(t * 0.05));
    for (int y = 0; y < 300; ++y)
      memcpy(out + (py + y) * W + px, page + (size_t)((y + t * 2) % (PAGE_H - 300)) * scroll_rect.w,
             sizeof(uint32_t) * 400);
    barcode(out, W, phase, index);
    return full_rect;
  }
  desktop(out, phase == PHASE_FINAL ? 77 : 1);
  return full_rect;
}

/** Full-screen reference for `phase` frame `index`: background plus that frame's rectangle. */
static void reference(int phase, unsigned index, uint32_t *fb, uint32_t *scratch) {
  if (phase == PHASE_TYPING || phase == PHASE_SCROLL) {
    desktop(fb, 1);
    const Rect r = render(phase, index, scratch);
    for (int y = 0; y < r.h; ++y) memcpy(fb + (r.y + y) * W + r.x, scratch + y * r.w, sizeof(uint32_t) * r.w);
    return;
  }
  render(phase, index, fb);
}

static double now(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec + ts.tv_nsec / 1e9;
}

static int phase_of(const char *name) {
  if (!strcmp(name, "typing")) return PHASE_TYPING;
  if (!strcmp(name, "scroll")) return PHASE_SCROLL;
  if (!strcmp(name, "motion")) return PHASE_MOTION;
  if (!strcmp(name, "final")) return PHASE_FINAL;
  if (!strcmp(name, "background")) return PHASE_NONE;
  fprintf(stderr, "unknown phase %s\n", name);
  exit(2);
}

int main(int argc, char **argv) {
  if (argc >= 3 && !strcmp(argv[1], "--dump")) {
    init_tables();
    uint32_t *fb = malloc(sizeof(uint32_t) * W * H), *scratch = malloc(sizeof(uint32_t) * W * H);
    FILE *out = fopen(argv[2], "wb");
    if (!out) { perror("dump"); return 1; }
    for (int i = 3; i + 1 < argc; i += 2) {
      reference(phase_of(argv[i]), (unsigned)atoi(argv[i + 1]), fb, scratch);
      fwrite(fb, sizeof(uint32_t), W * H, out);
    }
    fclose(out);
    return 0;
  }
  if (argc < 2) {
    fprintf(stderr, "usage: workload PHASE [HZ SECONDS TIMESTAMP_FILE] | --dump FILE PHASE INDEX...\n");
    return 2;
  }
  const int phase = phase_of(argv[1]);
  const double hz = argc > 2 ? atof(argv[2]) : 0, seconds = argc > 3 ? atof(argv[3]) : 0;
  init_tables();
  Display *display = XOpenDisplay(NULL);
  if (!display || !XShmQueryExtension(display)) { fprintf(stderr, "X display with MIT-SHM required\n"); return 1; }
  const int screen = DefaultScreen(display);
  XShmSegmentInfo shm;
  XImage *image = XShmCreateImage(display, DefaultVisual(display, screen), 24, ZPixmap, NULL, &shm, W, H);
  shm.shmid = shmget(IPC_PRIVATE, (size_t)image->bytes_per_line * H, IPC_CREAT | 0600);
  shm.shmaddr = image->data = shmat(shm.shmid, NULL, 0);
  shm.readOnly = False;
  XShmAttach(display, &shm);
  XSync(display, False);
  shmctl(shm.shmid, IPC_RMID, NULL);
  const Window root = RootWindow(display, screen);
  const GC gc = DefaultGC(display, screen);
  uint32_t *pixels = (uint32_t *)image->data;
  FILE *stamps = argc > 4 ? fopen(argv[4], "w") : NULL;
  unsigned drawn = 0, skipped = 0;
  const double start = now();
  for (unsigned index = 0;; ++index) {
    if (hz > 0) {
      const double due = start + index / hz;
      double t = now();
      if (t - start >= seconds) break;
      if (t < due) {
        const double wait = due - t;
        struct timespec ts = {(time_t)wait, (long)((wait - (time_t)wait) * 1e9)};
        nanosleep(&ts, NULL);
      } else if (t > due + 1 / hz) {
        const unsigned next = (unsigned)((t - start) * hz);
        skipped += next - index;
        index = next;
      }
    }
    const Rect r = render(phase, index, pixels);
    image->width = r.w;
    image->bytes_per_line = r.w * 4;
    XShmPutImage(display, root, gc, image, 0, 0, r.x, r.y, r.w, r.h, False);
    XSync(display, False);
    ++drawn;
    if (stamps) fprintf(stamps, "%.6f %u\n", now(), index);
    if (hz <= 0) break;
  }
  if (stamps) fclose(stamps);
  printf("{\"drawn\":%u,\"skipped\":%u}\n", drawn, skipped);
  XShmDetach(display, &shm);
  XCloseDisplay(display);
  return 0;
}
