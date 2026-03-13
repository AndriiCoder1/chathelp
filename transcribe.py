import sys
import os
import traceback
import requests
import io
from dotenv import load_dotenv
from pydub import AudioSegment
from typing import Optional
import tempfile

# Обеспечиваем правильную кодировку для вывода
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()

HF_TOKEN = os.getenv("HF_TOKEN")

if not HF_TOKEN:
    sys.exit(1)

# Название модели на Hugging Face
WHISPER_MODEL = "openai/whisper-large-v3"  

# Определение языка
def detect_language_from_text(text: str) -> str:
    """
    Простое определение языка по первым словам
    """
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
        #print(f"[Whisper] Начало обработки файла: {file_path}", file=sys.stderr)
        
        # Конвертируем аудио в нужный формат если необходимо
        audio = AudioSegment.from_file(file_path)
        
        # Сохраняем во временный файл в правильном формате
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            audio.export(tmp_file.name, format='wav')
            
            with open(tmp_file.name, 'rb') as f:
                data = f.read()
        
        #print(f"[Whisper] Отправка запроса в Hugging Face API (язык: {language or 'авто'})", file=sys.stderr)

       
        url = f"https://router.huggingface.co/hf-inference/models/{WHISPER_MODEL}"

        headers = {
            "Authorization": f"Bearer {HF_TOKEN}",
            "Content-Type": "audio/wav"
        }
        response = requests.post(
            url,
            headers=headers,
            data=data,  
            timeout=120
        )
        
        #print(f"[Whisper] Статус ответа: {response.status_code}", file=sys.stderr)
        
        # Очищаем временный файл
        if os.path.exists(tmp_file.name):
            os.unlink(tmp_file.name)
        
        if response.status_code == 200:
            # Для audio/wav ответа
            if response.headers.get('Content-Type', '').startswith('audio/'):
                #print("[Whisper] Получен аудио-ответ, а не JSON", file=sys.stderr)
                return "Ошибка распознавания речи"
    
            # Пытаемся распарсить JSON
            try:
                result = response.json()
                #print(f"[Whisper] Успешный ответ JSON: {result}", file=sys.stderr)
            except:
                #print("[Whisper] Ответ не является JSON", file=sys.stderr)
                return "Ошибка распознавания речи"
            
            # Обработка разных форматов ответа (словарь или список)
            text = ""
            if isinstance(result, list) and len(result) > 0:
                text = result[0].get("text", "").strip()
            elif isinstance(result, dict):
                text = result.get("text", "").strip()
            
            if not text:
                #print(f"[Whisper] Пустой текст в ответе. Тип ответа: {type(result)}", file=sys.stderr)
                return "Ошибка распознавания речи"
            
            #print(f"[Whisper] Распознанный текст: '{text}'", file=sys.stderr)
            return text
        else:
            
            return "Ошибка распознавания речи"
            
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return "Ошибка распознавания речи"

def convert_audio(input_path: str) -> str:
    """
    Конвертирует аудио в WAV 16kHz моно
    """
    try:
        audio = AudioSegment.from_file(input_path)
        audio = audio.set_frame_rate(16000).set_channels(1)
        
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        output_path = tmp.name
        tmp.close()
        audio.export(output_path, format="wav")
        return output_path
        
    except Exception as e:
        sys.exit(1)

# Точка входа
if __name__ == "__main__":
    converted_path = None
    
    try:
        if len(sys.argv) < 3:
            raise ValueError("Usage: python transcribe.py <input_audio_path> <output_audio_path> [language]")
        
        input_path = sys.argv[1]
        language = sys.argv[3] if len(sys.argv) > 3 else None
        
        # Конвертируем аудио
        converted_path = convert_audio(input_path)
        
        # Распознаём речь
        transcription = transcribe_audio(converted_path, language)
        
        # Возвращаем транскрипцию ТОЛЬКО в stdout
        sys.stdout.write(transcription)
        sys.stdout.flush()
        
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
        
    finally:
        if converted_path and os.path.exists(converted_path):
            try:
                os.remove(converted_path)
            except:
                pass
