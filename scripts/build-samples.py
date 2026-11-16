#!/usr/bin/env python3
"""楽器の音源(サンプル)を作る。

FluidR3_GM(MITライセンス、Frank Wen 氏)から、アプリで使う楽器の音を1音ずつ録音し、
楽器ごとに1つのファイル(.pack)にまとめる。3半音おきに録り、間の高さはアプリが再生速度で作る。

必要なもの: fluidsynth、ffmpeg、FluidR3_GM.sf2(Ubuntu/Debian なら apt install fluidsynth fluid-soundfont-gm ffmpeg)
使い方: python3 scripts/build-samples.py [出力先=sounds-build]

.pack の形: 先頭4バイト(リトルエンディアン)=見出しの長さ、続いて見出し(JSON)、続いて MP3 を並べたもの。
見出し: { "notes": [ { "pitch": 60, "offset": 0, "length": 12345 }, ... ] }  offset は MP3 部分の先頭から
"""
import json, os, struct, subprocess, sys, tempfile, wave
import numpy as np

SF2 = os.environ.get('SF2', '/usr/share/sounds/sf2/FluidR3_GM.sf2')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'sounds-build'
RATE = 44100

# id: (GMの音色番号, 一番低い音, 一番高い音, 鍵盤を押している秒数, 1音あたりの録音枠の秒数)
INSTRUMENTS = {
    'piano': (0, 33, 99, 3.0, 7.0),
    'acoustic-guitar': (25, 38, 86, 2.5, 6.0),
    'electric-guitar-clean': (27, 38, 86, 2.5, 6.0),
    'electric-guitar-distortion': (30, 38, 80, 3.5, 5.5),
    'bass': (33, 26, 58, 3.0, 5.0),
    'strings': (48, 45, 99, 7.0, 9.0),
    'bell': (10, 57, 99, 1.5, 5.0),
}
# ドラム(General MIDI の標準キット)。番号: 秒
DRUMS = {35: 1.5, 36: 1.5, 37: 1.0, 38: 1.5, 39: 1.5, 40: 1.5, 41: 2.0, 42: 1.0, 43: 2.0, 44: 1.0, 45: 2.0,
         46: 2.5, 47: 2.0, 48: 2.0, 49: 5.0, 50: 2.0, 51: 4.0}
STEP = 3  # 何半音おきに録るか


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.insert(0, (n & 0x7F) | 0x80)
        n >>= 7
    return bytes(out)


def midi_file(events):
    """events: (秒, バイト列) の並び。テンポ120・480ティック/拍 → 1秒=960ティック"""
    events = sorted(events, key=lambda e: e[0])
    body = b'\x00\xff\x51\x03\x07\xa1\x20'
    last = 0
    for t, data in events:
        tick = round(t * 960)
        body += vlq(tick - last) + data
        last = tick
    body += b'\x00\xff\x2f\x00'
    return b'MThd' + struct.pack('>IHHH', 6, 0, 1, 480) + b'MTrk' + struct.pack('>I', len(body)) + body


def render(events, seconds):
    with tempfile.TemporaryDirectory() as d:
        mid, wav = os.path.join(d, 'a.mid'), os.path.join(d, 'a.wav')
        open(mid, 'wb').write(midi_file(events + [(seconds, b'\xb0\x7b\x00')]))
        subprocess.run(['fluidsynth', '-ni', '-q', '-r', str(RATE), '-g', '0.6',
                        '-o', 'synth.reverb.active=0', '-o', 'synth.chorus.active=0', '-F', wav, SF2, mid],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        w = wave.open(wav)
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        return data.reshape(-1, w.getnchannels()).mean(axis=1)


def to_mp3(samples):
    with tempfile.TemporaryDirectory() as d:
        wav, mp3 = os.path.join(d, 'a.wav'), os.path.join(d, 'a.mp3')
        w = wave.open(wav, 'wb')
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
        w.close()
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-b:a', '96k', mp3], check=True)
        return open(mp3, 'rb').read()


def build(name, slots, events, total):
    """slots: (番号, 開始秒, 枠の秒数)"""
    audio = render(events, total)
    peak = float(np.abs(audio).max()) or 1.0
    audio = audio * (0.9 / peak)  # 楽器ごとに一番大きい音を 0.9 にそろえる
    notes, blobs, offset = [], [], 0
    for pitch, start, length in slots:
        a = audio[int(start * RATE):int((start + length) * RATE)]
        loud = np.nonzero(np.abs(a) > 0.0015)[0]
        if len(loud) == 0:
            continue
        a = a[:min(len(a), loud[-1] + int(0.03 * RATE))].copy()
        fade = min(len(a), int(0.02 * RATE))
        a[-fade:] *= np.linspace(1, 0, fade)
        mp3 = to_mp3(a)
        notes.append({'pitch': pitch, 'offset': offset, 'length': len(mp3)})
        blobs.append(mp3)
        offset += len(mp3)
    header = json.dumps({'notes': notes}, separators=(',', ':')).encode()
    path = os.path.join(OUT, f'{name}.pack')
    with open(path, 'wb') as f:
        f.write(struct.pack('<I', len(header)) + header + b''.join(blobs))
    print(f'{name}: {len(notes)} 音, {os.path.getsize(path) / 1024:.0f} KB')


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (program, low, high, hold, slot) in INSTRUMENTS.items():
        events, slots, t = [(0, bytes([0xC0, program]))], [], 0.5
        for pitch in range(low, high + 1, STEP):
            events += [(t, bytes([0x90, pitch, 100])), (t + hold, bytes([0x80, pitch, 0]))]
            slots.append((pitch, t, slot))
            t += slot
        build(name, slots, events, t + 1)
    events, slots, t = [], [], 0.5
    for pitch, slot in DRUMS.items():
        events += [(t, bytes([0x99, pitch, 110])), (t + 0.3, bytes([0x89, pitch, 0]))]
        slots.append((pitch, t, slot))
        t += slot
    build('drums', slots, events, t + 1)


main()
