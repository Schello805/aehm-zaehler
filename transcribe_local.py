import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit('Bitte Pfad zur Audio-Datei übergeben.')

    input_path = Path(sys.argv[1])
    model = WhisperModel('small', device='cpu', compute_type='int8')
    segments, info = model.transcribe(
        str(input_path),
        language='de',
        beam_size=4,
        vad_filter=False,
        word_timestamps=True,
        temperature=0,
        initial_prompt='Behalte kurze deutsche Fülllaute wie äh und ähm wörtlich bei.',
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

    text = ''.join(text_parts)
    data = {
        'text': text,
        'duration': info.duration,
        'segments': segment_data,
    }
    print(json.dumps(data, ensure_ascii=False))


if __name__ == '__main__':
    main()
