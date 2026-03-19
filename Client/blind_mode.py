"""
Blind Mode - Audio accessibility layer for visually impaired users
Provides text-to-speech for questions/options and speech recognition for answers
"""

import asyncio
import threading
from typing import Callable, Optional
from enum import Enum
import speech_recognition as sr
import edge_tts
from pathlib import Path
import tempfile
import os
import math
import struct
from PyQt6.QtCore import QObject, pyqtSignal, QThread, QTimer
from PyQt6.QtMultimedia import QMediaPlayer, QAudioOutput
from PyQt6.QtCore import QUrl

from models import Question


class BlindModeState(Enum):
    """States for blind mode state machine"""
    IDLE = "idle"           # Ready for commands, nothing active
    SPEAKING = "speaking"   # TTS is generating or playing speech
    LISTENING = "listening" # Microphone is active, capturing voice
    PROCESSING = "processing" # Brief state while processing voice command


def generate_entrance_chime(sample_rate: int = 44100) -> str:
    """
    Generate a pleasant two-tone entrance chime (ascending notes)
    """
    # Two pleasant notes: C5 (523Hz) followed by G5 (784Hz)
    note1_freq, note2_freq = 523, 784
    note_duration = 0.15  # 150ms per note
    gap_duration = 0.05   # 50ms gap between notes

    total_duration = note_duration * 2 + gap_duration
    num_samples = int(sample_rate * total_duration)

    samples = []

    for i in range(num_samples):
        t = float(i) / sample_rate
        sample = 0.0

        # First note (0-150ms)
        if t < note_duration:
            progress = t / note_duration
            envelope = math.sin(math.pi * progress)  # Smooth envelope
            sample = math.sin(2.0 * math.pi * note1_freq * t) * envelope * 0.2

        # Gap (150-200ms) - silence
        elif t < note_duration + gap_duration:
            sample = 0.0

        # Second note (200-350ms)
        elif t < note_duration * 2 + gap_duration:
            note_start = note_duration + gap_duration
            note_t = t - note_start
            progress = note_t / note_duration
            envelope = math.sin(math.pi * progress)  # Smooth envelope
            sample = math.sin(2.0 * math.pi * note2_freq * note_t) * envelope * 0.2

        # Convert to 16-bit PCM
        sample_int = int(sample * 32767)
        sample_int = max(-32768, min(32767, sample_int))
        samples.append(struct.pack('<h', sample_int))

    # Create temporary WAV file
    with tempfile.NamedTemporaryFile(mode='wb', suffix='.wav', delete=False) as f:
        # Write WAV header
        f.write(b'RIFF')
        f.write(struct.pack('<L', 36 + len(samples) * 2))
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write(struct.pack('<LHHLLHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        f.write(b'data')
        f.write(struct.pack('<L', len(samples) * 2))
        f.write(b''.join(samples))

        return f.name


def generate_beep_sound(frequency: int = 800, duration_ms: int = 200, sample_rate: int = 44100) -> str:
    """
    Generate a simple beep sound and return the path to the temporary WAV file.
    Args:
        frequency: Frequency of the beep in Hz
        duration_ms: Duration in milliseconds
        sample_rate: Sample rate for the audio
    """
    duration_s = duration_ms / 1000.0
    num_samples = int(sample_rate * duration_s)

    # Generate sine wave
    samples = []
    for i in range(num_samples):
        t = float(i) / sample_rate
        # Apply envelope to avoid clicking
        envelope = math.sin(math.pi * i / num_samples) if i < num_samples else 1.0
        sample = math.sin(2.0 * math.pi * frequency * t) * envelope * 0.3  # 0.3 for moderate volume

        # Convert to 16-bit PCM
        sample_int = int(sample * 32767)
        sample_int = max(-32768, min(32767, sample_int))  # Clamp to 16-bit range
        samples.append(struct.pack('<h', sample_int))  # Little-endian 16-bit

    # Create temporary WAV file
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.wav')
    temp_path = temp_file.name

    # Write WAV header + data
    with open(temp_path, 'wb') as f:
        # WAV header
        f.write(b'RIFF')
        f.write(struct.pack('<I', 36 + len(samples) * 2))  # File size - 8
        f.write(b'WAVE')

        # fmt chunk
        f.write(b'fmt ')
        f.write(struct.pack('<I', 16))  # Chunk size
        f.write(struct.pack('<H', 1))   # Audio format (PCM)
        f.write(struct.pack('<H', 1))   # Num channels (mono)
        f.write(struct.pack('<I', sample_rate))  # Sample rate
        f.write(struct.pack('<I', sample_rate * 2))  # Byte rate
        f.write(struct.pack('<H', 2))   # Block align
        f.write(struct.pack('<H', 16))  # Bits per sample

        # data chunk
        f.write(b'data')
        f.write(struct.pack('<I', len(samples) * 2))  # Data size
        f.write(b''.join(samples))

    temp_file.close()
    return temp_path


class TTSWorker(QThread):
    """Worker thread for text-to-speech generation"""
    finished = pyqtSignal(str)  # Emits path to generated audio file
    error = pyqtSignal(str)

    def __init__(self, text: str, parent=None):
        super().__init__(parent)
        self.text = text

    def run(self):
        try:
            # Create temp file for audio
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.mp3')
            output_path = temp_file.name
            temp_file.close()

            # Run async TTS in this thread
            asyncio.run(self._generate_speech(output_path))
            self.finished.emit(output_path)
        except Exception as e:
            self.error.emit(str(e))

    async def _generate_speech(self, output_path: str):
        voice = "en-GB-SoniaNeural"  # Clear, natural voice
        #en-GB-SoniaNeural
        #en-US-AvaNeural
        #en-US-AnaNeural
        #te-IN-ShrutiNeural
        communicate = edge_tts.Communicate(self.text, voice, rate="+10%")
        await communicate.save(output_path)


class SpeechRecognitionWorker(QThread):
    """Worker thread for speech recognition"""
    recognized = pyqtSignal(str)  # Emits recognized text
    error = pyqtSignal(str)
    listening = pyqtSignal()  # Signals when listening starts

    def __init__(self, parent=None):
        super().__init__(parent)
        self.recognizer = sr.Recognizer()
        # Conservative recognition settings for better accuracy
        self.recognizer.energy_threshold = 300  # Back to more conservative threshold
        self.recognizer.dynamic_energy_threshold = True
        self.recognizer.pause_threshold = 0.6  # Faster response
        self.recognizer.phrase_threshold = 0.3  # Min audio length to consider as speech
        self.recognizer.non_speaking_duration = 0.5  # How much silence before stopping
        self._should_stop = False  # Flag to stop listening
        self.attempt_count = 0  # Track recognition attempts

    def stop_listening(self):
        """Signal the worker to stop listening"""
        self._should_stop = True

    def run(self):
        self._should_stop = False  # Reset stop flag
        self.attempt_count = 0

        try:
            with sr.Microphone() as source:
                self.listening.emit()
                print("🎤 Starting precise voice recognition...")  # Debug

                # Standard ambient noise adjustment
                print("🎤 Calibrating microphone...")
                self.recognizer.adjust_for_ambient_noise(source, duration=0.5)
                print(f"🎤 Energy threshold: {self.recognizer.energy_threshold}")  # Debug

                # Simplified 2-attempt approach for better accuracy
                for main_attempt in range(2):  # Only 2 attempts to avoid accepting poor matches
                    if self._should_stop:
                        print("🎤 Listening stopped by user")  # Debug
                        return

                    self.attempt_count = main_attempt + 1
                    print(f"🎤 Recognition attempt {self.attempt_count}/2...")

                    # Conservative settings - prioritize accuracy over sensitivity
                    if main_attempt == 0:
                        # First attempt: Standard settings for best accuracy
                        timeout = 3
                        phrase_limit = 2
                    else:
                        # Second attempt: Slightly more time but same sensitivity
                        timeout = 4
                        phrase_limit = 3
                        # Don't change energy threshold - keep it conservative

                    try:
                        print(f"🎤 Listening (timeout: {timeout}s)...")
                        audio = self.recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_limit)
                        print("🎤 Audio captured, processing...")

                        # Try recognition with the captured audio
                        text = self.recognizer.recognize_google(audio)
                        print(f"🎤 Recognition SUCCESS: '{text}'")
                        self.recognized.emit(text.strip())
                        return  # Success! Exit

                    except sr.WaitTimeoutError:
                        print(f"🎤 Attempt {self.attempt_count}: No speech detected in {timeout}s")
                        continue  # Try next attempt
                    except sr.UnknownValueError:
                        print(f"🎤 Attempt {self.attempt_count}: Could not understand audio")
                        continue  # Try next attempt
                    except sr.RequestError as e:
                        print(f"🎤 Recognition service error: {e}")
                        break  # Don't retry service errors

                # Both attempts failed
                if not self._should_stop:
                    print("🎤 All recognition attempts failed")
                    self.error.emit("Could not understand speech. Please speak clearly and try again.")

        except Exception as e:
            if not self._should_stop:
                print(f"🎤 Unexpected error: {e}")
                self.error.emit(f"Microphone error: {str(e)}")


class BlindModeManager(QObject):
    """Main manager for blind mode functionality"""

    # Signals
    speech_started = pyqtSignal()
    speech_finished = pyqtSignal()
    listening_started = pyqtSignal()
    listening_finished = pyqtSignal()  # New signal for when listening stops
    command_recognized = pyqtSignal(str)  # Emits the recognized command

    def __init__(self, parent=None):
        super().__init__(parent)

        # State machine
        self._state = BlindModeState.IDLE
        self._debug_states = False  # Set to True for state debugging

        # Audio player for TTS
        self.player = QMediaPlayer()
        self.audio_output = QAudioOutput()
        self.player.setAudioOutput(self.audio_output)
        self.audio_output.setVolume(0.8)

        # Separate audio player for beep sounds
        self.beep_player = QMediaPlayer()
        self.beep_audio_output = QAudioOutput()
        self.beep_player.setAudioOutput(self.beep_audio_output)
        self.beep_audio_output.setVolume(0.6)  # Slightly quieter for beeps

        # State
        self.current_audio_file: Optional[str] = None
        self.temp_files: list[str] = []  # Track temp files for cleanup

        # Pre-generate beep sounds
        self.mic_on_beep: Optional[str] = None
        self.mic_off_beep: Optional[str] = None
        self.entrance_beep: Optional[str] = None
        self._generate_beep_sounds()

        # Workers
        self.tts_worker: Optional[TTSWorker] = None
        self.speech_worker: Optional[SpeechRecognitionWorker] = None

        # Persistent narrator system - prevents silence
        self.silence_timer = QTimer()
        self.silence_timer.setSingleShot(True)
        self.silence_timer.timeout.connect(self._handle_silence_timeout)
        self.auto_repeat_enabled = True
        self.silence_timeout_seconds = 10  # Speak again after 10 seconds of silence
        self.last_spoken_content = ""

        # Connect player signals
        self.player.playbackStateChanged.connect(self._on_playback_state_changed)

    @property
    def state(self) -> BlindModeState:
        """Get current state"""
        return self._state

    @property
    def is_speaking(self) -> bool:
        """Compatibility property for existing code"""
        return self._state == BlindModeState.SPEAKING

    def _set_state(self, new_state: BlindModeState, reason: str = ""):
        """Change state with optional debug logging and silence management"""
        if self._state != new_state:
            old_state = self._state
            self._state = new_state
            if self._debug_states:
                print(f"State: {old_state.value} → {new_state.value} ({reason})")

            # Manage silence timer based on state changes
            if new_state == BlindModeState.IDLE and self.auto_repeat_enabled:
                # Start silence timer when entering idle state
                self.silence_timer.start(self.silence_timeout_seconds * 1000)
                if self._debug_states:
                    print(f"🔇 Started silence timer for {self.silence_timeout_seconds}s")
            else:
                # Stop silence timer when not idle
                self.silence_timer.stop()
                if self._debug_states:
                    print("🔇 Stopped silence timer")

    def _handle_silence_timeout(self):
        """Called when there's been silence for too long - provide helpful prompts"""
        if self._state != BlindModeState.IDLE or not self.auto_repeat_enabled:
            return

        prompts = [
            "Press space to give voice commands. Say A, B, C, D to select an option, or say 'repeat' to hear the question again.",
            "I'm here to help. Press space and say a command like A, B, C, D, Mark, Next, Previous, Repeat, or Clear.",
            "Ready for your command. Press space bar and speak clearly."
        ]

        # Cycle through different prompts to avoid repetition
        import time
        prompt_index = int(time.time() // 30) % len(prompts)  # Change every 30 seconds
        self.speak(prompts[prompt_index])

    def _can_speak(self) -> bool:
        """Check if we can start speaking"""
        return self._state == BlindModeState.IDLE

    def _can_listen(self) -> bool:
        """Check if we can start listening"""
        return self._state == BlindModeState.IDLE

    def speak(self, text: str):
        """Convert text to speech and play it"""
        print(f"🔊 Speak called: '{text[:50]}...' (state: {self._state.value})")  # Debug

        # State machine: only speak if IDLE
        if not self._can_speak():
            print(f"❌ Cannot speak in state {self._state.value}, ignoring: {text[:50]}...")
            return

        print(f"✅ Speaking allowed in state {self._state.value}")  # Debug

        # Stop any existing speech first
        if self._state == BlindModeState.SPEAKING:
            self.stop_speaking()

        self._set_state(BlindModeState.SPEAKING, f"Starting TTS: {text[:30]}...")
        self.speech_started.emit()

        # Generate speech in background
        self.tts_worker = TTSWorker(text, parent=self)
        self.tts_worker.finished.connect(self._on_tts_finished)
        self.tts_worker.error.connect(self._on_tts_error)
        self.tts_worker.start()

    def stop_speaking(self):
        """Stop current speech playback and return to IDLE"""
        if self._state != BlindModeState.SPEAKING:
            return

        # Stop current audio playback
        if self.player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
            self.player.stop()

        # Cancel any running TTS worker with timeout to prevent freezing
        if self.tts_worker and self.tts_worker.isRunning():
            self.tts_worker.quit()
            # Wait with timeout to prevent GUI freeze
            if not self.tts_worker.wait(1000):  # Wait max 1 second
                print("⚠️ TTS worker didn't stop gracefully, terminating...")
                self.tts_worker.terminate()
                self.tts_worker.wait(500)  # Brief wait for termination
            self.tts_worker = None

        self._cleanup_current_audio()
        self._set_state(BlindModeState.IDLE, "Speech stopped")

    def listen(self):
        """Start listening for voice input"""
        # State machine: only listen if IDLE
        if not self._can_listen():
            if self._debug_states:
                print(f"Cannot listen in state {self._state.value}, ignoring")
            return

        self._set_state(BlindModeState.LISTENING, "Starting voice recognition")
        self.listening_started.emit()

        # Start speech recognition
        self.speech_worker = SpeechRecognitionWorker(parent=self)
        self.speech_worker.listening.connect(self._on_listening_started)
        self.speech_worker.recognized.connect(self._on_speech_recognized)
        self.speech_worker.error.connect(self._on_speech_error)
        self.speech_worker.start()

    def stop_listening(self):
        """Stop current voice input if active"""
        if self._state != BlindModeState.LISTENING:
            return

        if self.speech_worker and self.speech_worker.isRunning():
            self.speech_worker.stop_listening()  # Signal worker to stop
            self.speech_worker.quit()
            # Wait with timeout to prevent GUI freeze
            if not self.speech_worker.wait(1000):  # Wait max 1 second
                print("⚠️ Speech worker didn't stop gracefully, terminating...")
                self.speech_worker.terminate()
                self.speech_worker.wait(500)  # Brief wait for termination
            self.speech_worker = None

        self._set_state(BlindModeState.IDLE, "Listening stopped")
        self.listening_finished.emit()
        self.play_mic_off_beep()

    def speak_question(self, question: Question, question_number: int):
        """Speak a complete question with its options"""
        # Build the full text
        parts = []

        # Question text
        parts.append(f"Question {question_number}. {question.text}")

        # Options
        option_labels = ("A", "B", "C", "D", "E", "F")
        for i, option in enumerate(question.options):
            letter = option_labels[i] if i < len(option_labels) else str(i + 1)
            option_text = option.text if option.text else "Image option"
            parts.append(f"Option {letter}. {option_text}")

        full_text = ". ".join(parts)
        self.speak(full_text)

    def parse_command(self, text: str) -> Optional[str]:
        """Parse recognized speech into a command with precise matching"""
        original_text = text
        text = text.lower().strip()
        print(f"🎯 Parsing command: '{original_text}' -> '{text}'")  # Debug

        # EXACT MATCH FIRST - most reliable
        # Option selection - be very precise to avoid mismatches
        if text in ['a', 'option a', 'select a', 'choose a', 'letter a']:
            print(f"🎯 Command parsed: OPTION_A")
            return 'OPTION_A'
        if text in ['b', 'option b', 'select b', 'choose b', 'letter b']:
            print(f"🎯 Command parsed: OPTION_B")
            return 'OPTION_B'
        if text in ['c', 'option c', 'select c', 'choose c', 'letter c']:
            print(f"🎯 Command parsed: OPTION_C")
            return 'OPTION_C'
        if text in ['d', 'option d', 'select d', 'choose d', 'letter d']:
            print(f"🎯 Command parsed: OPTION_D")
            return 'OPTION_D'
        if text in ['e', 'option e', 'select e', 'choose e', 'letter e']:
            print(f"🎯 Command parsed: OPTION_E")
            return 'OPTION_E'
        if text in ['f', 'option f', 'select f', 'choose f', 'letter f']:
            print(f"🎯 Command parsed: OPTION_F")
            return 'OPTION_F'

        # Navigation commands - be strict to avoid mismatches like "previous" -> "C"
        if text in ['next', 'next question', 'go next', 'forward']:
            print(f"🎯 Command parsed: NEXT")
            return 'NEXT'
        if text in ['previous', 'prev', 'back', 'go back', 'previous question', 'backward']:
            print(f"🎯 Command parsed: PREV")
            return 'PREV'

        # Action commands
        if text in ['mark', 'mark for review', 'mark question', 'flag']:
            print(f"🎯 Command parsed: MARK")
            return 'MARK'
        if text in ['repeat', 'repeat question', 'say again', 'again', 'read again']:
            print(f"🎯 Command parsed: REPEAT")
            return 'REPEAT'
        if text in ['clear', 'clear answer', 'remove answer', 'delete answer']:
            print(f"🎯 Command parsed: CLEAR")
            return 'CLEAR'
        if text in ['submit', 'submit exam', 'finish', 'end exam']:
            print(f"🎯 Command parsed: SUBMIT")
            return 'SUBMIT'
        if text in ['unanswered', 'go to unanswered', 'show unanswered', 'skip to unanswered']:
            print(f"🎯 Command parsed: UNANSWERED")
            return 'UNANSWERED'

        # ONLY THEN try very conservative phonetic variations for single letters
        # Only if the text is EXACTLY these common misheard versions
        if text == 'be' or text == 'bee':
            print(f"🎯 Phonetic match: OPTION_B (heard 'bee')")
            return 'OPTION_B'
        if text == 'see' or text == 'sea':
            print(f"🎯 Phonetic match: OPTION_C (heard 'see')")
            return 'OPTION_C'
        if text == 'dee':
            print(f"🎯 Phonetic match: OPTION_D (heard 'dee')")
            return 'OPTION_D'

        print(f"🎯 Command NOT recognized: '{text}'")
        return None

    def play_mic_on_beep(self):
        """Play a beep sound when microphone starts listening"""
        if self.mic_on_beep:
            self.beep_player.setSource(QUrl.fromLocalFile(self.mic_on_beep))
            self.beep_player.play()

    def play_mic_off_beep(self):
        """Play a beep sound when microphone stops listening"""
        if self.mic_off_beep:
            self.beep_player.setSource(QUrl.fromLocalFile(self.mic_off_beep))
            self.beep_player.play()

    def play_entrance_beep(self):
        """Play a welcoming beep sound when entering the exam"""
        if self.entrance_beep:
            self.beep_player.setSource(QUrl.fromLocalFile(self.entrance_beep))
            self.beep_player.play()

    def _generate_beep_sounds(self):
        """Generate beep sounds for mic on/off feedback and entrance notification"""
        try:
            # Higher pitch beep for mic ON (more urgent/attention)
            self.mic_on_beep = generate_beep_sound(frequency=1200, duration_ms=150)
            self.temp_files.append(self.mic_on_beep)

            # Lower pitch beep for mic OFF (confirmation/completion)
            self.mic_off_beep = generate_beep_sound(frequency=600, duration_ms=200)
            self.temp_files.append(self.mic_off_beep)

            # Pleasant entrance chime (ascending two-tone)
            self.entrance_beep = generate_entrance_chime()
            self.temp_files.append(self.entrance_beep)

        except Exception as e:
            print(f"Warning: Could not generate beep sounds: {e}")
            self.mic_on_beep = None
            self.mic_off_beep = None
            self.entrance_beep = None

    def cleanup(self):
        """Clean up resources aggressively"""
        # Stop silence timer
        self.silence_timer.stop()

        # Force stop everything and return to IDLE
        if self._state == BlindModeState.SPEAKING:
            self.stop_speaking()
        elif self._state == BlindModeState.LISTENING:
            self.stop_listening()
        elif self._state != BlindModeState.IDLE:
            self._set_state(BlindModeState.IDLE, "Cleanup")

        # Aggressively stop all media players
        if self.player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
            self.player.stop()

        if self.beep_player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
            self.beep_player.stop()

        # Force stop any remaining workers
        if self.tts_worker and self.tts_worker.isRunning():
            self.tts_worker.quit()
            self.tts_worker.wait(1000)  # Wait max 1 second
            if self.tts_worker.isRunning():
                self.tts_worker.terminate()  # Force terminate if needed
            self.tts_worker = None

        if self.speech_worker and self.speech_worker.isRunning():
            self.speech_worker.stop_listening()
            self.speech_worker.quit()
            self.speech_worker.wait(1000)  # Wait max 1 second
            if self.speech_worker.isRunning():
                self.speech_worker.terminate()  # Force terminate if needed
            self.speech_worker = None

        # Clean up all temp files
        for file_path in self.temp_files:
            try:
                if os.path.exists(file_path):
                    os.unlink(file_path)
            except Exception:
                pass
        self.temp_files.clear()

    # ── Internal signal handlers ────────────────────────────────────────────

    def _on_tts_finished(self, audio_path: str):
        """Called when TTS generation completes"""
        self.current_audio_file = audio_path
        self.temp_files.append(audio_path)

        # Only play the audio if we're still in SPEAKING state
        # (user might have disabled blind mode while TTS was generating)
        if self._state == BlindModeState.SPEAKING:
            self.player.setSource(QUrl.fromLocalFile(audio_path))
            self.player.play()
        else:
            # TTS completed but we're not in SPEAKING state anymore
            # Clean up and ensure we're IDLE
            self._cleanup_current_audio()
            if self._state != BlindModeState.IDLE:
                self._set_state(BlindModeState.IDLE, "TTS finished but state changed")

    def _on_tts_error(self, error_msg: str):
        """Called when TTS fails"""
        self._set_state(BlindModeState.IDLE, f"TTS error: {error_msg}")
        self.speech_finished.emit()
        print(f"TTS Error: {error_msg}")

    def _on_playback_state_changed(self, state):
        """Called when audio playback state changes"""
        if state == QMediaPlayer.PlaybackState.StoppedState:
            if self._state == BlindModeState.SPEAKING:
                # Speech playback finished naturally
                self._set_state(BlindModeState.IDLE, "Audio playback finished")
                self.speech_finished.emit()
                self._cleanup_current_audio()

    def _on_listening_started(self):
        """Called when speech recognition starts listening"""
        if self._state == BlindModeState.LISTENING:
            self.play_mic_on_beep()  # Play beep when mic turns on

    def _on_speech_recognized(self, text: str):
        """Called when speech is successfully recognized"""
        print(f"📢 Speech recognized: '{text}'")  # Debug

        if self._state != BlindModeState.LISTENING:
            print(f"📢 Ignoring speech - not in LISTENING state: {self._state.value}")  # Debug
            return  # Ignore if we're not in listening state

        # Transition to PROCESSING
        self._set_state(BlindModeState.PROCESSING, f"Processing: {text}")
        self.listening_finished.emit()
        self.play_mic_off_beep()

        # Process the command
        command = self.parse_command(text)
        print(f"📢 Parsed command: {command}")  # Debug

        if command:
            print(f"📢 Emitting command: {command}")  # Debug

            # For commands that immediately trigger speech, transition to IDLE first
            # so the speak() function can work properly
            if command in ['REPEAT', 'CLEAR', 'SUBMIT', 'UNANSWERED']:
                self._set_state(BlindModeState.IDLE, f"Command {command} - preparing for speech")

            self.command_recognized.emit(command)

            # For other commands, transition to IDLE after emission
            if command not in ['REPEAT', 'CLEAR', 'SUBMIT', 'UNANSWERED']:
                self._set_state(BlindModeState.IDLE, f"Command {command} processed")
        else:
            # Unrecognized command - provide more helpful guidance
            suggestions = []
            # Try to suggest what they might have meant
            if any(word in text.lower() for word in ['option', 'select', 'choose', 'answer']):
                suggestions.append("Try saying just the letter: A, B, C, or D")
            if any(word in text.lower() for word in ['go', 'move', 'continue']):
                suggestions.append("Say 'next' or 'previous' to navigate")
            if any(word in text.lower() for word in ['again', 'replay']):
                suggestions.append("Say 'repeat' to hear the question again")

            if suggestions:
                error_msg = f"I heard '{text}' but didn't understand. {suggestions[0]}."
            else:
                error_msg = f"I heard '{text}' but that's not a recognized command. Say A, B, C, D to select an option. Or say Mark, Next, Previous, Repeat, or Clear."

            print(f"📢 Speaking enhanced error guidance: {error_msg}")  # Debug
            self.speak(error_msg)

        # Return to IDLE (unless speak() changed state to SPEAKING) - only for error cases
        if self._state == BlindModeState.PROCESSING and not command:
            self._set_state(BlindModeState.IDLE, "Unrecognized command processed")

    def _on_speech_error(self, error_msg: str):
        """Called when speech recognition fails - provide helpful guidance"""
        if self._state != BlindModeState.LISTENING:
            return  # Ignore if we're not in listening state

        self._set_state(BlindModeState.IDLE, f"Speech error: {error_msg}")
        self.listening_finished.emit()
        self.play_mic_off_beep()

        # Provide helpful feedback based on error type
        if "timeout" in error_msg.lower():
            # Normal timeout - just provide a gentle reminder
            guidance = "No speech detected. Press space and speak when ready."
        elif "Could not understand speech" in error_msg:
            # Recognition failed - give specific guidance
            guidance = "I'm having trouble understanding. Please speak clearly and say one of these: A, B, C, D, Mark, Next, Previous, Repeat, or Clear."
        elif "understand" in error_msg.lower():
            # Recognition got audio but couldn't parse it
            guidance = "I heard you but couldn't understand. Try speaking more clearly. Say A for option A, or repeat for the question again."
        else:
            # Other errors
            guidance = f"The microphone had an issue: {error_msg}. Press space to try again."

        # Speak the guidance
        self.speak(guidance)

    def enable_debug(self, enabled: bool = True):
        """Enable/disable state debugging output"""
        self._debug_states = enabled

    def get_state_info(self) -> str:
        """Get current state information for debugging"""
        return f"State: {self._state.value}, TTS Worker: {self.tts_worker is not None}, Speech Worker: {self.speech_worker is not None}"

    def _cleanup_current_audio(self):
        """Clean up the currently playing audio file"""
        if self.current_audio_file and os.path.exists(self.current_audio_file):
            try:
                os.unlink(self.current_audio_file)
                if self.current_audio_file in self.temp_files:
                    self.temp_files.remove(self.current_audio_file)
            except Exception:
                pass
        self.current_audio_file = None
        """Clean up the currently playing audio file"""
        if self.current_audio_file and os.path.exists(self.current_audio_file):
            try:
                os.unlink(self.current_audio_file)
                if self.current_audio_file in self.temp_files:
                    self.temp_files.remove(self.current_audio_file)
            except Exception:
                pass
        self.current_audio_file = None
