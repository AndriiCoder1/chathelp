from typing import Any, Optional

api_key: Optional[str] = None

class Audio:
    def transcribe(*args: Any, **kwargs: Any) -> Any: ...
    def synthesize(*args: Any, **kwargs: Any) -> Any: ...
