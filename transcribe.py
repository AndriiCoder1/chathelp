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

            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json",
                temperature=0.2,
            )

            detected_language = response.language.upper()
            print(f"[Transcribe] Определен язык: {detected_language}")
            return response.text, detected_language

    except Exception as e:
        print(f"[Ошибка] OpenAI API: {str(e)}")
        sys.exit(1)

def speak(text, language):
    engine = pyttsx3.init()
    voices = engine.getProperty('voices')

    # Установите голос в зависимости от языка
    if language == "RU":
        for voice in voices:
            if "russian" in voice.languages:
                engine.setProperty('voice', voice.id)
                break
    else:
        for voice in voices:
            if "english" in voice.languages:
                engine.setProperty('voice', voice.id)
                break

    # Установите скорость речи (чем больше значение, тем быстрее речь)
    engine.setProperty('rate', 200)  # Установите нужное значение скорости

    engine.say(text)
    engine.runAndWait()

if __name__ == "__main__":
    try:
        if len(sys.argv) < 2:
            raise ValueError("Укажите путь к аудиофайлу")

        input_path = sys.argv[1]
        print(f"[Main] Обработка файла: {input_path}")

        converted_path = convert_audio(input_path)
        transcription, language = transcribe_audio(converted_path)

        print("\nРезультат транскрипции:")
        print(transcription)

        # Фунуция голосового ответа
        speak(transcription, language)

    except Exception as e:
        print(f"[Критическая ошибка] {str(e)}")
        sys.exit(1)

    finally:
        if 'converted_path' in locals() and os.path.exists(converted_path):
            os.remove(converted_path)
            print(f"[Очистка] Удален временный файл: {converted_path}")