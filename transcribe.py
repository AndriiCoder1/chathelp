import sys
import os
import traceback
import requests
from dotenv import load_dotenv
from pydub import AudioSegment
from typing import Optional
import tempfile

load_dotenv()

HF_TOKEN = os.getenv("HF_TOKEN")

# Название модели на Hugging Face
WHISPER_MODEL = "openai/whisper-large-v3"  

# Определение языка
def detect_language_from_text(text: str) -> str:
    """
    Простое определение языка по первым словам
    Можно заменить на более сложную логику
    """
    # Простейшая эвристика
    ru_chars = set('абвгдеёжзийклмнопрстуфхцчшщъыьэюя')
    de_chars = set('äöüß')
    
    text_lower = text.lower()
    ru_count = sum(1 for c in text_lower if c in ru_chars)
    de_count = sum(1 for c in text_lower if c in de_chars)
    
    if ru_count > de_count:
        return 'ru'
    elif de_count > ru_count:
        return 'de'
    return 'en'

def transcribe_audio(file_path: str, language: Optional[str] = None) -> str:
    """
    Распознаёт аудио с указанием языка (опционально)
    """
    try:
        # Конвертируем аудио в нужный формат если необходимо
        audio = AudioSegment.from_file(file_path)
        
        # Сохраняем во временный файл в правильном формате
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            audio.export(tmp_file.name, format='wav')
            
            with open(tmp_file.name, 'rb') as f:
                data = f.read()
        
        # Подготавливаем запрос к Hugging Face
        headers = {"Authorization": f"Bearer {HF_TOKEN}"}
        
        # Добавляем параметр языка если указан
        params = {}
        if language:
            params = {"parameters": {"language": language}}
        
        response = requests.post(
            f"https://api-inference.huggingface.co/models/{WHISPER_MODEL}",
            headers=headers,
            data=data,
            params=params,
            timeout=60
        )
        
        # Очищаем временный файл
        os.unlink(tmp_file.name)
        
        if response.status_code == 200:
            result = response.json()
            text = result.get("text", "")
            
            # Автоматически определяем язык если не указан
            if not language:
                detected_lang = detect_language_from_text(text)
                #print(f"[Whisper] Определён язык: {detected_lang}", file=sys.stderr)
            
            return text
        else:
            #print(f"[Ошибка] Hugging Face API: {response.status_code}", file=sys.stderr)
            return "Ошибка распознавания речи"
            
    except Exception as e:
        #print(f"[Ошибка] Транскрипция: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return "Ошибка распознавания речи"

def convert_audio(input_path: str) -> str:
    """
    Конвертирует аудио в WAV 16kHz моно
    """
    try:
        print(f"[Конвертация] Начало обработки: {input_path}", file=sys.stderr)
        
        # Проверяем наличие ffmpeg
        audio = AudioSegment.from_file(input_path)
        audio = audio.set_frame_rate(16000).set_channels(1)
        
        output_path = "temp_converted.wav"
        audio.export(output_path, format="wav")
        
        if os.path.getsize(output_path) == 0:
            raise Exception("Конвертированный файл пустой")
            
        print(f"[Конвертация] Успешно: {output_path}", file=sys.stderr)
        return output_path
        
    except Exception as e:
        print(f"[Ошибка] Конвертация аудио: {e}", file=sys.stderr)
        sys.exit(1)

def generate_speech(text: str, output_path: str, lang: str = 'ru'):
    """
    Генерирует речь из текста (оставляем gTTS)
    """
    try:
        from gtts import gTTS
        print(f"[Генерация речи] Текст: {text[:50]}...", file=sys.stderr)
        
        # Определяем язык для озвучки
        if not lang:
            lang = detect_language_from_text(text)
        
        tts = gTTS(text, lang=lang)
        tts.save(output_path)
        print(f"[Генерация речи] Успешно: {output_path}", file=sys.stderr)
        
    except Exception as e:
        print(f"[Ошибка] Генерация речи: {e}", file=sys.stderr)
        sys.exit(1)

# Точка входа
if __name__ == "__main__":
    converted_path = None
    
    try:
        if len(sys.argv) < 3:
            raise ValueError("Usage: python transcribe.py <input_audio_path> <output_audio_path> [language]")
        
        input_path = sys.argv[1]
        output_path = sys.argv[2]
        language = sys.argv[3] if len(sys.argv) > 3 else None
        
        print(f"[Main] Обработка файла: {input_path}", file=sys.stderr)
        if language:
            pass
            print(f"[Main] Указан язык: {language}", file=sys.stderr)
        
        # Конвертируем аудио
        converted_path = convert_audio(input_path)
        
        # Распознаём речь
        transcription = transcribe_audio(converted_path, language)
        
        # Генерируем речь в ответ
        generate_speech(transcription, output_path)
        
        # Возвращаем транскрипцию
        sys.stdout.write(transcription)
        
    except Exception as e:
        print(f"[Критическая ошибка] {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
        
    finally:
        if converted_path and os.path.exists(converted_path):
            os.remove(converted_path)
            print(f"[Очистка] Удален временный файл: {converted_path}", file=sys.stderr)