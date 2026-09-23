import json
import os
import re
import sys
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio


def estimate_segment_pitch(audio_segment: np.ndarray, sr: int = 16000) -> float:
    if len(audio_segment) < sr * 0.25:
        return 0.0
    frame_size = 1024
    hop_size = 512
    min_lag = int(sr / 380)  # ~42 samples (380 Hz)
    max_lag = int(sr / 75)   # ~213 samples (75 Hz)

    total_possible_frames = (len(audio_segment) - frame_size) // hop_size
    if total_possible_frames <= 0:
        return 0.0

    # Sample up to 16 representative frames evenly across the segment
    max_frames = 16
    if total_possible_frames > max_frames:
        step = total_possible_frames / max_frames
        frame_starts = [int(i * step) * hop_size for i in range(max_frames)]
    else:
        frame_starts = range(0, len(audio_segment) - frame_size, hop_size)

    pitches = []
    for start_idx in frame_starts:
        frame = audio_segment[start_idx:start_idx + frame_size].astype(np.float32)
        frame -= np.mean(frame)
        energy = np.sum(frame ** 2)
        if energy < 1e-4:
            continue
        corr = np.correlate(frame, frame, mode='full')
        corr = corr[len(frame) - 1:]
        if len(corr) <= max_lag:
            continue
        search_window = corr[min_lag:max_lag]
        if len(search_window) == 0:
            continue
        peak_idx = int(np.argmax(search_window)) + min_lag
        peak_val = corr[peak_idx]
        if corr[0] > 0 and (peak_val / corr[0]) > 0.32:  # Voiced frame threshold
            pitches.append(sr / peak_idx)

    if len(pitches) >= 2:
        return float(np.median(pitches))
    return 0.0


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit('Bitte Pfad zur Audio-Datei übergeben.')

    input_path = Path(sys.argv[1])
    hotwords_arg = sys.argv[2] if len(sys.argv) > 2 else 'äh, ehm, ähm, öh, hm'
    base_hotwords = {'äh', 'ehm', 'ähm', 'öh', 'hm'}
    user_words = {w.strip() for w in hotwords_arg.split(',') if w.strip()}
    all_hotwords = ', '.join(sorted(base_hotwords.union(user_words)))

    audio_samples = None
    try:
        audio_samples = decode_audio(str(input_path), sampling_rate=16000)
    except Exception as e:
        sys.stderr.write(f'Audio decode warning: {e}\n')

    threads = max(1, min(4, os.cpu_count() or 2))
    model = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=threads)
    segments, info = model.transcribe(
        str(input_path),
        language='de',
        beam_size=1,
        best_of=1,
        vad_filter=False,
        word_timestamps=True,
        temperature=0,
        hotwords=all_hotwords,
        condition_on_previous_text=False,
        no_speech_threshold=None,
        log_prob_threshold=None,
        compression_ratio_threshold=None,
        initial_prompt='Transkribiere absolut wörtlich inklusive aller Füllwörter und Pausenlaute: Äh, also, ähm, wir haben, öh, gesprochen.',
    )

    sys.stdout.write(json.dumps({'type': 'info', 'duration': info.duration, 'language': info.language}, ensure_ascii=False) + '\n')
    sys.stdout.flush()

    segment_data = []
    text_parts = []
    for segment in segments:
        pitch = 0.0
        if audio_samples is not None:
            start_samp = max(0, int(segment.start * 16000))
            end_samp = min(len(audio_samples), int(segment.end * 16000))
            if end_samp > start_samp:
                pitch = estimate_segment_pitch(audio_samples[start_samp:end_samp], sr=16000)

        cleaned_text = re.sub(r'\b(\w+)(?:\s+\1){2,}\b', r'\1 \1', segment.text, flags=re.IGNORECASE).strip()
        text_parts.append(cleaned_text)

        s_obj = {
            'start': segment.start,
            'end': segment.end,
            'text': cleaned_text,
            'pitch': round(pitch, 1),
        }
        segment_data.append(s_obj)
        sys.stdout.write(json.dumps({'type': 'segment', 'segment': s_obj}, ensure_ascii=False) + '\n')
        sys.stdout.flush()

    text = ' '.join(s.strip() for s in text_parts if s.strip())
    data = {
        'type': 'done',
        'text': text,
        'duration': info.duration,
        'segments': segment_data,
    }
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + '\n')
    sys.stdout.flush()


if __name__ == '__main__':
    main()
