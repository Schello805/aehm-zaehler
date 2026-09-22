import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit('Bitte Pfad zur Audio-Datei übergeben.')

    input_path = Path(sys.argv[1])
    hotwords_arg = sys.argv[2] if len(sys.argv) > 2 else 'äh, ehm, ähm, öh, hm'
    base_hotwords = {'äh', 'ehm', 'ähm', 'öh', 'hm'}
    user_words = {w.strip() for w in hotwords_arg.split(',') if w.strip()}
    all_hotwords = ', '.join(sorted(base_hotwords.union(user_words)))

    model = WhisperModel('small', device='cpu', compute_type='int8')
    segments, info = model.transcribe(
        str(input_path),
        language='de',
        beam_size=5,
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

    segment_data = []
    text_parts = []
    for segment in segments:
        text_parts.append(segment.text)
        segment_data.append({
            'start': segment.start,
            'end': segment.end,
            'text': segment.text.strip(),
        })

    text = ' '.join(s.strip() for s in text_parts if s.strip())
    data = {
        'text': text,
        'duration': info.duration,
        'segments': segment_data,
    }
    print(json.dumps(data, ensure_ascii=False))


if __name__ == '__main__':
    main()
