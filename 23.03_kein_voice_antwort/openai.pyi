from typing import Any, Optional

api_key: Optional[str] = None

class Speech:
    def create(*args: Any, **kwargs: Any) -> Any: ...
    def stream_to_file(self, file_path: str) -> None: ...

class Audio:
    speech: Speech  # Добавлено объявление атрибута speech
    def transcribe(*args: Any, **kwargs: Any) -> Any: ...
    def synthesize(*args: Any, **kwargs: Any) -> Any: ...

audio: Audio = Audio()
audio.speech = Speech()  # Это присваивание теперь должно работать корректно
