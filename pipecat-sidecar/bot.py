"""PipecatBot — one instance per active meeting.

KEY DESIGN RULE: this bot is a dumb audio pipe. It does NOT run Claude for
reasoning and does NOT query memory. It transcribes audio, forwards
transcript chunks to Next.js, and plays audio when told to. All
intelligence (classification, memory lookup, response composition) lives
in the Next.js agents.

Pipeline: MeetingBaaS WebSocket (audio in)
            -> VAD (Silero)
            -> STT (Groq Whisper)         -> POST chunks to Next.js webhook
            -> TTS (ElevenLabs / Google)  <- text queued via queue_speech()
            -> MeetingBaaS WebSocket (audio out)
"""

import asyncio
import os
from datetime import datetime, timezone

import httpx
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import EndFrame, Frame, TranscriptionFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.elevenlabs import ElevenLabsTTSService
from pipecat.services.google import GoogleTTSService
from pipecat.services.groq import GroqSTTService

# NOTE: adjust this import to match the installed pipecat-ai version if the
# MeetingBaaS transport module path differs.
from pipecat.transports.services.meetingbaas import (
    MeetingBaasParams,
    MeetingBaasTransport,
)

# Guardrail: 8s timeout on the Python side (10s on the TS side) to leave headroom.
VENDOR_TIMEOUT_S = 8.0


class TranscriptForwarder(FrameProcessor):
    """Forwards final STT transcript chunks to the Next.js webhook.

    Fire-and-forget: a failed POST never blocks or breaks the audio pipeline.
    """

    def __init__(self, meeting_id: str, webhook_base_url: str, secret: str):
        super().__init__()
        self._meeting_id = meeting_id
        self._url = f"{webhook_base_url.rstrip('/')}/api/bot/pipecat-transcript"
        self._secret = secret
        self._client = httpx.AsyncClient(timeout=VENDOR_TIMEOUT_S)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame):
            asyncio.create_task(self._forward(frame))
        await self.push_frame(frame, direction)

    async def _forward(self, frame: TranscriptionFrame):
        payload = {
            "meeting_id": self._meeting_id,
            "text": frame.text,
            "speaker_label": getattr(frame, "user_id", None) or "unknown",
            "timestamp": getattr(frame, "timestamp", None)
            or datetime.now(timezone.utc).isoformat(),
        }
        try:
            await self._client.post(
                self._url,
                json=payload,
                headers={"Authorization": f"Bearer {self._secret}"},
            )
        except Exception as exc:  # noqa: BLE001 — never break the pipeline
            logger.warning(
                "transcript forward failed meeting_id={} error={}",
                self._meeting_id,
                exc,
            )

    async def close(self):
        await self._client.aclose()


def _build_tts():
    """ElevenLabs is the primary voice; Google TTS is the fallback."""
    elevenlabs_key = os.environ.get("ELEVENLABS_API_KEY")
    if elevenlabs_key:
        return ElevenLabsTTSService(
            api_key=elevenlabs_key,
            voice_id=os.environ.get("ELEVENLABS_VOICE_ID", ""),
            model="eleven_turbo_v2_5",
        )
    logger.warning("ELEVENLABS_API_KEY not set — falling back to Google TTS")
    return GoogleTTSService(
        credentials=os.environ.get("GOOGLE_TTS_API_KEY", ""),
        voice="en-US-Neural2-D",
    )


class PipecatBot:
    """Owns the Pipecat pipeline for a single meeting."""

    def __init__(self, meeting_url: str, bot_name: str, meeting_id: str):
        self.meeting_url = meeting_url
        self.bot_name = bot_name
        self.meeting_id = meeting_id
        self._speech_queue: asyncio.Queue[str] = asyncio.Queue()
        self._running = False
        self._task: PipelineTask | None = None
        self._forwarder: TranscriptForwarder | None = None

    async def run(self):
        """Main pipeline loop. Called as an asyncio task by app.py."""
        logger.info(
            "starting bot meeting_id={} url={}", self.meeting_id, self.meeting_url
        )

        transport = MeetingBaasTransport(
            api_key=os.environ["MEETING_BAAS_API_KEY"],
            meeting_url=self.meeting_url,
            bot_name=self.bot_name,
            params=MeetingBaasParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                vad_analyzer=SileroVADAnalyzer(),
            ),
        )

        stt = GroqSTTService(
            api_key=os.environ["GROQ_API_KEY"],
            model="whisper-large-v3-turbo",
        )

        tts = _build_tts()

        self._forwarder = TranscriptForwarder(
            meeting_id=self.meeting_id,
            webhook_base_url=os.environ["NEXTJS_WEBHOOK_URL"],
            secret=os.environ["PIPECAT_SERVICE_SECRET"],
        )

        pipeline = Pipeline(
            [
                transport.input(),   # audio in from the meeting
                stt,                 # Groq Whisper
                self._forwarder,     # POST chunks to Next.js (non-blocking)
                tts,                 # speaks only when a TTSSpeakFrame is queued
                transport.output(),  # audio out into the meeting
            ]
        )

        self._task = PipelineTask(
            pipeline,
            params=PipelineParams(allow_interruptions=True),
        )

        self._running = True
        speech_consumer = asyncio.create_task(self._consume_speech_queue())

        try:
            runner = PipelineRunner()
            await runner.run(self._task)
        finally:
            self._running = False
            speech_consumer.cancel()
            if self._forwarder:
                await self._forwarder.close()
            logger.info("bot stopped meeting_id={}", self.meeting_id)

    async def _consume_speech_queue(self):
        """Plays queued speech. The VAD-aware pipeline injects audio at the
        next natural pause rather than cutting a speaker off."""
        while True:
            text = await self._speech_queue.get()
            if not self._running or self._task is None:
                continue
            logger.info(
                "speaking meeting_id={} chars={}", self.meeting_id, len(text)
            )
            await self._task.queue_frames([TTSSpeakFrame(text=text)])

    async def queue_speech(self, text: str):
        """Called by the POST /bots/:id/speak endpoint."""
        await self._speech_queue.put(text)

    async def terminate(self):
        """Clean up and disconnect from the meeting."""
        logger.info("terminating bot meeting_id={}", self.meeting_id)
        self._running = False
        if self._task is not None:
            await self._task.queue_frames([EndFrame()])
