from typing import Optional
import sys
import os
from dotenv import load_dotenv
from openai import OpenAI
from pydub import AudioSegment
from gtts import gTTS
import hashlib
from functools import lru_cache

# Загрузка переменных окружения из файла .env
load_dotenv()

# Получение ключа API из переменных окружения
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise ValueError("Не удалось найти переменную окружения OPENAI_API_KEY")

# Инициализация клиента OpenAI
client = OpenAI(api_key=api_key)

def check_dependencies():
    try:
        import openai
        import pydub
        import gtts
        print("[Проверка зависимостей] Все зависимости установлены.")
    except ImportError as e:
        print(f"[Ошибка] Отсутствует зависимость: {str(e)}")
        sys.exit(1)

def convert_audio(input_path: str) -> str:
    try:
        print(f"[Конвертация] Начало обработки: {input_path}")
        audio = AudioSegment.from_file(input_path)
        audio = audio.set_frame_rate(16000).set_channels(1)
        output_path = "temp_converted.wav"
        audio.export(output_path, format="wav")
        print(f"[Конвертация] Успешно: {output_path}")
        return output_path
    except Exception as e:
        print(f"[Ошибка] Конвертация аудио: {str(e)}")
        sys.exit(1)

# Кэширование транскрипций
@lru_cache(maxsize=100)
def cached_transcribe(file_path: str) -> str:
    """
    Transcribe audio file with caching
    Args:
        file_path: Path to audio file
    Returns:
        str: Transcription text
    """
    try:
        # Использование абсолютного пути для cache_dir
        cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "transcription_cache")
        
        # Создаем директорию, если её нет
        if not os.path.exists(cache_dir):
            os.makedirs(cache_dir)
            print(f"[Кэш] Создана директория кэша: {cache_dir}")
        
        # Генерация уникального хеша файла
        file_hash = hashlib.md5(open(file_path, 'rb').read()).hexdigest()
        cache_path = os.path.join(cache_dir, f"{file_hash}.txt")
        
        # Проверка существующего кэша
        if os.path.exists(cache_path):
            print(f"[Кэш] Найдена кэшированная транскрипция: {cache_path}")
            with open(cache_path, "r", encoding='utf-8') as f:
                return f.read()
                
        print(f"[Кэш] Кэш не найден, выполняется транскрипция")
        
        # Основная логика Whisper
        with open(file_path, "rb") as audio_file:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="json"  # Изменили формат ответа
            )
            
        # Сохранение в кэш
        with open(cache_path, "w", encoding='utf-8') as f:
            f.write(result.text)  # Используем result.text
        print(f"[Кэш] Сохранена новая транскрипция: {cache_path}")
            
        return result.text  # Возвращаем text из result

    except Exception as e:
        print(f"[Кэш] Ошибка: {str(e)}")
        raise

def generate_speech(text, output_path):
    try:
        print(f"[Генерация речи] Начало генерации: {text}")
        tts = gTTS(text, lang='ru')
        tts.save(output_path)
        print(f"[Генерация речи] Успешно: {output_path}")
    except Exception as e:
        print(f"[Ошибка] Генерация речи: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        check_dependencies()
        
        if len(sys.argv) < 3:
            print("Usage: python transcribe.py <input_audio_path> <output_audio_path>")
            sys.exit(1)

        input_path = sys.argv[1]
        output_path = sys.argv[2]
        print(f"[Main] Обработка файла: {input_path}")

        # Убедимся, что входной файл существует
        if not os.path.exists(input_path):
            print(f"[Ошибка] Входной файл не найден: {input_path}")
            sys.exit(1)

        # Убедимся, что директория для выходного файла существует
        output_dir = os.path.dirname(output_path)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
            print(f"[Main] Создана директория: {output_dir}")

        converted_path = None  # type: Optional[str]
        
        try:
            # Конвертация и транскрипция
            converted_path = convert_audio(input_path)
            if not os.path.exists(converted_path):
                print(f"[Ошибка] Конвертированный файл не создан: {converted_path}")
                sys.exit(1)
                
            transcription = cached_transcribe(converted_path)
            if not transcription:
                print("[Ошибка] Пустая транскрипция")
                sys.exit(1)
                
            print("\nТекст транскрипции:")
            print(transcription)
            
            # Генерация речи
            generate_speech(transcription, output_path)
            if not os.path.exists(output_path):
                print(f"[Ошибка] Выходной файл не создан: {output_path}")
                sys.exit(1)

        except Exception as e:
            print(f"[Ошибка обработки] {str(e)}")
            sys.exit(1)
        finally:
            # Очистка временных файлов
            if converted_path and os.path.exists(converted_path):
                os.remove(converted_path)
                print(f"[Очистка] Удален временный файл: {converted_path}")

    except Exception as e:
        print(f"[Критическая ошибка] {str(e)}")
        sys.exit(1)
