import sys
import os
from openai import OpenAI
from pydub import AudioSegment

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def transcribe_audio(file_path: str, target_lang: str = None) -> tuple:
    try:
        audio = AudioSegment.from_file(file_path)
        audio = audio.set_frame_rate(16000).set_channels(1)
        converted_path = f"{file_path}.converted.wav"
        audio.export(converted_path, format="wav")

        params = {
            "model": "whisper-1",
            "file": open(converted_path, "rb"),
            "response_format": "verbose_json"
        }
        
        if target_lang:
            params["language"] = target_lang.lower()
            params["prompt"] = f"Это разговор на {target_lang}. Транскрибируй точно."

        result = client.audio.transcriptions.create(**params)
        os.remove(converted_path)
        
        return result.text, result.language.upper()

    except Exception as e:
        print(f"ERROR:{str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        target_lang = sys.argv[2] if len(sys.argv) > 2 else None
        text, lang = transcribe_audio(sys.argv[1], target_lang)
        print(f"{text}\n{lang}")
    except Exception as e:
        print(f"CRITICAL:{str(e)}")
        sys.exit(1)