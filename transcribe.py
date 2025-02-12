import sys
import os
from openai import OpenAI
from pydub import AudioSegment

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def transcribe_audio(file_path: str) -> tuple:
    """Возвращает кортеж (текст, язык)"""
    try:
        audio = AudioSegment.from_file(file_path)
        audio = audio.set_frame_rate(16000).set_channels(1)
        
        with open(file_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="verbose_json"
            )
            return result.text, result.language.upper()
    except Exception as e:
        print(f"ERROR:{str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        text, lang = transcribe_audio(sys.argv[1])
        print(f"{text}\n{lang}")  # Ключевое изменение: разделитель \n
    except Exception as e:
        print(f"CRITICAL:{str(e)}")
        sys.exit(1)