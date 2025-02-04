import sys
import os
from openai import OpenAI
from pydub import AudioSegment

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def convert_audio(input_path: str) -> str:
    """Конвертирует аудио в WAV 16 кГц."""
    try:
        audio = AudioSegment.from_file(input_path)
        audio = audio.set_frame_rate(16000)
        output_path = "temp_converted.wav"
        audio.export(output_path, format="wav")
        return output_path
    except Exception as e:
        print(f"[Ошибка] Конвертация: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Укажите путь к аудиофайлу!")
        sys.exit(1)

    input_path = sys.argv[1]
    converted_path = convert_audio(input_path)

    try:
        with open(converted_path, "rb") as f:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="ru",  # Явное указание языка
                response_format="text"
            )
        print(transcript)
    except Exception as e:
        print(f"[Ошибка] OpenAI: {str(e)}")
        sys.exit(1)
    finally:
        if os.path.exists(converted_path):
            os.remove(converted_path)