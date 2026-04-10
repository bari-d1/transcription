import sys
import os
import whisper


def transcribe_file(audio_path):
    model = whisper.load_model("tiny")
    result = model.transcribe(audio_path)
    return result["text"]


def main():
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <audio_path>", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]

    if not os.path.exists(audio_path):
        print(f"File not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    text = transcribe_file(audio_path)
    print(text)


if __name__ == "__main__":
    main()
