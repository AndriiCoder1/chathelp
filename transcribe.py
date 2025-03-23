import sys
import os
from dotenv import load_dotenv
import openai
from openai import error as openai_error  # type: ignore  - устраняет предупреждение
from pydub import AudioSegment
from gtts import gTTS

# Загрузка переменных окружения из файла .env
load_dotenv()

# Получение ключа API из переменных окружения
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise ValueError("Не удалось найти переменную окружения OPENAI_API_KEY")

# Инициализация клиента OpenAI
openai.api_key = api_key

def check_dependencies():
    try:
        import openai
        import pydub
        import gtts
        print("[Проверка зависимостей] Все зависимости установлены.", file=sys.stderr)
    except ImportError as e:
        print(f"[Ошибка] Отсутствует зависимость: {str(e)}", file=sys.stderr)
        sys.exit(1)

def convert_audio(input_path: str) -> str:
    try:
        print(f"[Конвертация] Начало обработки: {input_path}", file=sys.stderr)
        audio = AudioSegment.from_file(input_path)
        audio = audio.set_frame_rate(16000).set_channels(1)
        output_path = "temp_converted.wav"
        audio.export(output_path, format="wav")
        if os.path.getsize(output_path) == 0:
            raise Exception("Конвертированный файл пустой. Проверьте наличие ffmpeg.")
        print(f"[Конвертация] Успешно: {output_path}", file=sys.stderr)
        return output_path
    except Exception as e:
        print(f"[Ошибка] Конвертация аудио: {e}", file=sys.stderr)
        sys.exit(1)

def transcribe_audio(file_path: str) -> str:
    try:
        with open(file_path, "rb") as audio_file:
            print("[Transcribe] Отправка в OpenAI...", file=sys.stderr)
            response = openai.Audio.transcribe(
                model="whisper-1",  # используем Whisper для транскрипции
                file=audio_file,
                response_format="json"
                
            )
            print("[Transcribe] Response:", response, file=sys.stderr)
            detected_language = response.get("language", "unknown").upper()
            print(f"[Transcribe] Определен язык: {detected_language}", file=sys.stderr)
            return response["text"]
    except openai_error.PermissionError as e:
        error_msg = "[Ошибка] Доступ к модели отсутствует: " + str(e)
        print(error_msg, file=sys.stderr)
        return "Ошибка транскрипции: Нет доступа к модели Whisper. Проверьте настройки доступа в вашем аккаунте OpenAI."
    except Exception as e:
        import traceback
        error_msg = "[Ошибка] OpenAI API:\n" + traceback.format_exc()
        print(error_msg, file=sys.stderr)
        return "Ошибка транскрипции: " + str(e)

def generate_speech(text, output_path):
    try:
        print(f"[Генерация речи] Используем gTTS для генерации: {text}", file=sys.stderr)
        tts = gTTS(text=text, lang='ru')
        tts.save(output_path)
        print(f"[Генерация речи] gTTS успешно сгенерировала аудио: {output_path}", file=sys.stderr)
    except Exception as e:
        print(f"[Ошибка] gTTS не сработала: {str(e)}", file=sys.stderr)
        print("[Фоллбэк] Используем pyttsx3 для генерации речи", file=sys.stderr)
        try:
            import pyttsx3  # type: ignore
            engine = pyttsx3.init()
            voices = engine.getProperty('voices')
            # Вывод доступных голосов для контроля
            for voice in voices:
                print(f"[Available Voice] {voice.name}", file=sys.stderr)
            desired_voice = None
            if sys.platform == 'darwin':
                # Для macOS выбираем голос, содержащий 'Alex'
                for voice in voices:
                    if "Alex" in voice.name:
                        desired_voice = voice.id
                        break
            else:
                # Для остальных пытаемся выбрать голос "Microsoft David"
                for voice in voices:
                    if "Microsoft David" in voice.name:
                        desired_voice = voice.id
                        break
            if desired_voice:
                engine.setProperty('voice', desired_voice)
            else:
                engine.setProperty('voice', voices[0].id)
            engine.save_to_file(text, output_path)
            engine.runAndWait()
            print(f"[Фоллбэк] pyttsx3 успешно сгенерировала аудио: {output_path}", file=sys.stderr)
        except Exception as fe:
            print(f"[Критическая ошибка] pyttsx3: {str(fe)}", file=sys.stderr)
            sys.exit(1)

if __name__ == "__main__":
    converted_path = None  # инициализация для избежания UnboundLocalVariable
    try:
        # В production не вызываем check_dependencies(), чтобы не загрязнять stderr
        # check_dependencies()
        
        if len(sys.argv) < 3:
            raise ValueError("Usage: python transcribe.py <input_audio_path> <output_audio_path>")
    
        input_path = sys.argv[1]
        output_path = sys.argv[2]
        print(f"[Main] Обработка файла: {input_path}", file=sys.stderr)
    
        converted_path = convert_audio(input_path)
        transcription = transcribe_audio(converted_path)
        generate_speech(transcription, output_path)
    
        # Выводим в stdout только итоговую транскрипцию
        sys.stdout.write(transcription)
    
    except Exception as e:
        print(f"[Критическая ошибка] {str(e)}", file=sys.stderr)
        sys.exit(1)
    
    finally:
        if converted_path and os.path.exists(converted_path):
            os.remove(converted_path)
            print(f"[Очистка] Удален временный файл: {converted_path}", file=sys.stderr)