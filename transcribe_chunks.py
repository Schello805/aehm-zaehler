"""Resumable, sequential faster-whisper worker for ffmpeg-created audio chunks."""

import gc
import json
import os
import re
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

from transcribe_local import estimate_segment_pitch, safe_float


FILLER_SPELLINGS = {
    'äh', 'aeh', 'ah', 'ähh', 'ähhh', 'ää', 'äääh', 'uh',
    'ähm', 'aehm', 'ehm', 'äm', 'aem', 'öhm', 'oehm', 'uhm', 'erm',
    'äähm', 'ähmm', 'ähmmm', 'ääähm', 'eehm', 'eem',
    'öh', 'hm', 'hmm', 'hmmm', 'hmmmm', 'mhm', 'mm', 'mmm', 'mmmm', 'em',
}


def emit(data: dict) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False, allow_nan=False) + '\n')
    sys.stdout.flush()


def load_model() -> WhisperModel:
    model_name = os.environ.get('WHISPER_MODEL', 'small').strip() or 'small'
    try:
        raw_threads = int(os.environ.get('WHISPER_THREADS', '2').strip())
    except (ValueError, TypeError):
        raw_threads = 2
    threads = max(1, min(raw_threads, os.cpu_count() or 2))
    sys.stderr.write(f'Whisper Inferenz-Konfiguration: Modell={model_name}, CPU-Kerne={threads}\n')
    return WhisperModel(model_name, device='cpu', compute_type='int8', cpu_threads=threads)


def checkpoint_is_valid(checkpoint_path: str) -> bool:
    try:
        checkpoint_data = json.loads(Path(checkpoint_path).read_text(encoding='utf-8'))
        return isinstance(checkpoint_data.get('segments'), list)
    except (OSError, AttributeError, json.JSONDecodeError):
        return False


def transcribe_chunk(model: WhisperModel, chunk: dict, hotwords: str) -> list:
    chunk_path = Path(chunk['path'])
    audio_samples = None
    try:
        if chunk_path.stat().st_size < 5 * 1024 * 1024:
            audio_samples = decode_audio(str(chunk_path), sampling_rate=16000)
    except Exception as exc:
        sys.stderr.write(f"Audio decode warning in Abschnitt {chunk.get('index', '?')}: {exc}\n")

    options = {
        'beam_size': 1,
        'best_of': 1,
        'vad_filter': True,
        'word_timestamps': True,
        'temperature': 0,
        'condition_on_previous_text': False,
        'no_speech_threshold': None,
        'log_prob_threshold': None,
        'compression_ratio_threshold': None,
        'initial_prompt': 'Transkribiere den Inhalt wortgetreu. Erfinde keine Wörter und ersetze keine kurzen deutschen Wörter durch andere Wörter.',
    }
    if hotwords:
        options['hotwords'] = hotwords
    segments, _info = model.transcribe(str(chunk_path), **options)

    output = []
    for segment in segments:
        pitch = 0.0
        if audio_samples is not None:
            start_sample = max(0, int(segment.start * 16000))
            end_sample = min(len(audio_samples), int(segment.end * 16000))
            if end_sample > start_sample:
                pitch = estimate_segment_pitch(audio_samples[start_sample:end_sample], sr=16000)

        cleaned_text = str(segment.text or '').strip()
        words_data = []
        segment_words = getattr(segment, 'words', None)
        if segment_words is not None:
            for word in segment_words:
                word_text = word.word.strip()
                word_clean = re.sub(r'^[^\w]+|[^\w]+$', '', word_text).casefold()
                probability = safe_float(getattr(word, 'probability', 1.0), 1.0)
                # Prefer precision: an uncertain filler hypothesis must not inflate the count.
                if word_clean in FILLER_SPELLINGS and probability < 0.65:
                    continue
                words_data.append({
                    'start': round(safe_float(word.start), 3),
                    'end': round(safe_float(word.end), 3),
                    'word': word_text,
                    'clean': word_clean,
                    'prob': round(probability, 2),
                })
            cleaned_text = ' '.join(word['word'] for word in words_data).strip()

        output.append({
            'start': round(safe_float(segment.start), 3),
            'end': round(safe_float(segment.end), 3),
            'text': cleaned_text,
            'pitch': round(safe_float(pitch), 1),
            'words': words_data,
        })
        if len(output) % 40 == 0:
            gc.collect()
    return output


def load_or_transcribe(model: WhisperModel, chunk: dict, hotwords: str) -> tuple[list, bool]:
    checkpoint = Path(chunk['checkpoint'])
    if checkpoint.exists():
        try:
            data = json.loads(checkpoint.read_text(encoding='utf-8'))
            return data['segments'], True
        except (OSError, KeyError, json.JSONDecodeError):
            checkpoint.unlink(missing_ok=True)

    failure = None
    for attempt in range(2):
        try:
            segments = transcribe_chunk(model, chunk, hotwords)
            checkpoint.parent.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile('w', encoding='utf-8', dir=checkpoint.parent, delete=False) as temp_file:
                json.dump({'segments': segments}, temp_file, ensure_ascii=False, allow_nan=False)
                temporary_path = Path(temp_file.name)
            os.replace(temporary_path, checkpoint)
            return segments, False
        except Exception as exc:
            failure = exc
            sys.stderr.write(f"Abschnitt {chunk.get('index', '?')} fehlgeschlagen (Versuch {attempt + 1}/2): {exc}\n")
    raise RuntimeError(f"Abschnitt {chunk.get('index', '?')} konnte nach zwei Versuchen nicht verarbeitet werden: {failure}")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit('Bitte Manifest mit Audioabschnitten angeben.')
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    chunks = manifest.get('chunks', [])
    duration = safe_float(manifest.get('duration'))
    raw_words = sys.argv[2] if len(sys.argv) > 2 else ''

    # Fülllaute als Hotwords begünstigen Verwechslungen mit kurzen Wörtern wie „es“.
    user_words = {word.strip() for word in raw_words.split(',') if word.strip()}
    hotwords = ', '.join(sorted(word for word in user_words if word.casefold() not in FILLER_SPELLINGS))
    model = None
    if any(not checkpoint_is_valid(chunk['checkpoint']) for chunk in chunks):
        model = load_model()

    emit({'type': 'info', 'duration': duration})
    for index, chunk in enumerate(chunks):
        chunk['index'] = index
        segments, cached = load_or_transcribe(model, chunk, hotwords)
        offset = safe_float(chunk.get('offset'))
        for segment in segments:
            output_segment = dict(segment)
            output_segment['start'] = round(safe_float(segment.get('start')) + offset, 3)
            output_segment['end'] = round(safe_float(segment.get('end')) + offset, 3)
            output_segment['words'] = [
                {**word,
                 'start': round(safe_float(word.get('start')) + offset, 3),
                 'end': round(safe_float(word.get('end')) + offset, 3)}
                for word in segment.get('words', [])
            ]
            emit({'type': 'segment', 'segment': output_segment})
        emit({'type': 'chunk', 'index': index, 'cached': cached})
    emit({'type': 'done', 'duration': duration})


if __name__ == '__main__':
    main()
