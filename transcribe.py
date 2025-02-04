import whisper
import argparse
import os

def transcribe_audio(file_path, language="ru"):
    if not os.path.exists(file_path):
        print(f"Файл не найден: {file_path}")
        return ""

    try:
        print("Загрузка модели Whisper...")
        model = whisper.load_model("medium")  # Используйте medium или large
        print(f"Модель загружена. Начало транскрипции на языке: {language}...")
        result = model.transcribe(file_path, language=language)
        print("Транскрипция завершена.")
        return result["text"]
    except Exception as e:
        print(f"Ошибка при транскрипции: {e}")
        return ""

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Транскрипция аудио с использованием Whisper")
    parser.add_argument("audio_file", help="Путь к аудиофайлу")
    parser.add_argument("--language", default="ru", help="Язык транскрипции (например, ru, uk, en, de)")
    args = parser.parse_args()

    transcription = transcribe_audio(args.audio_file, args.language)
    print(transcription)