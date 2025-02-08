import sys
import os
from openai import OpenAI
from pydub import AudioSegment

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def convert_audio(input_path: str) -> str:
    """Конвертирует аудио в WAV 16 кГц с обработкой исключений"""
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

def transcribe_audio(file_path: str) -> tuple:
    """Транскрибирует аудио с автоматическим определением языка"""
    try:
        with open(file_path, "rb") as audio_file:
            print("[Transcribe] Отправка запроса в OpenAI...")
            
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json",
                temperature=0.2,
                prompt="",  # Контекстные подсказки при необходимости
            )
            
            print(f"[Transcribe] Определен язык: {response.language.upper()}")
            return response.text, response.language

    except Exception as e:
        print(f"[Ошибка] OpenAI API: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        if len(sys.argv) < 2:
            raise ValueError("Укажите путь к аудиофайлу")
            
        input_path = sys.argv[1]
        print(f"[Main] Начало обработки файла: {input_path}")
        
        # Конвертация аудио
        converted_path = convert_audio(input_path)
        
        # Транскрипция
        transcription, language = transcribe_audio(converted_path)
        print("\nРезультат транскрипции:")
        print(f"Текст: {transcription}")
        print(f"Язык: {language}")

    except Exception as e:
        print(f"[Критическая ошибка] {str(e)}")
        sys.exit(1)
        
    finally:
        if 'converted_path' in locals() and os.path.exists(converted_path):
            os.remove(converted_path)
            print(f"[Очистка] Удален временный файл: {converted_path}")