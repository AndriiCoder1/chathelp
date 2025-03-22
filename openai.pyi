from typing import Any, Optional

api_key: Optional[str] = None

class Audio:
    def transcribe(*args: Any, **kwargs: Any) -> Any: ...
    def synthesize(*args: Any, **kwargs: Any) -> Any: ...

class Speech:
    def create(*args: Any, **kwargs: Any) -> Any: ...
    # Метод stream_to_file будет вызываться у результата create
    def stream_to_file(self, file_path: str) -> None: ...

# Добавляем атрибут audio с вложенным свойством speech
audio: Any = type("OpenAIAudio", (), {"speech": Speech()})
