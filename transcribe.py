import sys
import os
from openai import OpenAI
from pydub import AudioSegment
import pyttsx3

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

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

def transcribe_audio(file_path: str) -> str:
    try:
        with open(file_path, "rb") as audio_file:
            print("[Transcribe] Отправка в OpenAI...")

            response = client.Audio.transcribe(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json",
                temperature=0.2,
            )

            detected_language = response['language'].upper()
            print(f"[Transcribe] Определен язык: {detected_language}")
            return response['text']

    except Exception as e:
        print(f"[Ошибка] OpenAI API: {str(e)}")
        sys.exit(1)

def generate_speech(text, output_path):
    try:
        engine = pyttsx3.init()
        engine.save_to_file(text, output_path)
        engine.runAndWait()
        print(f"[Генерация речи] Успешно: {output_path}")
    except Exception as e:
        print(f"[Ошибка] Генерация речи: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        if len(sys.argv) < 3:
            raise ValueError("Usage: python transcribe.py <input_audio_path> <output_audio_path>")

        input_path = sys.argv[1]
        output_path = sys.argv[2]
        print(f"[Main] Обработка файла: {input_path}")

        converted_path = convert_audio(input_path)
        transcription = transcribe_audio(converted_path)
        generate_speech(transcription, output_path)

        print("\nРезультат транскрипции:")
        print(transcription)

    except Exception as e:
        print(f"[Критическая ошибка] {str(e)}")
        sys.exit(1)

    finally:
        if 'converted_path' in locals() and os.path.exists(converted_path):
            os.remove(converted_path)
            print(f"[Очистка] Удален временный файл: {converted_path}")
