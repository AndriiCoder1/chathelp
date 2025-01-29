import whisper
import sys
import os
import io

# Устанавливаю кодировку UTF-8 для вывода
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def transcribe_audio(file_path):
    if not os.path.exists(file_path):
        print(f"Файл не найден: {file_path}")
        return ""

    try:
        print("Загрузка модели Whisper...")  # Отладочная информация
        model = whisper.load_model("base")  # Использую "base" для начального уровня
        print("Модель загружена. Начало транскрипции...")  # Отладочная информация
        result = model.transcribe(file_path)
        print("Транскрипция завершена.")  # Отладочная информация
        return result["text"]
    except Exception as e:
        print(f"Ошибка при транскрипции: {e}")
        return ""

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Использование: python transcribe.py <путь_к_аудиофайлу>")
        sys.exit(1)

    audio_file = sys.argv[1]
    print(f"Переданный путь к файлу: {audio_file}")  # Отладочная информация
    print(f"Файл существует: {os.path.exists(audio_file)}")  # Отладочная информация
    transcription = transcribe_audio(audio_file)
    print(transcription)