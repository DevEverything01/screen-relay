"""Deterministic 1280x720 native X11 workload; --self-check needs no display."""
import json
from pathlib import Path
import sys
import time

CASES = ('idle', 'scroll', 'window', 'video', 'mixed')
LINE = 'The quick brown fox 0123456789 Il1 O0 {} [] () != <= @example.org'


def parse(value):
    words = value.split()
    return (words[0], 'fps' in words[1:], 'freeze' in words[1:]) if words and words[0] in CASES else None


def bits(frame):
    return [0, 1] + [(frame >> i) & 1 for i in range(12)]


def texture(index):
    from PIL import Image
    im = Image.new('RGB', (320, 180))
    im.putdata([((x*7+y*3+index*19)%256, (x*3+y*11+index*29)%256,
                 ((x^y)*13+index*37)%256) for y in range(180) for x in range(320)])
    return im.resize((1280, 720), Image.Resampling.BILINEAR)


def ppm(index):
    return b'P6\n1280 720\n255\n' + texture(index).tobytes()


def main():
    import tkinter as tk
    root = tk.Tk()
    root.title('Desktop streaming lab qualification')
    root.overrideredirect(True)
    root.geometry('1280x720+0+0')
    canvas = tk.Canvas(root, width=1280, height=720, highlightthickness=0, bg='#f7f7fa')
    canvas.pack()
    images = [tk.PhotoImage(data=ppm(i), format='PPM') for i in range(12)]
    moving = tk.Toplevel(root)
    moving.overrideredirect(True)
    moving.configure(bg='#19334d')
    tk.Label(moving, text='REAL X11 TOPLEVEL WINDOW', fg='white', bg='#19334d',
             font=('DejaVu Sans', 18, 'bold')).pack(pady=25)
    tk.Label(moving, text=LINE, fg='white', bg='#19334d').pack()
    moving.withdraw()
    state = dict(mode='idle', flash=False, toggles=0, frame=0, fps_marker=False,
                 frozen=False, producer_hz=30, submitted_updates=0)
    phase = 0
    last = ''
    status = Path('/tmp/bench-status.json')

    def publish():
        state.update(time_ns=time.monotonic_ns(), x=canvas.winfo_rootx(), y=canvas.winfo_rooty())
        if state['mode'] == 'window':
            state['window_geometry'] = moving.geometry()
        tmp = status.with_suffix('.tmp')
        tmp.write_text(json.dumps(state))
        tmp.replace(status)

    def toggle(event=None):
        state['flash'] = not state['flash']
        state['toggles'] += 1
        probes()
        if state['mode'] == 'window':
            moving.lift()
        publish()

    def probes():
        canvas.delete('probe')
        canvas.create_rectangle(0, 532, 1280, 600, fill='#f7f7fa', outline='', tags='probe')
        canvas.create_rectangle(1000, 540, 1100, 590,
                                fill='#00dd33' if state['flash'] else '#dd0033', outline='', tags=('probe','flash'))
        canvas.tag_bind('flash', '<Button-1>', toggle)
        if state['fps_marker']:
            for left, top in ((24,540),(1144,700)):
                for i, bit in enumerate(bits(state['frame'])):
                    canvas.create_rectangle(left+i*8, top, left+8+i*8, top+12,
                                            fill='white' if bit else 'black', outline='', tags='probe')

    def base():
        canvas.delete('all')
        canvas.create_text(24, 24, anchor='nw', text='NATIVE QUALIFICATION / '+state['mode'].upper(),
                           font=('DejaVu Sans',18,'bold'))
        canvas.create_text(24,65,anchor='nw',text='1280 x 720 / 30 Hz / deterministic native X11 workloads')
        for i, size in enumerate((9,10,11,12,14,16)):
            canvas.create_text(24,105+i*32,anchor='nw',text=f'{size:2} pt {LINE}',
                               font=('DejaVu Sans Mono',size),fill='#101820')
        canvas.create_text(24,310,anchor='nw',text='Color text: red #e02030 / blue #2050e0 / green #208030',
                           font=('DejaVu Sans Mono',13),fill='#2050e0')

    def draw():
        canvas.delete('dynamic')
        mode = state['mode']
        if mode == 'video':
            canvas.create_image(0,0,anchor='nw',image=images[phase%12],tags='dynamic')
            canvas.create_text(24,24,anchor='nw',text='SYNTHETIC TEXTURED VIDEO / NOT NATURAL FOOTAGE',
                               fill='white',font=('DejaVu Sans',18,'bold'),tags='dynamic')
        elif mode == 'scroll':
            canvas.create_rectangle(0,90,1280,720,fill='white',outline='',tags='dynamic')
            for row in range(29):
                canvas.create_text(24,90+row*23-phase*7%23,anchor='nw',
                                   text=f'{phase*7//23+row:06} {LINE}   {LINE[:38]}',
                                   font=('DejaVu Sans Mono',12),
                                   fill=('#17212d','#2050a0','#962030')[row%3],tags='dynamic')
        elif mode == 'mixed':
            for i in range(28):
                x = 24+(phase*11+i*43)%1180
                y = 365+i%5*30
                canvas.create_rectangle(x,y,x+55,y+23,fill=('#2463eb','#df2b52','#22a070','#e1aa24')[i%4],
                                        outline='',tags='dynamic')
        elif mode == 'window':
            moving.geometry(f'420x160+{30+phase*9%820}+{345+phase*3%25}')
            moving.lift()
        probes()

    def choose(command):
        nonlocal phase
        mode, fps, frozen = command
        if mode != state['mode']:
            phase = 0
        state.update(mode=mode,fps_marker=fps,frozen=frozen)
        moving.deiconify() if mode == 'window' else moving.withdraw()
        base()
        draw()
        root.update_idletasks()
        publish()

    def tick():
        nonlocal phase, last
        started = time.monotonic()
        try:
            value = Path('/tmp/bench-mode').read_text().strip()
        except FileNotFoundError:
            value = ''
        if value != last:
            last = value
            command = parse(value)
            if command:
                choose(command)
        if not state['frozen'] and (state['mode'] != 'idle' or state['fps_marker']):
            phase += 1
            state['frame'] += 1
            state['submitted_updates'] += 1
            draw()
        root.update_idletasks()
        publish()
        root.after(max(1,round((1/30-(time.monotonic()-started))*1000)),tick)

    root.bind('<F8>',toggle)
    choose(('idle',False,False))
    root.after(100,root.focus_force)
    tick()
    root.mainloop()


if __name__ == '__main__':
    if '--self-check' in sys.argv:
        assert parse('scroll fps nonce') == ('scroll',True,False)
        assert parse('video freeze nonce') == ('video',False,True)
        assert parse('invalid nonce') is None
        assert bits(4097) == bits(1)
        assert bits(0)[:2] == [0,1]
        assert texture(4).tobytes() == texture(4).tobytes()
        assert texture(4).tobytes() != texture(5).tobytes()
        header, dimensions, maximum, pixels = ppm(4).split(b'\n', 3)
        assert (header, dimensions, maximum) == (b'P6', b'1280 720', b'255')
        assert len(pixels) == 1280 * 720 * 3
        assert pixels[:3] == bytes((76, 116, 148))
        print('fixture self-check passed')
    else:
        main()
