# transcribe.py
import whisper
import sys

def transcribe_audio(file_path):
    model = whisper.load_model("base")  # Используйте "base" для начального уровня
    result = model.transcribe(file_path)
    return result["text"]

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Использование: python transcribe.py <путь_к_аудиофайлу>")
        sys.exit(1)

    audio_file = sys.argv[1]
    transcription = transcribe_audio(audio_file)
    print(transcription)