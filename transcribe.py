import sys
import os
from dotenv import load_dotenv
import openai
from openai import error as openai_error  # type: ignore  - устраняет предупреждение
from pydub import AudioSegment
from gtts import gTTS
from typing import Any, Dict  # добавлено

# Загрузка переменных окружения из файла .env
load_dotenv()

# Получение ключа API из переменных окружения
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise ValueError("Не удалось найти переменную окружения OPENAI_API_KEY")

# Инициализация клиента OpenAI
openai.api_key = api_key

def check_dependencies():
    try:
        import openai
        import pydub
        import gtts
        print("[Проверка зависимостей] Все зависимости установлены.", file=sys.stderr)
    except ImportError as e:
        print(f"[Ошибка] Отсутствует зависимость: {str(e)}", file=sys.stderr)
        sys.exit(1)

def convert_audio(input_path: str) -> str:
    try:
        print(f"[Конвертация] Начало обработки: {input_path}", file=sys.stderr)
        audio = AudioSegment.from_file(input_path)
        audio = audio.set_frame_rate(16000).set_channels(1)
        output_path = "temp_converted.wav"
        audio.export(output_path, format="wav")
        if os.path.getsize(output_path) == 0:
            raise Exception("Конвертированный файл пустой. Проверьте наличие ffmpeg.")
        print(f"[Конвертация] Успешно: {output_path}", file=sys.stderr)
        return output_path
    except Exception as e:
        print(f"[Ошибка] Конвертация аудио: {e}", file=sys.stderr)
        sys.exit(1)

def transcribe_audio(file_path: str) -> str:
    try:
        with open(file_path, "rb") as audio_file:
            print("[Transcribe] Отправка в OpenAI...", file=sys.stderr)
            # Приводим результат к типу Dict[str, Any]
            response: Dict[str, Any] = openai.Audio.transcribe(  # type: ignore
                model="whisper-1",
                file=audio_file,
                response_format="json",
                temperature=0.2,
            )
            print("[Transcribe] Response:", response, file=sys.stderr)
            detected_language = response.get("language", "unknown").upper()  # теперь get распознается
            print(f"[Transcribe] Определен язык: {detected_language}", file=sys.stderr)
            return response["text"]  # теперь ошибок быть не должно
    except openai_error.PermissionError as e:
        error_msg = "[Ошибка] Доступ к модели отсутствует: " + str(e)
        print(error_msg, file=sys.stderr)
        return "Ошибка транскрипции: Нет доступа к модели whisper-1. Проверьте настройки доступа в вашем аккаунте OpenAI."
    except Exception as e:
        import traceback
        error_msg = "[Ошибка] OpenAI API:\n" + traceback.format_exc()
        print(error_msg, file=sys.stderr)
        return "Ошибка транскрипции: " + str(e)

def generate_speech(text, output_path):
    try:
        print(f"[Генерация речи] Начало генерации: {text}", file=sys.stderr)
        tts = gTTS(text, lang='ru')
        tts.save(output_path)
        print(f"[Генерация речи] Успешно: {output_path}", file=sys.stderr)
    except Exception as e:
        print(f"[Ошибка] Генерация речи: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    converted_path = None  # инициализация для избежания UnboundLocalVariable
    try:
        # В production не вызываем check_dependencies(), чтобы не загрязнять stderr
        # check_dependencies()
        
        if len(sys.argv) < 3:
            raise ValueError("Usage: python transcribe.py <input_audio_path> <output_audio_path>")
    
        input_path = sys.argv[1]
        output_path = sys.argv[2]
        print(f"[Main] Обработка файла: {input_path}", file=sys.stderr)
    
        converted_path = convert_audio(input_path)
        transcription = transcribe_audio(converted_path)
        generate_speech(transcription, output_path)
    
        # Выводим в stdout только итоговую транскрипцию
        sys.stdout.write(transcription)
    
    except Exception as e:
        print(f"[Критическая ошибка] {str(e)}", file=sys.stderr)
        sys.exit(1)
    
    finally:
        if converted_path and os.path.exists(converted_path):
            os.remove(converted_path)
            print(f"[Очистка] Удален временный файл: {converted_path}", file=sys.stderr)