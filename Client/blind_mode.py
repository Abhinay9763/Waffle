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
        # Optimized settings for command recognition
        self.recognizer.dynamic_energy_threshold = True
        self.recognizer.pause_threshold = 0.4  # Faster response for short commands
        self.recognizer.phrase_threshold = 0.2  # Lower threshold for short words
        self.recognizer.non_speaking_duration = 0.4  # Quicker silence detection
        self._should_stop = False  # Flag to stop listening
        self.attempt_count = 0  # Track recognition attempts

    def stop_listening(self):
        """Signal the worker to stop listening"""
        self._should_stop = True

    def run(self):
        self._should_stop = False  # Reset stop flag
        self.attempt_count = 0

        try:
            # Try to use the default microphone with better configuration
            with sr.Microphone(sample_rate=16000, chunk_size=1024) as source:
                self.listening.emit()
                print("🎤 Starting enhanced voice recognition...")

                # Enhanced ambient noise calibration
                self.recognizer.adjust_for_ambient_noise(source, duration=1.0)
                initial_threshold = self.recognizer.energy_threshold

                # Multi-attempt strategy with progressive sensitivity
                attempts_config = [
                    # Attempt 1: More sensitive from the start
                    {"threshold": max(80, initial_threshold * 0.6), "timeout": 4, "phrase_limit": 3, "name": "Sensitive"},
                    # Attempt 2: High sensitivity
                    {"threshold": max(60, initial_threshold * 0.4), "timeout": 5, "phrase_limit": 4, "name": "High Sensitivity"},
                    # Attempt 3: Very high sensitivity
                    {"threshold": max(40, initial_threshold * 0.3), "timeout": 6, "phrase_limit": 5, "name": "Very High"},
                    # Attempt 4: Maximum sensitivity
                    {"threshold": 30, "timeout": 7, "phrase_limit": 6, "name": "Maximum Sensitivity"},
                ]

                for attempt_idx, config in enumerate(attempts_config):
                    if self._should_stop:
                        return

                    self.attempt_count = attempt_idx + 1

                    # Apply attempt-specific settings
                    self.recognizer.energy_threshold = config["threshold"]

                    try:
                        audio = self.recognizer.listen(
                            source,
                            timeout=config["timeout"],
                            phrase_time_limit=config["phrase_limit"]
                        )

                        # Try Google recognition with language optimization
                        try:
                            text = self.recognizer.recognize_google(
                                audio,
                                language="en-US",
                                show_all=False
                            )
                            if text and len(text.strip()) > 0:
                                self.recognized.emit(text.strip())
                                return
                        except sr.UnknownValueError:
                            # Continue to next attempt
                            pass
                        except sr.RequestError as e:
                            # Continue to next attempt (might be temporary API issue)
                            pass

                    except sr.WaitTimeoutError:
                        # Try with more sensitive settings
                        continue
                    except Exception as e:
                        continue

                # All attempts failed
                if not self._should_stop:
                    self.error.emit("Could not understand speech. Please speak clearly.")

        except FileNotFoundError:
            if not self._should_stop:
                self.error.emit("Microphone not found. Please check your microphone connection.")
        except Exception as e:
            if not self._should_stop:
                self.error.emit(f"Microphone setup failed: {str(e)}")


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
        # State machine: only speak if IDLE
        if not self._can_speak():
            return

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
        """Parse recognized speech into a command with enhanced fuzzy matching"""
        original_text = text
        text = text.lower().strip()

        # Remove common filler words and normalize
        filler_words = ['the', 'please', 'select', 'choose', 'go', 'to']
        words = text.split()
        cleaned_words = [word for word in words if word not in filler_words]
        cleaned_text = ' '.join(cleaned_words) if cleaned_words else text

        # EXACT MATCHES FIRST - highest priority

        # Option selection with enhanced variations
        option_patterns = {
            'OPTION_A': [
                'a', 'option a', 'letter a', 'ay', 'hey', 'eh', 'answer a',
                'alpha', 'first option', 'option 1', 'one', 'first'
            ],
            'OPTION_B': [
                'b', 'option b', 'letter b', 'be', 'bee', 'answer b',
                'bravo', 'second option', 'option 2', 'two', 'second'
            ],
            'OPTION_C': [
                'c', 'option c', 'letter c', 'see', 'sea', 'si', 'answer c',
                'charlie', 'third option', 'option 3', 'three', 'third'
            ],
            'OPTION_D': [
                'd', 'option d', 'letter d', 'dee', 'di', 'answer d',
                'delta', 'fourth option', 'option 4', 'four', 'fourth'
            ],
            'OPTION_E': [
                'e', 'option e', 'letter e', 'ee', 'answer e',
                'echo', 'fifth option', 'option 5', 'five', 'fifth'
            ],
            'OPTION_F': [
                'f', 'option f', 'letter f', 'eff', 'answer f',
                'foxtrot', 'sixth option', 'option 6', 'six', 'sixth'
            ]
        }

        # Check option patterns
        for command, patterns in option_patterns.items():
            if text in patterns or cleaned_text in patterns:
                return command

        # Navigation commands with variations
        if any(phrase in text for phrase in ['next', 'forward', 'continue', 'move on']):
            if 'question' in text or len(text.split()) <= 2:  # Avoid false positives
                return 'NEXT'

        if any(phrase in text for phrase in ['previous', 'prev', 'back', 'return', 'go back']):
            if 'question' in text or len(text.split()) <= 2:
                return 'PREV'

        # Action commands with enhanced matching
        if any(phrase in text for phrase in ['mark', 'flag', 'bookmark', 'review']):
            return 'MARK'

        if any(phrase in text for phrase in ['repeat', 'again', 'read again', 'say again', 'once more']):
            return 'REPEAT'

        if any(phrase in text for phrase in ['clear', 'remove', 'delete', 'erase', 'unselect']):
            if 'answer' in text or len(text.split()) <= 2:
                return 'CLEAR'

        if any(phrase in text for phrase in ['submit', 'finish', 'done', 'complete', 'end']):
            if any(word in text for word in ['exam', 'test', 'quiz']) or len(text.split()) <= 2:
                return 'SUBMIT'

        if any(phrase in text for phrase in ['unanswered', 'skipped', 'empty', 'blank']):
            return 'UNANSWERED'

        # FUZZY MATCHING for single letters (handle speech recognition errors)
        single_letter_sounds = {
            'OPTION_A': ['ay', 'hey', 'eh', 'aye', 'ey'],
            'OPTION_B': ['be', 'bee', 'bi', 'beat', 'bea'],
            'OPTION_C': ['see', 'sea', 'si', 'cee', 'key'],
            'OPTION_D': ['dee', 'di', 'the', 'tea', 'de'],
            'OPTION_E': ['ee', 'e', 'i', 'each', 'he'],
            'OPTION_F': ['eff', 'ef', 'half', 'laugh', 'staff']
        }

        # Check single letter sounds only if it's a short phrase (avoid false positives)
        if len(words) <= 2:
            for command, sounds in single_letter_sounds.items():
                if text in sounds or cleaned_text in sounds:
                    return command

        # PARTIAL MATCHING - if we hear part of a command
        if len(text) >= 3:  # Minimum 3 characters to avoid false matches
            if 'nex' in text:
                return 'NEXT'
            if 'pre' in text or 'bac' in text:
                return 'PREV'
            if 'mar' in text:
                return 'MARK'
            if 'rep' in text:
                return 'REPEAT'
            if 'cle' in text or 'cla' in text:
                return 'CLEAR'
            if 'sub' in text or 'fin' in text:
                return 'SUBMIT'

        # If no match found, return None
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

        if command:
            # For commands that immediately trigger speech, transition to IDLE first
            # so the speak() function can work properly
            if command in ['REPEAT', 'CLEAR', 'SUBMIT', 'UNANSWERED', 'NEXT', 'PREV', 'MARK'] or command.startswith('OPTION_'):
                self._set_state(BlindModeState.IDLE, f"Command {command} - preparing for speech")

            self.command_recognized.emit(command)

            # For other commands, transition to IDLE after emission
            if command not in ['REPEAT', 'CLEAR', 'SUBMIT', 'UNANSWERED', 'NEXT', 'PREV', 'MARK'] and not command.startswith('OPTION_'):
                self._set_state(BlindModeState.IDLE, f"Command {command} processed")
        else:
            # Unrecognized command - provide helpful guidance
            if any(word in text.lower() for word in ['option', 'select', 'choose', 'answer']):
                error_msg = "Try saying just the letter: A, B, C, or D."
            elif any(word in text.lower() for word in ['go', 'move', 'continue']):
                error_msg = "Say 'Next' or 'Back' to navigate."
            elif any(word in text.lower() for word in ['again', 'replay']):
                error_msg = "Say 'Repeat' to hear the question again."
            else:
                error_msg = "Say: A, B, C, D, Next, Back, Mark, Clear, or Repeat."

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
        if "Could not understand speech" in error_msg:
            # Recognition failed after all attempts - give encouragement
            guidance = "Try speaking more clearly. Say: A, B, C, D, Next, Back, Mark, Clear, or Repeat."
        elif "Microphone not found" in error_msg:
            # Hardware issue
            guidance = "Microphone not detected. Please check your microphone connection and try again."
        elif "setup failed" in error_msg:
            # Setup issue
            guidance = "Microphone setup failed. Please check your audio settings."
        else:
            # Fallback for other errors
            guidance = "Speech recognition issue. Press space to try again."

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
